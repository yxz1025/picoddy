import assert from "node:assert/strict";
import test from "node:test";
import { desktopCron } from "../web/desktop/src/api/cloudAutomations.ts";

test("interval conversion must preserve cadence", () => {
  assert.equal(desktopCron({ scheduleType: "interval", triggerConfig: { intervalMinutes: 15 } }), "*/15 * * * *");
  assert.equal(desktopCron({ scheduleType: "interval", triggerConfig: { intervalMinutes: 60 } }), "0 * * * *");
  assert.throws(() => desktopCron({ scheduleType: "interval", triggerConfig: { intervalMinutes: 45 } }));
  assert.throws(() => desktopCron({ scheduleType: "once" }));
});
