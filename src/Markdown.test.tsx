import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const render = (text: string) => renderToStaticMarkup(<Markdown text={text} />);

describe('Markdown', () => {
  it('renders tables, lists, bold and code blocks', () => {
    const html = render(
      ['| Voce | Costo |', '| --- | --- |', '| Affitto | 800 |', '', '- uno', '- due', '', '**importante**', '', '```', 'A -> B', '```'].join('\n'),
    );

    expect(html).toContain('<div class="md-table"><table>');
    expect(html).toContain('<th>Voce</th>');
    expect(html).toContain('<td>800</td>');
    expect(html).toContain('<ul>');
    expect(html).toContain('<strong>importante</strong>');
    expect(html).toContain('<pre><code>A -&gt; B');
  });

  it('keeps the answer headings below the "Risposta" label', () => {
    const html = render('# Uno\n\n## Due\n\n#### Quattro');
    expect(html).not.toMatch(/<h1|<h2/);
    expect(html).toContain('<h3>Uno</h3>');
    expect(html).toContain('<h4>Quattro</h4>');
  });

  it('ignores raw HTML', () => {
    const html = render('Ciao <script>alert(1)</script> <img src=x onerror=alert(1)> <b onclick="x()">grassetto</b>');
    expect(html).not.toContain('<script');
    expect(html).not.toContain('onerror');
    expect(html).not.toContain('onclick');
    expect(html).not.toContain('<img');
  });

  it('opens links safely and drops unsafe protocols', () => {
    const html = render('[sito](https://example.com) e [trucco](javascript:alert(1))');
    expect(html).toContain('href="https://example.com"');
    expect(html).toContain('target="_blank"');
    expect(html).toContain('rel="noopener noreferrer"');
    expect(html).not.toContain('javascript:');
  });

  it('does not load images, only shows their description', () => {
    const html = render('![Grafico](https://tracker.example/pixel.png) e ![](https://tracker.example/x.png)');
    expect(html).not.toContain('<img');
    expect(html).not.toContain('tracker.example');
    expect(html).toContain('<span class="md-image-alt">Grafico</span>');
  });
});
