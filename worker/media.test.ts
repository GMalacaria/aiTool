import { describe, expect, it, vi } from 'vitest';
import { respond, MEDIA_OFF_TEXT, type Routers } from './chat';
import type { ChatMessage, CompletionOptions, ProviderRouter } from './llm/router';
import {
  answerWithMedia,
  decodeEntities,
  escapeMarkdown,
  MEDIA_PLAN_SYSTEM_PROMPT,
  MEDIA_REFUSAL_FALLBACK,
  MEDIA_UNAVAILABLE_TEXT,
  parseMediaPlan,
  PHOTO_COPYRIGHT_TEXT,
  VIDEOS_OFF_TEXT,
  type MediaConfig,
} from './media';
import { INTENT_SYSTEM_PROMPT, parseIntent } from './prompts';
import type { SourcesConfig } from './sources';

const ROME = [
  { lat: '41.8933203', lon: '12.4829321', display_name: 'Roma, Lazio, Italia', boundingbox: ['41.6556', '42.1410', '12.2344', '12.8557'] },
];
const VIDEO = {
  items: [{ id: { videoId: 'dQw4w9WgXcQ' }, snippet: { title: 'Il Colosseo: storia &amp; segreti', channelTitle: 'Canale [test]' } }],
};

const json = (value: unknown, status = 200) =>
  new Response(JSON.stringify(value), { status, headers: { 'Content-Type': 'application/json' } });

function plannerRouter(plan: string | Error) {
  const complete = vi.fn(async (_messages: ChatMessage[], _options: CompletionOptions) => {
    if (plan instanceof Error) throw plan;
    return plan;
  });
  return { router: { complete } as unknown as ProviderRouter, complete };
}

const planMessages = (question: string): ChatMessage[] => [
  { role: 'system', content: MEDIA_PLAN_SYSTEM_PROMPT },
  { role: 'user', content: question },
];

function config(overrides: Partial<MediaConfig> = {}, routes: Record<string, () => Response> = {}) {
  const fetchFn = vi.fn(async (input: RequestInfo | URL, _init?: RequestInit) => {
    const url = String(input);
    const route = Object.keys(routes).find((prefix) => url.startsWith(prefix));
    if (!route) throw new Error(`unexpected fetch ${url}`);
    return routes[route]();
  });
  const isFlagged = vi.fn(async () => false);
  return {
    config: { isFlagged, youtubeKey: 'yt-key', fetchFn: fetchFn as unknown as typeof fetch, ...overrides },
    fetchFn,
    isFlagged,
  };
}

describe('parseMediaPlan', () => {
  it('reads an allowed plan', () => {
    expect(parseMediaPlan('{"allowed":true,"kind":"map","query":" Roma, Italia ","refusal":""}')).toEqual({
      allowed: true,
      kind: 'map',
      query: 'Roma, Italia',
    });
  });

  it('reads a refusal, with a fallback sentence', () => {
    expect(parseMediaPlan('{"allowed":false,"refusal":"No."}')).toEqual({ allowed: false, refusal: 'No.' });
    expect(parseMediaPlan('{"allowed":false}')).toEqual({ allowed: false, refusal: MEDIA_REFUSAL_FALLBACK });
  });

  it.each([
    ['not JSON', 'map'],
    ['an unknown kind', '{"allowed":true,"kind":"iframe","query":"x"}'],
    ['an empty query', '{"allowed":true,"kind":"video","query":""}'],
    ['a huge query', JSON.stringify({ allowed: true, kind: 'video', query: 'x'.repeat(500) })],
  ])('rejects %s', (_name, raw) => {
    expect(parseMediaPlan(raw)).toBeNull();
  });
});

describe('text from other sites', () => {
  it('cannot become a Markdown link', () => {
    expect(escapeMarkdown('[click](https://evil.example)')).toBe('\\[click\\]\\(https://evil.example\\)');
  });

  it('decodes the entities YouTube leaves in titles', () => {
    expect(decodeEntities('Tom &amp; Jerry &#39;99 &quot;live&quot;')).toBe('Tom & Jerry \'99 "live"');
  });
});

