// Loaded on demand (dynamic import): pdfmake and its fonts are heavy.
import pdfMake from 'pdfmake/build/pdfmake';
import vfs from 'pdfmake/build/vfs_fonts';
import type { Content, TDocumentDefinitions } from 'pdfmake/interfaces';
import { hasTabularData, isNumericColumn, type DocumentBlock, type DocumentSpec } from '../../shared/document';
import { renderDiagramPng, type DiagramImage } from '../diagrams/render';
import { chartSvg, formatNumber } from './chart';
import { DATA_DISCLAIMER } from './files';

pdfMake.addVirtualFileSystem(vfs);

const TEXT_COLOR = '#1a1a1a';
const MUTED_COLOR = '#5c5c5c';
const OPTION_LETTERS = 'abcdefgh';
/** A4 width minus the margins, and the tallest a diagram may be, in points. */
const CONTENT_WIDTH = 499;
const MAX_DIAGRAM_HEIGHT = 640;
const POINTS_PER_PIXEL = 0.75;

export type DiagramImages = Map<DocumentBlock, DiagramImage | null>;

/** Diagram size in the PDF: its natural size, shrunk to fit the page. */
export function diagramSize(image: Pick<DiagramImage, 'width' | 'height'>): { width: number; height: number } {
  const width = image.width * POINTS_PER_PIXEL;
  const height = image.height * POINTS_PER_PIXEL;
  const scale = Math.min(1, CONTENT_WIDTH / width, MAX_DIAGRAM_HEIGHT / height);
  return { width: width * scale, height: height * scale };
}

export function buildDefinition(
  document: DocumentSpec,
  now: Date = new Date(),
  diagrams: DiagramImages = new Map(),
): TDocumentDefinitions {
  const content: Content[] = [
    { text: document.title, style: 'title' },
    { text: new Intl.DateTimeFormat('it-IT', { dateStyle: 'long' }).format(now), style: 'muted', margin: [0, 0, 0, 12] },
  ];

  if (!document.dataProvidedByUser && hasTabularData(document)) {
    content.push({ text: DATA_DISCLAIMER, style: 'muted', italics: true, margin: [0, 0, 0, 12] });
  }

  const solutions: Content[] = [];
  let questionNumber = 0;

  for (const block of document.blocks) {
    switch (block.type) {
      case 'heading':
        content.push({ text: block.text, style: 'heading' });
        break;
      case 'paragraph':
        content.push({ text: block.text, margin: [0, 0, 0, 8] });
        break;
      case 'list':
        content.push(
          block.ordered
            ? { ol: block.items, margin: [0, 0, 0, 8] }
            : { ul: block.items, margin: [0, 0, 0, 8] },
        );
        break;
      case 'table':
        if (block.title) content.push({ text: block.title, style: 'caption' });
        content.push({
          table: {
            headerRows: 1,
            widths: block.columns.map(() => '*'),
            body: [
              block.columns.map((column, index) => ({
                text: column,
                bold: true,
                alignment: isNumericColumn(block.rows, index) ? ('right' as const) : ('left' as const),
              })),
              ...block.rows.map((row) =>
                row.map((cell) =>
                  typeof cell === 'number' ? { text: formatNumber(cell), alignment: 'right' as const } : { text: cell },
                ),
              ),
            ],
          },
          layout: 'lightHorizontalLines',
          margin: [0, 0, 0, 12],
        });
        break;
      case 'chart':
        content.push({
          // Keep the caption and the chart on the same page.
          unbreakable: true,
          stack: [
            ...(block.title ? [{ text: block.title, style: 'caption' }] : []),
            { svg: chartSvg(block, { textColor: TEXT_COLOR, gridColor: '#d9d9d9', fontFamily: 'Roboto' }), width: 500 },
          ],
          margin: [0, 0, 0, 12],
        });
        break;
      case 'diagram': {
        const image = diagrams.get(block);
        content.push({
          unbreakable: true,
          stack: [
            ...(block.title ? [{ text: block.title, style: 'caption' }] : []),
            image
              ? { image: image.dataUrl, ...diagramSize(image), alignment: 'center' as const }
              : { text: 'Schema non disponibile in questo file.', style: 'muted', italics: true },
          ],
          margin: [0, 0, 0, 12],
        });
        break;
      }
      case 'quiz':
        for (const question of block.questions) {
          questionNumber += 1;
          content.push({
            unbreakable: true,
            stack: [
              { text: `${questionNumber}. ${question.question}`, bold: true, margin: [0, 0, 0, 4] },
              ...(question.options.length
                ? question.options.map((option, index) => ({
                    text: `${OPTION_LETTERS[index] ?? '-'}) ${option}`,
                    margin: [14, 0, 0, 2] as [number, number, number, number],
                  }))
                : // Blank lines to write the answer on.
                  [{ text: '\n\n', margin: [0, 0, 0, 0] as [number, number, number, number] }]),
            ],
            margin: [0, 0, 0, 10],
          });

          if (question.answer) {
            const optionIndex = question.options.indexOf(question.answer);
            const letter = optionIndex >= 0 ? `${OPTION_LETTERS[optionIndex]}) ` : '';
            solutions.push({ text: `${questionNumber}. ${letter}${question.answer}`, margin: [0, 0, 0, 4] });
          }
        }
        break;
    }
  }

  if (solutions.length) {
    content.push({ text: 'Soluzioni', style: 'heading', pageBreak: 'before' }, ...solutions);
  }

  return {
    info: { title: document.title },
    pageSize: 'A4',
    pageMargins: [48, 56, 48, 56],
    content,
    footer: (currentPage, pageCount) => ({
      text: `Pagina ${currentPage} di ${pageCount}`,
      alignment: 'center',
      fontSize: 9,
      color: MUTED_COLOR,
      margin: [0, 20, 0, 0],
    }),
    defaultStyle: { fontSize: 11, lineHeight: 1.25, color: TEXT_COLOR },
    styles: {
      title: { fontSize: 20, bold: true, margin: [0, 0, 0, 4] },
      heading: { fontSize: 14, bold: true, margin: [0, 10, 0, 6] },
      caption: { bold: true, margin: [0, 4, 0, 4] },
      muted: { fontSize: 9, color: MUTED_COLOR },
    },
  };
}

/** Draws every diagram as a picture first; one that cannot be drawn is noted in the file. */
async function drawDiagrams(document: DocumentSpec): Promise<DiagramImages> {
  const images: DiagramImages = new Map();
  for (const block of document.blocks) {
    if (block.type !== 'diagram') continue;
    try {
      images.set(block, await renderDiagramPng(block.code));
    } catch (error) {
      console.warn('Diagram not drawn in the PDF', error);
      images.set(block, null);
    }
  }
  return images;
}

export async function createPdf(document: DocumentSpec): Promise<Blob> {
  return pdfMake.createPdf(buildDefinition(document, new Date(), await drawDiagrams(document))).getBlob();
}
