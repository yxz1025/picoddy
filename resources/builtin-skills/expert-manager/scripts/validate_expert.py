#!/usr/bin/env python3
"""Validate a Pi-a Agent expert package before registration or packaging."""

import json
import re
import stat
import sys
import argparse
from pathlib import Path

from project_paths import get_expert_plugins_dir


VALID_CATEGORY_IDS = {
    "01-ProductDesign", "02-Engineering", "03-GameSpatial", "04-DataAI",
    "05-MarketingGrowth", "06-ContentCreative", "07-SalesCommerce",
    "08-FinanceInvestment", "09-OperationsHR", "10-ProjectQuality",
    "11-SecurityCompliance", "12-IndustryConsultant",
}

MAX_SKILL_FILES = 2048
MAX_SKILL_TREE_BYTES = 32 * 1024 * 1024
MAX_SKILL_MD_BYTES = 128 * 1024
MAX_SKILL_BODIES_BYTES = 128 * 1024
MAX_SKILL_NAME_LENGTH = 64

SAFE_KEBAB_NAME = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
SKILL_PATH = re.compile(r"^\./skills/([a-z0-9]+(?:-[a-z0-9]+)*)$")
FRONTMATTER = re.compile(r"^---\r?\n(.*?)\r?\n---(?:\r?\n|$)", re.DOTALL)


class ValidationResult:
    def __init__(self):
        self.errors = []
        self.warnings = []

    def error(self, message):
        self.errors.append(message)

    def warn(self, message):
        self.warnings.append(message)

    @property
    def is_valid(self):
        return not self.errors

    def summary(self):
        lines = []
        if self.errors:
            lines.append(f"❌ {len(self.errors)} error(s):")
            lines.extend(f"   • {error}" for error in self.errors)
        if self.warnings:
            lines.append(f"⚠️  {len(self.warnings)} warning(s):")
            lines.extend(f"   • {warning}" for warning in self.warnings)
        if self.is_valid:
            lines.append("✅ Expert package is valid!")
        return "\n".join(lines)


def _is_safe_kebab_name(value):
    return (
        isinstance(value, str)
        and len(value) <= MAX_SKILL_NAME_LENGTH
        and bool(SAFE_KEBAB_NAME.fullmatch(value))
    )


def _has_todo(value):
    return isinstance(value, str) and "[TODO" in value


def _plain_file(path):
    """Return true only for a non-symlink regular file."""
    try:
        mode = path.lstat().st_mode
    except (OSError, ValueError):
        return False
    return stat.S_ISREG(mode) and not stat.S_ISLNK(mode)


def _plain_directory(path):
    """Return true only for a non-symlink directory."""
    try:
        mode = path.lstat().st_mode
    except (OSError, ValueError):
        return False
    return stat.S_ISDIR(mode) and not stat.S_ISLNK(mode)


def _read_text(path, result, label):
    try:
        return path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError, ValueError) as exc:
        result.error(f"{label}: cannot read UTF-8 text: {exc}")
        return None


def parse_md_frontmatter(md_path):
    """Parse the simple scalar frontmatter used by Agent and Skill files."""
    try:
        content = md_path.read_text(encoding="utf-8")
    except (OSError, UnicodeDecodeError) as exc:
        return None, f"Cannot read {md_path}: {exc}"

    match = FRONTMATTER.match(content)
    if not match:
        return None, f"{md_path.name}: invalid or missing YAML frontmatter"

    frontmatter = {}
    for raw_line in match.group(1).splitlines():
        # Agent frontmatter includes nested display metadata. This validator
        # reads the top-level scalar fields it owns and leaves nested mappings
        # to the Agent runtime.
        if raw_line.startswith((" ", "\t")):
            continue
        line = raw_line.strip()
        if not line or line.startswith("#"):
            continue
        if ":" not in line or line.startswith("-"):
            return None, f"{md_path.name}: invalid YAML frontmatter entry '{raw_line}'"
        key, _, raw_value = line.partition(":")
        key = key.strip()
        value = raw_value.strip()
        if not key or key in frontmatter:
            return None, f"{md_path.name}: invalid YAML frontmatter entry '{raw_line}'"
        if value in {"true", "false"}:
            frontmatter[key] = value == "true"
        else:
            frontmatter[key] = value.strip('"').strip("'")
    return frontmatter, None


