import { useEffect, useState } from 'react';
import { usePageIsDark } from '../theme';

type State = { status: 'loading' } | { status: 'ready'; svg: string } | { status: 'failed' };

/**
 * A Mermaid diagram drawn in the page's colours. While it is drawn a short
 * placeholder is shown; if the source is not a valid diagram, its text is shown
 * instead, so nothing of the answer is lost.
 */
export function Diagram({ code, label }: { code: string; label: string }) {
  const dark = usePageIsDark();
  const [state, setState] = useState<State>({ status: 'loading' });

  useEffect(() => {
    let current = true;
    import('./render')
      .then(({ renderDiagram }) => renderDiagram(code, dark ? 'dark' : 'light'))
      .then(
        (svg) => current && setState({ status: 'ready', svg }),
        (error: unknown) => {
          console.warn('Diagram not drawn', error);
          if (current) setState({ status: 'failed' });
        },
      );
    return () => {
      current = false;
    };
  }, [code, dark]);

  if (state.status === 'failed') {
    return (
      <div className="diagram diagram-failed">
        <p className="muted">Schema non visualizzabile: ecco il testo.</p>
        <pre>
          <code>{code}</code>
        </pre>
      </div>
    );
  }

  if (state.status === 'loading') {
    return (
      <div className="diagram diagram-loading" role="status">
        Preparazione dello schema
      </div>
    );
  }

  // The markup comes from Mermaid in strict mode and is sanitised again by renderDiagram.
  return <div className="diagram" role="img" aria-label={label} dangerouslySetInnerHTML={{ __html: state.svg }} />;
}
