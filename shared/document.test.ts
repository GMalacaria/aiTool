import { describe, expect, it } from 'vitest';
import { DOCUMENT_LIMITS, hasTabularData, parseDocument } from './document';

describe('parseDocument', () => {
  it('accepts every block type, from an object or a JSON string', () => {
    const input = {
      title: ' Report ',
      dataProvidedByUser: true,
      blocks: [
        { type: 'heading', text: 'Intro' },
        { type: 'paragraph', text: 'Body' },
        { type: 'list', ordered: true, items: ['a', 'b'] },
        { type: 'table', title: 'Costs', columns: ['Item', 'Cost'], rows: [['Rent', 800]] },
        { type: 'chart', chart: 'bar', title: 'Costs', labels: ['Rent'], series: [{ name: 'EUR', values: [800] }] },
        { type: 'quiz', questions: [{ question: '2+2?', options: ['3', '4'], answer: '4' }] },
      ],
    };

    const expected = { ...input, title: 'Report' };
    expect(parseDocument(input)).toEqual(expected);
    expect(parseDocument(JSON.stringify(input))).toEqual(expected);
  });

  it('defaults the title and treats data as not provided by the user', () => {
    expect(parseDocument({ blocks: [{ type: 'paragraph', text: 'x' }] })).toEqual({
      title: 'Documento',
      dataProvidedByUser: false,
      blocks: [{ type: 'paragraph', text: 'x' }],
    });
  });

  it('drops unusable blocks and returns null when nothing is left', () => {
    const document = parseDocument({
      blocks: [
        { type: 'script', text: 'x' },
        { type: 'paragraph', text: '   ' },
        { type: 'list', items: [] },
        { type: 'table', columns: [], rows: [[1]] },
        { type: 'chart', chart: 'radar', labels: ['a'], series: [{ name: 's', values: [1] }] },
        { type: 'chart', chart: 'bar', labels: ['a', 'b'], series: [{ name: 's', values: [1] }] },
        { type: 'chart', chart: 'bar', labels: ['a'], series: [{ name: 's', values: ['1'] }] },
        { type: 'quiz', questions: [{ question: '' }] },
        'text',
        { type: 'heading', text: 'Kept' },
      ],
    });
    expect(document?.blocks).toEqual([{ type: 'heading', text: 'Kept' }]);

    expect(parseDocument({ blocks: [{ type: 'script' }] })).toBeNull();
    expect(parseDocument('not json')).toBeNull();
    expect(parseDocument(null)).toBeNull();
    expect(parseDocument({ title: 'x' })).toBeNull();
  });

  it('normalises table rows to the number of columns', () => {
    const document = parseDocument({
      blocks: [{ type: 'table', columns: ['A', 'B'], rows: [[1], [1, 2, 3], 'bad', [null, true]] }],
    });
    expect(document?.blocks[0]).toEqual({
      type: 'table',
      title: '',
      columns: ['A', 'B'],
      rows: [
        [1, ''],
        [1, 2],
        ['', ''],
      ],
    });
  });

  it('keeps a single series for pie charts and names unnamed series', () => {
    const document = parseDocument({
      blocks: [
        {
          type: 'chart',
          chart: 'pie',
          labels: ['a', 'b'],
          series: [{ values: [1, 2] }, { name: 'extra', values: [3, 4] }],
        },
      ],
    });
    expect(document?.blocks[0]).toMatchObject({ series: [{ name: 'Serie 1', values: [1, 2] }] });
  });

  it('enforces the size limits', () => {
    const document = parseDocument({
      title: 't'.repeat(1000),
      blocks: Array.from({ length: 100 }, () => ({ type: 'paragraph', text: 'p'.repeat(10_000) })),
    });

    expect(document?.title).toHaveLength(DOCUMENT_LIMITS.shortTextChars);
    expect(document?.blocks).toHaveLength(DOCUMENT_LIMITS.blocks);
    expect(document?.blocks[0]).toMatchObject({ text: 'p'.repeat(DOCUMENT_LIMITS.textChars) });
  });
});

describe('hasTabularData', () => {
  it('is true only with tables or charts', () => {
    expect(hasTabularData(parseDocument({ blocks: [{ type: 'paragraph', text: 'x' }] })!)).toBe(false);
    expect(hasTabularData(parseDocument({ blocks: [{ type: 'table', columns: ['A'], rows: [[1]] }] })!)).toBe(true);
  });
});
