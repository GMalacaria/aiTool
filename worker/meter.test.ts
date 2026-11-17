import { describe, expect, it } from 'vitest';
import { costMicroUsd, IMAGE_PRICE_USD, UsageMeter, type UsageRecord } from './meter';

const record = (overrides: Partial<UsageRecord>): UsageRecord => ({
  purpose: 'draft',
  provider: 'openai-standard',
  model: 'gpt-6-luna',
  free: false,
  inputTokens: 0,
  outputTokens: 0,
  costMicroUsd: 0,
  ...overrides,
});

describe('costMicroUsd', () => {
  it('turns tokens and a per-million price into micro-dollars', () => {
    // 1,000 input at $0.10/M + 500 output at $0.50/M = $0.00035
    expect(costMicroUsd({ inputPerMillion: 0.1, outputPerMillion: 0.5 }, 1000, 500)).toBe(350);
    expect(costMicroUsd(undefined, 1000, 500)).toBe(0);
  });
});

describe('UsageMeter', () => {
  it('adds up paid and free tokens separately, and the cost including images', () => {
    const meter = new UsageMeter();
    meter.record(record({ purpose: 'intent', inputTokens: 300, outputTokens: 2, costMicroUsd: 31 }));
    meter.record(record({ inputTokens: 1000, outputTokens: 400, costMicroUsd: 300 }));
    meter.record(record({ purpose: 'review', provider: 'groq', free: true, inputTokens: 700, outputTokens: 5 }));
    meter.addImage();

    expect(meter.paidInputTokens).toBe(1300);
    expect(meter.paidOutputTokens).toBe(402);
    expect(meter.paidTokens).toBe(1702);
    expect(meter.freeInputTokens).toBe(700);
    expect(meter.freeOutputTokens).toBe(5);
    expect(meter.costMicroUsd).toBe(331 + IMAGE_PRICE_USD * 1_000_000);
    expect(meter.servedBy).toBe('openai-standard,groq');
  });

  it('knows whether the answer the user sees came from a free model', () => {
    const paid = new UsageMeter();
    paid.record(record({ purpose: 'draft' }));
    paid.record(record({ purpose: 'review', free: true }));
    expect(paid.answeredByFreeModel).toBe(false);

    const free = new UsageMeter();
    free.record(record({ purpose: 'intent' }));
    free.record(record({ purpose: 'document', free: true }));
    expect(free.answeredByFreeModel).toBe(true);

    expect(new UsageMeter().answeredByFreeModel).toBe(false);
  });
});
