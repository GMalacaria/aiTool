// Mermaid is large: it is loaded only when an answer or a document holds a diagram.
import { cleanDiagramSource, isSafeDiagramSource, MAX_DIAGRAM_SOURCE_CHARS } from './source';

export type DiagramScheme = 'light' | 'dark';

const FONT_FAMILY = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

/** The app's light-blue palette (see the tokens in index.css). */
const THEMES: Record<DiagramScheme, Record<string, string | boolean>> = {
  light: {
    darkMode: false,
    background: '#ffffff',
    primaryColor: '#e8f3fc',
    primaryBorderColor: '#1a70ad',
    primaryTextColor: '#10202e',
    secondaryColor: '#fdf1e3',
    tertiaryColor: '#eef7f0',
    lineColor: '#4d6478',
    textColor: '#10202e',
    noteBkgColor: '#fff8d6',
    noteTextColor: '#10202e',
  },
  dark: {
    darkMode: true,
    background: '#0d1620',
    primaryColor: '#1b2d40',
    primaryBorderColor: '#7cc4f5',
    primaryTextColor: '#e4eef7',
    secondaryColor: '#3a2a1a',
    tertiaryColor: '#1a3326',
    lineColor: '#9cb3c6',
    textColor: '#e4eef7',
    noteBkgColor: '#3d3514',
    noteTextColor: '#e4eef7',
  },
};

/** Configuration keys a diagram can never override, whatever its source says. */
const SECURE_KEYS = [
  'secure',
  'securityLevel',
  'startOnLoad',
  'maxTextSize',
  'maxEdges',
  'suppressErrorRendering',
  'theme',
  'themeVariables',
  'themeCSS',
  'darkMode',
  'fontFamily',
  'altFontFamily',
  'htmlLabels',
];

// Mermaid's configuration is global: renders run one at a time so that two
// diagrams drawn at once cannot swap their themes.
let queue: Promise<unknown> = Promise.resolve();
let counter = 0;

/**
 * Draws a Mermaid diagram and returns its SVG markup, safe to insert in the page.
 * Rejects when the source is not a valid diagram.
 */
export function renderDiagram(code: string, scheme: DiagramScheme): Promise<string> {
  const run = async () => {
    const source = cleanDiagramSource(code);
    if (!source || source.length > MAX_DIAGRAM_SOURCE_CHARS) throw new Error('diagram source missing or too long');
    if (!isSafeDiagramSource(source)) throw new Error('diagram source loads remote images');

    const { default: mermaid } = await import('mermaid');
    mermaid.initialize({
      startOnLoad: false,
      // Strict: no click handlers or scripts, labels sanitised by Mermaid itself.
      securityLevel: 'strict',
      suppressErrorRendering: true,
      maxTextSize: MAX_DIAGRAM_SOURCE_CHARS,
      maxEdges: 200,
      // SVG text instead of HTML labels: they can be drawn on a canvas for the PDF.
      htmlLabels: false,
      flowchart: { htmlLabels: false, useMaxWidth: true },
      theme: 'base',
      themeVariables: { ...THEMES[scheme], fontFamily: FONT_FAMILY },
      fontFamily: FONT_FAMILY,
      secure: SECURE_KEYS,
    });
    counter += 1;
    const { svg } = await mermaid.render(`kern-diagram-${counter}`, source);
    return sanitizeSvg(svg);
  };
  const result = queue.then(run, run);
  queue = result.catch(() => undefined);
  return result;
}

const REMOVED_ELEMENTS = new Set(['script', 'img', 'image', 'iframe', 'object', 'embed', 'audio', 'video', 'link', 'meta']);
const LINK_ATTRIBUTES = new Set(['href', 'xlink:href', 'src', 'srcset', 'action', 'formaction']);
/** Any url(…) that does not point inside the document, e.g. url(#arrowhead). */
const REMOTE_URL = /url\(\s*(?!['"]?#)[^)]*\)/gi;

function cleanCss(css: string): string {
  return css.replace(/@import[^;]*;?/gi, '').replace(REMOTE_URL, 'none');
}

/**
 * Second line of defence after Mermaid's own sanitiser: the diagram must never
 * load anything from other sites (no images, stylesheets or links), like the
 * rest of an answer.
 */
export function sanitizeSvg(markup: string): string {
  // Mermaid serialises its SVG as HTML (e.g. an unclosed <br>): parse it the same way.
  const root = new DOMParser().parseFromString(markup, 'text/html').body.querySelector(':scope > svg');
  if (!root) throw new Error('invalid diagram markup');

  for (const element of [...root.querySelectorAll('*')]) {
    const name = element.localName.toLowerCase();
    if (REMOVED_ELEMENTS.has(name)) {
      element.remove();
      continue;
    }
    // A link keeps its text but no longer goes anywhere.
    if (name === 'a') {
      element.replaceWith(...element.childNodes);
      continue;
    }
    if (name === 'style') element.textContent = cleanCss(element.textContent ?? '');
    for (const attribute of [...element.attributes]) {
      const attributeName = attribute.name.toLowerCase();
      if (attributeName.startsWith('on')) element.removeAttribute(attribute.name);
      else if (LINK_ATTRIBUTES.has(attributeName) && !attribute.value.trim().startsWith('#')) {
        element.removeAttribute(attribute.name);
      } else if (attributeName === 'style' || /url\(/i.test(attribute.value)) {
        element.setAttribute(attribute.name, cleanCss(attribute.value));
      }
    }
  }
  return root.outerHTML;
}

export interface DiagramImage {
  /** PNG data URL. */
  dataUrl: string;
  /** Size in CSS pixels (the image itself is drawn at a higher resolution). */
  width: number;
  height: number;
}

const PNG_SCALE = 2;
const MAX_PNG_SIDE = 4000;

/** Draws a diagram as a PNG on a white background, for the PDF. */
export async function renderDiagramPng(code: string): Promise<DiagramImage> {
  const markup = await renderDiagram(code, 'light');
  const svg = new DOMParser().parseFromString(markup, 'text/html').body.querySelector(':scope > svg');
  if (!svg) throw new Error('invalid diagram markup');
  const [, , width, height] = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number);
  if (!(width > 0 && height > 0)) throw new Error('diagram without a size');

  // Mermaid sizes the SVG to its container; outside the page it needs a fixed size.
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.removeAttribute('style');

  const url = URL.createObjectURL(new Blob([new XMLSerializer().serializeToString(svg)], { type: 'image/svg+xml' }));
  try {
    const image = new Image();
    image.src = url;
    await image.decode();

    const scale = Math.min(PNG_SCALE, MAX_PNG_SIDE / width, MAX_PNG_SIDE / height);
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(width * scale);
    canvas.height = Math.round(height * scale);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('canvas not available');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return { dataUrl: canvas.toDataURL('image/png'), width, height };
  } finally {
    URL.revokeObjectURL(url);
  }
}
