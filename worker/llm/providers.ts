import type { Env } from '../env';
import { ProviderRouter, type Provider } from './router';

/** Ordered by preference; free-tier fallbacks get appended here later. */
export function buildProviders(env: Env): Provider[] {
  const providers: Provider[] = [];

  if (env.OPENAI_API_KEY) {
    providers.push({
      name: 'openai',
      baseURL: (env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
      model: 'gpt-6-luna',
      apiKey: env.OPENAI_API_KEY,
      maxTokensParam: 'max_completion_tokens',
    });
  }

  return providers;
}

let cached: { key: string; router: ProviderRouter } | undefined;

/** One router per isolate, so the rate-limit state survives across requests. */
export function getRouter(env: Env): ProviderRouter {
  const key = `${env.OPENAI_BASE_URL ?? ''}|${env.OPENAI_API_KEY ?? ''}`;
  if (cached?.key !== key) cached = { key, router: new ProviderRouter(buildProviders(env)) };
  return cached.router;
}