def _frontmatter_body(text):
    match = FRONTMATTER.match(text)
    return "" if not match else text[match.end():].lstrip("\r\n")


def _check_i18n_field(plugin_json, field_name, result):
    value = plugin_json.get(field_name)
    if not isinstance(value, dict):
        result.error(f"plugin.json: '{field_name}' must be an object with 'en' and 'zh'")
        return
    for locale in ("en", "zh"):
        text = value.get(locale)
        if not isinstance(text, str) or not text.strip() or _has_todo(text):
            result.error(f"plugin.json: '{field_name}.{locale}' must be a non-empty completed string")


def _check_i18n_array(plugin_json, field_name, result):
    values = plugin_json.get(field_name)
    if values is None:
        return []
    if not isinstance(values, list):
        result.error(f"plugin.json: '{field_name}' must be an array")
        return []
    for index, value in enumerate(values):
        if not isinstance(value, dict):
            result.error(f"plugin.json: '{field_name}[{index}]' must have 'en' and 'zh'")
            continue
        for locale in ("en", "zh"):
            text = value.get(locale)
            if not isinstance(text, str) or not text.strip() or _has_todo(text):
                result.error(
                    f"plugin.json: '{field_name}[{index}].{locale}' must be a non-empty completed string"
                )
    return values


def _validate_skill_tree(skill_dir, skill_name, expert_dir, budget, result):
    """Validate one complete, non-link Skill tree and update cumulative limits."""
    if not _plain_directory(skill_dir):
        result.error(f"plugin.json: skill directory '{skill_name}' must be a non-symlink directory")
        return False

    try:
        resolved_expert = expert_dir.resolve(strict=True)
        resolved_root = skill_dir.resolve(strict=True)
        resolved_root.relative_to(resolved_expert)
    except (OSError, ValueError) as exc:
        result.error(f"plugin.json: skill path escapes the expert package: {skill_name} ({exc})")
        return False

    pending = [skill_dir]
    valid = True
    while pending:
        current = pending.pop()
        try:
            children = list(current.iterdir())
        except OSError as exc:
            result.error(f"plugin.json: cannot read skill directory '{skill_name}': {exc}")
            return False
        for child in children:
            try:
                child_mode = child.lstat().st_mode
            except OSError as exc:
                result.error(f"plugin.json: cannot inspect skill entry '{child.name}': {exc}")
                return False
            if stat.S_ISLNK(child_mode):
                result.error(f"plugin.json: skill '{skill_name}' contains a symlink: {child.name}")
                valid = False
                continue
            if stat.S_ISDIR(child_mode):
                try:
                    child.resolve(strict=True).relative_to(resolved_root)
                except (OSError, ValueError):
                    result.error(f"plugin.json: skill '{skill_name}' path escapes its root: {child.name}")
                    valid = False
                    continue
                pending.append(child)
                continue
            if not stat.S_ISREG(child_mode):
                result.error(f"plugin.json: skill '{skill_name}' contains a non-ordinary entry: {child.name}")
                valid = False
                continue
            budget["files"] += 1
            budget["tree_bytes"] += child.lstat().st_size
            if budget["files"] > MAX_SKILL_FILES:
                result.error(f"plugin.json: declared skills exceed the {MAX_SKILL_FILES} files limit")
                valid = False
            if budget["tree_bytes"] > MAX_SKILL_TREE_BYTES:
                result.error(
                    f"plugin.json: declared skills exceed the {MAX_SKILL_TREE_BYTES} bytes tree limit"
                )
                valid = False
    return valid


