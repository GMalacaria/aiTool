import type { ChartKind, ChartSeries } from '../../shared/document';

export interface ChartData {
  chart: ChartKind;
  labels: string[];
  series: ChartSeries[];
}

export interface ChartStyle {
  /** Text and axis colour: `currentColor` on screen, a fixed colour in the PDF. */
  textColor: string;
  gridColor: string;
  fontFamily: string;
}

export const CHART_WIDTH = 640;
export const CHART_HEIGHT = 360;

/** Categorical palette, readable on light and dark backgrounds and in print. */
export const PALETTE = ['#2f6fb7', '#d1603d', '#3a8f6b', '#8a5fbf', '#c9a227', '#6b7280', '#b83b6e', '#2a9d9d'];

const numberFormat = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2 });
const percentFormat = new Intl.NumberFormat('it-IT', { style: 'percent', maximumFractionDigits: 1 });

export const formatNumber = (value: number) => numberFormat.format(value);

const escapeXml = (value: string) =>
  value.replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[char]!);

const shorten = (value: string, maxChars: number) =>
  value.length > maxChars ? `${value.slice(0, maxChars - 1)}…` : value;

const round = (value: number) => Math.round(value * 100) / 100;

/** Rounds the axis maximum up to 1, 2, 2.5, 5 or 10 times a power of ten. */
export function niceCeil(value: number): number {
  if (value <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 2.5, 5, 10].find((candidate) => candidate * magnitude >= value) ?? 10;
  return step * magnitude;
}

/** Axis range that always includes zero, with round tick values (about four intervals). */
export function axisScale(values: number[]): { min: number; max: number; step: number } {
  const low = Math.min(0, ...values);
  const high = Math.max(0, ...values);
  const step = niceCeil((high - low) / 4);
  const min = Math.floor(low / step) * step;
  const max = Math.max(min + step, Math.ceil(high / step) * step);
  return { min, max, step };
}

export function chartSvg(data: ChartData, style: ChartStyle): string {
  const body = data.chart === 'pie' ? pie(data, style) : cartesian(data, style);
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${CHART_WIDTH} ${CHART_HEIGHT}" ` +
    `width="${CHART_WIDTH}" height="${CHART_HEIGHT}" font-family="${escapeXml(style.fontFamily)}" font-size="15">${body}</svg>`
  );
}

function label(x: number, y: number, content: string, style: ChartStyle, anchor: 'start' | 'middle' | 'end' = 'start') {
  return `<text x="${round(x)}" y="${round(y)}" text-anchor="${anchor}" fill="${style.textColor}">${escapeXml(content)}</text>`;
}

function legend(names: string[], style: ChartStyle, x: number, y: number, maxChars: number): string {
  return names
    .map((name, index) => {
      const top = y + index * 24;
      return (
        `<rect x="${x}" y="${top}" width="12" height="12" rx="2" fill="${PALETTE[index % PALETTE.length]}"/>` +
        label(x + 18, top + 11, shorten(name, maxChars), style)
      );
    })
    .join('');
}

