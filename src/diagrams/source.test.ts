import { describe, expect, it } from 'vitest';
import { cleanDiagramSource, isSafeDiagramSource } from './source';

describe('cleanDiagramSource', () => {
  it('keeps a plain diagram', () => {
    expect(cleanDiagramSource('flowchart TD\r\n  A["Inizio"] --> B["Fine"]\n')).toBe('flowchart TD\n  A["Inizio"] --> B["Fine"]');
  });

  it('removes init directives, also across lines', () => {
    const source = '%%{init: {"themeCSS": "@import url(https://tracker.example/x.css)"}}%%\nflowchart TD\n%%{\n  init: {"theme": "dark"}\n}%%\n  A --> B';
    const cleaned = cleanDiagramSource(source);
    expect(cleaned).not.toContain('%%{');
    expect(cleaned).not.toContain('tracker.example');
    expect(cleaned).toContain('flowchart TD');
    expect(cleaned).toContain('A --> B');
  });

  it('removes front matter configuration', () => {
    const source = '---\ntitle: Prova\nconfig:\n  themeCSS: "x"\n---\nflowchart LR\n  A --> B';
    expect(cleanDiagramSource(source)).toBe('flowchart LR\n  A --> B');
  });

  it('keeps ordinary comments', () => {
    expect(cleanDiagramSource('flowchart TD\n%% nota\n  A --> B')).toBe('flowchart TD\n%% nota\n  A --> B');
  });
});

describe('isSafeDiagramSource', () => {
  it('refuses nodes that load a picture', () => {
    expect(isSafeDiagramSource('flowchart TD\n  A@{ img: "https://example.com/x.png", label: "x" } --> B')).toBe(false);
    expect(isSafeDiagramSource('flowchart TD\n  A@{ shape: rect, IMG : "x" }')).toBe(false);
  });

  it('accepts ordinary diagrams, also with addresses in the labels', () => {
    expect(isSafeDiagramSource('flowchart TD\n  A@{ shape: diamond, label: "Scelta" } --> B["Vai su https://www.inps.it"]')).toBe(true);
  });
});