def _validate_skill_markdown(skill_dir, skill_name, budget, result):
    skill_md = skill_dir / "SKILL.md"
    if not _plain_file(skill_md):
        result.error(
            f"plugin.json: skill path has no root-level ordinary SKILL.md: ./skills/{skill_name}"
        )
        return False
    try:
        size = skill_md.lstat().st_size
    except OSError as exc:
        result.error(f"plugin.json: cannot inspect SKILL.md for '{skill_name}': {exc}")
        return False
    if size > MAX_SKILL_MD_BYTES:
        result.error(f"plugin.json: SKILL.md for '{skill_name}' exceeds the {MAX_SKILL_MD_BYTES} bytes limit")
        return False

    content = _read_text(skill_md, result, f"plugin.json: SKILL.md for '{skill_name}'")
    if content is None:
        return False
    frontmatter, error = parse_md_frontmatter(skill_md)
    if error or frontmatter is None:
        result.error(error or f"{skill_md.name}: invalid frontmatter")
        return False
    if frontmatter.get("name") != skill_name:
        result.error(
            f"{skill_md}: frontmatter name must exactly equal skill directory '{skill_name}'"
        )
        return False
    disabled = frontmatter.get("disabled")
    if disabled is True:
        result.error(f"{skill_md}: disabled skills cannot be packaged")
        return False
    if disabled is not None and not isinstance(disabled, bool):
        result.error(f"{skill_md}: frontmatter disabled must be a boolean")
        return False

    budget["body_bytes"] += len(_frontmatter_body(content).encode("utf-8"))
    if budget["body_bytes"] > MAX_SKILL_BODIES_BYTES:
        result.error(
            f"plugin.json: declared Skill bodies exceed the {MAX_SKILL_BODIES_BYTES} bytes limit"
        )
        return False
    return True


def validate_declared_skills(plugin_json, expert_dir, result):
    """Validate only package-local, direct-child Skill declarations."""
    if "skills" not in plugin_json:
        return []
    declarations = plugin_json["skills"]
    if not isinstance(declarations, list):
        result.error("plugin.json: 'skills' must be an array")
        return None
    declarations = [
        declaration for declaration in declarations
        if not (isinstance(declaration, str) and _has_todo(declaration))
    ]
    if not declarations:
        return []

    skills_root = expert_dir / "skills"
    if not _plain_directory(skills_root):
        result.error("plugin.json: skills directory must be a non-symlink directory")
        return None

    names = []
    seen = set()
    seen_declarations = set()
    budget = {"files": 0, "tree_bytes": 0, "body_bytes": 0}
    valid = True
    for declaration in declarations:
        if not isinstance(declaration, str):
            result.error("plugin.json: each skill path must be a string")
            valid = False
            continue
        folded_declaration = declaration.casefold()
        if folded_declaration in seen_declarations:
            result.error(f"plugin.json: duplicate skill declaration '{declaration}'")
            valid = False
            continue
        seen_declarations.add(folded_declaration)
        match = SKILL_PATH.fullmatch(declaration)
        if not match:
            result.error(
                "plugin.json: skill path must be exactly './skills/<safe-kebab-name>', "
                f"got '{declaration}'"
            )
            valid = False
            continue
        skill_name = match.group(1)
        if skill_name == "expert-manager":
            result.error("plugin.json: expert-manager is reserved and cannot be packaged as a Skill")
            valid = False
            continue
        if skill_name in seen:
            result.error(f"plugin.json: duplicate skill declaration '{skill_name}'")
            valid = False
            continue
        seen.add(skill_name)

        skill_dir = skills_root / skill_name
        if not _validate_skill_tree(skill_dir, skill_name, expert_dir, budget, result):
            valid = False
            continue
        if not _validate_skill_markdown(skill_dir, skill_name, budget, result):
            valid = False
            continue
        names.append(skill_name)
    return names if valid else None


def _parse_inline_skill_names(frontmatter):
    raw_value = frontmatter.get("skills")
    if raw_value is None:
        return [], None
    if not isinstance(raw_value, str) or not (
        raw_value.startswith("[") and raw_value.endswith("]")
    ):
        return None, "must use an inline list such as skills: [alpha, beta]"
    raw_entries = raw_value[1:-1].strip()
    if not raw_entries:
        return [], None
    names = []
    for raw_name in raw_entries.split(","):
        name = raw_name.strip()
        if name[:1] in {"'", '"'} or name[-1:] in {"'", '"'}:
            if len(name) < 2 or name[0] != name[-1] or name[0] not in {"'", '"'}:
                return None, f"contains invalid skill name '{raw_name.strip()}'"
            name = name[1:-1]
        if not _is_safe_kebab_name(name) or name == "expert-manager":
            return None, f"contains invalid skill name '{raw_name.strip()}'"
        names.append(name)
    return names, None


