import type { Env } from '../env';
import { ProviderRouter, type Provider } from './router';

/** 'standard' answers every message; 'deep' is the "more in-depth answer" model. */
export type Tier = 'standard' | 'deep';

const OPENAI_MODELS: Record<Tier, string> = {
  standard: 'gpt-6-luna',
  deep: 'gpt-6-sol',
};

/** Ordered by preference; free-tier fallbacks get appended to 'standard' later. */
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
    });
  }

  return providers;
}

let cached: { key: string; routers: Record<Tier, ProviderRouter> } | undefined;

/** One router per tier and isolate, so the rate-limit state survives across requests. */
export function getRouter(env: Env, tier: Tier = 'standard'): ProviderRouter {
  const key = `${env.OPENAI_BASE_URL ?? ''}|${env.OPENAI_API_KEY ?? ''}`;
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
