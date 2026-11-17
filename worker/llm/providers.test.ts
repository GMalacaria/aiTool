import { describe, expect, it } from 'vitest';
import type { Env } from '../env';
import { buildProviders } from './providers';

const env = (overrides: Partial<Env> = {}): Env => ({ OPENAI_API_KEY: 'openai-key', ...overrides }) as Env;

describe('buildProviders', () => {
  it('leaves out the paid model in free-only mode', () => {
    const keys = { GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm' };
    expect(buildProviders(env(keys), 'standard', true).map((provider) => provider.name)).toEqual(['groq', 'gemini']);
    expect(buildProviders(env(), 'standard', true)).toEqual([]);
  });

  it('marks paid and free providers, with prices for the paid ones', () => {
    const [openai, groq] = buildProviders(env({ GROQ_API_KEY: 'g' }), 'standard');
    expect(openai).toMatchObject({ free: false, price: { inputPerMillion: 0.1, outputPerMillion: 0.5 } });
    expect(groq).toMatchObject({ free: true });
    expect(groq.price).toBeUndefined();
    expect(buildProviders(env(), 'deep')[0].price).toEqual({ inputPerMillion: 2, outputPerMillion: 10 });
  });

  it('uses only OpenAI when no fallback key is set', () => {
    expect(buildProviders(env(), 'standard').map((provider) => provider.name)).toEqual(['openai-standard']);
    expect(buildProviders(env(), 'deep').map((provider) => provider.name)).toEqual(['openai-deep']);
  });

  it('adds the free-tier fallbacks after OpenAI, only for the standard tier', () => {
    const keys = { GROQ_API_KEY: 'groq-key', GEMINI_API_KEY: 'gemini-key' };

    expect(buildProviders(env(keys), 'standard').map((provider) => provider.name)).toEqual([
      'openai-standard',
      'groq',
      'gemini',
    ]);
    expect(buildProviders(env(keys), 'deep').map((provider) => provider.name)).toEqual(['openai-deep']);
  });

  it('enables each fallback by its own key', () => {
    expect(buildProviders(env({ GEMINI_API_KEY: 'k' }), 'standard').map((provider) => provider.name)).toEqual([
      'openai-standard',
      'gemini',
    ]);
  });

  it('keeps attachments away from the free tiers and uses the right request fields', () => {
    const [openai, groq, gemini] = buildProviders(env({ GROQ_API_KEY: 'g', GEMINI_API_KEY: 'm' }), 'standard');

    expect(openai.acceptsAttachments).toBe(true);
    expect(groq.acceptsAttachments).toBe(false);
    expect(gemini.acceptsAttachments).toBe(false);
    expect(groq).toMatchObject({ baseURL: 'https://api.groq.com/openai/v1', maxTokensParam: 'max_tokens', temperature: 0.3 });
    expect(gemini.baseURL).toBe('https://generativelanguage.googleapis.com/v1beta/openai');
  });

  it('honours endpoint and model overrides', () => {
    const [, groq] = buildProviders(
      env({ GROQ_API_KEY: 'g', GROQ_BASE_URL: 'http://127.0.0.1:1/v1/', GROQ_MODEL: 'other-model' }),
      'standard',
    );
    expect(groq).toMatchObject({ baseURL: 'http://127.0.0.1:1/v1', model: 'other-model' });
  });
});
