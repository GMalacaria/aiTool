/** The fence language of a diagram in a text answer (see SYSTEM_PROMPT). */
export const DIAGRAM_LANGUAGE = 'mermaid';

/** Longer sources are not drawn: they are shown as text. */
export const MAX_DIAGRAM_SOURCE_CHARS = 6000;

/**
 * Removes what lets a diagram change the renderer's configuration: front matter
 * (`---\nconfig: …\n---`) and `%%{init: …}%%` directives. Through them the model,
 * or text it copied, could set theme CSS that loads remote resources or turn on
 * HTML labels; the app's own configuration must always apply.
 */
export function cleanDiagramSource(code: string): string {
  return code
    .replace(/\r\n?/g, '\n')
    .replace(/^\s*-{3}[^\S\n]*\n[\s\S]*?\n-{3}[^\S\n]*(?:\n|$)/, '')
    .replace(/%%\{[\s\S]*?\}%%/g, '')
    .trim();
}

/**
 * False when drawing the diagram would load a picture from elsewhere: Mermaid
 * fetches the image of an `@{ img: "…" }` node while it lays the diagram out,
 * before any sanitising of the result can stop it.
 */
export function isSafeDiagramSource(source: string): boolean {
  return !/@\{[^}]*\b(?:img|image|src)\s*:/i.test(source);
}
