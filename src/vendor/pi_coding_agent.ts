// Pi's public SDK owns sessions, resources and tools. Keep the one non-exported
// shell operations helper isolated here for the platform sandbox implementation.
export {
  createBashTool, createCodingTools, createReadOnlyTools, createAgentSession,
  AgentSession, SessionManager, DefaultResourceLoader, SettingsManager,
  ModelRuntime, formatSkillsForPrompt, loadSkills, createCodemodeExtension, createToolSearchExtension,
  estimateTokens,
} from "@earendil-works/pi-coding-agent";
export { createLocalBashOperations } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js";
// Pi does not export these helpers from its root. Use its implementation rather
// than maintaining a second command parser/substitution engine.
export { loadPromptTemplates, parseCommandArgs, substituteArgs } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/prompt-templates.js";
