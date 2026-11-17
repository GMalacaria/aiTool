import { describe, expect, it } from 'vitest';
import { insertMarkers, parseMarkerHref, parseSources, segmentAnswer, stripMarkers } from '../shared/sources';
import { UsageMeter } from './meter';
import { parseIntent } from './prompts';
import {
  answerWithSources,
  applyVerdicts,
  citedSegment,
  htmlToText,
  parseVerdicts,
  relevantText,
  stripCitations,
  type SourcesConfig,
} from './sources';

describe('segmentAnswer', () => {
  it('splits paragraphs into sentences and keeps list items', () => {
    const text = 'Il biglietto costa 1,50 euro. Vale 100 minuti.\n\n- Si compra online.\n- Anche in edicola.';
    const segments = segmentAnswer(text);
    expect(segments.map((segment) => segment.text)).toEqual([
      'Il biglietto costa 1,50 euro.',
      'Vale 100 minuti.',
      'Si compra online.',
      'Anche in edicola.',
    ]);
    expect(text.slice(segments[0].start, segments[0].end).trim()).toBe('Il biglietto costa 1,50 euro.');
  });

  it('treats table rows as segments and skips separators and code', () => {
    const text = '| Anno | Valore |\n|---|---|\n| 2025 | 3% |\n\n```\nnon toccare.\n```';
    expect(segmentAnswer(text).map((segment) => segment.text)).toEqual(['Anno · Valore', '2025 · 3%']);
  });

  it('does not split after abbreviations such as art. or n.', () => {
    expect(segmentAnswer('Vale dal 2 dicembre (art. 50, par. 2). Il D.Lgs. 36 lo prevede.').map((segment) => segment.text)).toEqual([
      'Vale dal 2 dicembre (art. 50, par. 2).',
      'Il D.Lgs. 36 lo prevede.',
    ]);
  });

  it('does not split decimal numbers or abbreviations followed by lowercase', () => {
    expect(segmentAnswer('Costa 2.5 euro, cioè poco. Fine.').map((segment) => segment.text)).toEqual([
      'Costa 2.5 euro, cioè poco.',
      'Fine.',
    ]);
  });
});

describe('insertMarkers', () => {
  it('puts markers after sentences and inside the last table cell', () => {
    const text = 'Primo fatto. Secondo fatto.\n\n| A | B |\n|---|---|\n| 1 | 2 |';
    const segments = segmentAnswer(text);
    const result = insertMarkers(text, segments, [
      [{ type: 'source', n: 1 }],
      [{ type: 'unverified' }],
      undefined,
      [{ type: 'source', n: 2 }],
    ]);
    expect(result).toBe(
      'Primo fatto.[1](#source-1) Secondo fatto.[?](#unverified)\n\n| A | B |\n|---|---|\n| 1 | 2 [2](#source-2) |',
    );
    expect(stripMarkers(result)).toBe('Primo fatto. Secondo fatto.\n\n| A | B |\n|---|---|\n| 1 | 2  |');
  });
});

describe('markers and stored sources', () => {
  it('parses marker links', () => {
    expect(parseMarkerHref('#source-3')).toEqual({ type: 'source', n: 3 });
    expect(parseMarkerHref('#unreadable-1')).toEqual({ type: 'unreadable', n: 1 });
    expect(parseMarkerHref('#unverified')).toEqual({ type: 'unverified' });
    expect(parseMarkerHref('https://example.com')).toBeNull();
  });

  it('accepts only http(s) links', () => {
    expect(parseSources({ items: [{ kind: 'web', url: 'javascript:alert(1)', title: 'x' }], verified: true })).toBeNull();
    expect(parseSources(JSON.stringify({ items: [{ kind: 'web', url: 'https://a.it', title: '' }], verified: true }))).toEqual({
      items: [{ kind: 'web', url: 'https://a.it', title: 'https://a.it' }],
      verified: true,
    });
  });
});

