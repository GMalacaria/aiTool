import { normalizeContext, type ContextSource } from '../shared/context';
import type { UsageMeter } from './meter';
import type { ProviderRouter } from './llm/router';
import { buildContextInput, CONTEXT_SYSTEM_PROMPT } from './prompts';

export interface UserContext {
  content: string;
  paused: boolean;
  updatedAt: string | null;
}

export interface ContextVersion {
  id: number;
  content: string;
  source: ContextSource;
  note: string;
  createdAt: string;
}

const HISTORY_LIMIT = 30;

export async function getContext(db: D1Database, userId: number): Promise<UserContext> {
  const row = await db
    .prepare('SELECT content, paused, updated_at AS updatedAt FROM user_context WHERE user_id = ?')
    .bind(userId)
    .first<{ content: string; paused: number; updatedAt: string }>();
  return row ? { content: row.content, paused: row.paused === 1, updatedAt: row.updatedAt } : { content: '', paused: false, updatedAt: null };
}

export async function listContextVersions(db: D1Database, userId: number): Promise<ContextVersion[]> {
  const { results } = await db
    .prepare(
      `SELECT id, content, source, note, created_at AS createdAt FROM user_context_versions
       WHERE user_id = ? ORDER BY id DESC LIMIT ?`,
    )
    .bind(userId, HISTORY_LIMIT)
    .all<ContextVersion>();
  return results;
}

/** Stores a new content as the current one and as a version; returns the version id. */
export async function saveContext(
  db: D1Database,
  userId: number,
  content: string,
  source: ContextSource,
  note: string,
): Promise<number> {
  const [, inserted] = await db.batch([
    db
      .prepare(
        `INSERT INTO user_context (user_id, content) VALUES (?1, ?2)
         ON CONFLICT (user_id) DO UPDATE SET content = ?2, updated_at = CURRENT_TIMESTAMP`,
      )
      .bind(userId, content),
    db
      .prepare('INSERT INTO user_context_versions (user_id, content, source, note) VALUES (?, ?, ?, ?) RETURNING id')
      .bind(userId, content, source, note.slice(0, 300)),
  ]);
  const id = (inserted.results as { id: number }[])[0]?.id;
  if (typeof id !== 'number') throw new Error('context version not stored');
  return id;
}

export async function setContextPaused(db: D1Database, userId: number, paused: boolean): Promise<void> {
  await db
    .prepare(
      `INSERT INTO user_context (user_id, paused) VALUES (?1, ?2)
       ON CONFLICT (user_id) DO UPDATE SET paused = ?2`,
    )
    .bind(userId, paused ? 1 : 0)
    .run();
}

/**
 * Takes back the change of `versionId` while the context is still exactly what
 * that change produced (also after later changes were themselves undone): the
 * content before it becomes current again, as a new version. Returns the
 * restored content, or null when the context changed since.
 */
export async function undoContextVersion(db: D1Database, userId: number, versionId: number): Promise<string | null> {
  const version = await db
    .prepare('SELECT content FROM user_context_versions WHERE id = ? AND user_id = ?')
    .bind(versionId, userId)
    .first<{ content: string }>();
  if (!version) return null;
  const current = await getContext(db, userId);
  if (current.content !== version.content) return null;

  const before = await db
    .prepare('SELECT content FROM user_context_versions WHERE user_id = ? AND id < ? ORDER BY id DESC LIMIT 1')
    .bind(userId, versionId)
    .first<{ content: string }>();
  const previous = before?.content ?? '';
  await saveContext(db, userId, previous, 'undo', 'Annullata una modifica');
  return previous;
}

/** Brings back an earlier version as the current content. Null when it is not the user's. */
export async function restoreContextVersion(db: D1Database, userId: number, versionId: number): Promise<string | null> {
  const row = await db
    .prepare('SELECT content, created_at AS createdAt FROM user_context_versions WHERE id = ? AND user_id = ?')
    .bind(versionId, userId)
    .first<{ content: string; createdAt: string }>();
  if (!row) return null;
  await saveContext(db, userId, row.content, 'restore', 'Ripristinata una versione precedente');
  return row.content;
}

export interface ContextProposal {
  /** The full new list; equal to the current one when nothing changes. */
  content: string;
  /** What changed, one short sentence; empty when nothing changed. */
  change: string;
  /** For explicit requests: what to tell the user. */
  reply: string;
}

/**
 * Asks the standard model how the context should change after a message.
 * 'request': the user asked explicitly ("ricorda che…"); 'auto': a lasting
 * fact was noticed in an ordinary message. Throws when the reply is unusable.
 */
export async function proposeContext(
  router: ProviderRouter,
  current: string,
  message: string,
  mode: 'request' | 'auto',
  meter?: UsageMeter,
): Promise<ContextProposal> {
  const raw = await router.complete(
    [
      { role: 'system', content: CONTEXT_SYSTEM_PROMPT },
      { role: 'user', content: buildContextInput(current, message, mode) },
    ],
    // The context is personal: it never goes to free-tier providers.
    { maxOutputTokens: 900, json: true, fast: true, meter, purpose: 'context', containsAttachments: true, timeoutMs: 20_000 },
  );
  return parseProposal(raw, current);
}

export function parseProposal(raw: string, current: string): ContextProposal {
  const value = JSON.parse(raw) as { content?: unknown; change?: unknown; reply?: unknown };
  const reply = typeof value.reply === 'string' ? value.reply.trim().slice(0, 1500) : '';
  const change = typeof value.change === 'string' ? value.change.trim().slice(0, 300) : '';
  const content = typeof value.content === 'string' ? normalizeContext(value.content) : null;
  // Too long or missing: the context stays as it is.
  if (content === null) return { content: current, change: '', reply };
  return { content, change: content === current ? '' : change || 'Contesto aggiornato', reply };
}
