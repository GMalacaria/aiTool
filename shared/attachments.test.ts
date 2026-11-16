import { describe, expect, it } from 'vitest';
import {
  ATTACHMENT_LIMITS,
  EMPTY_ATTACHMENTS,
  parseAttachments,
  parseStoredAttachments,
  toStored,
} from './attachments';

const IMAGE = 'data:image/jpeg;base64,AAAA';

describe('parseAttachments', () => {
  it('treats missing attachments as none', () => {
    expect(parseAttachments(undefined)).toEqual(EMPTY_ATTACHMENTS);
    expect(parseAttachments(null)).toEqual(EMPTY_ATTACHMENTS);
    expect(parseAttachments({})).toEqual(EMPTY_ATTACHMENTS);
  });

  it('accepts documents and images, cleaning the names', () => {
    expect(
      parseAttachments({
        documents: [{ name: ' report "final" <1>.pdf ', text: ' Body ' }],
        images: [{ dataUrl: IMAGE }],
      }),
    ).toEqual({
      documents: [{ name: 'report  final   1 .pdf', text: 'Body' }],
      images: [{ name: 'immagine', dataUrl: IMAGE }],
    });
  });

  it.each([
    ['a non-object', 'x'],
    ['documents that are not a list', { documents: 'x' }],
    ['too many documents', { documents: Array(ATTACHMENT_LIMITS.documents + 1).fill({ name: 'a', text: 'b' }) }],
    ['too many images', { images: Array(ATTACHMENT_LIMITS.images + 1).fill({ name: 'a', dataUrl: IMAGE }) }],
    ['an empty document', { documents: [{ name: 'a', text: '  ' }] }],
    ['a document that is too long', { documents: [{ name: 'a', text: 'x'.repeat(ATTACHMENT_LIMITS.documentChars + 1) }] }],
    ['a remote image URL', { images: [{ name: 'a', dataUrl: 'https://example.com/a.png' }] }],
    ['a non-image data URL', { images: [{ name: 'a', dataUrl: 'data:text/html;base64,AAAA' }] }],
    ['an SVG image', { images: [{ name: 'a', dataUrl: 'data:image/svg+xml;base64,AAAA' }] }],
    ['malformed base64', { images: [{ name: 'a', dataUrl: 'data:image/png;base64,<script>' }] }],
    ['an oversized image', { images: [{ name: 'a', dataUrl: `data:image/png;base64,${'A'.repeat(ATTACHMENT_LIMITS.imageDataUrlChars)}` }] }],
  ])('rejects %s', (_label, value) => {
    expect(parseAttachments(value)).toBeNull();
  });
});

describe('stored attachments', () => {
  it('keeps document text and only the names of images', () => {
    const stored = toStored({ documents: [{ name: 'a.pdf', text: 'Body' }], images: [{ name: 'p.jpg', dataUrl: IMAGE }] });
    expect(stored).toEqual({ documents: [{ name: 'a.pdf', text: 'Body' }], images: ['p.jpg'] });
    expect(JSON.stringify(stored)).not.toContain('base64');
    expect(parseStoredAttachments(JSON.stringify(stored))).toEqual(stored);
  });

  it('returns null for nothing, empty or broken data', () => {
    expect(parseStoredAttachments(null)).toBeNull();
    expect(parseStoredAttachments('{"documents":[],"images":[]}')).toBeNull();
    expect(parseStoredAttachments('not json')).toBeNull();
  });
});
