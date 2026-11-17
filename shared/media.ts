/**
 * Existing content shown with an answer: a map or a video found by a real
 * search, never a link written by the model. The client builds the embed URL
 * from these fields only, so an answer can never point an iframe elsewhere.
 */
export type MediaItem =
  | {
      kind: 'map';
      /** The place as the geocoder names it. */
      label: string;
      lat: number;
      lon: number;
      /** West, south, east, north. */
      bbox: [number, number, number, number];
    }
  | {
      kind: 'video';
      provider: 'youtube';
      /** The YouTube video id. */
      id: string;
      title: string;
      channel: string;
    };

const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const MAX_TEXT_CHARS = 300;

function text(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim().slice(0, MAX_TEXT_CHARS) : null;
}

function inRange(value: unknown, limit: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Math.abs(value) <= limit;
}

/** Validates stored or received media; null when unusable. */
export function parseMedia(value: unknown): MediaItem | null {
  let data = value;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      return null;
    }
  }
  if (typeof data !== 'object' || data === null) return null;
  const item = data as Record<string, unknown>;

  if (item.kind === 'map') {
    const label = text(item.label);
    const { lat, lon, bbox } = item;
    if (!label || !inRange(lat, 90) || !inRange(lon, 180) || !Array.isArray(bbox) || bbox.length !== 4) return null;
    const [west, south, east, north] = bbox as unknown[];
    if (!inRange(west, 180) || !inRange(east, 180) || !inRange(south, 90) || !inRange(north, 90)) return null;
    if (west >= east || south >= north) return null;
    return { kind: 'map', label, lat, lon, bbox: [west, south, east, north] };
  }

  if (item.kind === 'video' && item.provider === 'youtube') {
    const title = text(item.title);
    if (typeof item.id !== 'string' || !YOUTUBE_ID.test(item.id) || !title) return null;
    return { kind: 'video', provider: 'youtube', id: item.id, title, channel: text(item.channel) ?? '' };
  }
  return null;
}

/** The smallest box a map shows, so a single building is not zoomed in to the last tile. */
const MIN_SPAN = 0.004;

function widened([west, south, east, north]: [number, number, number, number]): [number, number, number, number] {
  const padLon = Math.max(0, (MIN_SPAN - (east - west)) / 2);
  const padLat = Math.max(0, (MIN_SPAN - (north - south)) / 2);
  return [west - padLon, south - padLat, east + padLon, north + padLat];
}

/** OpenStreetMap's own embeddable map, with a marker on the place. */
export function mapEmbedUrl(item: Extract<MediaItem, { kind: 'map' }>): string {
  const bbox = widened(item.bbox).map((value) => value.toFixed(5)).join(',');
  return `https://www.openstreetmap.org/export/embed.html?bbox=${bbox}&layer=mapnik&marker=${item.lat.toFixed(5)},${item.lon.toFixed(5)}`;
}

/** Zoom level that roughly fits the box, for the link to the full map. */
export function mapZoom(bbox: [number, number, number, number]): number {
  const span = Math.max(bbox[2] - bbox[0], bbox[3] - bbox[1], MIN_SPAN);
  return Math.max(2, Math.min(18, Math.round(Math.log2(360 / span))));
}

export function mapLink(item: Extract<MediaItem, { kind: 'map' }>): string {
  const lat = item.lat.toFixed(5);
  const lon = item.lon.toFixed(5);
  return `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=${mapZoom(item.bbox)}/${lat}/${lon}`;
}

/**
 * The privacy-enhanced player: no cookies until the video plays. It is loaded
 * only after a tap, so opening a chat never contacts YouTube.
 */
export function videoEmbedUrl(item: Extract<MediaItem, { kind: 'video' }>): string {
  return `https://www.youtube-nocookie.com/embed/${item.id}?autoplay=1&rel=0`;
}

export function videoLink(item: Extract<MediaItem, { kind: 'video' }>): string {
  return `https://www.youtube.com/watch?v=${item.id}`;
}
