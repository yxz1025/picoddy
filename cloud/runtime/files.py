#!/usr/bin/env python3
"""Bounded JSON-file RPC for Pi-compatible tools inside the remote sandbox."""

from __future__ import annotations

import base64
import difflib
import errno
import fnmatch
import json
import os
import re
import signal
import stat
import sys
import time
from typing import Any, Iterator


ROOT = os.path.abspath(os.environ.get("PICODDY_FILE_ROOT", "/workspace"))
MAX_REQUEST_BYTES = 2 * 1024 * 1024
MAX_FILE_BYTES = 8 * 1024 * 1024
MAX_WRITE_BYTES = 1024 * 1024
MAX_IMAGE_BYTES = 512 * 1024
MAX_OUTPUT_BYTES = 50 * 1024
MAX_LINES = 2_000
MAX_LINE_LENGTH = 500
MAX_PATH_BYTES = 4 * 1024
MAX_SCAN_ENTRIES = 20_000
MAX_GREP_FILES = 2_000
MAX_GREP_BYTES = 16 * 1024 * 1024
SEARCH_SECONDS = 3.0
REGEX_SECONDS = 1.0
SKIP_DIRECTORIES = {".git", "node_modules", "__pycache__"}
UUID = re.compile(r"^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$", re.I)


class RpcError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code


class RegexDeadline(Exception):
    pass


def _response(payload: dict[str, Any]) -> None:
    sys.stdout.write(json.dumps(payload, separators=(",", ":"), ensure_ascii=False))
    sys.stdout.write("\n")
    sys.stdout.flush()


def _request_name(path: str) -> str:
    if not isinstance(path, str) or "\x00" in path or "\\" in path:
        raise RpcError("INVALID_REQUEST_PATH", "Invalid request path")
    absolute = os.path.abspath(path)
    if os.path.dirname(absolute) != ROOT:
        raise RpcError("INVALID_REQUEST_PATH", "Request must be directly under the workspace root")
    match = re.fullmatch(r"\.file-request-([0-9a-f-]+)\.json", os.path.basename(absolute), re.I)
    if not match or not UUID.fullmatch(match.group(1)):
        raise RpcError("INVALID_REQUEST_PATH", "Request filename must contain a UUID")
    return os.path.basename(absolute)


def _root_fd() -> int:
    if os.path.realpath(ROOT) != ROOT:
        raise RpcError("SYMLINK_FORBIDDEN", "Workspace root cannot be a symlink")
    try:
        return os.open(ROOT, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW)
    except OSError as error:
        raise RpcError("WORKSPACE_UNAVAILABLE", "Workspace root is unavailable") from error


def _path_parts(path: Any) -> list[str]:
    if not isinstance(path, str) or not path or len(path.encode("utf-8")) > MAX_PATH_BYTES:
        raise RpcError("INVALID_PATH", "Path must be a non-empty workspace path")
    if "\\" in path or any(ord(char) < 32 or ord(char) == 127 for char in path):
        raise RpcError("INVALID_PATH", "Path contains forbidden characters")
    if path == ROOT:
        return []
    prefix = ROOT + "/"
    if not path.startswith(prefix):
        raise RpcError("PATH_OUTSIDE_WORKSPACE", "Path must remain within the workspace")
    parts = path[len(prefix):].split("/")
    if any(not part or part in (".", "..") for part in parts):
        raise RpcError("INVALID_PATH", "Path is not canonical")
    return parts


def _is_symlink(parent_fd: int, name: str) -> bool:
    try:
        return stat.S_ISLNK(os.stat(name, dir_fd=parent_fd, follow_symlinks=False).st_mode)
    except FileNotFoundError:
        return False


def _open_directory(parts: list[str], create: bool = False) -> int:
    current = _root_fd()
    try:
        for part in parts:
            if _is_symlink(current, part):
                raise RpcError("SYMLINK_FORBIDDEN", "Symbolic links are not followed")
            if create:
                try:
                    os.mkdir(part, 0o700, dir_fd=current)
                except FileExistsError:
                    pass
            try:
                child = os.open(part, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=current)
            except FileNotFoundError as error:
                raise RpcError("PATH_NOT_FOUND", "Directory does not exist") from error
            except NotADirectoryError as error:
                raise RpcError("NOT_A_DIRECTORY", "A path component is not a directory") from error
            except OSError as error:
                if error.errno in (errno.ELOOP, errno.EMLINK):
                    raise RpcError("SYMLINK_FORBIDDEN", "Symbolic links are not followed") from error
                raise
            os.close(current)
            current = child
        return current
    except Exception:
        os.close(current)
        raise


