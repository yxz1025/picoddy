# TAPD 用例上传目录选择与提交反馈

## 背景

用户反馈“上传选定版本”点击无反应，并要求与 TAPD 新建用例一样在上传弹窗选择目标目录。前一版导入已接入原生 tcases 和需求关联，但目录仅按 Excel 路径自动解析，弹窗没有目录选择。

## 现状与定位

TestingDeliveryControls 的上传按钮在 detail、字段映射或外部 disabled 条件未满足时直接 disabled，未紧邻按钮展示完整原因。当前真实会话的详情 GET 返回 49 条用例、等级高/中/低，步骤描述类型和标签非空，项目没有对应自定义字段，因此映射条件无法满足，按钮不会触发提交。不能仅根据这次读取断言用户每次操作都属于该原因；同时需要检查加载期间、事件处理及请求失败的反馈。execute 在 detail 为空时也可能直接结束而未报告原因，应显式拦截。

## 目标

1. 上传弹窗展示当前项目真实目录层级，用户明确选择本次目标目录。
2. 本次新建用例全部直接保存到选定目录；清楚说明此选择覆盖 Excel 的目录列，不自动在其下创建 Excel 子目录。
3. 点击上传立即显示校验结果或上传进度，任何前置条件不满足都明确说明，不再通过无原因的禁用按钮表现为无反应。
4. 保留原生用例创建、需求关联、不可变文件校验及逐行续传能力。

## 非目标

不在本次弹窗增加远端目录新建/移动/删除操作，不修改 TAPD 项目字段配置，不将步骤描述类型错误映射为用例类型，不静默丢失模板非空列，不执行测试或推进需求状态。

## 目录与接口

复用连接器凭证，分页读取 GET tcase_categories，使用真实 id、name、parent_id 构建完整路径选项。读取失败、父目录缺失或循环导致无法可靠识别路径时给出错误，不猜测目录。项目提供的未规划目录也作为真实选项显示，不虚构目录 ID。支持刷新目录及字段。

选定目录通过 POST testing-delivery 的 categoryId 传递，后端在当前可信 workspace 中重新读取目录，确认 ID 归属并存在，再为每条新用例的 POST tcases 填入 category_id。不接受外部 workspace、任意 URL 或文件路径。目录清单通过既有 testingGet 返回，IPC、preload 与 HTTP 共用业务入口。

官方依据：
- https://open.tapd.cn/document/api-doc/API文档/api_reference/tcase/get_tcase_categories.html
- https://open.tapd.cn/document/api-doc/API文档/api_reference/tcase/add_tcase.html

## 提交交互与状态

文件/字段/目录加载中显示明确状态；文件改变时清除旧详情，避免选项与上传版本不一致。上传按钮仅在执行中或会话不可提交时禁止重复提交；缺少文件、等级映射、非空列映射、目录或字段读取失败时，点击给出逐项校验提示，并在操作区列出未满足条件。

execute 必须先核对选定文件与详情一致、资产 hash、映射和目录。缺少详情不能静默退出。进入执行后立即显示“正在校验/上传”，保持窗口中固定状态反馈和逐行结果。请求失败显示真实错误；加载/忙碌及部分成功均有明确反馈。保留已选映射供续传使用。

## 回执与续传

目标目录纳入内容指纹和回执。未成功创建的行允许修正目录再上传；已成功或结果未知的行固定已授权目录，续传时若选择不同目录明确阻断，不静默移动、不复用其他目录记录或重复创建。已有回执从其持久化 payload.category_id 识别实际目录；缺少目录证据时阻断并说明，不能猜测。保持创建成功后只补做需求关联、未知结果先查询的行为。

## 影响范围

TestingDeliveryControls、测试导入领域服务、testing-delivery API/IPC 数据结构、回归测试源码、专家系统和 IPC 文档。保留已有未提交修改，不改专家模板的 11 列。

## 风险与验证

