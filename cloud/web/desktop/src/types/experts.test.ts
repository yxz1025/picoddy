import type { ExpertType } from "./experts.ts";

const agent: ExpertType = "agent";
void agent;

// @ts-expect-error Expert types must remain Agent-only.
const team: ExpertType = "team";
void team;
