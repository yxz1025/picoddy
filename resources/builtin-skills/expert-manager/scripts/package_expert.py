#!/usr/bin/env python3
"""Validate and create a bounded sharing archive for one Agent expert.

Registration installs an expert in the fixed Pi-a marketplace.  This script
only creates a portable ZIP for sharing; it never modifies registration state.

Usage:
    package_expert.py <path/to/expert-dir> [output-dir]
"""

import os
import sys
import tempfile
import zipfile
from pathlib import Path, PurePosixPath

# Import the authoritative validator from the sibling script.
script_dir = Path(__file__).parent
sys.path.insert(0, str(script_dir))
from validate_expert import validate_expert


MAX_PACKAGE_BYTES = 64 * 1024 * 1024

# These directories are generated caches or dependency trees and are never
# part of a shareable expert package.  ``dist`` is handled separately below so
# that only the expert root's build output is excluded.
SKIP_DIR_NAMES = {
    "__pycache__",
    "node_modules",
    ".cache",
    ".pytest_cache",
    ".mypy_cache",
    ".ruff_cache",
    "tmp",
    "temp",
}
SKIP_FILE_NAMES = {
    ".DS_Store",
    "Thumbs.db",
}
SKIP_FILE_SUFFIXES = (".tmp", ".temp", ".part", ".swp", "~")


def _absolute_path(value):
    """Return an absolute lexical path without resolving symlinks."""
    path = Path(value).expanduser()
    return path if path.is_absolute() else Path.cwd() / path


def _archive_name(expert_name, relative_path):
    """Build a POSIX archive path regardless of the host platform."""
    return PurePosixPath(expert_name, *relative_path.parts).as_posix()


def _should_skip_file(relative_path):
    if relative_path.name in SKIP_FILE_NAMES:
        return True
    if relative_path.name.startswith("."):
        # Keep the Pi-a protocol directory, but omit unrelated hidden files.
        return relative_path.parts[0] != ".picoddy-plugin"
    return relative_path.name.endswith(SKIP_FILE_SUFFIXES)


def _iter_package_files(expert_path):
    """Yield regular package files in deterministic relative-path order."""
    for root, dirs, files in os.walk(expert_path, topdown=True, followlinks=False):
        root_path = Path(root)
        relative_root = root_path.relative_to(expert_path)
        dirs[:] = sorted(
            directory
            for directory in dirs
            if directory not in SKIP_DIR_NAMES
            and not (not relative_root.parts and directory == "dist")
            and (directory == ".picoddy-plugin" or not directory.startswith("."))
        )
        for filename in sorted(files):
            relative_path = (root_path / filename).relative_to(expert_path)
            if _should_skip_file(relative_path):
                continue
            file_path = expert_path / relative_path
            if file_path.is_file() and not file_path.is_symlink():
                yield file_path, relative_path


def _is_inside(path, directory):
    """Whether ``path`` equals or is below ``directory`` after resolution."""
    try:
        path.relative_to(directory)
    except ValueError:
        return False
    return True


def package_expert(expert_path, output_dir=None):
    """Validate and atomically create an expert sharing ZIP.

    The output directory must be outside the expert tree.  A temporary ZIP is
    created in that output directory, checked against ``MAX_PACKAGE_BYTES``,
    and atomically renamed into place only after it is complete.
    """
    lexical_expert_path = _absolute_path(expert_path)
    if not lexical_expert_path.exists():
        print(f"❌ Error: Expert directory not found: {lexical_expert_path}")
        return None
    if lexical_expert_path.is_symlink() or not lexical_expert_path.is_dir():
        print(f"❌ Error: Expert path must be a non-symlink directory: {lexical_expert_path}")
        return None

    expert_path = lexical_expert_path.resolve(strict=True)
    expert_name = expert_path.name

    lexical_output = _absolute_path(output_dir) if output_dir is not None else Path.cwd()
    output_path = lexical_output.resolve(strict=False)
    if _is_inside(output_path, expert_path):
        print("❌ Error: Output directory must be outside the expert directory")
        return None

    try:
        output_path.mkdir(parents=True, exist_ok=True)
    except OSError as exc:
        print(f"❌ Error: Cannot create output directory {output_path}: {exc}")
        return None
    if not output_path.is_dir():
        print(f"❌ Error: Output path is not a directory: {output_path}")
        return None

    # The validator is the single source of truth shared with registration.
    print("🔍 Validating expert package...\n")
    result = validate_expert(expert_path)
    print(result.summary())
    if not result.is_valid:
        print("\n❌ Packaging aborted. Please fix validation errors first.")
        return None

    zip_path = output_path / f"{expert_name}.zip"
    temporary_path = None
    file_count = 0
    try:
        fd, temporary_name = tempfile.mkstemp(
            prefix=f".{expert_name}-", suffix=".zip.tmp", dir=str(output_path)
        )
        os.close(fd)
        temporary_path = Path(temporary_name)

        with zipfile.ZipFile(temporary_path, "w", zipfile.ZIP_DEFLATED) as zip_file:
            for file_path, relative_path in _iter_package_files(expert_path):
                archive_path = _archive_name(expert_name, relative_path)
                zip_file.write(file_path, archive_path)
                print(f"  📄 {archive_path}")
                file_count += 1

        package_size = temporary_path.stat().st_size
        if package_size > MAX_PACKAGE_BYTES:
            raise ValueError(
                f"package size {package_size} bytes exceeds limit "
                f"{MAX_PACKAGE_BYTES} bytes"
            )

        os.replace(temporary_path, zip_path)
        temporary_path = None
        print(f"\n✅ Packaged {file_count} files to: {zip_path}")
        print(f"   Size: {package_size / 1024:.1f} KB")
        return zip_path
    except Exception as exc:
        print(f"❌ Error creating zip: {exc}")
        return None
    finally:
        if temporary_path is not None:
            try:
                temporary_path.unlink()
            except FileNotFoundError:
                pass
            except OSError as exc:
                print(f"⚠️ Warning: Could not remove temporary archive: {exc}")


def main():
    if len(sys.argv) < 2 or len(sys.argv) > 3:
        print("Usage: python3 package_expert.py <path/to/expert-dir> [output-dir]")
        sys.exit(1)

    expert_path = sys.argv[1]
    output_dir = sys.argv[2] if len(sys.argv) == 3 else None
    print(f"📦 Packaging expert: {expert_path}")
    if output_dir:
        print(f"   Output directory: {output_dir}")
    print()
    sys.exit(0 if package_expert(expert_path, output_dir) else 1)


if __name__ == "__main__":
    main()
