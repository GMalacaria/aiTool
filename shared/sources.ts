/**
 * Verified sources of an answer. The answer text carries Markdown links as
 * markers, which the client turns into citation links and tooltips:
 *   [n](#source-n)       the sentence is confirmed by source n of the legend;
 *   [?](#unverified)     a factual sentence that no source confirms;
 *   [?](#unreadable-n)   the cited source n could not be read, so the sentence was not checked.
 */
export type SourceItem =
  | { kind: 'web'; url: string; title: string }
  /** An attached document. */
  | { kind: 'file'; name: string };

export interface AnswerSources {
  /** Numbered in order: item 0 is [1]. */
  items: SourceItem[];
  /** False when the independent check could not run: the legend lists what was cited, with no markers. */
  verified: boolean;
}

export type Marker = { type: 'source'; n: number } | { type: 'unverified' } | { type: 'unreadable'; n: number };

const MARKER_LINK = /\[(\d+|\?)\]\(#(source-\d+|unverified|unreadable-\d+)\)/g;

export function markerHref(marker: Marker): string {
  if (marker.type === 'unverified') return '#unverified';
  return `#${marker.type}-${marker.n}`;
}

export function markerLink(marker: Marker): string {
  return `[${marker.type === 'source' ? marker.n : '?'}](${markerHref(marker)})`;
}

/** Null when `href` is not one of the marker links. */
export function parseMarkerHref(href: string | undefined): Marker | null {
  if (!href) return null;
  if (href === '#unverified') return { type: 'unverified' };
  const match = /^#(source|unreadable)-(\d+)$/.exec(href);
  if (!match) return null;
  return { type: match[1] as 'source' | 'unreadable', n: Number(match[2]) };
}

/** The answer without markers: for the model's history and for search excerpts. */
export function stripMarkers(text: string): string {
  return text.replace(MARKER_LINK, '');
}

const MAX_ITEMS = 20;
const MAX_FIELD_CHARS = 2000;

/** Validates stored or received sources; null when unusable. Only http(s) links are kept. */
export function parseSources(value: unknown): AnswerSources | null {
  let data = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) return null;
  const { items, verified } = data as { items?: unknown; verified?: unknown };
  if (!Array.isArray(items) || typeof verified !== 'boolean') return null;

  const parsed: SourceItem[] = [];
  for (const item of items.slice(0, MAX_ITEMS)) {
    const { kind, url, title, name } = (item ?? {}) as Record<string, unknown>;
    if (kind === 'web' && typeof url === 'string' && /^https?:\/\//i.test(url) && url.length <= MAX_FIELD_CHARS) {
      parsed.push({ kind, url, title: typeof title === 'string' && title.trim() ? title.slice(0, 300) : url });
    } else if (kind === 'file' && typeof name === 'string' && name.length <= 300) {
      parsed.push({ kind, name });
    } else {
      return null;
    }
  }
  return parsed.length ? { items: parsed, verified } : null;
}

/** A piece of the answer that may receive a marker, and where the marker goes. */
export interface Segment {
  text: string;
  start: number;
  /** Offset in the answer where the marker is inserted. */
  end: number;
}

const ABBREVIATION =
  /(?:^|[\s(])(?:art|artt|n|nn|nr|par|parr|pag|pagg|pp|cap|capp|lett|co|c|es|ecc|cfr|vol|fig|tab|ca|sig|sigg|dott|dr|prof|ing|avv|geom|on|sen|st|mr|mrs|ms|vs|etc|e\.g|i\.e|d\.lgs|d\.l|l|reg|dir)$/i;

const SENTENCE_END =/[.!?…](?=["»”')\]*_]*\s+["«“(*_]*[A-ZÀ-ÖØ-Þ0-9])/g;

/**
 * Splits a Markdown answer into sentences that can carry a marker: sentences
 * of paragraphs, list items and headings, and whole table rows. Code blocks and
 * table separators are skipped. Markers go right after the sentence, or before
 * the closing pipe of a table row.
 */
export function segmentAnswer(text: string): Segment[] {
  const segments: Segment[] = [];
  let inCode = false;
  let offset = 0;

  for (const line of text.split('\n')) {
    const lineStart = offset;
    offset += line.length + 1;
    const trimmed = line.trim();

    if (/^(```|~~~)/.test(trimmed)) {
      inCode = !inCode;
      continue;
    }
    if (inCode || !trimmed) continue;
    if (/^\|?\s*:?-{2,}/.test(trimmed) && /^[\s|:-]+$/.test(trimmed)) continue;

    if (trimmed.startsWith('|')) {
      const lastPipe = line.lastIndexOf('|');
      const end = lastPipe > line.indexOf('|') ? lineStart + lastPipe : lineStart + line.trimEnd().length;
      const cells = trimmed.replace(/^\||\|$/g, '').split('|').map((cell) => cell.trim());
      segments.push({ text: cells.join(' · '), start: lineStart, end });
      continue;
    }

    // Sentences inside the line.
    const content = line.trimEnd();
    let sentenceStart = 0;
    const boundaries = [...content.matchAll(SENTENCE_END)]
      .map((match) => match.index ?? 0)
      // "art. 50", "n. 3", "Dott. Rossi": an abbreviation does not end the sentence.
      .filter((index) => content[index] !== '.' || !ABBREVIATION.test(content.slice(Math.max(0, index - 12), index)))
      .map((index) => index + 1);
    for (const boundary of [...boundaries, content.length]) {
      // Closing quotes, brackets and emphasis stay with their sentence.
      let end = boundary;
      while (end < content.length && /["»”')\]*_]/.test(content[end])) end += 1;
      const raw = content.slice(sentenceStart, end);
      const plain = raw.replace(/^\s*(#{1,6}\s+|[-*+]\s+|\d+[.)]\s+|>\s*)*/, '').trim();
      if (plain.length >= 3) segments.push({ text: plain, start: lineStart + sentenceStart, end: lineStart + end });
      sentenceStart = end;
    }
  }
  return segments;
}

/** Inserts the markers at the end of their segments. `markers` is indexed like `segments`. */
export function insertMarkers(text: string, segments: Segment[], markers: (Marker[] | undefined)[]): string {
  const insertions = segments
    .map((segment, index) => ({ at: segment.end, links: (markers[index] ?? []).map(markerLink).join('') }))
    .filter((insertion) => insertion.links)
    .sort((a, b) => b.at - a.at);

  let result = text;
  for (const { at, links } of insertions) {
    // In a table row the marker sits inside the last cell.
    const before = result.slice(0, at);
    const pad = result[at] === '|' ? ' ' : '';
    result = `${before.trimEnd()}${pad === ' ' ? ' ' : ''}${links}${pad}${result.slice(at)}`;
  }
  return result;
}