describe('stripCitations', () => {
  it('removes the inline links and remembers where they were', () => {
    const link = '[atac.roma.it](https://www.atac.roma.it/biglietti?utm_source=openai)';
    const text = `Il biglietto costa 1,50 euro (${link}). Vale 100 minuti.`;
    const start = text.indexOf(link);
    const result = stripCitations(text, [
      { start_index: start, end_index: start + link.length, url: 'https://www.atac.roma.it/biglietti?utm_source=openai', title: 'ATAC' },
    ]);
    expect(result.text).toBe('Il biglietto costa 1,50 euro. Vale 100 minuti.');
    expect(result.citations).toEqual([{ at: 'Il biglietto costa 1,50 euro'.length, url: 'https://www.atac.roma.it/biglietti', title: 'ATAC' }]);
    const segments = segmentAnswer(result.text);
    expect(citedSegment(segments, result.text, result.citations[0].at)).toBe(0);
  });

  it('assigns a citation placed after the full stop to the sentence before', () => {
    const text = 'Primo fatto. Secondo fatto.';
    const segments = segmentAnswer(text);
    expect(citedSegment(segments, text, 'Primo fatto.'.length)).toBe(0);
    expect(citedSegment(segments, text, 'Primo fatto. '.length)).toBe(0);
  });
});

describe('verdicts', () => {
  it('ignores invalid entries and source numbers', () => {
    const verdicts = parseVerdicts('{"sentences":[{"n":1,"factual":true,"sources":[1,9,1]},{"n":7,"factual":true}]}', 2, 2);
    expect(verdicts).toEqual([
      { factual: true, sources: [1] },
      { factual: false, sources: [] },
    ]);
  });

  it('numbers only the sources that markers use, and marks unreadable citations', () => {
    const text = 'Fatto A. Spiegazione generale. Fatto B. Fatto C.';
    const segments = segmentAnswer(text);
    const result = applyVerdicts(
      text,
      segments,
      [
        { factual: true, sources: [2] },
        { factual: false, sources: [] },
        { factual: true, sources: [] },
        { factual: true, sources: [] },
      ],
      [
        { item: { kind: 'web', url: 'https://bloccato.it', title: 'Bloccato' }, content: { ok: false, why: 'HTTP 403' } },
        { item: { kind: 'web', url: 'https://ok.it', title: 'OK' }, content: { ok: true, text: 'Fatto A' } },
        { item: { kind: 'web', url: 'https://mai.it', title: 'Mai usata' }, content: { ok: true, text: '' } },
      ],
      [[], [], [0], []],
    );
    expect(result.text).toBe(
      'Fatto A.[1](#source-1) Spiegazione generale. Fatto B.[?](#unreadable-2) Fatto C.[?](#unverified)',
    );
    expect(result.sources).toEqual({
      items: [
        { kind: 'web', url: 'https://ok.it', title: 'OK' },
        { kind: 'web', url: 'https://bloccato.it', title: 'Bloccato' },
      ],
      verified: true,
    });
  });
});

describe('page text', () => {
  it('drops scripts and markup', () => {
    expect(htmlToText('<p>Ciao&nbsp;<b>mondo</b></p><script>x()</script><style>p{}</style>')).toBe('Ciao mondo');
  });

  it('keeps the parts of a long page that match the answer', () => {
    const filler = 'testo irrilevante '.repeat(400);
    const page = `${filler} Il prezzo del biglietto ordinario è 1,50 euro. ${filler}`;
    const kept = relevantText(page, 'Il biglietto costa 1,50 euro.', 2400);
    expect(kept.length).toBeLessThanOrEqual(2400 + 10);
    expect(kept).toContain('1,50 euro');
  });
});

describe('meter', () => {
  it('keeps search and checking out of the user budget but in the cost', () => {
    const meter = new UsageMeter();
    meter.record({ purpose: 'search', provider: 'openai-search', model: 'm', free: false, inputTokens: 9000, outputTokens: 300, costMicroUsd: 1050 });
    meter.record({ purpose: 'review', provider: 'openai', model: 'm', free: false, inputTokens: 500, outputTokens: 5, costMicroUsd: 53 });
    meter.addSearches(1);
    expect(meter.paidTokens).toBe(505);
    expect(meter.sourcesCostMicroUsd).toBe(1050 + 10_000);
    expect(meter.costMicroUsd).toBe(53 + 1050 + 10_000);
    expect(meter.answeredByFreeModel).toBe(false);
  });
});

describe('intent', () => {
  it('recognises search', () => {
    expect(parseIntent('search')).toBe('search');
    expect(parseIntent(' Search.')).toBe('search');
  });
});

