import { parseStoredAttachments, type StoredAttachments } from '../shared/attachments';
import type { ConversationMessage, MessageKind } from './chat';
import type { User } from './env';

const TITLE_MAX_CHARS = 60;
const LIST_LIMIT = 200;

export interface ConversationSummary {
  id: string;
  title: string;
  updatedAt: string;
}

export function titleFrom(message: string): string {
  const singleLine = message.replace(/\s+/g, ' ').trim();
  return singleLine.length > TITLE_MAX_CHARS ? `${singleLine.slice(0, TITLE_MAX_CHARS - 1)}…` : singleLine;
}

export async function listConversations(db: D1Database, user: User): Promise<ConversationSummary[]> {
  const { results } = await db
    .prepare(
      `SELECT id, title, updated_at AS updatedAt FROM conversations
       WHERE user_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT ?`,
    )
    .bind(user.id, LIST_LIMIT)
    .all<ConversationSummary>();
  return results;
}

export async function findConversation(db: D1Database, user: User, id: string): Promise<ConversationSummary | null> {
  return db
    .prepare('SELECT id, title, updated_at AS updatedAt FROM conversations WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<ConversationSummary>();
}

/** Messages in chronological order; `limit` keeps only the most recent ones. */
export async function listMessages(db: D1Database, conversationId: string, limit?: number): Promise<ConversationMessage[]> {
  const statement =
    limit === undefined
      ? db.prepare('SELECT role, content, kind, attachments, image_id AS imageId, free_model AS freeModel FROM messages WHERE conversation_id = ? ORDER BY id').bind(conversationId)
      : db
          .prepare(
            `SELECT role, content, kind, attachments, imageId, freeModel FROM (
               SELECT id, role, content, kind, attachments, image_id AS imageId, free_model AS freeModel FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
             ) ORDER BY id`,
          )
          .bind(conversationId, limit);

  const { results } = await statement.all<Omit<ConversationMessage, 'attachments'> & { attachments: string | null }>();
  return results.map((row) => ({ ...row, attachments: parseStoredAttachments(row.attachments) }));
}

/** Stores one question/answer exchange, creating the conversation when `conversationId` is null. */
export async function saveExchange(
  db: D1Database,
  user: User,
  conversationId: string | null,
  question: string,
  answer: string,
  answerKind: MessageKind = 'text',
  attachments: StoredAttachments | null = null,
  /** A generated image shown with the answer; its file is already in R2. */
  image: { id: string; mimeType: string } | null = null,
  /** The answer was written by a free-tier model. */
  freeModel = false,
): Promise<ConversationSummary> {
  const id = conversationId ?? crypto.randomUUID();
  const insertMessage = db.prepare(
    'INSERT INTO messages (conversation_id, role, content, kind, attachments, image_id, free_model) VALUES (?, ?, ?, ?, ?, ?, ?)',
  );

  await db.batch([
    conversationId
      ? db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').bind(id, user.id)
      : db.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)').bind(id, user.id, titleFrom(question)),
    ...(image
      ? [
          db
            .prepare('INSERT INTO generated_images (id, user_id, conversation_id, mime_type) VALUES (?, ?, ?, ?)')
            .bind(image.id, user.id, id, image.mimeType),
        ]
      : []),
    insertMessage.bind(id, 'user', question, 'text', attachments ? JSON.stringify(attachments) : null, null, 0),
    insertMessage.bind(id, 'assistant', answer, answerKind, null, image?.id ?? null, freeModel ? 1 : 0),
  ]);

  const conversation = await findConversation(db, user, id);
  if (!conversation) throw new Error('conversation not found after save');
  return conversation;
}

/** Removes image files from R2 first: an orphaned file would keep a deleted conversation's content alive. */
async function deleteImageFiles(bucket: R2Bucket, ids: string[]): Promise<void> {
  for (let start = 0; start < ids.length; start += 1000) await bucket.delete(ids.slice(start, start + 1000));
}

async function imageIds(db: D1Database, where: string, value: string | number): Promise<string[]> {
  const { results } = await db.prepare(`SELECT id FROM generated_images WHERE ${where}`).bind(value).all<{ id: string }>();
  return results.map((row) => row.id);
}

export async function deleteConversation(db: D1Database, bucket: R2Bucket, user: User, id: string): Promise<void> {
  const owned = await findConversation(db, user, id);
  if (!owned) return;

  await deleteImageFiles(bucket, await imageIds(db, 'conversation_id = ?', id));
  await db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(id, user.id).run();
}

export async function deleteAllConversations(db: D1Database, bucket: R2Bucket, user: User): Promise<void> {
  await deleteImageFiles(bucket, await imageIds(db, 'user_id = ?', user.id));
  await db.prepare('DELETE FROM conversations WHERE user_id = ?').bind(user.id).run();
}

/** Deletes the account with everything attached to it, image files included. */
export async function deleteAccount(db: D1Database, bucket: R2Bucket, user: User): Promise<void> {
  await deleteImageFiles(bucket, await imageIds(db, 'user_id = ?', user.id));
  await db.prepare('DELETE FROM users WHERE id = ?').bind(user.id).run();
}

/** The image of a message, only for its owner. */
export async function findImage(db: D1Database, user: User, id: string): Promise<{ mimeType: string } | null> {
  return db
    .prepare('SELECT mime_type AS mimeType FROM generated_images WHERE id = ? AND user_id = ?')
    .bind(id, user.id)
    .first<{ mimeType: string }>();
}
