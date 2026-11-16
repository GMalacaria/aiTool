// Loaded on demand (dynamic import): pdf.js is heavy.
import { getDocument, GlobalWorkerOptions } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import { ATTACHMENT_LIMITS } from '../../shared/attachments';
import { canvasToDataUrl, fitWithin } from './image';

GlobalWorkerOptions.workerSrc = workerUrl;

/** Below this average, the pages are treated as scans (pictures of text). */
const MIN_TEXT_CHARS_PER_PAGE = 40;

export type PdfContent =
  | { kind: 'text'; text: string; pages: number; readPages: number; truncated: boolean }
  | { kind: 'scan'; images: string[]; pages: number; readPages: number };

export async function readPdf(file: File): Promise<PdfContent> {
  const loading = getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const pdf = await loading.promise;

  try {
    const pages = pdf.numPages;
    const textPages = Math.min(pages, ATTACHMENT_LIMITS.pdfTextPages);
    const parts: string[] = [];

    for (let number = 1; number <= textPages; number++) {
      const page = await pdf.getPage(number);
      const content = await page.getTextContent();
      const text = content.items
        .map((item) => ('str' in item ? item.str + (item.hasEOL ? '\n' : ' ') : ''))
        .join('')
        .replace(/[ \t]+\n/g, '\n')
        .trim();
      if (text) parts.push(text);
    }

    const fullText = parts.join('\n\n');
    if (fullText.length >= MIN_TEXT_CHARS_PER_PAGE * textPages) {
      const truncated = fullText.length > ATTACHMENT_LIMITS.documentChars || textPages < pages;
      return {
        kind: 'text',
        text: fullText.slice(0, ATTACHMENT_LIMITS.documentChars),
        pages,
        readPages: textPages,
        truncated,
      };
    }

    // Scanned document: send the first pages as images.
    const scannedPages = Math.min(pages, ATTACHMENT_LIMITS.pdfScannedPages);
    const images: string[] = [];
    for (let number = 1; number <= scannedPages; number++) {
      const page = await pdf.getPage(number);
      const base = page.getViewport({ scale: 1 });
      const size = fitWithin(base.width * 2, base.height * 2, ATTACHMENT_LIMITS.imageMaxSide);
      const viewport = page.getViewport({ scale: size.width / base.width });

      const canvas = document.createElement('canvas');
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      const canvasContext = canvas.getContext('2d');
      if (!canvasContext) throw new Error('canvas not available');
      canvasContext.fillStyle = '#ffffff';
      canvasContext.fillRect(0, 0, canvas.width, canvas.height);

      // 'print' intent renders without waiting for animation frames, so it also
      // completes while the tab is in the background.
      await page.render({ canvas, canvasContext, viewport, intent: 'print' }).promise;
      images.push(canvasToDataUrl(canvas));
    }
    return { kind: 'scan', images, pages, readPages: scannedPages };
  } finally {
    await loading.destroy();
  }
}
