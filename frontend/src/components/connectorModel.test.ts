// 渲染层连接器模型测试：纯函数映射，不依赖网络与 UI。

import assert from "node:assert/strict";
import test from "node:test";

import {
  cardControlFor,
  connector,
  connectorLoadErrorLabel,
  viewFor,
} from "./connectorModel";

test("not installed and install failures return to the plus control", () => {
  for (const state of ["not_installed", "install_failed", "version_invalid"] as const) {
    assert.deepEqual(cardControlFor(connector("dingtalk", state)), {
      kind: "install",
      action: "activate",
    });
  }
});

test("installing and authorization states map to visible progress", () => {
  assert.equal(viewFor(connector("dingtalk", "installing")).label, "正在安装连接器依赖");
  assert.equal(viewFor(connector("dingtalk", "authorizing")).label, "等待授权完成");
  assert.equal(viewFor(connector("dingtalk", "auth_expired")).primaryAction, "reauthorize");
});

test("busy states expose a non-clickable loading control", () => {
  for (const state of ["installing", "authorizing"] as const) {
    const item = connector("dingtalk", state);
    assert.deepEqual(cardControlFor(item), { kind: "busy" });
    assert.equal(viewFor(item).busy, true);
    assert.equal(viewFor(item).cancellable, true);
  }
});

test("installed authorization failures reuse the downloaded CLI", () => {
  for (const state of ["installed_unauthorized", "auth_failed", "auth_expired"] as const) {
    assert.deepEqual(cardControlFor(connector("dingtalk", state)), {
      kind: "reauthorize",
      action: "reauthorize",
    });
  }
});

test("broken installed runtimes expose the repair control", () => {
  for (const state of ["runtime_broken", "connector_broken"] as const) {
    assert.deepEqual(cardControlFor(connector("dingtalk", state)), {
      kind: "repair",
      action: "repair",
    });
  }
});

test("ready connectors expose the conversation control", () => {
  assert.deepEqual(cardControlFor(connector("dingtalk", "ready")), {
    kind: "conversation",
  });
});

test("environment failure codes map to a restart-update hint", () => {
  assert.equal(
    connectorLoadErrorLabel("CONNECTOR_RUNTIME_UNAVAILABLE", "internal detail"),
    "运行环境异常：连接器运行环境不可用，请重启或更新应用后再试。",
  );
  assert.equal(
    connectorLoadErrorLabel("CONNECTOR_CATALOG_INVALID", "internal detail"),
    "运行环境异常：连接器运行环境不可用，请重启或更新应用后再试。",
  );
  assert.equal(connectorLoadErrorLabel(null, "网络错误"), "网络错误");
  assert.equal(connectorLoadErrorLabel(null, null), null);
});
