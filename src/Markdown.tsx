import ReactMarkdown, { type Components } from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Renders the model's Markdown. It is built as React elements, never as an HTML
 * string, and raw HTML in the text is ignored. Links keep only safe protocols
 * (react-markdown's default) and open in a new tab; images are not loaded, so
 * an answer cannot trigger requests to other sites.
 */
const components: Components = {
  a: ({ node: _node, children, ...props }) => (
    <a {...props} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),
  img: ({ alt }) => (alt ? <span className="md-image-alt">{alt}</span> : null),
  table: ({ node: _node, children }) => (
    <div className="md-table">
      <table>{children}</table>
    </div>
  ),
  // The answer sits under an <h2> label: headings start one level below it.
  h1: ({ node: _node, children }) => <h3>{children}</h3>,
  h2: ({ node: _node, children }) => <h3>{children}</h3>,
  h3: ({ node: _node, children }) => <h3>{children}</h3>,
  h4: ({ node: _node, children }) => <h4>{children}</h4>,
  h5: ({ node: _node, children }) => <h4>{children}</h4>,
  h6: ({ node: _node, children }) => <h4>{children}</h4>,
};

export function Markdown({ text }: { text: string }) {
  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={components}>
        {text}
      </ReactMarkdown>
    </div>
  );
}
