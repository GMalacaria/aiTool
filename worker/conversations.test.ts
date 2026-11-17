import { describe, expect, it } from 'vitest';
import { snippetAround } from './conversations';
import { cleanTitle } from './prompts';

describe('snippetAround', () => {
  it('returns the text around the match, without Markdown markers', () => {
    expect(snippetAround('La capitale del Portogallo è **Lisbona**.', 'lisbona')).toBe('La capitale del Portogallo è Lisbona.');
  });

  it('cuts long texts around the match and marks the cuts', () => {
    const text = `${'a'.repeat(200)} parola ${'b'.repeat(200)}`;
    const snippet = snippetAround(text, 'parola');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.endsWith('…')).toBe(true);
    expect(snippet).toContain('parola');
  });

  it('falls back to the start when the match is not found', () => {
    expect(snippetAround('Testo breve', 'assente')).toBe('Testo breve');
  });
});

describe('cleanTitle', () => {
  it.each([
    ['Capitale del Portogallo', 'Capitale del Portogallo'],
    ['"Capitale del Portogallo".', 'Capitale del Portogallo'],
    ['«Ciclo dell’acqua»', 'Ciclo dell’acqua'],
    ['**Equazione di primo grado**', 'Equazione di primo grado'],
    ['Titolo\nSpiegazione inutile', 'Titolo'],
  ])('cleans %j', (reply, expected) => {
    expect(cleanTitle(reply)).toBe(expected);
  });

  it('shortens long titles and rejects unusable ones', () => {
    expect(cleanTitle('parola '.repeat(9))?.length).toBeLessThanOrEqual(40);
    expect(cleanTitle('  ')).toBeNull();
    expect(cleanTitle('x'.repeat(200))).toBeNull();
  });
});
