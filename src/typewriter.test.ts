import { describe, expect, it } from 'vitest';
import { safeCut } from './typewriter';

describe('safeCut', () => {
  it('leaves plain text alone', () => {
    expect(safeCut('Una risposta semplice.', 6)).toBe(6);
  });

  it('never stops inside a link or a source marker', () => {
    const text = 'Roma è la capitale[1](#source-1) d’Italia.';
    const start = text.indexOf('[1]');
    expect(safeCut(text, start + 2)).toBe(text.indexOf(')') + 1);
    expect(safeCut(text, start)).toBe(start);
  });

  it('shows a Mermaid block whole, also when it is not closed yet', () => {
    const text = 'Ecco:\n```mermaid\ngraph TD\nA-->B\n```\nFine';
    expect(safeCut(text, 20)).toBe(text.indexOf('```\nFine') + 3);
    const open = 'Ecco:\n```mermaid\ngraph TD';
    expect(safeCut(open, 10)).toBe(open.length);
  });

  it('opens a copy card at once but types its text', () => {
    const text = 'Ecco:\n```copy\nCiao Marco, ti scrivo per…\n```\nFine';
    const opened = text.indexOf('Ciao');
    expect(safeCut(text, 9)).toBe(opened);
    expect(safeCut(text, opened + 5)).toBe(opened + 5);
  });

  it('returns the full length at the end', () => {
    expect(safeCut('abc', 3)).toBe(3);
  });
});
