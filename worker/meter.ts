/**
 * Collects what one chat request used: tokens per model call (paid or free),
 * images and the estimated cost. Nothing about the content is kept.
 */
export type CallPurpose = 'intent' | 'draft' | 'review' | 'document' | 'plan' | 'title' | 'search' | 'verify';

/** Web search and source checking: paid by the owner, never counted against the user's token budget. */
const SOURCE_PURPOSES: CallPurpose[] = ['search', 'verify'];

export interface UsageRecord {
  purpose: CallPurpose;
  provider: string;
  model: string;
  free: boolean;
  inputTokens: number;
  outputTokens: number;
  costMicroUsd: number;
}

/** USD per million tokens. Free tiers cost nothing. */
export interface Price {
  inputPerMillion: number;
  outputPerMillion: number;
}

/** USD per generated image (Nano Banana 2 Lite, November 2026 price — verify). */
export const IMAGE_PRICE_USD = 0.034;

/** USD per web search call (OpenAI, November 2026 — verify). */
export const SEARCH_CALL_PRICE_USD = 0.01;

/** Tokens × USD per million = micro-USD, which keeps the sums in integers. */
export function costMicroUsd(price: Price | undefined, inputTokens: number, outputTokens: number): number {
  if (!price) return 0;
  return Math.round(inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion);
}

export class UsageMeter {
  readonly records: UsageRecord[] = [];
  images = 0;
  /** Web search calls made by the model. */
  searches = 0;

  record(entry: UsageRecord): void {
    this.records.push(entry);
  }

  addImage(): void {
    this.images += 1;
  }

  addSearches(count: number): void {
    this.searches += count;
  }

  private sum(free: boolean, field: 'inputTokens' | 'outputTokens'): number {
    return this.records.filter((entry) => entry.free === free).reduce((total, entry) => total + entry[field], 0);
  }

  get paidInputTokens(): number {
    return this.sum(false, 'inputTokens');
  }

  get paidOutputTokens(): number {
    return this.sum(false, 'outputTokens');
  }

  get freeInputTokens(): number {
    return this.sum(true, 'inputTokens');
  }

  get freeOutputTokens(): number {
    return this.sum(true, 'outputTokens');
  }

  /** Paid tokens count against the user's daily budget, except those spent on sources. */
  get paidTokens(): number {
    return this.records
      .filter((entry) => !entry.free && !SOURCE_PURPOSES.includes(entry.purpose))
      .reduce((total, entry) => total + entry.inputTokens + entry.outputTokens, 0);
  }

  /** What searching and checking sources cost, included in `costMicroUsd`. */
  get sourcesCostMicroUsd(): number {
    const tokens = this.records
      .filter((entry) => SOURCE_PURPOSES.includes(entry.purpose))
      .reduce((total, entry) => total + entry.costMicroUsd, 0);
    return tokens + Math.round(this.searches * SEARCH_CALL_PRICE_USD * 1_000_000);
  }

  get costMicroUsd(): number {
    const tokens = this.records
      .filter((entry) => !SOURCE_PURPOSES.includes(entry.purpose))
      .reduce((total, entry) => total + entry.costMicroUsd, 0);
    return tokens + Math.round(this.images * IMAGE_PRICE_USD * 1_000_000) + this.sourcesCostMicroUsd;
  }

  /** True when the answer the user sees was written by a free-tier model. */
  get answeredByFreeModel(): boolean {
    const answer = [...this.records].reverse().find((entry) => entry.purpose === 'draft' || entry.purpose === 'document' || entry.purpose === 'search');
    return answer?.free ?? false;
  }

  get servedBy(): string {
    return [...new Set(this.records.map((entry) => entry.provider))].join(',');
  }
}