def _open_file(parts: list[str], flags: int, mode: int = 0o600, create_parents: bool = False) -> int:
    if not parts:
        raise RpcError("NOT_A_FILE", "Workspace root is not a file")
    parent = _open_directory(parts[:-1], create=create_parents)
    try:
        if _is_symlink(parent, parts[-1]):
            raise RpcError("SYMLINK_FORBIDDEN", "Symbolic links are not followed")
        try:
            descriptor = os.open(parts[-1], flags | os.O_NOFOLLOW, mode, dir_fd=parent)
        except FileNotFoundError as error:
            raise RpcError("PATH_NOT_FOUND", "File does not exist") from error
        except IsADirectoryError as error:
            raise RpcError("NOT_A_FILE", "Path is not a regular file") from error
        except OSError as error:
            if error.errno in (errno.ELOOP, errno.EMLINK):
                raise RpcError("SYMLINK_FORBIDDEN", "Symbolic links are not followed") from error
            raise
    finally:
        os.close(parent)
    metadata = os.fstat(descriptor)
    if not stat.S_ISREG(metadata.st_mode):
        os.close(descriptor)
        raise RpcError("NOT_A_FILE", "Path is not a regular file")
    return descriptor


def _read_descriptor(descriptor: int, maximum: int) -> bytes:
    size = os.fstat(descriptor).st_size
    if size > maximum:
        raise RpcError("FILE_TOO_LARGE", f"File exceeds the {maximum}-byte limit")
    chunks: list[bytes] = []
    total = 0
    while True:
        chunk = os.read(descriptor, min(64 * 1024, maximum + 1 - total))
        if not chunk:
            break
        total += len(chunk)
        if total > maximum:
            raise RpcError("FILE_TOO_LARGE", f"File exceeds the {maximum}-byte limit")
        chunks.append(chunk)
    return b"".join(chunks)


def _write_all(descriptor: int, content: bytes) -> None:
    view = memoryview(content)
    while view:
        written = os.write(descriptor, view)
        if written <= 0:
            raise RpcError("WRITE_FAILED", "Could not finish writing the file")
        view = view[written:]
    os.fsync(descriptor)


def _bounded_lines(lines: list[str], maximum_lines: int = MAX_LINES) -> tuple[str, bool]:
    output: list[str] = []
    used = 0
    truncated = False
    for line in lines[:maximum_lines]:
        encoded = line.encode("utf-8")
        separator = 1 if output else 0
        if used + separator + len(encoded) > MAX_OUTPUT_BYTES:
            truncated = True
            break
        output.append(line)
        used += separator + len(encoded)
    if len(lines) > len(output):
        truncated = True
    return "\n".join(output), truncated


def _image_mime(content: bytes) -> str | None:
    if content.startswith(b"\x89PNG\r\n\x1a\n"):
        return "image/png"
    if content.startswith(b"\xff\xd8\xff"):
        return "image/jpeg"
    if content.startswith((b"GIF87a", b"GIF89a")):
        return "image/gif"
    if content.startswith(b"BM"):
        return "image/bmp"
    if len(content) >= 12 and content[:4] == b"RIFF" and content[8:12] == b"WEBP":
        return "image/webp"
    return None


