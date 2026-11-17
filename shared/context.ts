/**
 * The user's context: short facts they chose to share about themselves (job,
 * school, tools, preferred format), used to tailor answers. One fact per line.
 */
export const MAX_CONTEXT_CHARS = 1500;
export const MAX_CONTEXT_ITEMS = 20;
export const MAX_CONTEXT_ITEM_CHARS = 200;

export type ContextSource = 'auto' | 'request' | 'manual' | 'undo' | 'restore';

/** The change made while answering a message, shown under the answer. */
export interface ContextUpdate {
  versionId: number;
  /** One short sentence: what changed. */
  change: string;
  /** The user took it back. */
  undone?: boolean;
}

/** Facts one per line, without bullets or blank lines, within the limits. Null when too long. */
export function normalizeContext(text: string): string | null {
  const items = text
    .split('\n')
    .map((line) => line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
  if (items.length > MAX_CONTEXT_ITEMS || items.some((item) => item.length > MAX_CONTEXT_ITEM_CHARS)) return null;
  const joined = items.join('\n');
  return joined.length > MAX_CONTEXT_CHARS ? null : joined;
}

export function parseContextUpdate(value: unknown): ContextUpdate | null {
  let data = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  const { versionId, change, undone } = (data ?? {}) as Record<string, unknown>;
  if (typeof versionId !== 'number' || !Number.isInteger(versionId) || typeof change !== 'string') return null;
  return { versionId, change: change.slice(0, 300), ...(undone === true ? { undone: true } : {}) };
}
