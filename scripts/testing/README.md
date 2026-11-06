# 需求测试流水线接入

这些文件是待接入目标仓库的适配资源，不会由客户端启动自动执行，也不修改已有 Jenkins Job。

## 接入顺序

1. 在目标仓库复用或安装锁定版本的 `@playwright/test`，按需合并 `templates/playwright.config.ts.example`。浏览器依赖安装在 Jenkins agent，不放进 Electron。
2. 复制 `run-web.mjs` 到目标仓库 `scripts/testing/`，按 SDD 编写真实脚本。每条测试标题使用唯一 `[TC-ID]`，例如 `[TC-VOC-001] 查看手机号`；一期每个 Case 对应单一浏览器项目。多浏览器需独立测试目标，不混合相同 ID 的结果。
3. 认证、测试数据及清理由 Playwright fixtures 管理。脚本不得提交登录态或使用生产数据，fixture teardown 必须报告清理失败。
4. 创建下面格式的测试包清单，提交并推送脚本、配置、锁文件及清单。在客户端“测试执行”登记完整测试提交 SHA 和清单路径；登记不会触发测试。
5. 修改现有流水线接收 prepareRun 返回的参数，在部署后调用 runner。共享环境的锁必须覆盖部署到测试结束，且所有修改该环境的 Job 都遵守同一锁。
6. 实际部署步骤生成 `testing-results/deployment-manifest.json`，必须依据真实部署版本。用精确 TEST_SHA 的干净工作区执行 runner，`VERSION_URL` 返回 JSON，`VERSION_FIELD` 指向完整 SHA。
7. 构建无论成功失败都归档 `testing-results/**/*`。用户在聊天选择 Jenkins MCP，明确要求部署并测试；Agent 先用 requirement_testing 准备请求，再沿用现有 MCP 写权限触发流水线，并将准确构建编号交给 collect。

## 测试包清单示例

下面 ID/hash 需要替换为本需求已提交的真实 SDD 资产；不能直接使用示例登记。

```json
{
  "schemaVersion": 1,
  "inputAssets": [{"id": "真实资产ID", "hash": "真实SHA256"}],
  "cases": [{
    "id": "TC-VOC-001", "title": "有权限用户查看手机号",
    "acceptanceIds": ["AC-VOC-001"], "required": true,
    "automation": "automated", "file": "tests/e2e/voc/phone.spec.ts"
  }]
}
```

`automation` 支持 automated/manual/blocked；required 的人工或阻塞项未解决时总体门禁不能通过。已有 Excel 仍独立交付，不能自动当作可执行脚本。

## 部署清单

```json
{
  "schemaVersion": 1, "requestId": "prepareRun返回的ID",
  "targetId": "目标ID", "environment": "测试环境标识",
  "businessSha": "预期完整SHA", "deployedSha": "实际验证的部署完整SHA"
}
```

runner 输出 `playwright.json`、`junit.xml`、HTML/截图/Trace、`test-summary.json`。客户端校验部署清单、请求、测试包、执行前后版本、原始报告 hash 和逐用例结果。缺文件、零用例、遗漏必测项均不能通过。

## 边界

- 仅第一期 Web/微前端/H5 浏览器执行，小程序配置可保存但执行阻断。
- 模板不是现成业务测试：页面定位、预期、账号与数据必须来自目标项目。
- 不自动提交推送，不自动安装依赖，不修改真实 Jenkins Job，不支持用“最近成功构建”代替明确构建号。
- Git 工作区必须干净；流水线检查用例脚本来源和合并权限，不能向未审查脚本提供生产凭据。
- 中断后用原 requestId 和 build number 重新读取报告，不重复触发 CI/CD。

## 快速验证界面与配置

在 Electron 中打开需求的“研发设计”或“自动测试”，进入右侧“测试执行”：

1. 添加目标，选择已关联仓库，填写 Jenkins MCP 配置名、Job、环境标识。
2. 填写明确的测试页面地址 BASE_URL，例如 https://test.example.com/。页面路由由真实测试脚本指定；不能从仓库名推断域名。
3. 填写同一环境的版本 JSON 地址及完整 SHA 字段。微前端应对应被测子应用版本。当前仅支持固定地址，动态预览域名后续接入。
4. 保存后可验证配置展示；“校验只读连接”仅检查 MCP 工具可用，不会构建或测试。
5. 流水线接入完成后，聊天登记运行并关联准确构建号。运行中每 30 秒只读查询；客户端退出后远端继续，重新打开面板恢复读取。超过 24 小时停止自动轮询，可手动核验。

当前代码交付不等于真实业务链路已经接通。仍需选定实际 Job 接入本目录协议，并提供对应页面的测试脚本、登录态、数据 fixtures。普通发布流水线缺少报告时不会标记测试通过。
