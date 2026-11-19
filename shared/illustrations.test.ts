import { describe, expect, it } from 'vitest';
import { parseIllustrations, type Illustration } from './illustrations';

const item: Illustration = {
  src: 'https://upload.wikimedia.org/wikipedia/commons/d/d0/Heart_diagram.jpg',
  page: 'https://commons.wikimedia.org/wiki/File:Heart_diagram.jpg',
  caption: 'Schema del cuore',
  author: 'Alishan Khan',
  license: 'CC BY-SA 4.0',
  width: 800,
  height: 600,
};

describe('parseIllustrations', () => {
  it('accepts pictures on Wikimedia hosts, also as stored JSON', () => {
    expect(parseIllustrations([item])).toEqual([item]);
    expect(parseIllustrations(JSON.stringify([item]))).toEqual([item]);
  });

  it.each([
    ['another image host', { ...item, src: 'https://evil.example/x.jpg' }],
    ['a look-alike host', { ...item, src: 'https://upload.wikimedia.org.evil.example/x.jpg' }],
    ['plain http', { ...item, src: 'http://upload.wikimedia.org/x.jpg' }],
    ['a page outside Commons files', { ...item, page: 'https://commons.wikimedia.org/wiki/Special:Search' }],
    ['a missing licence', { ...item, license: '' }],
    ['a bad size', { ...item, width: -1 }],
  ])('drops %s', (_name, bad) => {
    expect(parseIllustrations([bad])).toBeNull();
  });

  it('keeps the good ones and at most three', () => {
    const list = [{ ...item, src: 'javascript:alert(1)' }, ...Array.from({ length: 4 }, (_, n) => ({ ...item, caption: `c${n}` }))];
    expect(parseIllustrations(list)?.map((entry) => entry.caption)).toEqual(['c0', 'c1']);
  });
});
