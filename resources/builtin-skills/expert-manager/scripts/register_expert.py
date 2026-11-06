#!/usr/bin/env python3
"""Validate and register one Pi-a Agent expert in the fixed marketplace.

Registration is deliberately small and deterministic: the expert must be a
direct child of Pi-a's project-owned expert plugins directory, and the
marketplace manifest is replaced atomically after the authoritative package
validator succeeds.  Sharing/exporting a ZIP is handled separately by
``package_expert.py``.

Usage::

    python3 register_expert.py <expert-dir>
"""

import json
import os
import sys
import tempfile
from pathlib import Path

from project_paths import get_expert_marketplace_dir, get_expert_plugins_dir
from validate_expert import validate_expert


def _absolute_lexical_path(value: str) -> Path:
    """Return an absolute path without resolving symlinks."""
    path = Path(value).expanduser()
    return path if path.is_absolute() else Path.cwd() / path


def _load_marketplace(manifest_path: Path) -> dict:
    """Read an existing marketplace or return the initial manifest shape."""
    if not manifest_path.exists():
        return {
            "name": "my-experts",
            "description": "my-experts marketplace (auto-generated)",
            "plugins": [],
        }

    try:
        manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise ValueError(f"marketplace.json is invalid: {exc}") from exc
    if not isinstance(manifest, dict):
        raise ValueError("marketplace.json top level must be an object")
    plugins = manifest.get("plugins")
    if not isinstance(plugins, list):
        raise ValueError("marketplace.json 'plugins' must be an array")
    if any(not isinstance(entry, dict) for entry in plugins):
        raise ValueError("marketplace.json 'plugins' entries must be objects")
    return manifest


def _write_marketplace_atomically(manifest_path: Path, manifest: dict) -> None:
    """Replace marketplace.json atomically, cleaning up a failed temp write."""
    manifest_path.parent.mkdir(parents=True, exist_ok=True)
    temp_path = None
    try:
        fd, temp_name = tempfile.mkstemp(
            prefix=".marketplace.json.", suffix=".tmp", dir=manifest_path.parent
        )
        temp_path = Path(temp_name)
        with os.fdopen(fd, "w", encoding="utf-8") as stream:
            json.dump(manifest, stream, indent=2, ensure_ascii=False)
            stream.write("\n")
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp_path, manifest_path)
        temp_path = None
    finally:
        if temp_path is not None:
            try:
                temp_path.unlink()
            except FileNotFoundError:
                pass


def register_expert(expert_dir: Path) -> bool:
    """Register a validated expert in Pi-a's project-owned marketplace."""
    marketplace_dir = get_expert_marketplace_dir().expanduser().resolve(strict=False)
    manifest_path = marketplace_dir / ".picoddy-plugin" / "marketplace.json"

    plugin_path = expert_dir / ".picoddy-plugin" / "plugin.json"
    try:
        plugin_data = json.loads(plugin_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        print(f"❌ Error: could not read validated plugin.json: {exc}")
        return False
    if not isinstance(plugin_data, dict):
        print("❌ Error: plugin.json top level must be an object")
        return False

    expert_name = plugin_data["name"]
    expert_description = plugin_data["description"]
    source = f"./plugins/{expert_name}"

    try:
        manifest = _load_marketplace(manifest_path)
        plugins = manifest["plugins"]
        replacement = {
            "name": expert_name,
            "source": source,
            "description": expert_description,
        }
        for index, entry in enumerate(plugins):
            if entry.get("source") == source or entry.get("name") == expert_name:
                plugins[index] = replacement
                break
        else:
            plugins.append(replacement)
        manifest["plugins"] = plugins
        _write_marketplace_atomically(manifest_path, manifest)
    except (OSError, ValueError, KeyError, TypeError) as exc:
        print(f"❌ Registration failed; existing marketplace was preserved: {exc}")
        return False

    print(f"✅ Registered '{expert_name}' in marketplace.json")
    return True


def main(argv=None):
    args = list(sys.argv[1:] if argv is None else argv)
    if len(args) != 1:
        print("Usage: register_expert.py <expert-dir>")
        print("Registration uses Pi-a's project-owned expert marketplace automatically.")
        return 1

    expert_dir = _absolute_lexical_path(args[0])
    plugins_dir = get_expert_plugins_dir().expanduser().resolve(strict=False)
    if not expert_dir.exists():
        print(f"❌ Error: expert directory does not exist: {expert_dir}")
        return 1

    print(f"🔍 Validating expert package: {expert_dir.name}")
    result = validate_expert(expert_dir, expected_plugins_dir=plugins_dir)
    if not result.is_valid:
        print("\n❌ Expert package is invalid. Cannot register.")
        print(result.summary())
        return 1
    print("   ✅ Validation passed")
    print(f"📋 Marketplace: {get_expert_marketplace_dir()}")

    # validate_expert has already checked the direct-child and symlink rules;
    # resolve only after that check for the actual plugin.json read.
    return 0 if register_expert(expert_dir.resolve(strict=True)) else 1


if __name__ == "__main__":
    sys.exit(main())