describe('answerWithMedia', () => {
  it('shows a map found by geocoding, never coordinates from the model', async () => {
    const { router, complete } = plannerRouter('{"allowed":true,"kind":"map","query":"Roma, Italia"}');
    const { config: media, fetchFn, isFlagged } = config({}, { 'https://nominatim.openstreetmap.org/search': () => json(ROME) });

    const reply = await answerWithMedia(media, router, planMessages('mostrami la mappa di Roma'), { containsAttachments: true });

    expect(reply).toEqual({
      text: 'Mappa: Roma, Lazio, Italia.',
      media: { kind: 'map', label: 'Roma, Lazio, Italia', lat: 41.8933203, lon: 12.4829321, bbox: [12.2344, 41.6556, 12.8557, 42.141] },
    });
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.searchParams.get('q')).toBe('Roma, Italia');
    expect(url.searchParams.get('accept-language')).toBe('it');
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'User-Agent': expect.stringContaining('Kern') });
    expect(complete.mock.calls[0][1]).toMatchObject({ json: true, purpose: 'plan', containsAttachments: true });
    // A map shows no content from the open web: no moderation needed.
    expect(isFlagged).not.toHaveBeenCalled();
  });

  it('says when a place is not found', async () => {
    const { router } = plannerRouter('{"allowed":true,"kind":"map","query":"Atlantide"}');
    const { config: media } = config({}, { 'https://nominatim.openstreetmap.org/': () => json([]) });

    expect(await answerWithMedia(media, router, planMessages('mappa di Atlantide'))).toEqual({
      text: 'Non ho trovato «Atlantide» sulla mappa.',
    });
  });

  it('shows the first YouTube result, searched with safe search', async () => {
    const { router } = plannerRouter('{"allowed":true,"kind":"video","query":"Colosseo storia"}');
    const { config: media, fetchFn, isFlagged } = config({}, { 'https://www.googleapis.com/youtube/v3/search': () => json(VIDEO) });

    const reply = await answerWithMedia(media, router, planMessages('fammi vedere un video sul Colosseo'));

    expect(reply.media).toEqual({
      kind: 'video',
      provider: 'youtube',
      id: 'dQw4w9WgXcQ',
      title: 'Il Colosseo: storia & segreti',
      channel: 'Canale [test]',
    });
    expect(reply.text).toBe('Video su YouTube: Il Colosseo: storia & segreti (Canale \\[test\\]).');
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.searchParams.get('safeSearch')).toBe('strict');
    expect(url.searchParams.get('videoEmbeddable')).toBe('true');
    expect(isFlagged).toHaveBeenCalledWith('fammi vedere un video sul Colosseo');
    expect(isFlagged).toHaveBeenCalledWith('Colosseo storia');
  });

  it('drops a video id that is not a YouTube id', async () => {
    const { router } = plannerRouter('{"allowed":true,"kind":"video","query":"x"}');
    const { config: media } = config(
      {},
      { 'https://www.googleapis.com/': () => json({ items: [{ id: { videoId: '"><script>' }, snippet: { title: 'x' } }] }) },
    );

    const reply = await answerWithMedia(media, router, planMessages('un video'));
    expect(reply.media).toBeUndefined();
    expect(reply.text).toContain('Non ho trovato video');
  });

  it('says that videos are off without a YouTube key', async () => {
    const { router } = plannerRouter('{"allowed":true,"kind":"video","query":"x"}');
    const { config: media, fetchFn } = config({ youtubeKey: undefined });

    expect(await answerWithMedia(media, router, planMessages('un video'))).toEqual({ text: VIDEOS_OFF_TEXT });
    expect(fetchFn).not.toHaveBeenCalled();
  });

  it('refuses when moderation flags the request, and fails closed when it is unavailable', async () => {
    const { router } = plannerRouter('{"allowed":true,"kind":"video","query":"x"}');
    const flagged = config({ isFlagged: async () => true });
    expect(await answerWithMedia(flagged.config, router, planMessages('un video'))).toEqual({ text: MEDIA_REFUSAL_FALLBACK });
    expect(flagged.fetchFn).not.toHaveBeenCalled();

    const down = config({ isFlagged: async () => Promise.reject(new Error('down')) });
    expect(await answerWithMedia(down.config, router, planMessages('un video'))).toEqual({ text: MEDIA_UNAVAILABLE_TEXT });
    expect(down.fetchFn).not.toHaveBeenCalled();
  });

  it('passes on the planner refusal and fails when the planner is unavailable', async () => {
    const { config: media } = config();
    const refused = plannerRouter('{"allowed":false,"refusal":"Non posso cercare dove abita una persona."}');
    expect(await answerWithMedia(media, refused.router, planMessages('mappa di casa di Mario Rossi'))).toEqual({
      text: 'Non posso cercare dove abita una persona.',
    });

    const broken = plannerRouter(new Error('quota'));
    expect(await answerWithMedia(media, broken.router, planMessages('mappa di Roma'))).toEqual({ text: MEDIA_UNAVAILABLE_TEXT });
  });

  it('never shows a photo: it says why and links the page found by web search', async () => {
    const { router } = plannerRouter('{"allowed":true,"kind":"photo","query":"ultimo iPhone sito Apple"}');
    const search: SourcesConfig = {
      openaiKey: 'k',
      openaiBaseURL: 'https://api.openai.test/v1',
      model: 'gpt-6-luna',
      price: { inputPerMillion: 0, outputPerMillion: 0 },
    };
    const responses = {
      output: [
        { type: 'web_search_call' },
        {
          type: 'message',
          content: [
            {
              type: 'output_text',
              text: 'La pagina ufficiale è apple.com (apple.com).',
              annotations: [
                { type: 'url_citation', start_index: 30, end_index: 41, url: 'https://www.apple.com/it/iphone/?utm_source=openai', title: 'iPhone (ufficiale)' },
              ],
            },
          ],
        },
      ],
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const { config: media } = config(
      { search: async () => ({ ...search, fetchFn: (async () => json(responses)) as unknown as typeof fetch }) },
      {},
    );

    const reply = await answerWithMedia(media, router, planMessages("mostrami l'ultimo iPhone"));

    expect(reply.media).toBeUndefined();
    expect(reply.text).toBe(`${PHOTO_COPYRIGHT_TEXT} Puoi vederle qui: [iPhone \\(ufficiale\\)](https://www.apple.com/it/iphone/)`);
  });

  it('says why, without a link, when web search is not available', async () => {
    const { router } = plannerRouter('{"allowed":true,"kind":"photo","query":"Partenone"}');
    const { config: media } = config({ search: async () => undefined });

    const reply = await answerWithMedia(media, router, planMessages('fammi vedere il Partenone'));
    expect(reply.text.startsWith(PHOTO_COPYRIGHT_TEXT)).toBe(true);
    expect(reply.text).not.toContain('](');
  });
});