def _read(request: dict[str, Any]) -> dict[str, Any]:
    descriptor = _open_file(_path_parts(request.get("path")), os.O_RDONLY)
    try:
        content = _read_descriptor(descriptor, MAX_FILE_BYTES)
    finally:
        os.close(descriptor)
    mime_type = _image_mime(content)
    if mime_type:
        if len(content) > MAX_IMAGE_BYTES:
            raise RpcError("IMAGE_TOO_LARGE", f"Image exceeds the {MAX_IMAGE_BYTES}-byte limit")
        return {
            "kind": "image",
            "text": f"Read image file [{mime_type}]",
            "mimeType": mime_type,
            "data": base64.b64encode(content).decode("ascii"),
            "details": {"bytes": len(content)},
        }
    try:
        text = content.decode("utf-8")
    except UnicodeDecodeError as error:
        raise RpcError("NOT_UTF8", "File is not valid UTF-8 text or a supported image") from error
    lines = text.split("\n")
    offset = request.get("offset")
    limit = request.get("limit")
    if offset is None:
        offset = 1
    if not isinstance(offset, int) or isinstance(offset, bool) or offset < 1:
        raise RpcError("INVALID_OFFSET", "offset must be a positive integer")
    if limit is not None and (not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > MAX_LINES):
        raise RpcError("INVALID_LIMIT", f"limit must be between 1 and {MAX_LINES}")
    start = offset - 1
    if start >= len(lines):
        raise RpcError("OFFSET_OUT_OF_RANGE", f"Offset {offset} is beyond the end of the file ({len(lines)} lines)")
    selected = lines[start:start + limit] if limit is not None else lines[start:]
    rendered, truncated = _bounded_lines(selected, min(limit or MAX_LINES, MAX_LINES))
    returned_lines = 0 if rendered == "" and not selected else rendered.count("\n") + 1
    details = {
        "totalLines": len(lines),
        "startLine": offset,
        "returnedLines": returned_lines,
        "truncation": {"truncated": truncated, "maxLines": MAX_LINES, "maxBytes": MAX_OUTPUT_BYTES},
    }
    if truncated:
        rendered += f"\n\n[Output truncated. Continue with offset={offset + returned_lines}.]"
    return {"kind": "text", "text": rendered, "details": details}


def _write(request: dict[str, Any]) -> dict[str, Any]:
    content = request.get("content")
    if not isinstance(content, str):
        raise RpcError("INVALID_CONTENT", "content must be a string")
    encoded = content.encode("utf-8")
    if len(encoded) > MAX_WRITE_BYTES:
        raise RpcError("CONTENT_TOO_LARGE", f"content exceeds the {MAX_WRITE_BYTES}-byte limit")
    descriptor = _open_file(
        _path_parts(request.get("path")),
        os.O_WRONLY | os.O_CREAT | os.O_TRUNC,
        create_parents=True,
    )
    try:
        _write_all(descriptor, encoded)
    finally:
        os.close(descriptor)
    return {"kind": "text", "text": f"Successfully wrote to {request['path']}", "details": {"bytes": len(encoded)}}


def _edit(request: dict[str, Any]) -> dict[str, Any]:
    edits = request.get("edits")
    if not isinstance(edits, list) or not edits or len(edits) > 100:
        raise RpcError("INVALID_EDITS", "edits must contain between 1 and 100 replacements")
    descriptor = _open_file(_path_parts(request.get("path")), os.O_RDWR)
    try:
        original_bytes = _read_descriptor(descriptor, MAX_FILE_BYTES)
        try:
            original = original_bytes.decode("utf-8")
        except UnicodeDecodeError as error:
            raise RpcError("NOT_UTF8", "Edited file must be UTF-8 text") from error
        bom = "\ufeff" if original.startswith("\ufeff") else ""
        body = original[len(bom):]
        newline = "\r\n" if "\r\n" in body else "\n"
        normalized = body.replace("\r\n", "\n").replace("\r", "\n")
        replacements: list[tuple[int, int, str]] = []
        request_bytes = 0
        for index, edit in enumerate(edits):
            if not isinstance(edit, dict) or not isinstance(edit.get("oldText"), str) or not isinstance(edit.get("newText"), str):
                raise RpcError("INVALID_EDITS", f"edits[{index}] must contain string oldText and newText")
            old_text = edit["oldText"].replace("\r\n", "\n").replace("\r", "\n")
            new_text = edit["newText"].replace("\r\n", "\n").replace("\r", "\n")
            request_bytes += len(old_text.encode("utf-8")) + len(new_text.encode("utf-8"))
            if not old_text:
                raise RpcError("INVALID_EDITS", "oldText cannot be empty")
            if normalized.count(old_text) != 1:
                raise RpcError("EDIT_MATCH_NOT_UNIQUE", f"edits[{index}].oldText must match exactly once")
            start = normalized.find(old_text)
            replacements.append((start, start + len(old_text), new_text))
        if request_bytes > MAX_WRITE_BYTES:
            raise RpcError("EDITS_TOO_LARGE", "Combined edit text exceeds its byte limit")
        ordered = sorted(replacements)
        for previous, current in zip(ordered, ordered[1:]):
            if current[0] < previous[1]:
                raise RpcError("EDIT_OVERLAP", "Edits cannot overlap")
        changed = normalized
        for start, end, replacement in reversed(ordered):
            changed = changed[:start] + replacement + changed[end:]
        if changed == normalized:
            raise RpcError("NO_CHANGES", "Edit produced no changes")
        restored = bom + (changed.replace("\n", newline) if newline != "\n" else changed)
        encoded = restored.encode("utf-8")
        if len(encoded) > MAX_FILE_BYTES:
            raise RpcError("FILE_TOO_LARGE", "Edited file exceeds its byte limit")
        os.lseek(descriptor, 0, os.SEEK_SET)
        os.ftruncate(descriptor, 0)
        _write_all(descriptor, encoded)
    finally:
        os.close(descriptor)
    original_lines = normalized.splitlines(keepends=True)
    changed_lines = changed.splitlines(keepends=True)
    patch = "".join(difflib.unified_diff(original_lines, changed_lines, fromfile=request["path"], tofile=request["path"]))
    patch_text, patch_truncated = _bounded_lines(patch.split("\n"))
    first_changed = min((start for start, _end, _replacement in ordered), default=0)
    first_changed_line = normalized.count("\n", 0, first_changed) + 1
    return {
        "kind": "text",
        "text": patch_text or f"Successfully edited {request['path']}",
        "details": {"diff": patch_text, "patch": patch_text, "firstChangedLine": first_changed_line, "truncated": patch_truncated},
    }


