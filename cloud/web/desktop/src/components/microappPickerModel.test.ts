import assert from "node:assert/strict";
import test from "node:test";

import {
  bindMicroappWorkspace,
  getCreateDraftHint,
} from "./microappPickerModel";

test("getCreateDraftHint rejects empty name and illegal identifiers", () => {
  assert.equal(getCreateDraftHint("", "/goods-center"), "微应用名称不能为空");
  assert.equal(getCreateDraftHint("名称", ""), "请填写标识，例如 /goods-center");
  assert.equal(
    getCreateDraftHint("新图案中心", "1-center"),
    "标识须为小写字母开头的 kebab-case，例如 /goods-center",
  );
  assert.equal(
    getCreateDraftHint("名称", "Foo_Center"),
    "标识须为小写字母开头的 kebab-case，例如 /goods-center",
  );
  assert.equal(getCreateDraftHint("素材中心", "/collocation-center"), null);
});

test("bindMicroappWorkspace selects the workspace returned by creation", async () => {
  const selected: string[] = [];
  let creates = 0;
  await bindMicroappWorkspace(
    {
      id: "catalog-1",
      name: "商品中心",
      activeRule: "/goods",
      dirName: "goods",
      dirPath: "C:/work/goods",
      localAvailable: true,
      source: "local-only",
    },
    [],
    async () => {
      creates++;
      return { id: "workspace-created" };
    },
    (id) => selected.push(id),
  );
  assert.equal(creates, 1);
  assert.deepEqual(selected, ["workspace-created"]);
});