/** Bar and line charts share axes, grid and legend. */
function cartesian(data: ChartData, style: ChartStyle): string {
  const showLegend = data.series.length > 1;
  const area = { left: 68, top: 18, right: CHART_WIDTH - (showLegend ? 170 : 16), bottom: CHART_HEIGHT - 46 };
  const width = area.right - area.left;
  const height = area.bottom - area.top;

  const { min, max, step } = axisScale(data.series.flatMap((series) => series.values));
  const y = (value: number) => area.bottom - ((value - min) / (max - min)) * height;

  let svg = '';
  for (let value = min; value <= max + step / 1000; value += step) {
    svg +=
      `<line x1="${area.left}" x2="${area.right}" y1="${round(y(value))}" y2="${round(y(value))}" stroke="${style.gridColor}" stroke-width="1"/>` +
      label(area.left - 8, y(value) + 5, formatNumber(round(value)), style, 'end');
  }
  svg += `<line x1="${area.left}" x2="${area.right}" y1="${round(y(0))}" y2="${round(y(0))}" stroke="${style.textColor}" stroke-width="1"/>`;

  const slot = width / data.labels.length;
  const labelChars = Math.max(3, Math.floor(slot / 9));
  data.labels.forEach((text, index) => {
    svg += label(area.left + slot * (index + 0.5), area.bottom + 22, shorten(text, labelChars), style, 'middle');
  });

  if (data.chart === 'bar') {
    const group = slot * 0.72;
    const barWidth = group / data.series.length;
    data.series.forEach((series, seriesIndex) => {
      series.values.forEach((value, index) => {
        const x = area.left + slot * index + (slot - group) / 2 + barWidth * seriesIndex;
        const top = Math.min(y(value), y(0));
        svg += `<rect x="${round(x)}" y="${round(top)}" width="${round(Math.max(1, barWidth - 2))}" height="${round(Math.abs(y(value) - y(0)))}" fill="${PALETTE[seriesIndex % PALETTE.length]}"/>`;
      });
    });
  } else {
    data.series.forEach((series, seriesIndex) => {
      const color = PALETTE[seriesIndex % PALETTE.length];
      const points = series.values.map((value, index) => [area.left + slot * (index + 0.5), y(value)] as const);
      svg += `<polyline fill="none" stroke="${color}" stroke-width="2.5" stroke-linejoin="round" points="${points.map(([px, py]) => `${round(px)},${round(py)}`).join(' ')}"/>`;
      svg += points.map(([px, py]) => `<circle cx="${round(px)}" cy="${round(py)}" r="3.5" fill="${color}"/>`).join('');
    });
  }

  if (showLegend) svg += legend(data.series.map((series) => series.name), style, area.right + 18, area.top, 17);
  return svg;
}

const MAX_PIE_SLICES = 12;

/** Keeps the largest slices and groups the rest, so the legend always fits. */
export function pieSlices(labels: string[], values: number[]): { labels: string[]; values: number[] } {
  const slices = labels.map((text, index) => ({ text, value: Math.max(0, values[index] ?? 0) }));
  if (slices.length <= MAX_PIE_SLICES) {
    return { labels: slices.map((slice) => slice.text), values: slices.map((slice) => slice.value) };
  }

  const sorted = [...slices].sort((a, b) => b.value - a.value);
  const kept = sorted.slice(0, MAX_PIE_SLICES - 1);
  const rest = sorted.slice(MAX_PIE_SLICES - 1).reduce((sum, slice) => sum + slice.value, 0);
  return { labels: [...kept.map((slice) => slice.text), 'Altro'], values: [...kept.map((slice) => slice.value), rest] };
}

function pie(input: ChartData, style: ChartStyle): string {
  const data = pieSlices(input.labels, input.series[0].values);
  const values = data.values;
  const total = values.reduce((sum, value) => sum + value, 0);
  const cx = 150;
  const cy = CHART_HEIGHT / 2;
  const radius = 135;

  if (total <= 0) return label(CHART_WIDTH / 2, cy, 'Nessun dato', style, 'middle');

  let angle = -Math.PI / 2;
  let svg = '';
  values.forEach((value, index) => {
    if (value <= 0) return;
    const sweep = (value / total) * Math.PI * 2;
    const color = PALETTE[index % PALETTE.length];

    if (sweep >= Math.PI * 2 - 1e-9) {
      svg += `<circle cx="${cx}" cy="${cy}" r="${radius}" fill="${color}"/>`;
    } else {
      const [x1, y1] = [cx + radius * Math.cos(angle), cy + radius * Math.sin(angle)];
      const [x2, y2] = [cx + radius * Math.cos(angle + sweep), cy + radius * Math.sin(angle + sweep)];
      svg += `<path d="M${cx} ${cy} L${round(x1)} ${round(y1)} A${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${round(x2)} ${round(y2)} Z" fill="${color}" stroke="#ffffff" stroke-width="1.5"/>`;
    }
    angle += sweep;
  });

  const names = data.labels.map(
    (text, index) => `${shorten(text, 18)} — ${formatNumber(values[index])} (${percentFormat.format(values[index] / total)})`,
  );
  const legendTop = Math.max(16, cy - (names.length * 24) / 2);
  return svg + legend(names, style, 305, legendTop, 40);
}
