import { getDb } from "../../../infra/db.ts";

export interface AttachmentRecord {
  id: string;
  name: string;
  filePath: string;
  mimeType: string;
  extension: string;
  size: number;
}

export interface ClaimedAttachmentRecord extends AttachmentRecord {
  createdAt: number;
}

export type AttachmentClaimResult =
  | { status: "claimed"; record: ClaimedAttachmentRecord }
  | { status: "linked" }
  | { status: "missing" };

const SELECT_ATTACHMENT = `
  SELECT
    id,
    original_name AS name,
    file_path AS filePath,
    mime_type AS mimeType,
    extension,
    size
  FROM attachments
`;

export function insertAttachment(record: AttachmentRecord): void {
  getDb().prepare(`
    INSERT INTO attachments (
      id,
      original_name,
      file_path,
      mime_type,
      extension,
      size,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.name,
    record.filePath,
    record.mimeType,
    record.extension,
    record.size,
    Date.now(),
  );
}

export function restoreClaimedAttachment(
  record: ClaimedAttachmentRecord,
): void {
  getDb().prepare(`
    INSERT INTO attachments (
      id,
      original_name,
      file_path,
      mime_type,
      extension,
      size,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    record.id,
    record.name,
    record.filePath,
    record.mimeType,
    record.extension,
    record.size,
    record.createdAt,
  );
}

export function getAttachment(id: string): AttachmentRecord | undefined {
  return getDb().prepare(`${SELECT_ATTACHMENT} WHERE id = ?`).get(id) as
    | AttachmentRecord
    | undefined;
}

export function getConversationAttachment(
  conversationId: string,
  attachmentId: string,
): AttachmentRecord | undefined {
  return getDb().prepare(`
    SELECT
      attachments.id,
      attachments.original_name AS name,
      attachments.file_path AS filePath,
      attachments.mime_type AS mimeType,
      attachments.extension,
      attachments.size
    FROM attachments
    JOIN message_attachments
      ON message_attachments.attachment_id = attachments.id
    JOIN messages
      ON messages.id = message_attachments.message_id
    WHERE attachments.id = ?
      AND messages.conversation_id = ?
    LIMIT 1
  `).get(attachmentId, conversationId) as AttachmentRecord | undefined;
}

export function encodeAttachmentLayout(offset: number, order: number): number {
  return Math.max(0, offset) * 100 + (Math.max(0, order) % 100);
}

export function decodeAttachmentLayout(
  position: number,
): { offset: number; order: number } {
  const safe = Math.max(0, position);
  return { offset: Math.floor(safe / 100), order: safe % 100 };
}

export function attachToMessage(
  messageId: string,
  ids: string[],
  anchors: Readonly<Record<string, number>> = {},
): void {
  const db = getDb();
  db.exec("SAVEPOINT attach_to_message");
  try {
    db.prepare("DELETE FROM message_attachments WHERE message_id = ?").run(
      messageId,
    );
    const insert = db.prepare(`
      INSERT INTO message_attachments (message_id, attachment_id, position)
      VALUES (?, ?, ?)
    `);
    ids.forEach((attachmentId, order) => {
      insert.run(
        messageId,
        attachmentId,
        encodeAttachmentLayout(anchors[attachmentId] ?? 0, order),
      );
    });
    db.exec("RELEASE SAVEPOINT attach_to_message");
  } catch (error) {
    db.exec("ROLLBACK TO SAVEPOINT attach_to_message");
    db.exec("RELEASE SAVEPOINT attach_to_message");
    throw error;
  }
}

export function listMessageAttachments(
  messageId: string,
): Array<AttachmentRecord & { position: number }> {
  return getDb().prepare(`
    SELECT
      attachments.id,
      attachments.original_name AS name,
      attachments.file_path AS filePath,
      attachments.mime_type AS mimeType,
      attachments.extension,
      attachments.size,
      message_attachments.position AS position
    FROM message_attachments
    JOIN attachments
      ON attachments.id = message_attachments.attachment_id
    WHERE message_attachments.message_id = ?
    ORDER BY message_attachments.position ASC
  `).all(messageId) as unknown as Array<AttachmentRecord & { position: number }>;
}

export function isAttachmentLinked(id: string): boolean {
  const row = getDb().prepare(`
    SELECT 1 AS linked
    FROM message_attachments
    WHERE attachment_id = ?
    LIMIT 1
  `).get(id) as { linked: number } | undefined;
  return row !== undefined;
}

/**
 * Atomically removes an attachment record only if no message references it.
 * The returned metadata lets the service restore the record if filesystem
 * cleanup fails. Once claimed, later message associations fail their FK.
 */
export function claimUnlinkedAttachment(id: string): AttachmentClaimResult {
  const db = getDb();
  const record = db.prepare(`
    DELETE FROM attachments
    WHERE id = ?
      AND NOT EXISTS (
        SELECT 1
        FROM message_attachments
        WHERE attachment_id = attachments.id
      )
    RETURNING
      id,
      original_name AS name,
      file_path AS filePath,
      mime_type AS mimeType,
      extension,
      size,
      created_at AS createdAt
  `).get(id) as ClaimedAttachmentRecord | undefined;

  if (record) return { status: "claimed", record };
  if (getAttachment(id)) return { status: "linked" };
  return { status: "missing" };
}

export function deleteAttachmentRecord(id: string): void {
  getDb().prepare("DELETE FROM attachments WHERE id = ?").run(id);
}
