import {
  BUILTIN_SKILLS_GZIP_BASE64,
  BUILTIN_SKILLS_MANIFEST,
} from "./builtin-skills.bundle.generated.ts";

export interface BuiltinSkillManifest {
  formatVersion: 1;
  bundleDigest: string;
  skills: Array<{ name: string; skillFile: string }>;
  files: Array<{ path: string; size: number; sha256: string }>;
}

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const WINDOWS_DEVICE_NAME =
  /^(?:(?:CON|PRN|AUX|NUL|CONIN\$|CONOUT\$)|(?:COM|LPT)[1-9¹²³])(?:\.|$)/i;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
  label: string,
): void {
  const actual = Object.keys(value).sort();
  const wanted = [...expected].sort();
  if (
    actual.length !== wanted.length ||
    actual.some((key, index) => key !== wanted[index])
  ) {
    throw new Error(`${label} contains unexpected or missing properties`);
  }
}

function caseFold(value: string): string {
  return value.toUpperCase().toLowerCase();
}

/** Validate the portable, `/`-separated path stored inside the bundle. */
export function validateBuiltinArchivePath(path: unknown): string {
  if (typeof path !== "string" || path.length === 0) {
    throw new Error("Builtin bundle path must be a non-empty string");
  }
  const segments = path.split("/");
  if (
    path.startsWith("/") || path.includes("\\") ||
    /^[A-Za-z]:/.test(path) ||
    segments.some((segment) =>
      segment === "" || segment === "." || segment === ".." ||
      /[<>:"|?*\u0000-\u001f]/.test(segment) || /[ .]$/.test(segment) ||
      WINDOWS_DEVICE_NAME.test(segment)
    )
  ) {
    throw new Error(`Unsafe builtin bundle path: ${JSON.stringify(path)}`);
  }
  return path;
}

export function validateBuiltinSkillManifest(
  value: unknown,
): BuiltinSkillManifest {
  if (!isRecord(value)) throw new Error("Builtin manifest must be an object");
  requireExactKeys(
    value,
    ["formatVersion", "bundleDigest", "skills", "files"],
    "Builtin manifest",
  );
  if (value.formatVersion !== 1) {
    throw new Error(
      `Unsupported builtin manifest format: ${value.formatVersion}`,
    );
  }
  if (
    typeof value.bundleDigest !== "string" ||
    !SHA256_PATTERN.test(value.bundleDigest)
  ) {
    throw new Error("Builtin manifest bundleDigest must be a SHA-256 digest");
  }
  if (!Array.isArray(value.skills) || !Array.isArray(value.files)) {
    throw new Error("Builtin manifest skills and files must be arrays");
  }

  const foldedPaths = new Map<string, string>();
  const files = value.files.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Builtin manifest file ${index} must be an object`);
    }
    requireExactKeys(entry, ["path", "size", "sha256"], "Manifest file");
    const path = validateBuiltinArchivePath(entry.path);
    const folded = caseFold(path);
    if (foldedPaths.has(folded)) {
      throw new Error(`Duplicate builtin manifest path: ${path}`);
    }
    foldedPaths.set(folded, path);
    if (!Number.isSafeInteger(entry.size) || Number(entry.size) < 0) {
      throw new Error(`Invalid size for builtin manifest path: ${path}`);
    }
    if (
      typeof entry.sha256 !== "string" || !SHA256_PATTERN.test(entry.sha256)
    ) {
      throw new Error(`Invalid SHA-256 for builtin manifest path: ${path}`);
    }
    return { path, size: Number(entry.size), sha256: entry.sha256 };
  });
  for (let index = 1; index < files.length; index++) {
    if (files[index - 1].path >= files[index].path) {
      throw new Error("Builtin manifest files must be uniquely sorted by path");
    }
  }

  const foldedNames = new Set<string>();
  const skills = value.skills.map((entry, index) => {
    if (!isRecord(entry)) {
      throw new Error(`Builtin manifest skill ${index} must be an object`);
    }
    requireExactKeys(entry, ["name", "skillFile"], "Manifest skill");
    if (
      typeof entry.name !== "string" || !SKILL_NAME_PATTERN.test(entry.name)
    ) {
      throw new Error(`Invalid builtin skill name at index ${index}`);
    }
    const folded = caseFold(entry.name);
    if (foldedNames.has(folded)) {
      throw new Error(`Duplicate builtin skill name: ${entry.name}`);
    }
    foldedNames.add(folded);
    const skillFile = validateBuiltinArchivePath(entry.skillFile);
    if (skillFile !== `${entry.name}/SKILL.md`) {
      throw new Error(`Invalid SKILL.md path for builtin skill: ${entry.name}`);
    }
    if (!foldedPaths.has(caseFold(skillFile))) {
      throw new Error(`Missing SKILL.md file for builtin skill: ${entry.name}`);
    }
    return { name: entry.name, skillFile };
  });
  for (let index = 1; index < skills.length; index++) {
    if (skills[index - 1].name >= skills[index].name) {
      throw new Error(
        "Builtin manifest skills must be uniquely sorted by name",
      );
    }
  }

  return {
    formatVersion: 1,
    bundleDigest: value.bundleDigest,
    skills,
    files,
  };
}

function decodeBase64(value: unknown): Uint8Array {
  if (
    typeof value !== "string" || value.length === 0 ||
    value.length > 128 * 1024 * 1024 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      value,
    )
  ) {
    throw new Error("Builtin bundle gzip must be canonical Base64");
  }
  try {
    return new Uint8Array(Buffer.from(value, "base64"));
  } catch (error) {
    throw new Error("Builtin bundle gzip Base64 is invalid", { cause: error });
  }
}

export function getEmbeddedBuiltinSkillsBundle(): {
  manifest: BuiltinSkillManifest;
  gzip: Uint8Array;
} {
  return {
    manifest: validateBuiltinSkillManifest(BUILTIN_SKILLS_MANIFEST),
    gzip: decodeBase64(BUILTIN_SKILLS_GZIP_BASE64),
  };
}
