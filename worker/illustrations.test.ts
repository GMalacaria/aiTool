import { describe, expect, it, vi } from 'vitest';
import { parseIllustrations } from '../shared/illustrations';
import { respond, type Routers } from './chat';
import {
  buildPickInput,
  findIllustrations,
  ILLUSTRATION_PICK_SYSTEM_PROMPT,
  ILLUSTRATION_PLAN_SYSTEM_PROMPT,
  parsePicks,
  parsePicturePlan,
  plainText,
  searchCommons,
  type IllustrationsConfig,
} from './illustrations';
import type { ChatMessage, CompletionOptions, ProviderRouter } from './llm/router';
import { INTENT_SYSTEM_PROMPT, parseVisual } from './prompts';

/** The shape of a real Commons answer (formatversion=2), trimmed. */
const COMMONS = {
  query: {
    pages: [
      {
        index: 2,
        title: 'File:Scheme snail anatomy-numbers.svg',
        imageinfo: [
          {
            thumburl: 'https://upload.wikimedia.org/wikipedia/commons/thumb/d/db/Snail.svg/800px-Snail.svg.png',
            thumbwidth: 800,
            thumbheight: 600,
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Scheme_snail_anatomy-numbers.svg',
            mime: 'image/svg+xml',
            extmetadata: { ImageDescription: { value: 'Anatomy of a common snail.' }, Artist: { value: 'Al2' }, LicenseShortName: { value: 'CC BY 3.0' } },
          },
        ],
      },
      {
        index: 1,
        title: 'File:Heart numlabels.svg',
        imageinfo: [
          {
            thumburl: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/11/Heart_numlabels.svg/800px-Heart_numlabels.svg.png',
            thumbwidth: 800,
            thumbheight: 720,
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Heart_numlabels.svg',
            mime: 'image/svg+xml',
            extmetadata: {
              ImageDescription: { value: '1. Right atrium<dl><dd>2. Left atrium</dd></dl>' },
              Artist: { value: '<a href="https://en.wikipedia.org/wiki/User:Wapcaplet">Wapcaplet</a>' },
              LicenseShortName: { value: 'CC BY-SA 3.0' },
            },
          },
        ],
      },
      {
        index: 3,
        title: 'File:Heart sound.ogg',
        imageinfo: [
          {
            thumburl: 'https://upload.wikimedia.org/x.png',
            thumbwidth: 1,
            thumbheight: 1,
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Heart_sound.ogg',
            mime: 'audio/ogg',
            extmetadata: { LicenseShortName: { value: 'CC0' } },
          },
        ],
      },
      {
        index: 4,
        title: 'File:Elsewhere.jpg',
        imageinfo: [
          {
            thumburl: 'https://evil.example/x.jpg',
            thumbwidth: 800,
            thumbheight: 600,
            descriptionurl: 'https://commons.wikimedia.org/wiki/File:Elsewhere.jpg',
            mime: 'image/jpeg',
            extmetadata: { LicenseShortName: { value: 'CC0' } },
          },
        ],
      },
    ],
  },
};

const json = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function setup({
  plan = '{"pictures":[{"query":"human heart diagram","caption":"Schema del cuore"}]}',
  pick = '{"choices":[1]}',
  flagged = false,
  commons = () => json(COMMONS),
}: { plan?: string | Error; pick?: string; flagged?: boolean | Error; commons?: () => Response } = {}) {
  const complete = vi.fn(async (messages: ChatMessage[], _options: CompletionOptions) => {
    const system = messages[0].content;
    if (system === ILLUSTRATION_PLAN_SYSTEM_PROMPT) {
      if (plan instanceof Error) throw plan;
      return plan;
    }
    if (system === ILLUSTRATION_PICK_SYSTEM_PROMPT) return pick;
    throw new Error('unexpected call');
  });
  const fetchFn = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => commons());
  const isFlagged = vi.fn(async () => {
    if (flagged instanceof Error) throw flagged;
    return flagged;
  });
  const config: IllustrationsConfig = { isFlagged, fetchFn: fetchFn as unknown as typeof fetch };
  return { config, router: { complete } as unknown as ProviderRouter, complete, fetchFn, isFlagged };
}

describe('parsing', () => {
  it('reads the wanted pictures, at most three', () => {
    const many = JSON.stringify({ pictures: Array.from({ length: 5 }, (_, n) => ({ query: `q${n}`, caption: `c${n}` })) });
    expect(parsePicturePlan(many)).toHaveLength(3);
    expect(parsePicturePlan('{"pictures":[{"query":"","caption":"x"},{"query":"ok","caption":" Schema "}]}')).toEqual([
      { query: 'ok', caption: 'Schema' },
    ]);
    expect(parsePicturePlan('nope')).toEqual([]);
  });

  it('reads one pick per picture, dropping anything out of range', () => {
    expect(parsePicks('{"choices":[2,null,9,"1"]}', [3, 3, 3, 3])).toEqual([1, null, null, null]);
    expect(parsePicks('broken', [3])).toEqual([null]);
  });

  it('keeps only the text of Commons metadata', () => {
    expect(plainText('<a href="x">Wapcaplet</a> &amp; <b>altri</b>')).toBe('Wapcaplet & altri');
  });
});