目录可能被删除或权限变化，提交前重新验证；目录同名用完整路径区分；目录分页不能遗漏。续传与新目录混用须明确阻断。补充目录归属、指定 category_id、目录变更续传和缺少映射反馈的回归源码。

遵循项目要求，只执行 TypeScript、语法检查和 git diff --check，不擅自运行测试或构建。不用虚构用例向真实项目写入；实现基于跨平台 Node/IPC，未经验证不声称 Windows 构建或实际上传通过。

## 状态

用户已确认，并明确简化为“选择 Excel → 选择上传目录 → 上传”，取消人工字段与等级映射。以下核实结果及修订替代上文旧 tcases 映射方案。

## 已确认范围内的接口修订

官方 TestX 测试协同创建用例 API 原生接受 P0/P1/P2/P3、STEP/TEXT、Steps/StepText、Labels、Issues、ManHourEstimated 和 RunTimes，与原模板列直接对应；先前的旧 tcases 接口属于旧测试模块，导致不必要映射。本次直接替换旧导入实现，取消字段配置和高/中/低交互，不擅自换算，不将扩展字段塞入业务文本。

仍在宿主解析并校验 Excel，再创建原生用例；没有发现公开的 Excel 二进制导入 API，不能声称是网页文件上传。目录目标为当前项目真实用例库/版本/目录组合；默认唯一可用库/版本，否则在目录选项中显示库和版本，避免技术 ID 出现在常规流程。调用 repo 列表及 case search 的 FOLDER 模式分页读取目录；支持选择库根目录（官方 FolderUid=0）。创建请求直接携带当前需求 Issues，不再调用旧 stories/add_story_tcase。

步骤和预期按模板连续编号成对转为 CaseStep；TEXT 保留全文；标签按中文逗号分成 Label，保留显示名和值。需求身份由宿主注入，拒绝 Excel 中其他需求。目录选择覆盖 Excel 目录列，上传版本保持原文件不变。

导入使用独立 TestX 回执表，包含目标库、版本、目录和请求指纹，不能将旧 tcases 回执当成 TestX 成功记录。创建前持久化；成功后校验返回用例 ID 和需求关联；创建请求自带 Issues，若返回未确认关联则保留 ID 并明确提示在 TAPD 核对，续传只查询已有用例，避免未经验证的部分更新行为覆盖人工修改。未知结果先查唯一匹配用例，不盲目重建。目录变更在成功或未知回执存在时阻断；明确失败且未创建的记录可以修正目标重试。

现有连接器令牌已按 Bearer/Via/s=mcp 只读访问 TestX，远端返回 HTTP 401 FlexibleCode.Shipyard.Credential。实现必须明确呈现“测试协同未认证，请重新授权支持 TestX 的连接器凭证”，保留提交需求资产能力，不退回旧模块、不要求映射、不读取浏览器 Cookie 或绕过认证。可以完成代码与静态检查，但实际目录及上传验证依赖有效 TestX 用户态授权；不能伪称已真实上传。

官方依据：
- https://open.tapd.cn/document/api-doc/API文档/api_reference/testx/case/create_case.html
- https://open.tapd.cn/document/api-doc/API文档/api_reference/testx/case/list_repo.html
- https://open.tapd.cn/document/api-doc/API文档/api_reference/testx/case/search_case.html
- https://open.tapd.cn/document/api-doc/API文档/授权凭证/用户态.html

## 实施与验证结果

已实施 Excel 版本与目录选择、移除人工字段/等级映射、TestX 原生创建、逐行回执及续传保护，并重启开发应用。运行时 Excel 详情接口成功识别现有文件的 49 条用例；目录接口明确返回 TestX 授权不足原因。当前凭证仍被 TestX 拒绝认证，真实目录及创建流程尚未验证，未向远端创建用例。

前端 TypeScript、相关源码语法及 git diff --check 通过。后端整体类型检查仅剩技能模块既有 store.ts:204/280 的 version 类型错误。按项目约束未运行测试或构建，Windows 未验证；专家包生成脚本已同步说明，未重新打包个人安装包。
