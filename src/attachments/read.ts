import { ATTACHMENT_LIMITS, type Attachments } from '../../shared/attachments';
import { imageFileToDataUrl } from './image';

export interface ReadResult {
  attachments: Attachments;
  /** Italian, user-facing notes about what was skipped or cut. */
  notes: string[];
}

const isPdf = (file: File) => file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
const isImage = (file: File) => file.type.startsWith('image/');

/**
 * Adds the chosen files to the current attachments. Everything happens on the
 * device: PDFs become text (or page images when scanned), images are downscaled.
 */
export async function addFiles(current: Attachments, files: File[]): Promise<ReadResult> {
  const documents = [...current.documents];
  const images = [...current.images];
  const notes: string[] = [];
  const L = ATTACHMENT_LIMITS;

  const addImage = (name: string, dataUrl: string): boolean => {
    if (images.length >= L.images || dataUrl.length > L.imageDataUrlChars) return false;
    images.push({ name, dataUrl });
    return true;
  };

  for (const file of files) {
    try {
      if (isPdf(file)) {
        // pdf.js is loaded only when a PDF is attached.
        const content = await (await import('./pdf')).readPdf(file);

        if (content.kind === 'text') {
          if (documents.length >= L.documents) {
            notes.push(`«${file.name}» non aggiunto: al massimo ${L.documents} documenti per messaggio.`);
            continue;
          }
          documents.push({ name: file.name, text: content.text });
          if (content.truncated) {
            notes.push(
              content.readPages < content.pages
                ? `«${file.name}»: lette solo le prime ${content.readPages} pagine su ${content.pages}.`
                : `«${file.name}»: testo troppo lungo, ne è stata letta solo la prima parte.`,
            );
          }
        } else {
          const added = content.images.filter((dataUrl, index) => addImage(`${file.name} — pagina ${index + 1}`, dataUrl));
          if (added.length === 0) {
            notes.push(`«${file.name}» non aggiunto: al massimo ${L.images} immagini per messaggio.`);
          } else if (added.length < content.pages) {
            notes.push(
              `«${file.name}» è un documento scansionato: lette come immagini solo le prime ${added.length} pagine su ${content.pages}.`,
            );
          }
        }
      } else if (isImage(file)) {
        if (!addImage(file.name, await imageFileToDataUrl(file))) {
          notes.push(`«${file.name}» non aggiunta: al massimo ${L.images} immagini per messaggio.`);
        }
      } else {
        notes.push(`«${file.name}» non aggiunto: sono accettati solo immagini e PDF.`);
      }
    } catch (error) {
      console.error(error);
      notes.push(`«${file.name}» non leggibile (file danneggiato o protetto da password).`);
    }
  }

  return { attachments: { documents, images }, notes };
}
