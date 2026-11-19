import { describe, expect, it } from 'vitest';
import { parseDocument } from '../../shared/document';
import { axisScale, chartSvg, niceCeil, pieSlices } from './chart';
import { buildSheets } from './excel';
import { fitWithin } from '../attachments/image';
import { fileName } from './files';

const style = { textColor: '#000', gridColor: '#ccc', fontFamily: 'Roboto' };

describe('chartSvg', () => {
  it('draws one bar per value and escapes text', () => {
    const svg = chartSvg(
      {
        chart: 'bar',
        labels: ['<a>', 'b'],
        series: [
          { name: 'x & y', values: [1, 2] },
          { name: 'z', values: [3, 4] },
        ],
      },
      style,
    );

    expect(svg.match(/<rect [^>]*height=/g)?.length).toBe(4 + 2); // 4 bars + 2 legend swatches
    expect(svg).toContain('&lt;a&gt;');
    expect(svg).toContain('x &amp; y');
    expect(svg).not.toContain('<a>');
  });

  it('draws a line per series', () => {
    const svg = chartSvg({ chart: 'line', labels: ['a', 'b', 'c'], series: [{ name: 's', values: [1, -2, 3] }] }, style);
    expect(svg.match(/<polyline/g)).toHaveLength(1);
    expect(svg.match(/<circle/g)).toHaveLength(3);
  });

  it('draws pie slices with percentages and handles empty data', () => {
    const svg = chartSvg({ chart: 'pie', labels: ['a', 'b'], series: [{ name: 's', values: [1, 3] }] }, style);
    expect(svg.match(/<path/g)).toHaveLength(2);
    expect(svg).toContain('25%');
    expect(svg).toContain('75%');

    expect(chartSvg({ chart: 'pie', labels: ['a'], series: [{ name: 's', values: [0] }] }, style)).toContain('Nessun dato');
    expect(chartSvg({ chart: 'pie', labels: ['a'], series: [{ name: 's', values: [5] }] }, style)).toContain('<circle');
  });
});

describe('niceCeil', () => {
  it.each([
    [0, 1],
    [7, 10],
    [12, 20],
    [23, 25],
    [260, 500],
    [0.03, 0.05],
  ])('rounds %d up to %d', (value, expected) => {
    expect(niceCeil(value)).toBeCloseTo(expected);
  });
});

describe('axisScale', () => {
  it('includes zero and uses round steps', () => {
    expect(axisScale([800, 350, 120, 90])).toEqual({ min: 0, max: 800, step: 200 });
    expect(axisScale([-2, 12])).toEqual({ min: -5, max: 15, step: 5 });
    expect(axisScale([0, 0])).toEqual({ min: 0, max: 1, step: 1 });
    expect(axisScale([-30, -5])).toEqual({ min: -30, max: 0, step: 10 });
  });
});

describe('pieSlices', () => {
  it('groups the smallest slices beyond the limit', () => {
    const labels = Array.from({ length: 15 }, (_, index) => `l${index}`);
    const values = labels.map((_, index) => index + 1);
    const slices = pieSlices(labels, values);

    expect(slices.labels).toHaveLength(12);
    expect(slices.labels.at(-1)).toBe('Altro');
    expect(slices.values.at(-1)).toBe(1 + 2 + 3 + 4);
    expect(slices.values.reduce((sum, value) => sum + value, 0)).toBe(120);
  });
});

describe('buildSheets', () => {
  it('creates one sheet per table and chart with unique, valid names', () => {
    const document = parseDocument({
      blocks: [
        { type: 'table', title: 'Spese: 2026/27', columns: ['Voce', 'Costo'], rows: [['Affitto', 800]] },
        { type: 'table', title: 'Spese: 2026/27', columns: ['A'], rows: [[1]] },
        { type: 'chart', chart: 'bar', title: '', labels: ['x', 'y'], series: [{ name: 's', values: [1, 2] }] },
        { type: 'paragraph', text: 'ignored' },
      ],
    })!;

    expect(buildSheets(document)).toEqual([
      { name: 'Spese 2026 27', rows: [['Voce', 'Costo'], ['Affitto', 800]] },
      { name: 'Spese 2026 27 2', rows: [['A'], [1]] },
      { name: 'Grafico 3', rows: [['', 's'], ['x', 1], ['y', 2]] },
    ]);
  });
});

describe('fileName', () => {
  it('builds a safe file name', () => {
    expect(fileName('Città & paesi: età media!', 'pdf')).toBe('citta-paesi-eta-media.pdf');
    expect(fileName('???', 'xlsx')).toBe('documento.xlsx');
  });
});

describe('fitWithin', () => {
  it('scales down keeping the proportions and never scales up', () => {
    expect(fitWithin(4000, 3000, 1568)).toEqual({ width: 1568, height: 1176 });
    expect(fitWithin(600, 1200, 1568)).toEqual({ width: 600, height: 1200 });
    expect(fitWithin(3000, 10, 1000)).toEqual({ width: 1000, height: 3 });
  });
});

describe('PDF diagrams', async () => {
  const { buildDefinition, diagramSize } = await import('./pdf');

  it('keeps the natural size and shrinks big diagrams to the page', () => {
    expect(diagramSize({ width: 400, height: 200 })).toEqual({ width: 300, height: 150 });
    const wide = diagramSize({ width: 2000, height: 500 });
    expect(wide.width).toBeCloseTo(499);
    expect(wide.height).toBeCloseTo(124.75);
    const tall = diagramSize({ width: 300, height: 2000 });
    expect(tall.height).toBeCloseTo(640);
  });

  it('places the drawn picture, or a note when it could not be drawn', () => {
    const document = parseDocument({
      title: 'Schemi',
      blocks: [
        { type: 'diagram', title: 'Uno', code: 'flowchart TD\n  A --> B' },
        { type: 'diagram', title: 'Due', code: 'flowchart TD\n  C --> D' },
      ],
    })!;
    const images = new Map([
      [document.blocks[0], { dataUrl: 'data:image/png;base64,AAAA', width: 400, height: 200 }],
      [document.blocks[1], null],
    ]);
    const content = JSON.stringify(buildDefinition(document, new Date(0), images).content);
    expect(content).toContain('"image":"data:image/png;base64,AAAA","width":300,"height":150');
    expect(content).toContain('Schema non disponibile in questo file.');
  });
});
