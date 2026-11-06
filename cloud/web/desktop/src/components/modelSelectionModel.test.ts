import assert from "node:assert/strict";
import test from "node:test";

import { resolveModelSelection } from "./modelSelectionModel";

const models = [
  { id: "deepseek-v4-flash", provider: "deepseek", name: "DeepSeek" },
  { id: "qwen-max", provider: "qwen", name: "Qwen Max" },
];

test("returns the exact stored provider and model when it is available", () => {
  assert.equal(
    resolveModelSelection(models, { provider: "qwen", id: "qwen-max" }),
    models[1],
  );
});

test("returns the first available model when the stored selection is stale", () => {
  assert.equal(
    resolveModelSelection(models, { provider: "removed", id: "old-model" }),
    models[0],
  );
});

test("returns undefined when no model is available", () => {
  assert.equal(
    resolveModelSelection([], { provider: "deepseek", id: "deepseek-v4-flash" }),
    undefined,
  );
});