describe('searchCommons', () => {
  it('keeps pictures on Wikimedia hosts, in search order, with author and licence', async () => {
    const { config, fetchFn } = setup();
    const found = await searchCommons(config, 'human heart diagram');

    expect(found.map((item) => item.title)).toEqual(['Heart numlabels.svg', 'Scheme snail anatomy-numbers.svg']);
    expect(found[0]).toMatchObject({
      author: 'Wapcaplet',
      license: 'CC BY-SA 3.0',
      description: '1. Right atrium 2. Left atrium',
      page: 'https://commons.wikimedia.org/wiki/File:Heart_numlabels.svg',
    });
    const url = new URL(String(fetchFn.mock.calls[0][0]));
    expect(url.origin + url.pathname).toBe('https://commons.wikimedia.org/w/api.php');
    expect(url.searchParams.get('gsrsearch')).toBe('human heart diagram filetype:bitmap|drawing');
    expect((fetchFn.mock.calls[0][1] as RequestInit).headers).toMatchObject({ 'User-Agent': expect.stringContaining('Kern') });
  });
});

describe('findIllustrations', () => {
  it('shows the picture the model picked among the real results, with the planned caption', async () => {
    const { config, router, complete } = setup();
    const pictures = await findIllustrations(config, router, 'spiegami come funziona il cuore');

    expect(pictures).toEqual([
      {
        src: 'https://thumb.wikimedia.org/wikipedia/commons/thumb/1/11/Heart_numlabels.svg/800px-Heart_numlabels.svg.png',
        page: 'https://commons.wikimedia.org/wiki/File:Heart_numlabels.svg',
        caption: 'Schema del cuore',
        author: 'Wapcaplet',
        license: 'CC BY-SA 3.0',
        width: 800,
        height: 720,
      },
    ]);
    // The picker sees titles and descriptions, never addresses.
    const pickInput = complete.mock.calls[1][0][1].content as string;
    expect(pickInput).toContain('1. Heart numlabels.svg — 1. Right atrium');
    expect(pickInput).not.toContain('https://');
    expect(parseIllustrations(pictures)).toEqual(pictures);
  });

  it('shows nothing when the model finds no good match, or pictures would not help', async () => {
    expect(await findIllustrations(setup({ pick: '{"choices":[null]}' }).config, setup({ pick: '{"choices":[null]}' }).router, 'x')).toEqual([]);

    const none = setup({ plan: '{"pictures":[]}' });
    expect(await findIllustrations(none.config, none.router, 'x')).toEqual([]);
    expect(none.fetchFn).not.toHaveBeenCalled();
  });

  it('shows nothing when moderation flags the pictures, or is unavailable', async () => {
    const flagged = setup({ flagged: true });
    expect(await findIllustrations(flagged.config, flagged.router, 'x')).toEqual([]);
    const down = setup({ flagged: new Error('down') });
    expect(await findIllustrations(down.config, down.router, 'x')).toEqual([]);
  });

  it('never fails: errors from the planner or from Commons mean no pictures', async () => {
    const planner = setup({ plan: new Error('quota') });
    expect(await findIllustrations(planner.config, planner.router, 'x')).toEqual([]);
    const commons = setup({ commons: () => json({}, 503) });
    expect(await findIllustrations(commons.config, commons.router, 'x')).toEqual([]);
    expect(commons.complete).toHaveBeenCalledTimes(1);
  });

  it('lists every wanted picture with its candidates for the picker', () => {
    const input = buildPickInput(
      [
        { query: 'a', caption: 'Primo' },
        { query: 'b', caption: 'Secondo' },
      ],
      [[], []],
    );
    expect(input).toBe('Picture 1: Primo\n  (no candidates)\n\nPicture 2: Secondo\n  (no candidates)');
  });
});

describe('explanations get pictures', () => {
  it('reads the visual flag after the intent', () => {
    expect(parseVisual('text visual')).toBe(true);
    expect(parseVisual('search remember visual')).toBe(true);
    expect(parseVisual('text')).toBe(false);
    expect(INTENT_SYSTEM_PROMPT).toContain('add " visual" when the message asks to explain');
  });

  function routers(intent: string, illustrations?: IllustrationsConfig) {
    const { router } = setup();
    const standard = vi.fn(async (messages: ChatMessage[], options: CompletionOptions) =>
      messages[0].content === INTENT_SYSTEM_PROMPT ? intent : options.purpose === 'plan' ? router.complete(messages, options) : 'OK',
    );
    const value: Routers = {
      draft: { complete: async () => 'Il cuore ha quattro cavità.' } as unknown as ProviderRouter,
      review: { complete: standard } as unknown as ProviderRouter,
      deep: false,
      illustrations,
    };
    return value;
  }

  it('adds pictures to an explanation, next to the text', async () => {
    const reply = await respond(routers('text visual', setup().config), [], 'spiegami come funziona il cuore');
    expect(reply.text).toBe('Il cuore ha quattro cavità.');
    expect(reply.illustrations).toHaveLength(1);
  });

  it('adds nothing without the visual flag, for documents, or when the feature is off', async () => {
    const plain = setup();
    expect((await respond(routers('text', plain.config), [], 'quanto fa 2+2')).illustrations).toBeUndefined();
    expect(plain.fetchFn).not.toHaveBeenCalled();
    expect((await respond(routers('text visual'), [], 'spiegami il cuore')).illustrations).toBeUndefined();
  });
});