def _validate_primary_agent(expert_dir, plugin_json, declared_skills, result):
    name = plugin_json.get("name")
    if not _is_safe_kebab_name(name):
        return
    agent_path = expert_dir / "agents" / f"{name}.md"
    if not _plain_file(agent_path):
        result.error(f"plugin.json: primary Agent must be a non-symlink file: agents/{name}.md")
        return
    content = _read_text(agent_path, result, agent_path.name)
    if content is None:
        return
    frontmatter, error = parse_md_frontmatter(agent_path)
    if error or frontmatter is None:
        result.error(error or f"{agent_path.name}: invalid frontmatter")
        return
    if frontmatter.get("name") != name:
        result.error(f"{agent_path.name}: frontmatter name must exactly equal '{name}'")
    description = frontmatter.get("description")
    if not isinstance(description, str) or not description.strip() or _has_todo(description):
        result.error(f"{agent_path.name}: frontmatter description must be a non-empty completed string")
    if re.search(r"^tools\s*:", FRONTMATTER.match(content).group(1), re.MULTILINE):
        result.error(f"{agent_path.name}: frontmatter must NOT contain 'tools' field")
    if not _frontmatter_body(content).strip():
        result.error(f"{agent_path.name}: primary Agent body must not be empty")
    if "[TODO" in content:
        result.error(f"{agent_path.name}: primary Agent contains [TODO]")
    if declared_skills is None:
        return
    agent_skills, parse_error = _parse_inline_skill_names(frontmatter)
    if parse_error:
        result.error(f"{agent_path.name}: frontmatter skills {parse_error}")
    elif agent_skills != declared_skills:
        result.error(
            f"{agent_path.name}: frontmatter skills must match plugin.json skills in order "
            f"({declared_skills})"
        )


def _validate_avatar(plugin_json, expert_dir, result):
    """Avatar is optional; a declared one must remain a package-local image."""
    if "avatar" not in plugin_json:
        return
    avatar = plugin_json["avatar"]
    if not isinstance(avatar, str) or not avatar:
        result.error("plugin.json: 'avatar' must be a non-empty relative path when provided")
        return
    if Path(avatar).is_absolute():
        result.error("plugin.json: avatar must be a relative path")
        return
    avatar_path = expert_dir / avatar
    try:
        avatar_path.resolve(strict=True).relative_to(expert_dir.resolve(strict=True))
    except (OSError, ValueError):
        result.error("plugin.json: avatar path must resolve inside the expert package")
        return
    if not _plain_file(avatar_path):
        result.error(f"plugin.json: avatar must be a non-symlink ordinary file: {avatar}")
        return
    if avatar_path.suffix.lower() not in {".png", ".jpg", ".jpeg", ".webp"}:
        result.error("plugin.json: avatar must be a PNG, JPG, JPEG, or WebP image")
    elif avatar_path.lstat().st_size > 512 * 1024:
        result.error("plugin.json: avatar must not exceed 512 KiB")


def validate_plugin_json(plugin_json, expert_dir, result):
    """Validate the fixed, Agent-only on-disk manifest protocol."""
    if plugin_json.get("schemaVersion") != 2:
        result.error("plugin.json: schemaVersion must be exactly 2")

    name = plugin_json.get("name")
    if not _is_safe_kebab_name(name):
        result.error(f"plugin.json: 'name' must be lowercase kebab-case, got '{name}'")
    elif name != expert_dir.name:
        result.error(f"plugin.json: 'name' ({name}) must equal expert directory name ({expert_dir.name})")

    for field in ("version", "description"):
        value = plugin_json.get(field)
        if not isinstance(value, str) or not value.strip() or _has_todo(value):
            result.error(f"plugin.json: '{field}' must be a non-empty completed string")

    if plugin_json.get("expertType") != "agent":
        result.error("plugin.json: expertType must be agent")
    for team_field in ("teamInfo", "members"):
        if team_field in plugin_json:
            result.error(f"plugin.json: Agent experts must not contain '{team_field}'")

    plugin = plugin_json.get("plugin")
    agent_name = plugin_json.get("agentName")
    if plugin != name:
        result.error(f"plugin.json: 'plugin' ({plugin}) must exactly equal 'name' ({name})")
    if agent_name != name:
        result.error(f"plugin.json: 'agentName' ({agent_name}) must exactly equal 'name' ({name})")

    expected_agent = f"./agents/{name}.md" if isinstance(name, str) else None
    if plugin_json.get("agents") != [expected_agent]:
        result.error(f"plugin.json: 'agents' must be exactly [{expected_agent!r}]")

    for field in ("displayName", "profession", "displayDescription"):
        _check_i18n_field(plugin_json, field, result)
    if plugin_json.get("defaultInitPrompt") is not None:
        _check_i18n_field(plugin_json, "defaultInitPrompt", result)

    category = plugin_json.get("categoryId")
    if not isinstance(category, str) or category not in VALID_CATEGORY_IDS:
        result.error(f"plugin.json: invalid categoryId '{category}'")

    _check_i18n_array(plugin_json, "tags", result)
    _check_i18n_array(plugin_json, "quickPrompts", result)

    _validate_avatar(plugin_json, expert_dir, result)


