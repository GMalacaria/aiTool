import { costMicroUsd, type CallPurpose, type Price, type UsageMeter } from '../meter';

export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } };

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  /** A string, or text and images for multimodal user messages. */
  content: string | ContentPart[];
}

export interface Provider {
  name: string;
  baseURL: string;
  model: string;
  apiKey: string;
  /** Request field carrying the output cap; newer OpenAI models reject `max_tokens`. */
  maxTokensParam: 'max_tokens' | 'max_completion_tokens';
  /** Left out of the request when undefined (some models only accept their default). */
  temperature?: number;
  /** Extra request fields for `fast` completions, e.g. to switch reasoning off. */
  fastParams?: Record<string, unknown>;
  /**
   * Whether the provider may receive the content of files the user attached
   * (images, extracted document text). False for free tiers, whose terms may
   * allow training on the data: such providers are skipped for those requests.
   */
  acceptsAttachments: boolean;
  /** A free-tier provider: its tokens do not count against the paid budget. */
  free: boolean;
  /** USD per million tokens, for the usage log. */
  price?: Price;
}

export interface CompletionOptions {
  maxOutputTokens: number;
  /** Ask for a single JSON object (`response_format: json_object`). */
  json?: boolean;
  /** A trivial task (e.g. classification): answer as quickly as the provider allows. */
  fast?: boolean;
  /** The messages carry the content of attached files (also in the history). */
  containsAttachments?: boolean;
  timeoutMs?: number;
  /** Where to record the tokens this call used, and what the call was for. */
  meter?: UsageMeter;
  purpose?: CallPurpose;
}

export class AllProvidersFailedError extends Error {
  constructor(
    readonly failures: string[],
    /** Some provider was left out only because it must not receive attachments. */
    readonly attachmentsSkipped = false,
    /** Every provider tried was out of quota (HTTP 429, or skipped until its reset). */
    readonly rateLimited = false,
  ) {
    super(`All providers failed: ${failures.join('; ')}`);
    this.name = 'AllProvidersFailedError';
  }
}

const DEFAULT_COOLDOWN_MS = 60_000;
const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Tries the providers in order through their OpenAI-compatible Chat Completions
 * endpoint. A provider that answers 429 is skipped until its reset time; the
 * state lives in memory, so it is per Worker isolate and best effort.
 */
export class ProviderRouter {
  private readonly exhaustedUntil = new Map<string, number>();

  constructor(
    private readonly providers: Provider[],
    private readonly fetchFn: typeof fetch = (input, init) => fetch(input, init),
    private readonly now: () => number = Date.now,
  ) {}

  async complete(messages: ChatMessage[], options: CompletionOptions): Promise<string> {
    const failures: string[] = [];
    let attachmentsSkipped = false;
    let attempts = 0;
    let rateLimitedAttempts = 0;

    for (const provider of this.providers) {
      if ((this.exhaustedUntil.get(provider.name) ?? 0) > this.now()) {
        failures.push(`${provider.name}: rate limited, skipped`);
        attempts += 1;
        rateLimitedAttempts += 1;
        continue;
      }

      if (options.containsAttachments && !provider.acceptsAttachments) {
        failures.push(`${provider.name}: does not accept attachments, skipped`);
        attachmentsSkipped = true;
        continue;
      }

      attempts += 1;
      try {
        return await this.call(provider, messages, options);
      } catch (error) {
        if (error instanceof RateLimitError) rateLimitedAttempts += 1;
        failures.push(`${provider.name}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    throw new AllProvidersFailedError(failures, attachmentsSkipped, attempts > 0 && rateLimitedAttempts === attempts);
  }

  private async call(provider: Provider, messages: ChatMessage[], options: CompletionOptions): Promise<string> {
    const body: Record<string, unknown> = {
      model: provider.model,
      messages,
      [provider.maxTokensParam]: options.maxOutputTokens,
    };
    if (provider.temperature !== undefined) body.temperature = provider.temperature;
    if (options.json) body.response_format = { type: 'json_object' };
    if (options.fast) Object.assign(body, provider.fastParams);

    const response = await this.fetchFn(`${provider.baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${provider.apiKey}`,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(options.timeoutMs ?? REQUEST_TIMEOUT_MS),
    });

    if (response.status === 429) {
      this.exhaustedUntil.set(provider.name, this.now() + retryAfterMs(response.headers));
      throw new RateLimitError(`HTTP 429 ${(await response.text()).slice(0, 200)}`);
    }
    if (!response.ok) {
      const detail = (await response.text()).slice(0, 300);
      throw new Error(`HTTP ${response.status} ${detail}`);
    }

    const data = (await response.json()) as { choices?: { message?: { content?: unknown } }[] };
    const usage = (data as { usage?: { prompt_tokens?: unknown; completion_tokens?: unknown } }).usage;
    const inputTokens = typeof usage?.prompt_tokens === 'number' ? usage.prompt_tokens : 0;
    const outputTokens = typeof usage?.completion_tokens === 'number' ? usage.completion_tokens : 0;
    options.meter?.record({
      purpose: options.purpose ?? 'draft',
      provider: provider.name,
      model: provider.model,
      free: provider.free,
      inputTokens,
      outputTokens,
      costMicroUsd: provider.free ? 0 : costMicroUsd(provider.price, inputTokens, outputTokens),
    });

    const content = data.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('empty completion');
    return content.trim();
  }
}

class RateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RateLimitError';
  }
}

function retryAfterMs(headers: Headers): number {
  const seconds = Number(headers.get('retry-after'));
  return Number.isFinite(seconds) && seconds > 0 ? seconds * 1000 : DEFAULT_COOLDOWN_MS;
}
