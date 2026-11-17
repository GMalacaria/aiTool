import type { User } from './env';

/** Whole days between two YYYY-MM-DD dates (calendar days, no time zone involved). */
function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number);
  return Math.round(Date.UTC(year, month - 1, date) / 86_400_000);
}

/**
 * Longest run of consecutive days with use, and the current one: the run that
 * ends today, or yesterday when today has no use yet (it is not broken until
 * a whole day passes without use).
 */
export function streaks(days: string[], today: string): { longest: number; current: number } {
  const numbers = [...new Set(days.map(dayNumber))].sort((a, b) => a - b);
  let longest = 0;
  let run = 0;
  let previous = Number.NaN;

  for (const number of numbers) {
    run = number === previous + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previous = number;
  }

  const last = numbers.at(-1);
  const todayNumber = dayNumber(today);
  const current = last !== undefined && todayNumber - last <= 1 ? run : 0;
  return { longest, current };
}

export interface UsageTotals {
  /** Answered requests of any kind. */
  messages: number;
  deep: number;
  documents: number;
  images: number;
  paidTokens: number;
  freeTokens: number;
  /** First day in the usage log: totals start there. */
  since: string | null;
  days: string[];
}

export async function usageTotals(db: D1Database, user: User): Promise<UsageTotals> {
  const totals = await db
    .prepare(
      `SELECT COUNT(*) AS messages,
              COALESCE(SUM(CASE WHEN kind = 'deep' THEN 1 ELSE 0 END), 0) AS deep,
              COALESCE(SUM(CASE WHEN kind = 'document' THEN 1 ELSE 0 END), 0) AS documents,
              COALESCE(SUM(images), 0) AS images,
              COALESCE(SUM(paid_input_tokens + paid_output_tokens), 0) AS paidTokens,
              COALESCE(SUM(free_input_tokens + free_output_tokens), 0) AS freeTokens,
              MIN(day) AS since
       FROM usage_events WHERE user_id = ? AND kind NOT IN ('error', 'verify')`,
    )
    .bind(user.id)
    .first<Omit<UsageTotals, 'days'>>();

  const { results } = await db
    .prepare(`SELECT DISTINCT day FROM usage_events WHERE user_id = ? AND kind NOT IN ('error', 'verify') ORDER BY day`)
    .bind(user.id)
    .all<{ day: string }>();

  return {
    messages: totals?.messages ?? 0,
    deep: totals?.deep ?? 0,
    documents: totals?.documents ?? 0,
    images: totals?.images ?? 0,
    paidTokens: totals?.paidTokens ?? 0,
    freeTokens: totals?.freeTokens ?? 0,
    since: totals?.since ?? null,
    days: results.map((row) => row.day),
  };
}
