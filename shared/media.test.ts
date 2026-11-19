import { describe, expect, it } from 'vitest';
import { mapEmbedUrl, mapLink, mapZoom, parseMedia, videoEmbedUrl, videoLink, type MediaItem } from './media';

const map: MediaItem = { kind: 'map', label: 'Roma, Lazio, Italia', lat: 41.8933, lon: 12.4829, bbox: [12.23, 41.65, 12.85, 42.14] };
const video: MediaItem = { kind: 'video', provider: 'youtube', id: 'dQw4w9WgXcQ', title: 'Il Colosseo', channel: 'Canale' };

describe('parseMedia', () => {
  it('accepts a valid map and video, also as stored JSON', () => {
    expect(parseMedia(map)).toEqual(map);
    expect(parseMedia(JSON.stringify(video))).toEqual(video);
  });

  it.each([
    ['a video id that could change the URL', { ...video, id: '../../evil' }],
    ['a video id of the wrong length', { ...video, id: 'abc' }],
    ['another video provider', { ...video, provider: 'vimeo' }],
    ['a video without title', { ...video, title: ' ' }],
    ['a latitude out of range', { ...map, lat: 91 }],
    ['coordinates as strings', { ...map, lon: '12' }],
    ['an inverted box', { ...map, bbox: [12.85, 41.65, 12.23, 42.14] }],
    ['a box with three values', { ...map, bbox: [1, 2, 3] }],
    ['an unknown kind', { kind: 'iframe', url: 'https://example.com' }],
    ['broken JSON', '{'],
    ['null', null],
  ])('rejects %s', (_name, value) => {
    expect(parseMedia(value)).toBeNull();
  });

  it('cuts very long labels', () => {
    expect((parseMedia({ ...map, label: 'x'.repeat(1000) }) as { label: string }).label).toHaveLength(300);
  });
});

describe('embed URLs', () => {
  it('builds the OpenStreetMap embed with a marker and the full-map link', () => {
    expect(mapEmbedUrl(map as Extract<MediaItem, { kind: 'map' }>)).toBe(
      'https://www.openstreetmap.org/export/embed.html?bbox=12.23000,41.65000,12.85000,42.14000&layer=mapnik&marker=41.89330,12.48290',
    );
    expect(mapLink(map as Extract<MediaItem, { kind: 'map' }>)).toBe(
      'https://www.openstreetmap.org/?mlat=41.89330&mlon=12.48290#map=9/41.89330/12.48290',
    );
  });

  it('widens the box of a single building so the map is not zoomed in to the last tile', () => {
    const building = { ...map, bbox: [12.4920, 41.8900, 12.4930, 41.8905] } as Extract<MediaItem, { kind: 'map' }>;
    const bbox = new URL(mapEmbedUrl(building)).searchParams.get('bbox')?.split(',').map(Number) ?? [];
    expect(bbox[2] - bbox[0]).toBeCloseTo(0.004, 5);
    expect(bbox[3] - bbox[1]).toBeCloseTo(0.004, 5);
    expect(mapZoom(building.bbox)).toBe(16);
  });

  it('uses the privacy-enhanced YouTube player', () => {
    const item = video as Extract<MediaItem, { kind: 'video' }>;
    expect(videoEmbedUrl(item)).toBe('https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?autoplay=1&rel=0');
    expect(videoLink(item)).toBe('https://www.youtube.com/watch?v=dQw4w9WgXcQ');
  });
});
