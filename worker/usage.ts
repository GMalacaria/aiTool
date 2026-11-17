import type { UsageMeter } from './meter';
import type { User } from './env';

const DAY_FORMAT = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Rome' });

/** Calendar day in Italy as YYYY-MM-DD: the daily limit resets at Italian midnight. */
export function currentDay(now: Date = new Date()): string {
  return DAY_FORMAT.format(now);
}

export async function getUsedMessages(db: D1Database, user: User, day: string): Promise<number> {
  const row = await db
    .prepare('SELECT messages FROM daily_usage WHERE user_id = ? AND day = ?')
    .bind(user.id, day)
    .first<{ messages: number }>();
  return row?.messages ?? 0;
}

/**
 * Atomically takes one message from today's allowance.
 * Returns the new count, or null when the daily limit is already reached.
 */
export async function consumeMessage(db: D1Database, user: User, day: string): Promise<number | null> {
  if (user.dailyMessageLimit <= 0) return null;

  const row = await db
    .prepare(
      `INSERT INTO daily_usage (user_id, day, messages) VALUES (?1, ?2, 1)
       ON CONFLICT (user_id, day) DO UPDATE SET messages = messages + 1 WHERE messages < ?3
       RETURNING messages`,
    )
    .bind(user.id, day, user.dailyMessageLimit)
    .first<{ messages: number }>();

  return row?.messages ?? null;
}

/** Gives a message back when the request failed for reasons outside the user's control. */
export async function refundMessage(db: D1Database, user: User, day: string): Promise<void> {
  await db
    .prepare('UPDATE daily_usage SET messages = messages - 1 WHERE user_id = ? AND day = ? AND messages > 0')
    .bind(user.id, day)
    .run();
}

export async function getUsedDeepMessages(db: D1Database, user: User, day: string): Promise<number> {
  const row = await db
    .prepare('SELECT deep_messages FROM daily_usage WHERE user_id = ? AND day = ?')
    .bind(user.id, day)
    .first<{ deep_messages: number }>();
  return row?.deep_messages ?? 0;
}

/**
 * Atomically takes one in-depth answer from today's allowance. Call it after
 * `consumeMessage`, which creates today's row. Returns the new count, or null
 * when the allowance is used up.
 */
export async function consumeDeepMessage(db: D1Database, user: User, day: string): Promise<number | null> {
  if (user.dailyDeepLimit <= 0) return null;

  const row = await db
    .prepare(
      `UPDATE daily_usage SET deep_messages = deep_messages + 1
       WHERE user_id = ?1 AND day = ?2 AND deep_messages < ?3
       RETURNING deep_messages`,
    )
    .bind(user.id, day, user.dailyDeepLimit)
    .first<{ deep_messages: number }>();

  return row?.deep_messages ?? null;
}

export async function refundDeepMessage(db: D1Database, user: User, day: string): Promise<void> {
  await db
    .prepare('UPDATE daily_usage SET deep_messages = deep_messages - 1 WHERE user_id = ? AND day = ? AND deep_messages > 0')
    .bind(user.id, day)
    .run();
}

export async function getUsedImages(db: D1Database, user: User, day: string): Promise<number> {
  const row = await db
    .prepare('SELECT images FROM daily_usage WHERE user_id = ? AND day = ?')
    .bind(user.id, day)
    .first<{ images: number }>();
  return row?.images ?? 0;
}

/**
 * Atomically takes one image from today's allowance. Call it after
 * `consumeMessage`, which creates today's row. Returns the new count, or null
 * when the allowance is used up.
 */
export async function consumeImage(db: D1Database, user: User, day: string): Promise<number | null> {
  if (user.dailyImageLimit <= 0) return null;

  const row = await db
    .prepare(
      `UPDATE daily_usage SET images = images + 1
       WHERE user_id = ?1 AND day = ?2 AND images < ?3
       RETURNING images`,
    )
    .bind(user.id, day, user.dailyImageLimit)
    .first<{ images: number }>();

  return row?.images ?? null;
}

export async function refundImage(db: D1Database, user: User, day: string): Promise<void> {
  await db
    .prepare('UPDATE daily_usage SET images = images - 1 WHERE user_id = ? AND day = ? AND images > 0')
    .bind(user.id, day)
    .run();
}

/** Paid-model tokens used today, counted against `user.dailyTokenLimit`. */
export async function getPaidTokens(db: D1Database, user: User, day: string): Promise<number> {
  const row = await db
    .prepare('SELECT paid_tokens FROM daily_usage WHERE user_id = ? AND day = ?')
    .bind(user.id, day)
    .first<{ paid_tokens: number }>();
  return row?.paid_tokens ?? 0;
}

/** Answers with web search today, for all users together: the app-wide cap on sources. */
export async function getSearchesToday(db: D1Database, day: string): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS answers FROM usage_events WHERE day = ? AND searches > 0")
    .bind(day)
    .first<{ answers: number }>();
  return row?.answers ?? 0;
}

export type UsageKind = 'text' | 'deep' | 'document' | 'image' | 'error';

/**
 * Stores what a request used: adds its paid tokens to today's budget and
 * writes one row of the usage log. No message content is stored.
 */
export async function recordUsage(
  db: D1Database,
  user: User,
  day: string,
  kind: UsageKind,
  mode: 'paid' | 'free',
  meter: UsageMeter,
): Promise<void> {
  if (!meter.records.length && !meter.images) return;

  await db.batch([
    db
      .prepare(
        `INSERT INTO daily_usage (user_id, day, messages, paid_tokens) VALUES (?1, ?2, 0, ?3)
         ON CONFLICT (user_id, day) DO UPDATE SET paid_tokens = paid_tokens + ?3`,
      )
      .bind(user.id, day, meter.paidTokens),
    db
      .prepare(
        `INSERT INTO usage_events (user_id, day, kind, mode, paid_input_tokens, paid_output_tokens,
           free_input_tokens, free_output_tokens, images, cost_micro_usd, served_by, searches, sources_cost_micro_usd)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        user.id,
        day,
        kind,
        mode,
        meter.paidInputTokens,
        meter.paidOutputTokens,
        meter.freeInputTokens,
        meter.freeOutputTokens,
        meter.images,
        meter.costMicroUsd,
        meter.servedBy,
        meter.searches,
        meter.sourcesCostMicroUsd,
      ),
  ]);
}