def _directory_entries(descriptor: int) -> list[str]:
    try:
        return os.listdir(descriptor)
    except OSError as error:
        raise RpcError("DIRECTORY_READ_FAILED", "Cannot read directory") from error


def _ls(request: dict[str, Any]) -> dict[str, Any]:
    limit = request.get("limit", 500)
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > 2_000:
        raise RpcError("INVALID_LIMIT", "limit must be between 1 and 2000")
    descriptor = _open_directory(_path_parts(request.get("path")))
    try:
        entries = sorted(_directory_entries(descriptor), key=str.casefold)
        rendered: list[str] = []
        for name in entries[:limit]:
            metadata = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
            suffix = "/" if stat.S_ISDIR(metadata.st_mode) else "@" if stat.S_ISLNK(metadata.st_mode) else ""
            rendered.append(name + suffix)
    finally:
        os.close(descriptor)
    text, byte_truncated = _bounded_lines(rendered, limit)
    truncated = len(entries) > len(rendered) or byte_truncated
    if truncated:
        text += f"\n\n[Output truncated. Showing {len(rendered)} of {len(entries)} entries.]"
    return {"kind": "text", "text": text, "details": {"count": len(rendered), "truncated": truncated}}


def _walk(descriptor: int, prefix: str, state: dict[str, Any]) -> Iterator[tuple[str, os.stat_result, int | None]]:
    if time.monotonic() > state["deadline"]:
        raise RpcError("SEARCH_TIMEOUT", "Search exceeded its time budget")
    for name in sorted(_directory_entries(descriptor), key=str.casefold):
        state["entries"] += 1
        if state["entries"] > MAX_SCAN_ENTRIES:
            raise RpcError("SEARCH_LIMIT", "Search examined too many entries")
        metadata = os.stat(name, dir_fd=descriptor, follow_symlinks=False)
        relative = f"{prefix}/{name}" if prefix else name
        if stat.S_ISLNK(metadata.st_mode):
            continue
        if stat.S_ISDIR(metadata.st_mode):
            yield relative + "/", metadata, None
            if name in SKIP_DIRECTORIES:
                continue
            child = os.open(name, os.O_RDONLY | os.O_DIRECTORY | os.O_NOFOLLOW, dir_fd=descriptor)
            try:
                yield from _walk(child, relative, state)
            finally:
                os.close(child)
        elif stat.S_ISREG(metadata.st_mode):
            yield relative, metadata, descriptor


def _glob_match(path: str, pattern: str) -> bool:
    candidate = path[:-1] if path.endswith("/") else path
    basename = candidate.rsplit("/", 1)[-1]
    return fnmatch.fnmatchcase(candidate, pattern) or ("/" not in pattern and fnmatch.fnmatchcase(basename, pattern))


