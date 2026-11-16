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
