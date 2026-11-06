import test from "node:test";
import assert from "node:assert/strict";
import {
  addExpertSkill,
  isExpertSkillSelectionAtLimit,
  MAX_EXPERT_BUSINESS_SKILLS,
  removeExpertSkill,
} from "./expertSkillSelectionModel";

test("adds skills in insertion order and trims canonical names", () => {
  assert.deepEqual(addExpertSkill([], "  research  "), ["research"]);
  assert.deepEqual(addExpertSkill(["research"], "writing"), [
    "research",
    "writing",
  ]);
});

test("deduplicates skill names case-insensitively without changing the first spelling", () => {
  assert.deepEqual(addExpertSkill(["Research"], " research "), ["Research"]);
});

test("removes a skill case-insensitively and returns a defensive array", () => {
  const current = ["Research", "Writing"];
  const result = removeExpertSkill(current, " research ");

  assert.deepEqual(result, ["Writing"]);
  assert.notStrictEqual(result, current);
  assert.deepEqual(current, ["Research", "Writing"]);
});

test("rejects empty names and throws for the reserved expert-manager skill", () => {
  assert.deepEqual(addExpertSkill(["Research"], "   "), ["Research"]);
  assert.throws(
    () => addExpertSkill(["Research"], "EXPERT-MANAGER"),
    /expert-manager is reserved/,
  );
});

test(`throws when adding a ninth skill`, () => {
  const current = Array.from(
    { length: MAX_EXPERT_BUSINESS_SKILLS },
    (_, index) => `skill-${index}`,
  );

  assert.throws(
    () => addExpertSkill(current, "overflow"),
    /maximum of 8 expert business skills reached/,
  );
  assert.deepEqual(addExpertSkill(current, "skill-0"), current);
});

test("reports when the business-skill selection has reached its UI limit", () => {
  const fullSelection = Array.from(
    { length: MAX_EXPERT_BUSINESS_SKILLS },
    (_, index) => `skill-${index}`,
  );

  assert.equal(isExpertSkillSelectionAtLimit([]), false);
  assert.equal(isExpertSkillSelectionAtLimit(fullSelection), true);
});