def _find(request: dict[str, Any]) -> dict[str, Any]:
    pattern = request.get("pattern")
    limit = request.get("limit", 1_000)
    if not isinstance(pattern, str) or not pattern or len(pattern.encode("utf-8")) > MAX_PATH_BYTES:
        raise RpcError("INVALID_PATTERN", "pattern must be a non-empty bounded string")
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > 2_000:
        raise RpcError("INVALID_LIMIT", "limit must be between 1 and 2000")
    descriptor = _open_directory(_path_parts(request.get("path")))
    matches: list[str] = []
    state = {"entries": 0, "deadline": time.monotonic() + SEARCH_SECONDS}
    try:
        for relative, _metadata, _parent in _walk(descriptor, "", state):
            if _glob_match(relative, pattern):
                matches.append(relative)
                if len(matches) >= limit:
                    break
    finally:
        os.close(descriptor)
    text, byte_truncated = _bounded_lines(matches, limit)
    truncated = len(matches) >= limit or byte_truncated
    if not matches:
        text = "No files found matching pattern"
    elif truncated:
        text += f"\n\n[Output truncated at {len(matches)} results.]"
    return {"kind": "text", "text": text, "details": {"count": len(matches), "truncated": truncated}}


def _regex_alarm(_signum: int, _frame: Any) -> None:
    raise RegexDeadline()


def _grep(request: dict[str, Any]) -> dict[str, Any]:
    pattern = request.get("pattern")
    if not isinstance(pattern, str) or len(pattern.encode("utf-8")) > MAX_PATH_BYTES:
        raise RpcError("INVALID_PATTERN", "pattern must be a bounded string")
    literal = request.get("literal", False)
    ignore_case = request.get("ignoreCase", False)
    context = request.get("context", 0)
    limit = request.get("limit", 100)
    glob = request.get("glob")
    if not isinstance(literal, bool) or not isinstance(ignore_case, bool):
        raise RpcError("INVALID_OPTIONS", "literal and ignoreCase must be booleans")
    if not isinstance(context, int) or isinstance(context, bool) or context < 0 or context > 20:
        raise RpcError("INVALID_CONTEXT", "context must be between 0 and 20")
    if not isinstance(limit, int) or isinstance(limit, bool) or limit < 1 or limit > 1_000:
        raise RpcError("INVALID_LIMIT", "limit must be between 1 and 1000")
    if glob is not None and (not isinstance(glob, str) or not glob or len(glob.encode("utf-8")) > MAX_PATH_BYTES):
        raise RpcError("INVALID_GLOB", "glob must be a non-empty bounded string")

    compiled: re.Pattern[str] | None = None
    if not literal:
        try:
            compiled = re.compile(pattern, re.IGNORECASE if ignore_case else 0)
        except re.error as error:
            raise RpcError("INVALID_REGEX", str(error)) from error
    needle = pattern.casefold() if ignore_case and literal else pattern
    target_parts = _path_parts(request.get("path"))
    root = _root_fd()
    files: list[tuple[str, list[str], int]] = []
    try:
        if target_parts:
            parent = _open_directory(target_parts[:-1])
            try:
                name = target_parts[-1]
                if _is_symlink(parent, name):
                    raise RpcError("SYMLINK_FORBIDDEN", "Symbolic links are not followed")
                metadata = os.stat(name, dir_fd=parent, follow_symlinks=False)
            except FileNotFoundError as error:
                raise RpcError("PATH_NOT_FOUND", "Search path does not exist") from error
            finally:
                os.close(parent)
            if stat.S_ISREG(metadata.st_mode):
                files.append((name, target_parts, metadata.st_size))
            elif not stat.S_ISDIR(metadata.st_mode):
                raise RpcError("INVALID_PATH", "Search path must be a regular file or directory")
        if not files:
            if target_parts:
                os.close(root)
                root = _open_directory(target_parts)
            state = {"entries": 0, "deadline": time.monotonic() + SEARCH_SECONDS}
            for relative, metadata, _parent in _walk(root, "", state):
                if relative.endswith("/") or (glob and not _glob_match(relative, glob)):
                    continue
                files.append((relative, target_parts + relative.split("/"), metadata.st_size))
                if len(files) >= MAX_GREP_FILES:
                    break

        previous_handler = signal.getsignal(signal.SIGALRM)
        if compiled is not None:
            signal.signal(signal.SIGALRM, _regex_alarm)
            signal.setitimer(signal.ITIMER_REAL, REGEX_SECONDS)
        output: list[str] = []
        matches = 0
        scanned_bytes = 0
        deadline = time.monotonic() + SEARCH_SECONDS
        try:
            for display_path, parts, expected_size in files:
                if time.monotonic() > deadline:
                    raise RpcError("SEARCH_TIMEOUT", "Search exceeded its time budget")
                if expected_size > 2 * 1024 * 1024:
                    continue
                descriptor = _open_file(parts, os.O_RDONLY)
                try:
                    content = _read_descriptor(descriptor, 2 * 1024 * 1024)
                finally:
                    os.close(descriptor)
                scanned_bytes += len(content)
                if scanned_bytes > MAX_GREP_BYTES:
                    raise RpcError("SEARCH_LIMIT", "Search exceeded its byte budget")
                try:
                    lines = content.decode("utf-8").split("\n")
                except UnicodeDecodeError:
                    continue
                matched_indexes: list[int] = []
                for index, line in enumerate(lines):
                    haystack = line.casefold() if ignore_case and literal else line
                    matched = needle in haystack if literal else bool(compiled and compiled.search(line))
                    if matched:
                        matched_indexes.append(index)
                        matches += 1
                        if matches >= limit:
                            break
                for index in matched_indexes:
                    start = max(0, index - context)
                    end = min(len(lines), index + context + 1)
                    for line_index in range(start, end):
                        marker = ":" if line_index == index else "-"
                        line = lines[line_index]
                        if len(line) > MAX_LINE_LENGTH:
                            line = line[:MAX_LINE_LENGTH] + "…"
                        output.append(f"{display_path}{marker}{line_index + 1}{marker}{line}")
                if matches >= limit:
                    break
        except RegexDeadline as error:
            raise RpcError("REGEX_TIMEOUT", "Regular expression exceeded its time budget") from error
        finally:
            if compiled is not None:
                signal.setitimer(signal.ITIMER_REAL, 0)
                signal.signal(signal.SIGALRM, previous_handler)
    finally:
        os.close(root)

    text, byte_truncated = _bounded_lines(output, len(output) or 1)
    truncated = matches >= limit or byte_truncated or len(files) >= MAX_GREP_FILES
    if not output:
        text = "No matches found"
    elif truncated:
        text += f"\n\n[Output truncated at {matches} matches.]"
    return {"kind": "text", "text": text, "details": {"matches": matches, "truncated": truncated}}


