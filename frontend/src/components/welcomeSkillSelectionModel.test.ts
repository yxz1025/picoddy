import assert from "node:assert/strict";
import test from "node:test";

import {
  applyWelcomeSkillToComposer,
  buildDailyDevSelection,
  buildWelcomeSkillPrefix,
  DAILY_DEV_COMMAND,
  DAILY_DEV_DEFAULT_PROMPT,
  DAILY_DEV_SCENARIOS,
  getWelcomeSkillSelection,
  WELCOME_FIXED_SKILLS,
} from "./welcomeSkillSelectionModel";
import {
  deleteSkillTagAtOffset,
  matchSlashTrigger,
  SKILL_TOKEN_BOUNDARY,
} from "./composerMenuModel.ts";

test("maps welcome design and website entries to distinct frontend skills", () => {
  assert.deepEqual(getWelcomeSkillSelection("设计创意", "UI 设计"), {
    command: "/frontend-design",
    label: "UI 设计",
  });
  assert.deepEqual(getWelcomeSkillSelection("代码开发", "网站开发"), {
    command: "/frontend-create",
    label: "网站开发",
  });
});


test("preserves document and data skill mappings", () => {
  assert.deepEqual(getWelcomeSkillSelection("日常办公", "文档处理"), {
    command: "/document-processing",
    label: "文档处理",
  });
  assert.deepEqual(getWelcomeSkillSelection("日常办公", "数据分析"), {
    command: "/data-analysis",
    label: "数据分析",
  });
  assert.equal(getWelcomeSkillSelection("设计创意", "图片编辑"), undefined);
});

test("exposes every fixed welcome skill for composer token rendering", () => {
  assert.deepEqual(WELCOME_FIXED_SKILLS, [
    { command: "/document-processing", label: "文档处理" },
    { command: "/data-analysis", label: "数据分析" },
    { command: "/frontend-create", label: "网站开发" },
    { command: "/frontend-design", label: "UI 设计" },
    { command: DAILY_DEV_COMMAND, label: "日常开发" },
  ]);
});

test("maps daily-dev entry without default prompt; scenario click fills copy", () => {
  assert.deepEqual(getWelcomeSkillSelection("代码开发", "日常开发"), {
    command: DAILY_DEV_COMMAND,
    label: "日常开发",
  });
  const tagOnly = buildDailyDevSelection();
  const feature = buildDailyDevSelection(DAILY_DEV_DEFAULT_PROMPT);
  const bugfix = buildDailyDevSelection(
    DAILY_DEV_SCENARIOS.find((item) => item.id === "bugfix")!.prompt,
  );
  const inserted = applyWelcomeSkillToComposer("", tagOnly);
  assert.ok(inserted);
  assert.equal(
    inserted.text,
    `${DAILY_DEV_COMMAND}${SKILL_TOKEN_BOUNDARY}`,
  );
  const withFeature = applyWelcomeSkillToComposer(inserted.text, feature);
  assert.ok(withFeature);
  assert.equal(
    withFeature.text,
    `${DAILY_DEV_COMMAND}${SKILL_TOKEN_BOUNDARY}${DAILY_DEV_DEFAULT_PROMPT}`,
  );
  const switched = applyWelcomeSkillToComposer(withFeature.text, bugfix);
  assert.ok(switched);
  assert.equal(
    switched.text,
    `${DAILY_DEV_COMMAND}${SKILL_TOKEN_BOUNDARY}${bugfix.prompt}`,
  );
  assert.doesNotMatch(switched.text, /功能描述/);
});
