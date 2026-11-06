import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import { strToU8, zipSync } from "fflate";

import { parseSkillFiles, parseSkillPackage, SKILL_PACKAGE_LIMITS } from "../src/domains/skill/node/package.ts";

const encoder = new TextEncoder();

function skillMarkdown(name = "Report Builder", description = "Builds reports safely"): Uint8Array {
  return encoder.encode(`---\nname: ${name}\ndescription: ${description}\n---\n\n# Instructions\n`);
}

test("parses a standalone SKILL.md and hashes the immutable uploaded content", async () => {
  const bytes = skillMarkdown();
  const parsed = await parseSkillPackage("SKILL.md", bytes);

  assert.equal(parsed.name, "Report Builder");
  assert.equal(parsed.description, "Builds reports safely");
  assert.equal(parsed.version, createHash("sha256").update(JSON.stringify(parsed.files)).digest("hex"));
  assert.deepEqual(parsed.files, [{ path: "SKILL.md", contentBase64: Buffer.from(bytes).toString("base64") }]);
});

test('upload containers and drafts use the same canonical file-content version', async () => {
  const bytes = skillMarkdown();
  const standalone = await parseSkillPackage('SKILL.md', bytes);
  const archive = await parseSkillPackage('skill.zip', zipSync({ 'package/SKILL.md': bytes }));
  const draft = parseSkillFiles(standalone.files);
  assert.equal(standalone.version, archive.version);
  assert.equal(draft.version, archive.version);
});

test("parses a zip with one package root and returns sorted relative files", async () => {
  const archive = zipSync({
    "report-skill/scripts/build.py": strToU8("print('ok')\n"),
    "report-skill/SKILL.md": skillMarkdown(),
    "report-skill/assets/template.bin": new Uint8Array([0, 255, 1]),
  });

  const parsed = await parseSkillPackage("report-skill.zip", archive);

  assert.deepEqual(parsed.files.map((file) => file.path), [
    "SKILL.md",
    "assets/template.bin",
    "scripts/build.py",
  ]);
  assert.equal(parsed.files[1]!.contentBase64, "AP8B");
});

test("accepts an explicit package root directory without returning it as a file", async () => {
  const archive = zipSync({
    "package/": new Uint8Array(),
    "package/SKILL.md": skillMarkdown(),
  });

  const parsed = await parseSkillPackage("package.zip", archive);

  assert.deepEqual(parsed.files.map((file) => file.path), ["SKILL.md"]);
});

test("rejects malformed, duplicate, or non-string frontmatter fields", async () => {
  const invalid = [
    "# no frontmatter\n",
    "---\nname: x\n---\n",
    "---\nname: x\ndescription: one\ndescription: two\n---\n",
    "---\nname: [x]\ndescription: nope\n---\n",
    "---\nname: x\ndescription: { nested: value }\n---\n",
  ];

  for (const source of invalid) {
    await assert.rejects(parseSkillPackage("SKILL.md", encoder.encode(source)), /frontmatter|description|name/i);
  }
});

test("rejects traversal, backslash, absolute, drive, and ambiguous Unicode paths", async () => {
  const attacks: Record<string, Uint8Array>[] = [
    { "../SKILL.md": skillMarkdown() },
    { "/SKILL.md": skillMarkdown() },
    { "C:/SKILL.md": skillMarkdown() },
    { "folder\\SKILL.md": skillMarkdown() },
    {
      "SKILL.md": skillMarkdown(),
      "assets/caf\u00e9.txt": strToU8("one"),
      "assets/cafe\u0301.txt": strToU8("two"),
    },
  ];

  for (const entries of attacks) {
    await assert.rejects(parseSkillPackage("attack.zip", zipSync(entries)), /path|collision|Unicode/i);
  }
});

test("rejects Unix symlinks from central-directory metadata", async () => {
  const archive = zipSync({
    "SKILL.md": skillMarkdown(),
    link: [strToU8("/etc/passwd"), { os: 3, attrs: 0o120777 << 16 }],
  });

  await assert.rejects(parseSkillPackage("symlink.zip", archive), /symlink/i);
});

test("rejects declared zip bombs before decompression", async () => {
  const archive = zipSync({ "SKILL.md": skillMarkdown() });
  const view = new DataView(archive.buffer, archive.byteOffset, archive.byteLength);
  let central = -1;
  for (let offset = 0; offset <= archive.length - 4; offset += 1) {
    if (view.getUint32(offset, true) === 0x02014b50) {
      central = offset;
      break;
    }
  }
  assert.notEqual(central, -1);
  view.setUint32(central + 24, SKILL_PACKAGE_LIMITS.maxTotalUncompressedBytes + 1, true);

  await assert.rejects(parseSkillPackage("bomb.zip", archive), /uncompressed|limit/i);
});