OPERATIONS = {"read": _read, "write": _write, "edit": _edit, "grep": _grep, "find": _find, "ls": _ls}


def _load_request(path: str) -> dict[str, Any]:
    name = _request_name(path)
    root = _root_fd()
    descriptor = -1
    try:
        if _is_symlink(root, name):
            raise RpcError("SYMLINK_FORBIDDEN", "Request cannot be a symbolic link")
        descriptor = os.open(name, os.O_RDONLY | os.O_NOFOLLOW, dir_fd=root)
        if not stat.S_ISREG(os.fstat(descriptor).st_mode):
            raise RpcError("INVALID_REQUEST", "Request must be a regular file")
        content = _read_descriptor(descriptor, MAX_REQUEST_BYTES)
        os.unlink(name, dir_fd=root)
    finally:
        if descriptor >= 0:
            os.close(descriptor)
        os.close(root)
    try:
        request = json.loads(content)
    except (UnicodeDecodeError, json.JSONDecodeError) as error:
        raise RpcError("INVALID_REQUEST", "Request is not valid UTF-8 JSON") from error
    if not isinstance(request, dict):
        raise RpcError("INVALID_REQUEST", "Request must be a JSON object")
    return request


def _cleanup(path: str) -> None:
    name = _request_name(path)
    root = _root_fd()
    try:
        if _is_symlink(root, name):
            raise RpcError("SYMLINK_FORBIDDEN", "Request cannot be a symbolic link")
        try:
            os.unlink(name, dir_fd=root)
        except FileNotFoundError:
            pass
    finally:
        os.close(root)


def main(argv: list[str]) -> int:
    try:
        if len(argv) == 3 and argv[1] == "--cleanup":
            _cleanup(argv[2])
            return 0
        if len(argv) != 2:
            raise RpcError("INVALID_ARGUMENTS", "Usage: files.py request.json")
        request = _load_request(argv[1])
        operation = request.get("operation")
        if operation not in OPERATIONS:
            raise RpcError("INVALID_OPERATION", "Unsupported file operation")
        result = OPERATIONS[operation](request)
        _response({"ok": True, "result": result})
        return 0
    except RpcError as error:
        _response({"ok": False, "error": {"code": error.code, "message": str(error)}})
        return 0
    except Exception:
        _response({"ok": False, "error": {"code": "INTERNAL_ERROR", "message": "File operation failed"}})
        return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
