import type { Env } from '../env';
import { ProviderRouter, type Provider } from './router';

/** 'standard' answers every message; 'deep' is the "more in-depth answer" model. */
export type Tier = 'standard' | 'deep';

const OPENAI_MODELS: Record<Tier, string> = {
  standard: 'gpt-6-luna',
  deep: 'gpt-6-sol',
};

const GROQ_DEFAULTS = { baseURL: 'https://api.groq.com/openai/v1', model: 'llama-3.3-70b-versatile' };
const GEMINI_DEFAULTS = {
  baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai',
  model: 'gemini-flash-lite-latest',
};

/** Free-tier answers are kept more deterministic, as in the project guidelines. */
const FALLBACK_TEMPERATURE = 0.3;

/**
 * Ordered by preference. OpenAI always comes first. Free-tier fallbacks are
 * added only to 'standard', only when their key is set, and never receive
 * attached files: their terms may allow training on the data, and the
 * conversations of colleagues can contain private documents.
 */
export function buildProviders(env: Env, tier: Tier): Provider[] {
  const providers: Provider[] = [];

  if (env.OPENAI_API_KEY) {
    providers.push({
      name: `openai-${tier}`,
      baseURL: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: OPENAI_MODELS[tier],
      apiKey: env.OPENAI_API_KEY,
      maxTokensParam: 'max_completion_tokens',
      fastParams: { reasoning_effort: 'none' },
      acceptsAttachments: true,
    });
  }

  if (tier === 'standard') {
    if (env.GROQ_API_KEY) {
      providers.push({
        name: 'groq',
        baseURL: (env.GROQ_BASE_URL ?? GROQ_DEFAULTS.baseURL).replace(/\/$/, ''),
        model: env.GROQ_MODEL ?? GROQ_DEFAULTS.model,
        apiKey: env.GROQ_API_KEY,
        maxTokensParam: 'max_tokens',
        temperature: FALLBACK_TEMPERATURE,
        acceptsAttachments: false,
      });
    }

    if (env.GEMINI_API_KEY) {
      providers.push({
        name: 'gemini',
        baseURL: (env.GEMINI_BASE_URL ?? GEMINI_DEFAULTS.baseURL).replace(/\/$/, ''),
        model: env.GEMINI_MODEL ?? GEMINI_DEFAULTS.model,
        apiKey: env.GEMINI_API_KEY,
        maxTokensParam: 'max_tokens',
        temperature: FALLBACK_TEMPERATURE,
        acceptsAttachments: false,
      });
    }
  }

  return providers;
}

let cached: { key: string; routers: Record<Tier, ProviderRouter> } | undefined;

/** One router per tier and isolate, so the rate-limit state survives across requests. */
export function getRouter(env: Env, tier: Tier = 'standard'): ProviderRouter {
  const key = JSON.stringify([
    env.OPENAI_BASE_URL,
    env.OPENAI_API_KEY,
    env.GROQ_API_KEY,
    env.GROQ_BASE_URL,
    env.GROQ_MODEL,
    env.GEMINI_API_KEY,
    env.GEMINI_BASE_URL,
    env.GEMINI_MODEL,
  ]);
  if (cached?.key !== key) {
    cached = {
      key,
      routers: {
        standard: new ProviderRouter(buildProviders(env, 'standard')),
        deep: new ProviderRouter(buildProviders(env, 'deep')),
      },
    };
  }
  return cached.routers[tier];
}
