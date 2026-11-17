/**
 * Collects what one chat request used: tokens per model call (paid or free),
 * images and the estimated cost. Nothing about the content is kept.
 */
export type CallPurpose = 'intent' | 'draft' | 'review' | 'document' | 'plan';

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

/** Tokens × USD per million = micro-USD, which keeps the sums in integers. */
export function costMicroUsd(price: Price | undefined, inputTokens: number, outputTokens: number): number {
  if (!price) return 0;
  return Math.round(inputTokens * price.inputPerMillion + outputTokens * price.outputPerMillion);
}

export class UsageMeter {
  readonly records: UsageRecord[] = [];
  images = 0;

  record(entry: UsageRecord): void {
    this.records.push(entry);
  }

  addImage(): void {
    this.images += 1;
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

  /** Paid tokens count against the user's daily budget. */
  get paidTokens(): number {
    return this.paidInputTokens + this.paidOutputTokens;
  }

  get costMicroUsd(): number {
    const tokens = this.records.reduce((total, entry) => total + entry.costMicroUsd, 0);
    return tokens + Math.round(this.images * IMAGE_PRICE_USD * 1_000_000);
  }

  /** True when the answer the user sees was written by a free-tier model. */
  get answeredByFreeModel(): boolean {
    const answer = [...this.records].reverse().find((entry) => entry.purpose === 'draft' || entry.purpose === 'document');
    return answer?.free ?? false;
  }

  get servedBy(): string {
    return [...new Set(this.records.map((entry) => entry.provider))].join(',');
  }
}
