// src/agent/tools/goal.ts
// pi-goal：目标驱动强校验模式工具 (Goal Verification Tool)

import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { sessionContext } from "../../infra/context.ts";

const goalCompleteSchema = Type.Object({
  success: Type.Boolean({ description: "目标是否已完全达标且验证通过" }),
  summary: Type.String({ description: "目标完成成果摘要" }),
  proof: Type.String({ description: "验证通过的具体依据/断言结果/输出文件路径" }),
  status: Type.Optional(Type.Union([Type.Literal("completed"), Type.Literal("waiting_for_user")], {
    description: "确实缺少用户必须补充的信息时设 waiting_for_user，并在 summary 写明具体问题；此时 success 必须为 false。",
  })),
});

export const goalCompleteTool: AgentTool<typeof goalCompleteSchema, any> = {
  name: "goal_complete",
  label: "目标完成校验",
  description: '单独提交任务完成、失败或等待用户的声明，不要与其他工具同批调用。一次同时提供三个必填字段，例如 {"success":true,"summary":"完成的具体工作","proof":"实际验证结果与产物路径"}。缺少用户信息时 success=false、status="waiting_for_user"，仍须提供 summary 和 proof；环境失败或未验证不能宣称验证通过。成功前必须完成必要操作与验证；声明被接收后停止业务工具，由运行时复验并收尾。普通问答无需调用，无文件任务无需生成文件。',
  parameters: goalCompleteSchema,
  executionMode: "sequential",
  execute: async (_id, p) => {
    if (p.status === "waiting_for_user" && (p.success || !p.summary.trim())) {
      throw new Error("等待用户时 success 必须为 false，summary 必须说明待补充的信息。");
    }
    const declare = sessionContext.getStore()?.declareTaskCompletion;
    if (!declare) throw new Error("完成声明必须在任务运行时内提交。");
    await declare(p);
    console.log(`[pi-goal] 目标完成校验: success=${p.success}`);
    return {
      // Native Pi stops normally; this is not cancellation or Task succeeded.
      terminate: true,
      content: [
        {
          type: "text",
          text: p.status === "waiting_for_user" ? `等待用户补充：${p.summary}` : p.success
            ? `[完成声明已接收，等待运行时最终验收]: ${p.summary}\n验证凭据: ${p.proof}`
            : `❌ [目标未能闭环]: ${p.summary}`,
        },
      ],
      details: { success: p.success, proof: p.proof, summary: p.summary, status: p.status },
    };
  },
};
