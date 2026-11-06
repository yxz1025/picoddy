import type { Database } from '../../../infra/db.ts';
import { fail } from '../../../shared/errors.ts';
import { object } from '../../../shared/validation.ts';

export interface UserPreferences {
  agentSystemPrompt: string;
  language: string;
  fontSize: string;
}
const DEFAULTS: UserPreferences = { agentSystemPrompt: '', language: 'zh-CN', fontSize: '14' };
interface PreferenceQuery {
  query(sql: string, values?: unknown[]): Promise<{ rows: Array<{ data?: unknown }> }>;
}

export function parsePreferencePatch(input: unknown): Partial<UserPreferences> {
  const body = object(input);
  const result: Partial<UserPreferences> = {};
  for (const key of Object.keys(body)) {
    if (!Object.hasOwn(DEFAULTS, key)) fail(400, 'SETTING_UNSUPPORTED', `Unsupported preference: ${key}`);
    const value = body[key];
    if (typeof value !== 'string') fail(400, 'INVALID_SETTING', `${key} must be a string`);
    if (key === 'agentSystemPrompt' && value.length > 8000) fail(400, 'PROMPT_CONTEXT_LIMIT_EXCEEDED', 'agent_system_prompt exceeds 8000 characters');
    if (key === 'language' && !/^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,3}$/.test(value)) fail(400, 'INVALID_SETTING', 'Invalid language tag');
    if (key === 'fontSize' && !/^(?:1[0-9]|2[0-4])$/.test(value)) fail(400, 'INVALID_SETTING', 'Font size must be 10–24');
    result[key as keyof UserPreferences] = value;
  }
  return result;
}

async function readPreferences(db: PreferenceQuery, ownerId: string): Promise<UserPreferences> {
  const result = await db.query('SELECT data FROM user_preferences WHERE owner_id=$1', [ownerId]);
  return { ...DEFAULTS, ...parsePreferencePatch(result.rows[0]?.data ?? {}) };
}

/** Call with the run transaction after locking the owner; never read live settings in Worker. */
export async function readPromptSettings(db: PreferenceQuery, ownerId: string) {
  const settings = await readPreferences(db, ownerId);
  return { customInstructions: settings.agentSystemPrompt, language: settings.language };
}

export function createPreferenceService(db: Database) {
  return {
    get(ownerId: string) { return readPreferences(db, ownerId); },
    async update(ownerId: string, input: unknown): Promise<UserPreferences> {
      const patch = parsePreferencePatch(input);
      return db.transaction(async client => {
        const owner = await client.query('SELECT id FROM users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [ownerId]);
        if (!owner.rowCount) fail(404, 'NOT_FOUND', 'User not found');
        const result = await client.query(
          `INSERT INTO user_preferences(owner_id,data) VALUES($1,$2::jsonb)
           ON CONFLICT(owner_id) DO UPDATE SET data=user_preferences.data || EXCLUDED.data,updated_at=now()
           RETURNING data`, [ownerId, JSON.stringify(patch)],
        );
        return { ...DEFAULTS, ...parsePreferencePatch(result.rows[0].data) };
      });
    },
  };
}
