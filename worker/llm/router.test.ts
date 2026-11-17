import { describe, expect, it, vi } from 'vitest';
import { AllProvidersFailedError, ProviderRouter, type Provider } from './router';

const provider = (name: string, overrides: Partial<Provider> = {}): Provider => ({
  name,
  baseURL: `https://${name}.test/v1`,
  model: `${name}-model`,
  apiKey: `${name}-key`,
  maxTokensParam: 'max_tokens',
  acceptsAttachments: true,
  ...overrides,
});

const completion = (content: string) => Response.json({ choices: [{ message: { content } }] });
const messages = [{ role: 'user' as const, content: 'hi' }];
const options = { maxOutputTokens: 100 };

describe('ProviderRouter', () => {
  it('sends an OpenAI-compatible request to the first provider', async () => {
    const fetchFn = vi.fn(async () => completion(' answer '));
    const router = new ProviderRouter(
      [provider('a', { maxTokensParam: 'max_completion_tokens', temperature: 0.2 })],
      fetchFn as unknown as typeof fetch,
    );

    await expect(router.complete(messages, options)).resolves.toBe('answer');

    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://a.test/v1/chat/completions');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer a-key');
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'a-model',
      messages,
      max_completion_tokens: 100,
      temperature: 0.2,
    });
  });

  it('falls back to the next provider on 429 and skips the exhausted one until reset', async () => {
    let now = 1_000;
    const fetchFn = vi.fn(async (url: string) =>
      url.startsWith('https://a.test')
        ? new Response('quota', { status: 429, headers: { 'retry-after': '10' } })
        : completion('from b'),
    );
    const router = new ProviderRouter(
      [provider('a'), provider('b')],
      fetchFn as unknown as typeof fetch,
      () => now,
    );

    await expect(router.complete(messages, options)).resolves.toBe('from b');
    await expect(router.complete(messages, options)).resolves.toBe('from b');
    expect(fetchFn.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(['a.test', 'b.test', 'b.test']);

    now += 10_001;
    await router.complete(messages, options);
    expect(new URL(fetchFn.mock.calls[3][0]).hostname).toBe('a.test');
  });

  it('falls back on network errors and empty completions', async () => {
    const fetchFn = vi.fn(async (url: string) => {
      if (url.startsWith('https://a.test')) throw new Error('network down');
      if (url.startsWith('https://b.test')) return completion('   ');
      return completion('from c');
    });
    const router = new ProviderRouter(
      [provider('a'), provider('b'), provider('c')],
      fetchFn as unknown as typeof fetch,
    );

    await expect(router.complete(messages, options)).resolves.toBe('from c');
  });

  it('adds the provider-specific fast parameters only to fast completions', async () => {
    const fetchFn = vi.fn(async () => completion('ok'));
    const router = new ProviderRouter(
      [provider('a', { fastParams: { reasoning_effort: 'none' } })],
      fetchFn as unknown as typeof fetch,
    );
    const bodyOf = (call: number) =>
      JSON.parse((fetchFn.mock.calls[call] as unknown as [string, RequestInit])[1].body as string);

    await router.complete(messages, { ...options, fast: true });
    await router.complete(messages, options);

    expect(bodyOf(0).reasoning_effort).toBe('none');
    expect(bodyOf(1)).not.toHaveProperty('reasoning_effort');
  });

  it('skips providers that must not receive attachments', async () => {
    const fetchFn = vi.fn(async (url: string) =>
      url.startsWith('https://a.test') ? new Response('down', { status: 500 }) : completion('from c'),
    );
    const router = new ProviderRouter(
      [provider('a'), provider('b', { acceptsAttachments: false }), provider('c')],
      fetchFn as unknown as typeof fetch,
    );

    await expect(router.complete(messages, { ...options, containsAttachments: true })).resolves.toBe('from c');
    expect(fetchFn.mock.calls.map(([url]) => new URL(url).hostname)).toEqual(['a.test', 'c.test']);

    // Without attachments the free-tier provider is used.
    fetchFn.mockClear();
    const onlyB = new ProviderRouter([provider('b', { acceptsAttachments: false })], fetchFn as unknown as typeof fetch);
    await expect(onlyB.complete(messages, options)).resolves.toBe('from c');
    const refused = await onlyB.complete(messages, { ...options, containsAttachments: true }).catch((error) => error);
    expect(refused).toBeInstanceOf(AllProvidersFailedError);
    expect(refused.attachmentsSkipped).toBe(true);
  });

  it('throws when every provider fails', async () => {
    const fetchFn = vi.fn(async () => new Response('boom', { status: 500 }));
    const router = new ProviderRouter([provider('a'), provider('b')], fetchFn as unknown as typeof fetch);

    const failure = await router.complete(messages, options).catch((error) => error);
    expect(failure).toBeInstanceOf(AllProvidersFailedError);
    expect(failure.attachmentsSkipped).toBe(false);
  });
});
