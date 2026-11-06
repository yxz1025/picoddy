import { assertDatabaseInitialized, pool, transaction } from "../src/infra/db.ts";

const IDENTITY_PROVIDER = "cas";

function option(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  if (index < 0) return undefined;
  const value = process.argv[index + 1];
  if (!value || value.startsWith("--")) throw new Error(`--${name} requires a value`);
  return value;
}

function requiredOption(name: string): string {
  const value = option(name)?.trim();
  if (!value) throw new Error(`--${name} is required`);
  return value;
}

async function setDisabled(disabled: boolean): Promise<void> {
  const subject = requiredOption("subject");
  const result = await transaction(async (client) => {
    const updated = await client.query<{ id: string; subject: string }>(
      `UPDATE users SET disabled_at=$2,updated_at=now()
        WHERE provider=$1 AND subject=$3 RETURNING id,subject`,
      [IDENTITY_PROVIDER, disabled ? new Date() : null, subject],
    );
    if (disabled && updated.rows[0]) {
      await client.query("DELETE FROM sessions WHERE owner_id=$1", [updated.rows[0].id]);
    }
    return updated.rows[0];
  });
  if (!result) throw new Error("User not found");
  console.log(JSON.stringify({ id: result.id, provider: IDENTITY_PROVIDER, subject: result.subject, disabled }));
}

async function setRole(): Promise<void> {
  const subject = requiredOption("subject");
  const role = requiredOption("role");
  if (role !== "user" && role !== "admin") {
    throw new Error("--role must be user or admin");
  }
  const result = await pool.query<{ id: string; subject: string; role: "user" | "admin" }>(
    `UPDATE users SET role=$3,updated_at=now()
      WHERE provider=$1 AND subject=$2
      RETURNING id,subject,role`,
    [IDENTITY_PROVIDER, subject, role],
  );
  const user = result.rows[0];
  if (!user) throw new Error("User not found");
  console.log(JSON.stringify({ id: user.id, provider: IDENTITY_PROVIDER, subject: user.subject, role: user.role }));
}

async function listUsers(): Promise<void> {
  const result = await pool.query<{
    id: string; provider: string; subject: string; email: string | null;
    name: string; avatar: string; role: string;
    disabled_at: Date | null; created_at: Date;
  }>(
    `SELECT id,provider,subject,email,name,avatar,role,disabled_at,created_at
       FROM users WHERE provider=$1 ORDER BY created_at,id`,
    [IDENTITY_PROVIDER],
  );
  console.log(JSON.stringify(result.rows.map((row) => ({
    id: row.id,
    provider: row.provider,
    subject: row.subject,
    email: row.email,
    name: row.name,
    avatar: row.avatar,
    role: row.role,
    disabled: !!row.disabled_at,
    createdAt: row.created_at.toISOString(),
  }))));
}

async function main(): Promise<void> {
  const command = process.argv[2];
  if (!command || command === "help" || command === "--help") {
    console.log("Usage: admin.ts <list-users|disable-user|enable-user|set-role> [--subject username] [--role user|admin]");
    return;
  }
  await assertDatabaseInitialized();
  if (command === "disable-user") await setDisabled(true);
  else if (command === "enable-user") await setDisabled(false);
  else if (command === "set-role") await setRole();
  else if (command === "list-users") await listUsers();
  else throw new Error(`Unknown command: ${command}`);
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Admin command failed");
  process.exitCode = 1;
} finally {
  await pool.end();
}