def validate_file_structure(expert_dir, result):
    plugin_path = expert_dir / ".picoddy-plugin" / "plugin.json"
    if not _plain_file(plugin_path):
        result.error(".picoddy-plugin/plugin.json must be a non-symlink regular file")
    if not _plain_directory(expert_dir / "agents"):
        result.error("Agent expert must have a non-symlink agents/ directory")
    for forbidden in ("hooks", "commands"):
        if (expert_dir / forbidden).exists():
            result.error(f"Forbidden directory found: {forbidden}/")
    for forbidden_file in (".lsp.json", "settings.json"):
        if (expert_dir / forbidden_file).exists():
            result.error(f"Forbidden file found: {forbidden_file}")
    plugin_dir = expert_dir / ".picoddy-plugin"
    for subdir in ("agents", "skills", "bin", "avatars"):
        if (plugin_dir / subdir).exists():
            result.error(f"{subdir}/ found inside .picoddy-plugin/ — must be at plugin root")


def validate_expert(expert_path, expected_plugins_dir=None):
    """Return all manifest, Agent, and package-local Skill validation failures."""
    result = ValidationResult()
    lexical_expert_dir = Path(expert_path).expanduser()
    if not lexical_expert_dir.is_absolute():
        lexical_expert_dir = Path.cwd() / lexical_expert_dir
    plugins_dir = Path(
        expected_plugins_dir if expected_plugins_dir is not None else get_expert_plugins_dir()
    ).expanduser().resolve(strict=False)

    if not lexical_expert_dir.exists():
        result.error(f"Directory not found: {lexical_expert_dir}")
        return result
    if not _plain_directory(lexical_expert_dir):
        result.error(f"Expert package must be a non-symlink directory: {lexical_expert_dir}")
        return result
    expert_dir = lexical_expert_dir.resolve(strict=True)
    if expert_dir.parent != plugins_dir:
        result.error(f"Expert must be a direct child of the expert plugins directory: {plugins_dir}")

    plugin_path = expert_dir / ".picoddy-plugin" / "plugin.json"
    if not _plain_file(plugin_path):
        result.error(".picoddy-plugin/plugin.json not found")
        return result
    try:
        plugin_json = json.loads(plugin_path.read_text(encoding="utf-8"))
    except (OSError, UnicodeDecodeError, json.JSONDecodeError) as exc:
        result.error(f"plugin.json: invalid JSON: {exc}")
        return result
    if not isinstance(plugin_json, dict):
        result.error("plugin.json: top level must be an object")
        return result

    validate_plugin_json(plugin_json, expert_dir, result)
    declared_skills = validate_declared_skills(plugin_json, expert_dir, result)
    validate_file_structure(expert_dir, result)
    _validate_primary_agent(expert_dir, plugin_json, declared_skills, result)
    return result


def main():
    parser = argparse.ArgumentParser(description="Validate a Pi-a Agent expert package")
    parser.add_argument("expert_path", help="path to the expert directory")
    parser.add_argument(
        "--expected-plugins-dir",
        dest="expected_plugins_dir",
        help="expected direct parent directory for the expert package",
    )
    args = parser.parse_args()
    expert_path = args.expert_path
    print(f"🔍 Validating expert package: {expert_path}\n")
    result = validate_expert(expert_path, expected_plugins_dir=args.expected_plugins_dir)
    print(result.summary())
    sys.exit(0 if result.is_valid else 1)


if __name__ == "__main__":
    main()
