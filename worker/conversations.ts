import type { ConversationMessage } from './chat';
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
      ? db.prepare('SELECT role, content FROM messages WHERE conversation_id = ? ORDER BY id').bind(conversationId)
      : db
          .prepare(
            `SELECT role, content FROM (
               SELECT id, role, content FROM messages WHERE conversation_id = ? ORDER BY id DESC LIMIT ?
             ) ORDER BY id`,
          )
          .bind(conversationId, limit);

  const { results } = await statement.all<ConversationMessage>();
  return results;
}

/** Stores one question/answer exchange, creating the conversation when `conversationId` is null. */
export async function saveExchange(
  db: D1Database,
  user: User,
  conversationId: string | null,
  question: string,
  answer: string,
): Promise<ConversationSummary> {
  const id = conversationId ?? crypto.randomUUID();
  const insertMessage = db.prepare('INSERT INTO messages (conversation_id, role, content) VALUES (?, ?, ?)');

  await db.batch([
    conversationId
      ? db.prepare('UPDATE conversations SET updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?').bind(id, user.id)
      : db.prepare('INSERT INTO conversations (id, user_id, title) VALUES (?, ?, ?)').bind(id, user.id, titleFrom(question)),
    insertMessage.bind(id, 'user', question),
    insertMessage.bind(id, 'assistant', answer),
  ]);

  const conversation = await findConversation(db, user, id);
  if (!conversation) throw new Error('conversation not found after save');
  return conversation;
}

export async function deleteConversation(db: D1Database, user: User, id: string): Promise<void> {
  await db.prepare('DELETE FROM conversations WHERE id = ? AND user_id = ?').bind(id, user.id).run();
}

export async function deleteAllConversations(db: D1Database, user: User): Promise<void> {
  await db.prepare('DELETE FROM conversations WHERE user_id = ?').bind(user.id).run();
}
