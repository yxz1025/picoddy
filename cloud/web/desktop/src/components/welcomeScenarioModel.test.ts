import assert from "node:assert/strict";
import test from "node:test";

import { CODE_DAILY_SCENARIOS } from "./welcomeScenarioModel";

test("code welcome scenarios only use supported execution shapes", () => {
  const bugFix = CODE_DAILY_SCENARIOS.find((scenario) => scenario.id === "dev-fix");
  const webCreate = CODE_DAILY_SCENARIOS.find((scenario) => scenario.id === "dev-web");

  assert.equal(bugFix?.mode, "craft");
  assert.equal(bugFix?.skillCmd, undefined);
  assert.equal(webCreate?.mode, "craft");
  assert.equal(webCreate?.skillCmd, "/frontend-create");
});
