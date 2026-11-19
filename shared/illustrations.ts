/**
 * Pictures from Wikimedia Commons shown with an explanation. Every file there
 * has a free licence or is in the public domain; it is shown with its author
 * and licence and links to its page. Addresses come from the Commons API and
 * are checked against the Wikimedia hosts: never from the model.
 */
export interface Illustration {
  /** Thumbnail address on a Wikimedia image host. */
  src: string;
  /** The file's page on Commons (author, licence, full size). */
  page: string;
  /** What the picture shows, in Italian, written for this answer. */
  caption: string;
  author: string;
  license: string;
  width: number;
  height: number;
}

export const MAX_ILLUSTRATIONS = 3;
const MAX_TEXT_CHARS = 300;
const MAX_URL_CHARS = 2000;
const IMAGE_HOSTS = new Set(['upload.wikimedia.org', 'thumb.wikimedia.org']);

export function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' && IMAGE_HOSTS.has(url.hostname) && value.length <= MAX_URL_CHARS;
  } catch {
    return false;
  }
}

export function isCommonsPage(value: string): boolean {
  try {
    const url = new URL(value);
    return (
      url.protocol === 'https:' &&
      url.hostname === 'commons.wikimedia.org' &&
      url.pathname.startsWith('/wiki/File:') &&
      value.length <= MAX_URL_CHARS
    );
  } catch {
    return false;
  }
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT_CHARS) : null;
}

function size(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 10_000 ? value : null;
}

/** Validates stored or received pictures; null when there is nothing usable. */
export function parseIllustrations(value: unknown): Illustration[] | null {
  let data = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (!Array.isArray(data)) return null;

  const items: Illustration[] = [];
  for (const item of data.slice(0, MAX_ILLUSTRATIONS)) {
    const { src, page, caption, author, license, width, height } = (item ?? {}) as Record<string, unknown>;
    const fields = { caption: text(caption), license: text(license), width: size(width), height: size(height) };
    if (typeof src !== 'string' || !isImageUrl(src) || typeof page !== 'string' || !isCommonsPage(page)) continue;
    if (!fields.caption || !fields.license || !fields.width || !fields.height) continue;
    items.push({
      src,
      page,
      caption: fields.caption,
      author: text(author) ?? '',
      license: fields.license,
      width: fields.width,
      height: fields.height,
    });
  }
  return items.length ? items : null;
}
