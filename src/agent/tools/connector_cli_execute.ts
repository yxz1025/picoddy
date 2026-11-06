import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";

import type { ConnectorCommandContext, ConnectorCommandGateway } from "../../domains/connector/node/command_gateway.ts";
import { ConnectorError, CONNECTOR_ERROR_HTTP_STATUS } from "../../domains/connector/node/errors.ts";
import { sessionContext } from "../../infra/context.ts";

type JsonObject = Record<string, unknown>;

const commandSchema = Type.Object({
  connectorId: Type.String({ minLength: 1, maxLength: 64 }),
  argv: Type.Array(Type.String({ minLength: 1, maxLength: 512 }), { minItems: 1, maxItems: 32 }),
  confirmationId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
}, { additionalProperties: false });

export interface ConnectorCliExecuteToolResult {
  content: Array<{ type: "text"; text: string }>;
  details: JsonObject;
}

export interface ConnectorCliExecuteToolDependencies {
  /** 可延迟到首次执行时解析的网关（允许惰性装配注册表）。 */
  readonly gateway: ConnectorCommandGateway | Promise<ConnectorCommandGateway>;
  /** Resolves the active connector binding for a session; defaults to session context. */
  readonly resolveContext?: (sessionId: string) => ConnectorCommandContext | undefined;
}

function result(details: JsonObject): ConnectorCliExecuteToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(details) }],
    details,
  };
}

function failure(code: string, status: number, message: string, extra?: JsonObject): ConnectorCliExecuteToolResult {
  return result({ ok: false, error: { code, status, message, ...extra } });
}

export function createConnectorCliExecuteTool(
  dependencies: ConnectorCliExecuteToolDependencies,
): AgentTool<typeof commandSchema, JsonObject> {
  const resolveContext = dependencies.resolveContext ?? ((sessionId: string) => {
    const store = sessionContext.getStore();
    if (store?.sessionId !== sessionId || store.connector === undefined) return undefined;
    const { connectorId, cliVersion, binPath, cwd } = store.connector;
    return { connectorId, cliVersion, binPath, ...(cwd !== undefined ? { cwd } : {}) };
  });

  return {
    name: "connector_cli_execute",
    label: "执行连接器命令",
    description: "在当前活动连接器的已验证 CLI 上执行一条目录 schema 允许的命令，并返回结构化结果。",
    parameters: commandSchema,
    execute: async (_id, params) => {
      const sessionId = sessionContext.getStore()?.sessionId;
      if (!sessionId) {
        return failure("SESSION_CONTEXT_MISSING", 400, "无法确定当前会话");
      }
      const context = resolveContext(sessionId);
      if (context === undefined) {
        return failure("CONNECTOR_CONTEXT_MISSING", 409, "当前会话没有活动的连接器");
      }
      let outcome;
      try {
        const gateway = await dependencies.gateway;
        outcome = await gateway.execute(
          { connectorId: params.connectorId, argv: params.argv, confirmationId: params.confirmationId },
          context,
        );
      } catch (cause) {
        if (cause instanceof ConnectorError) {
          return failure(cause.code, cause.status, cause.message);
        }
        return failure("CONNECTOR_BROKEN", 502, "连接器命令执行失败");
      }
      switch (outcome.code) {
        case "SUCCESS":
          return result({
            ok: true,
            output: outcome.output,
            ...(outcome.artifact !== undefined ? { artifact: outcome.artifact } : {}),
          });
        case "CONFIRMATION_REQUIRED":
          // ConnectorErrorCode 也包含 CONFIRMATION_REQUIRED，需要用字段存在性区分确认结果与错误结果。
          return "reason" in outcome
            ? failure("CONFIRMATION_REQUIRED", 409, outcome.reason, { confirmationId: outcome.confirmationId })
            : failure(outcome.code, CONNECTOR_ERROR_HTTP_STATUS[outcome.code] ?? 502, outcome.message);
        default:
          return failure(outcome.code, CONNECTOR_ERROR_HTTP_STATUS[outcome.code] ?? 502, outcome.message);
      }
    },
  };
}
