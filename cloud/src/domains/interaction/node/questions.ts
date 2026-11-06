import type { Database } from '../../../infra/db.ts';
import type { Run } from '../../../cloud/runs/types.ts';
import { fail } from '../../../shared/errors.ts';
import { object, string } from '../../../shared/validation.ts';

interface Question { question: string; header?: string; multiSelect: boolean; options: Array<{ label: string; description?: string }> }
function validateQuestions(value: unknown): Question[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > 4) fail(400, 'INVALID_QUESTIONS', 'Provide 1-4 questions');
  return value.map(input => {
    const item = object(input);
    if (!Array.isArray(item.options) || item.options.length < 2 || item.options.length > 4) fail(400, 'INVALID_QUESTIONS', 'Each question needs 2-4 options');
    if (item.multiSelect !== undefined && typeof item.multiSelect !== 'boolean') fail(400, 'INVALID_QUESTIONS', 'multiSelect must be boolean');
    const options = item.options.map(input => {
      const option = object(input);
      return { label: string(option.label, 'label', 1, 120), ...(option.description === undefined ? {} : { description: string(option.description, 'description', 1, 500) }) };
    });
    if (new Set(options.map(option => option.label)).size !== options.length) fail(400, 'INVALID_QUESTIONS', 'Option labels must be unique');
    return { question: string(item.question, 'question', 1, 2000), multiSelect: item.multiSelect === true, options,
      ...(item.header === undefined ? {} : { header: string(item.header, 'header', 1, 120) }) };
  });
}
function validateAnswers(value: unknown, questions: Question[]) {
  if (!Array.isArray(value) || value.length !== questions.length) fail(400, 'INVALID_ANSWERS', 'Answer every question');
  return value.map((answer, index) => {
    if (answer === null) return null; // Explicit skip, not approval.
    if (typeof answer === 'string') return string(answer, 'answer', 1, 4000);
    if (!Array.isArray(answer) || !questions[index].multiSelect || answer.length > 4 || answer.some(item => typeof item !== 'string' || !questions[index].options.some(option => option.label === item))) fail(400, 'INVALID_ANSWERS', 'Invalid answer selection');
    return [...new Set(answer)] as string[];
  });
}

export function createQuestionService(database: Database) {
  return {
    async open(run: Run, toolCallId: string, input: unknown) {
      const questions = validateQuestions(input);
      string(toolCallId, 'toolCallId', 1, 500);
      return database.transaction(async client => {
        const lease = await client.query(`SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND lease_until>now()
          AND NOT cancel_requested AND status='running' FOR UPDATE`, [run.id, run.owner_id, run.lease_token]);
        if (!lease.rows[0]) throw new Error('RUN_LEASE_LOST');
        const automated = await client.query('SELECT run_id FROM automation_runs WHERE run_id=$1 AND owner_id=$2', [run.id, run.owner_id]);
        if (automated.rows[0]) fail(409, 'INTERACTION_UNAVAILABLE', 'Unattended automation cannot wait for user answers');
        const existing = await client.query('SELECT id,questions,status FROM user_questions WHERE run_id=$1 AND owner_id=$2 AND tool_call_id=$3', [run.id, run.owner_id, toolCallId]);
        if (existing.rows[0]) {
          if (JSON.stringify(existing.rows[0].questions) !== JSON.stringify(questions)) {
            // JSONB key order differs: compare semantic structures through the validator.
            if (JSON.stringify(validateQuestions(existing.rows[0].questions)) !== JSON.stringify(questions)) fail(409, 'QUESTION_CALL_CONFLICT', 'Tool call already contains different questions');
          }
          return existing.rows[0] as { id: string; questions: Question[]; status: string };
        }
        const inserted = await client.query('INSERT INTO user_questions(owner_id,run_id,tool_call_id,questions) VALUES($1,$2,$3,$4::jsonb) RETURNING id,questions,status', [run.owner_id, run.id, toolCallId, JSON.stringify(questions)]);
        const row = inserted.rows[0];
        await client.query("INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'ask_user_question',$3::jsonb)", [run.owner_id, run.id, JSON.stringify({ requestId: row.id, questions })]);
        return row as { id: string; questions: Question[]; status: string };
      });
    },
    async list(ownerId: string, runId: string) {
      const run = await database.query('SELECT id FROM runs WHERE id=$1 AND owner_id=$2', [runId, ownerId]);
      if (!run.rows[0]) fail(404, 'NOT_FOUND', 'Run not found');
      return (await database.query(`SELECT q.id,q.questions FROM user_questions q JOIN runs r ON r.id=q.run_id AND r.owner_id=q.owner_id
        WHERE q.run_id=$1 AND q.owner_id=$2 AND q.status='pending' AND q.expires_at>now()
          AND r.status='running' AND r.lease_until>now() AND NOT r.cancel_requested ORDER BY q.created_at`, [runId, ownerId])).rows;
    },
    async answer(ownerId: string, id: string, input: unknown) {
      const found = await database.query('SELECT run_id FROM user_questions WHERE id=$1 AND owner_id=$2', [id, ownerId]);
      if (!found.rows[0]) fail(404, 'NOT_FOUND', 'Question not found');
      return database.transaction(async client => {
        const run = await client.query(`SELECT status,cancel_requested,lease_until>now() AS leased FROM runs WHERE id=$1 AND owner_id=$2 FOR UPDATE`, [found.rows[0].run_id, ownerId]);
        const question = await client.query('SELECT *,expires_at>now() AS timely FROM user_questions WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, ownerId]);
        const row = question.rows[0];
        if (!row) fail(404, 'NOT_FOUND', 'Question not found');
        const answers = validateAnswers(input, row.questions);
        if (row.status === 'answered') {
          if (JSON.stringify(row.answers) !== JSON.stringify(answers)) fail(409, 'ALREADY_ANSWERED', 'Question already answered');
          return { ok: true };
        }
        if (row.status !== 'pending' || !row.timely || !run.rows[0]?.leased || run.rows[0].cancel_requested || run.rows[0].status !== 'running') fail(409, 'QUESTION_NOT_ACTIVE', 'Question is no longer active');
        await client.query("UPDATE user_questions SET answers=$3::jsonb,status='answered',answered_at=now() WHERE id=$1 AND owner_id=$2", [id, ownerId, JSON.stringify(answers)]);
        await client.query("INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'question_answered',$3::jsonb)", [ownerId, row.run_id, JSON.stringify({ requestId: id })]);
        return { ok: true };
      });
    },
    async poll(run: Run, id: string): Promise<unknown[] | undefined> {
      const result = await database.query(`SELECT q.status,q.answers,q.expires_at>now() AS timely FROM user_questions q JOIN runs r ON r.id=q.run_id AND r.owner_id=q.owner_id
        WHERE q.id=$1 AND q.owner_id=$2 AND q.run_id=$3 AND r.lease_token=$4 AND r.lease_until>now() AND NOT r.cancel_requested AND r.status='running'`, [id, run.owner_id, run.id, run.lease_token]);
      const row = result.rows[0];
      if (!row) throw new Error('RUN_LEASE_LOST');
      if (row.status === 'answered') return row.answers;
      if (!row.timely || row.status !== 'pending') throw new Error('QUESTION_EXPIRED_OR_CANCELLED');
      return undefined;
    },
    async close(run: Run, id: string) {
      await database.query(`UPDATE user_questions SET status=CASE WHEN expires_at<=now() THEN 'expired' ELSE 'cancelled' END
        WHERE id=$1 AND owner_id=$2 AND run_id=$3 AND status='pending'`, [id, run.owner_id, run.id]);
    },
  };
}