describe('media intent', () => {
  it.each([
    ['media', 'media'],
    [' Media. ', 'media'],
    ['multimedia', 'text'],
  ])('reads %j as %s', (reply, expected) => {
    expect(parseIntent(reply)).toBe(expected);
  });

  it('tells the classifier that generating a picture is not media', () => {
    expect(INTENT_SYSTEM_PROMPT).toContain('Asking to generate, draw or create a picture is image, not media');
  });

  function routers(media?: MediaConfig): { routers: Routers; draft: ReturnType<typeof vi.fn> } {
    const standard = vi.fn(async (messages: ChatMessage[]) =>
      messages[0].content === INTENT_SYSTEM_PROMPT
        ? 'media'
        : messages[0].content === MEDIA_PLAN_SYSTEM_PROMPT
          ? '{"allowed":true,"kind":"map","query":"Roma"}'
          : 'OK',
    );
    const draft = vi.fn(async () => 'Answer.');
    return {
      routers: {
        draft: { complete: draft } as unknown as ProviderRouter,
        review: { complete: standard } as unknown as ProviderRouter,
        deep: false,
        media,
      },
      draft,
    };
  }

  it('answers a media request with the found content instead of the text draft', async () => {
    const { config: media } = config({}, { 'https://nominatim.openstreetmap.org/': () => json(ROME) });
    const reply = await respond(routers(media).routers, [], 'mostrami la mappa di Roma');
    expect(reply.media?.kind).toBe('map');
    expect(reply.text).toBe('Mappa: Roma, Lazio, Italia.');
  });

  it('says the feature is off when it is not configured', async () => {
    expect(await respond(routers(undefined).routers, [], 'mostrami la mappa di Roma')).toEqual({ text: MEDIA_OFF_TEXT });
  });
});
