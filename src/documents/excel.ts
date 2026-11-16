// Loaded on demand (dynamic import).
import writeExcelFile from 'write-excel-file/browser';
import type { Cell, DocumentSpec } from '../../shared/document';

interface Sheet {
  name: string;
  rows: Cell[][];
}

/** Excel sheet names: at most 31 characters, none of []:*?/\ and unique. */
function sheetName(title: string, fallback: string, used: Set<string>): string {
  const base = (title.replace(/[[\]:*?/\\]/g, ' ').replace(/\s+/g, ' ').trim() || fallback).slice(0, 31);
  let name = base;
  for (let suffix = 2; used.has(name.toLowerCase()); suffix++) {
    const tail = ` ${suffix}`;
    name = `${base.slice(0, 31 - tail.length)}${tail}`;
  }
  used.add(name.toLowerCase());
  return name;
}

/** One sheet per table and one per chart (labels in the first column, a column per series). */
export function buildSheets(document: DocumentSpec): Sheet[] {
  const used = new Set<string>();
  const sheets: Sheet[] = [];

  for (const block of document.blocks) {
    if (block.type === 'table') {
      sheets.push({
        name: sheetName(block.title, `Tabella ${sheets.length + 1}`, used),
        rows: [block.columns, ...block.rows],
      });
    } else if (block.type === 'chart') {
      sheets.push({
        name: sheetName(block.title, `Grafico ${sheets.length + 1}`, used),
        rows: [
          ['', ...block.series.map((series) => series.name)],
          ...block.labels.map((label, index) => [label, ...block.series.map((series) => series.values[index])]),
        ],
      });
    }
  }
  return sheets;
}

export async function createExcel(document: DocumentSpec): Promise<Blob> {
  const sheets = buildSheets(document).map(({ name, rows }) => {
    const columnCount = Math.max(...rows.map((row) => row.length));
    return {
      sheet: name,
      data: rows.map((row, rowIndex) =>
        row.map((value) =>
          typeof value === 'number'
            ? { value, type: Number }
            : { value, type: String, ...(rowIndex === 0 ? { fontWeight: 'bold' as const } : {}) },
        ),
      ),
      columns: Array.from({ length: columnCount }, (_, column) => ({
        width: Math.min(50, Math.max(10, ...rows.map((row) => String(row[column] ?? '').length + 2))),
      })),
      stickyRowsCount: 1,
    };
  });

  return writeExcelFile(sheets).toBlob();
}