describe('answerWithSources', () => {
  const config = (fetchFn: typeof fetch, paid = true): SourcesConfig => ({
    openaiKey: 'k',
    openaiBaseURL: 'https://openai.test/v1',
    model: 'gpt-6-luna',
    price: { inputPerMillion: 0.1, outputPerMillion: 0.5 },
    verify: { apiKey: 'g', baseURL: 'https://gemini.test/v1beta', model: 'gemini-flash-latest', paid },
    fetchFn,
  });

  const answer = 'Il biglietto costa 1,50 euro (fonte). Dura 100 minuti.';
  const fetchFn = (verdicts: unknown, pageStatus = 200) =>
    (async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/responses')) {
        const start = answer.indexOf('fonte');
        return Response.json({
          output: [
            { type: 'web_search_call' },
            {
              type: 'message',
              content: [
                {
                  type: 'output_text',
                  text: answer,
                  annotations: [{ type: 'url_citation', start_index: start, end_index: start + 5, url: 'https://atac.it/p', title: 'ATAC' }],
                },
              ],
            },
          ],
          usage: { input_tokens: 9000, output_tokens: 200 },
        });
      }
      if (url.startsWith('https://atac.it')) {
        return new Response('<p>Il biglietto ordinario costa 1,50 euro e vale 100 minuti dalla convalida.</p>', {
          status: pageStatus,
          headers: { 'content-type': 'text/html' },
        });
      }
      if (url.includes(':generateContent')) {
        return Response.json({
          candidates: [{ content: { parts: [{ text: JSON.stringify(verdicts) }] } }],
          usageMetadata: { promptTokenCount: 800, candidatesTokenCount: 40 },
        });
      }
      throw new Error(`unexpected ${url}`);
    }) as typeof fetch;

  it('marks confirmed and unconfirmed facts', async () => {
    const meter = new UsageMeter();
    const result = await answerWithSources(
      config(fetchFn({ sentences: [{ n: 1, factual: true, sources: [1] }, { n: 2, factual: true, sources: [] }] })),
      [{ role: 'user', content: 'Quanto costa il biglietto?' }],
      { deep: false, maxOutputTokens: 2000, meter, documents: [], review: async (draft) => draft },
    );
    expect(result.text).toBe('Il biglietto costa 1,50 euro.[1](#source-1) Dura 100 minuti.[?](#unverified)');
    expect(result.sources).toEqual({ items: [{ kind: 'web', url: 'https://atac.it/p', title: 'ATAC' }], verified: true });
    expect(meter.searches).toBe(1);
    expect(meter.paidTokens).toBe(0);
  });

  it('marks a fact cited from an unreadable page as not checked', async () => {
    const result = await answerWithSources(
      config(fetchFn({ sentences: [{ n: 1, factual: true, sources: [1] }, { n: 2, factual: false }] }, 403)),
      [{ role: 'user', content: 'Quanto costa il biglietto?' }],
      { deep: false, maxOutputTokens: 2000, documents: [], review: async (draft) => draft },
    );
    expect(result.text).toBe('Il biglietto costa 1,50 euro.[?](#unreadable-1) Dura 100 minuti.');
  });

  it('keeps the legend without markers when the check fails', async () => {
    const result = await answerWithSources(
      config(fetchFn('not json')),
      [{ role: 'user', content: 'Quanto costa il biglietto?' }],
      { deep: false, maxOutputTokens: 2000, documents: [], review: async (draft) => draft },
    );
    expect(result.text).toBe('Il biglietto costa 1,50 euro. Dura 100 minuti.');
    expect(result.sources?.verified).toBe(false);
  });

  it('never sends attached documents to a free checker', async () => {
    const calls: string[] = [];
    const base = fetchFn({ sentences: [] });
    const spy = (async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push(String(input));
      return base(input, init);
    }) as typeof fetch;
    const result = await answerWithSources(
      config(spy, false),
      [{ role: 'user', content: 'Quanto costa?' }],
      { deep: false, maxOutputTokens: 2000, documents: [{ name: 'tariffe.pdf', text: 'riservato' }], review: async (draft) => draft },
    );
    expect(calls.some((url) => url.includes(':generateContent'))).toBe(false);
    expect(result.sources?.verified).toBe(false);
  });
});
