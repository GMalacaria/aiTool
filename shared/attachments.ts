/**
 * Files attached to a question. The browser turns them into extracted text
 * (PDFs) or downscaled images before sending; original files never leave the
 * device. Used by both the Worker and the frontend.
 */
export interface DocumentAttachment {
  name: string;
  /** Text extracted from the file. */
  text: string;
}

export interface ImageAttachment {
  name: string;
  /** `data:image/...;base64,...` */
  dataUrl: string;
}

export interface Attachments {
  documents: DocumentAttachment[];
  images: ImageAttachment[];
}

/** An attached image as kept with the message: the file is in R2 under `id`. */
export interface StoredImage {
  name: string;
  /** Absent for messages from before attached images were stored. */
  id?: string;
  mimeType?: string;
}

/** What is kept with the conversation: document text, and the attached images (files in R2). */
export interface StoredAttachments {
  documents: DocumentAttachment[];
  images: StoredImage[];
}

/** What the client needs to show a message's attachments. */
export interface AttachmentNames {
  documents: string[];
  images: string[];
  /** Where to load each image from (same order as `images`), when it is available. */
  imageUrls?: (string | null)[];
}

export const ATTACHMENT_LIMITS = {
  documents: 3,
  documentChars: 60_000,
  images: 5,
  /** ~1.5 MB of image data once base64-decoded. */
  imageDataUrlChars: 2_000_000,
  nameChars: 120,
  /** PDF pages read as text, and pages of a scanned PDF turned into images. */
  pdfTextPages: 30,
  pdfScannedPages: 5,
  /** Longest side of an image sent to the model, in pixels. */
  imageMaxSide: 1568,
} as const;

export const EMPTY_ATTACHMENTS: Attachments = { documents: [], images: [] };

const IMAGE_DATA_URL = /^data:image\/(?:jpeg|png|webp);base64,[A-Za-z0-9+/]+=*$/;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function name(value: unknown, fallback: string): string {
  const cleaned = typeof value === 'string' ? value.replace(/[\u0000-\u001f<>"]/g, ' ').trim() : '';
  return cleaned.slice(0, ATTACHMENT_LIMITS.nameChars) || fallback;
}

/**
 * Validates the attachments of a chat request. Missing attachments are fine;
 * anything malformed or over the limits makes the whole request invalid (null),
 * so the user is never answered about a silently dropped file.
 */
export function parseAttachments(value: unknown): Attachments | null {
  if (value === undefined || value === null) return EMPTY_ATTACHMENTS;
  if (!isObject(value)) return null;

  const rawDocuments = value.documents ?? [];
  const rawImages = value.images ?? [];
  if (!Array.isArray(rawDocuments) || !Array.isArray(rawImages)) return null;
  if (rawDocuments.length > ATTACHMENT_LIMITS.documents || rawImages.length > ATTACHMENT_LIMITS.images) return null;

  const documents: DocumentAttachment[] = [];
  for (const entry of rawDocuments) {
    if (!isObject(entry) || typeof entry.text !== 'string') return null;
    const text = entry.text.trim();
    if (!text || text.length > ATTACHMENT_LIMITS.documentChars) return null;
    documents.push({ name: name(entry.name, 'documento'), text });
  }

  const images: ImageAttachment[] = [];
  for (const entry of rawImages) {
    if (!isObject(entry) || typeof entry.dataUrl !== 'string') return null;
    if (entry.dataUrl.length > ATTACHMENT_LIMITS.imageDataUrlChars || !IMAGE_DATA_URL.test(entry.dataUrl)) return null;
    images.push({ name: name(entry.name, 'immagine'), dataUrl: entry.dataUrl });
  }

  return { documents, images };
}

export function hasAttachments(attachments: Attachments | StoredAttachments | AttachmentNames): boolean {
  return attachments.documents.length > 0 || attachments.images.length > 0;
}

/** `imageFiles` are the R2 entries of the attached images, in the same order. */
export function toStored(attachments: Attachments, imageFiles: { id: string; mimeType: string }[] = []): StoredAttachments {
  return {
    documents: attachments.documents,
    images: attachments.images.map((image, index) => ({ name: image.name, ...imageFiles[index] })),
  };
}

/** Splits a base64 data URL into its MIME type and base64 payload. */
export function splitDataUrl(dataUrl: string): { mimeType: string; data: string } | null {
  const match = /^data:([^;,]+);base64,(.*)$/s.exec(dataUrl);
  return match ? { mimeType: match[1], data: match[2] } : null;
}

/** Reads back what was stored with a message; tolerant, because it is our own data. */
export function parseStoredAttachments(json: string | null): StoredAttachments | null {
  if (!json) return null;
  try {
    const value: unknown = JSON.parse(json);
    if (!isObject(value)) return null;

    const documents = (Array.isArray(value.documents) ? value.documents : [])
      .filter(isObject)
      .filter((entry): entry is { name: string; text: string } & Record<string, unknown> =>
        typeof entry.name === 'string' && typeof entry.text === 'string',
      )
      .map((entry) => ({ name: entry.name, text: entry.text }));
    // Older messages stored only the names.
    const images = (Array.isArray(value.images) ? value.images : []).flatMap((entry): StoredImage[] => {
      if (typeof entry === 'string') return [{ name: entry }];
      if (!isObject(entry) || typeof entry.name !== 'string') return [];
      return [
        {
          name: entry.name,
          ...(typeof entry.id === 'string' ? { id: entry.id } : {}),
          ...(typeof entry.mimeType === 'string' ? { mimeType: entry.mimeType } : {}),
        },
      ];
    });

    const stored = { documents, images };
    return hasAttachments(stored) ? stored : null;
  } catch {
    return null;
  }
}
