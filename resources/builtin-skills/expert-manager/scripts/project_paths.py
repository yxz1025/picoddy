#!/usr/bin/env python3
"""Resolve Pi-a project-owned expert paths without legacy globals."""

import os
import platform
from pathlib import Path
from typing import Mapping, Optional


def get_project_config_dir(
    platform_name: Optional[str] = None,
    environment: Optional[Mapping[str, str]] = None,
    home_dir: Optional[Path] = None,
) -> Path:
    system = platform_name or platform.system()
    env = environment if environment is not None else os.environ
    home = home_dir if home_dir is not None else Path.home()
    if environment is not None:
        test_config_dir = env.get("PI_A_CONFIG_DIR", "").strip()
        if test_config_dir:
            return Path(test_config_dir)
    if system == "Windows":
        local_app_data = env.get("LOCALAPPDATA", "").strip()
        return (Path(local_app_data) if local_app_data else home / "AppData" / "Local") / "Pi-a"
    return home / ".pi-a"


def get_expert_marketplace_dir() -> Path:
    return get_project_config_dir() / "plugins" / "marketplaces" / "my-experts"


def get_expert_plugins_dir() -> Path:
    return get_expert_marketplace_dir() / "plugins"
