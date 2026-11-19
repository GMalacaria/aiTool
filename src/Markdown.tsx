import { useMemo } from 'react';
import ReactMarkdown, { type Components, type ExtraProps } from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { parseMarkerHref, type AnswerSources } from '../shared/sources';
import { CopyBlock } from './CopyBlock';
import { Diagram } from './diagrams/Diagram';
import { DIAGRAM_LANGUAGE } from './diagrams/source';
import { MarkerView, SourceLegend, UncheckedNotice } from './Sources';

/** The fence language that marks text ready to paste elsewhere (see SYSTEM_PROMPT). */
export const COPY_LANGUAGE = 'copy';

type HastNode = NonNullable<ExtraProps['node']>;

/** The plain text of a syntax-tree node. */
function textOf(node: HastNode | HastNode['children'][number]): string {
  if (node.type === 'text') return node.value;
  return 'children' in node ? node.children.map((child) => textOf(child as HastNode)).join('') : '';
}

/**
 * A fenced block with a copy icon: ```copy becomes a card, ```mermaid a diagram
 * (the icon copies its source), any other a code block.
 */
function CodeBlock({ node, children }: { node?: HastNode; children?: React.ReactNode }) {
  const code = node?.children.find((child) => child.type === 'element' && child.tagName === 'code');
  const classes = code?.type === 'element' ? code.properties.className : undefined;
  const language = (name: string) => Array.isArray(classes) && classes.includes(`language-${name}`);
  const isCard = language(COPY_LANGUAGE);
  const text = (code ? textOf(code) : '').replace(/\n$/, '');

  if (language(DIAGRAM_LANGUAGE)) {
    return (
      <CopyBlock text={text} variant="diagram">
        <Diagram code={text} label="Schema" />
      </CopyBlock>
    );
  }

  return isCard ? (
    <CopyBlock text={text} variant="card">
      <p className="copy-card-text">{text}</p>
    </CopyBlock>
  ) : (
    <CopyBlock text={text} variant="code">
      <pre>{children}</pre>
    </CopyBlock>
  );
}

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
  pre: ({ node, children }) => <CodeBlock node={node}>{children}</CodeBlock>,
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

/**
 * `[1](#source-1)`, `[?](#unverified)` and `[?](#unreadable-1)` are source
 * markers (see shared/sources.ts): they become citation links and toggletips,
 * and the legend of the sources follows the text.
 */
export function Markdown({
  text,
  sources,
  onVerify,
}: {
  text: string;
  sources?: AnswerSources;
  /** Checks the sources of an unchecked answer; false when it failed. */
  onVerify?: () => Promise<boolean>;
}) {
  const withMarkers = useMemo<Components>(
    () => ({
      ...components,
      a: ({ node: _node, children, href, ...props }) => {
        const marker = parseMarkerHref(href);
        if (marker) return <MarkerView marker={marker} sources={sources} />;
        return (
          <a href={href} {...props} target="_blank" rel="noopener noreferrer">
            {children}
          </a>
        );
      },
    }),
    [sources],
  );
  const unreadable = useMemo(
    () => new Set([...text.matchAll(/\(#unreadable-(\d+)\)/g)].map((match) => Number(match[1]))),
    [text],
  );

  return (
    <div className="markdown">
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml components={withMarkers}>
        {text}
      </ReactMarkdown>
      {sources?.unchecked ? (
        <UncheckedNotice onVerify={onVerify} />
      ) : (
        sources && <SourceLegend sources={sources} unreadable={unreadable} />
      )}
    </div>
  );
}
