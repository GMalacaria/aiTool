/**
 * Structured document produced by the model in "document" mode. The model only
 * describes the content; the app renders the preview and builds the PDF and
 * Excel files from this description. Used by both the Worker and the frontend.
 */
export type ChartKind = 'bar' | 'line' | 'pie';
export type Cell = string | number;

export interface ChartSeries {
  name: string;
  values: number[];
}

export interface QuizQuestion {
  question: string;
  /** Empty for open questions. */
  options: string[];
  answer: string;
}

export type DocumentBlock =
  | { type: 'heading'; text: string }
  | { type: 'paragraph'; text: string }
  | { type: 'list'; ordered: boolean; items: string[] }
  | { type: 'table'; title: string; columns: string[]; rows: Cell[][] }
  | { type: 'chart'; chart: ChartKind; title: string; labels: string[]; series: ChartSeries[] }
  | { type: 'quiz'; questions: QuizQuestion[] }
  /** A Mermaid diagram (flowchart, mind map, timeline…): `code` is its source, drawn by the app. */
  | { type: 'diagram'; title: string; code: string };

export interface DocumentSpec {
  title: string;
  /** False when numeric data comes from the model's own knowledge. */
  dataProvidedByUser: boolean;
  blocks: DocumentBlock[];
}

export const DOCUMENT_LIMITS = {
  blocks: 40,
  textChars: 4000,
  shortTextChars: 200,
  listItems: 50,
  tableColumns: 12,
  tableRows: 200,
  chartLabels: 30,
  chartSeries: 6,
  quizQuestions: 50,
  quizOptions: 8,
  diagramChars: 4000,
} as const;

const CHART_KINDS: ChartKind[] = ['bar', 'line', 'pie'];

type Json = Record<string, unknown>;

const isObject = (value: unknown): value is Json => typeof value === 'object' && value !== null && !Array.isArray(value);

function text(value: unknown, maxChars: number): string {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return typeof value === 'string' ? value.trim().slice(0, maxChars) : '';
}

function texts(value: unknown, maxItems: number, maxChars: number): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .slice(0, maxItems)
    .map((item) => text(item, maxChars))
    .filter(Boolean);
}

function cell(value: unknown): Cell {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  return text(value, DOCUMENT_LIMITS.shortTextChars);
}

function block(value: unknown): DocumentBlock | null {
  if (!isObject(value)) return null;
  const L = DOCUMENT_LIMITS;

  switch (value.type) {
    case 'heading': {
      const content = text(value.text, L.shortTextChars);
      return content ? { type: 'heading', text: content } : null;
    }
    case 'paragraph': {
      const content = text(value.text, L.textChars);
      return content ? { type: 'paragraph', text: content } : null;
    }
    case 'list': {
      const items = texts(value.items, L.listItems, L.textChars);
      return items.length ? { type: 'list', ordered: value.ordered === true, items } : null;
    }
    case 'table': {
      const columns = texts(value.columns, L.tableColumns, L.shortTextChars);
      if (!columns.length || !Array.isArray(value.rows)) return null;

      const rows = value.rows
        .slice(0, L.tableRows)
        .filter(Array.isArray)
        // Every row gets exactly one cell per column.
        .map((row) => columns.map((_, index) => cell(row[index])));
      return rows.length ? { type: 'table', title: text(value.title, L.shortTextChars), columns, rows } : null;
    }
    case 'chart': {
      const chart = CHART_KINDS.find((kind) => kind === value.chart);
      const labels = texts(value.labels, L.chartLabels, L.shortTextChars);
      if (!chart || !labels.length || !Array.isArray(value.series)) return null;

      const series = value.series
        .slice(0, chart === 'pie' ? 1 : L.chartSeries)
        .filter(isObject)
        .map((entry, index) => ({
          name: text(entry.name, L.shortTextChars) || `Serie ${index + 1}`,
          values: Array.isArray(entry.values) ? entry.values.slice(0, labels.length) : [],
        }))
        // A series is usable only with one finite number per label.
        .filter(
          (entry): entry is ChartSeries =>
            entry.values.length === labels.length &&
            entry.values.every((item) => typeof item === 'number' && Number.isFinite(item)),
        );
      return series.length ? { type: 'chart', chart, title: text(value.title, L.shortTextChars), labels, series } : null;
    }
    case 'quiz': {
      if (!Array.isArray(value.questions)) return null;
      const questions = value.questions
        .slice(0, L.quizQuestions)
        .filter(isObject)
        .map((entry) => ({
          question: text(entry.question, L.textChars),
          options: texts(entry.options, L.quizOptions, L.textChars),
          answer: text(entry.answer, L.textChars),
        }))
        .filter((entry) => entry.question);
      return questions.length ? { type: 'quiz', questions } : null;
    }
    case 'diagram': {
      // Models sometimes wrap the source in a code fence: keep only what is inside.
      const raw = typeof value.code === 'string' ? value.code : '';
      const code = raw
        .trim()
        .replace(/^```[\w-]*[^\S\n]*\n?|\n?```$/g, '')
        .trim();
      if (!code || code.length > L.diagramChars) return null;
      return { type: 'diagram', title: text(value.title, L.shortTextChars), code };
    }
    default:
      return null;
  }
}

/**
 * Validates untrusted JSON (model output or stored content) and returns a
 * document that respects the limits, dropping anything unusable. Returns null
 * when nothing renderable is left.
 */
export function parseDocument(value: unknown): DocumentSpec | null {
  let data = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!isObject(data) || !Array.isArray(data.blocks)) return null;

  const blocks = data.blocks
    .slice(0, DOCUMENT_LIMITS.blocks)
    .map(block)
    .filter((entry): entry is DocumentBlock => entry !== null);
  if (!blocks.length) return null;

  return {
    title: text(data.title, DOCUMENT_LIMITS.shortTextChars) || 'Documento',
    dataProvidedByUser: data.dataProvidedByUser === true,
    blocks,
  };
}

/** True when the document contains numbers worth exporting to a spreadsheet. */
export function hasTabularData(document: DocumentSpec): boolean {
  return document.blocks.some((entry) => entry.type === 'table' || entry.type === 'chart');
}

/** True when every cell of the column is a number: such columns are right-aligned. */
export function isNumericColumn(rows: Cell[][], index: number): boolean {
  return rows.every((row) => typeof row[index] === 'number');
}
