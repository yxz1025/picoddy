export interface AgentRuntimeInitialization<Service> {
  initializeSkills(): string | Promise<string>;
  initializeModels(): void | Promise<void>;
  // 受管连接器启动：只验证目录/运行时并恢复过期锁与残留 staging，
  // 不联网、不安装、不提取 Skill、不执行包脚本、不打开授权，也不为非 ready 连接器注册委派。
  initializeConnectors?: () => void | Promise<void>;
  startService?: () => Service | Promise<Service>;
}

export interface AgentRuntimeInitializationResult<Service> {
  activeBuiltinSkillsDir: string;
  service: Service | undefined;
}

export interface DesktopAgentDependencies {
  ensureSkills(): string | Promise<string>;
  initModels(): void | Promise<void>;
  skillsReady?: (activeBuiltinSkillsDir: string) => void | Promise<void>;
  modelsReady?: () => void | Promise<void>;
  connectorsReady?: () => void | Promise<void>;
}

/** Production desktop dependency wiring, separated from application side effects. */
export function createDesktopAgentInitialization(
  dependencies: DesktopAgentDependencies,
): AgentRuntimeInitialization<never> {
  return {
    initializeSkills: async () => {
      const activeDir = await dependencies.ensureSkills();
      await dependencies.skillsReady?.(activeDir);
      return activeDir;
    },
    initializeModels: async () => {
      await dependencies.initModels();
      await dependencies.modelsReady?.();
    },
    initializeConnectors: dependencies.connectorsReady,
  };
}

/** Shared ordering gate for desktop agent runtime initialization. */
export async function initializeAgentRuntime<Service = never>(
  initialization: AgentRuntimeInitialization<Service>,
): Promise<AgentRuntimeInitializationResult<Service>> {
  const activeBuiltinSkillsDir = await initialization.initializeSkills();
  await initialization.initializeModels();
  await initialization.initializeConnectors?.();
  const service = await initialization.startService?.();
  return { activeBuiltinSkillsDir, service };
}
