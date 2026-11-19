import { parseIllustrations, type Illustration } from '../shared/illustrations';

/**
 * Pictures from Wikimedia Commons under an explanation, each with its author
 * and licence, linking to its Commons page. Addresses are checked again here:
 * only Wikimedia image hosts are ever loaded.
 */
export function Illustrations({ items }: { items: Illustration[] }) {
  const safe = parseIllustrations(items) ?? [];
  if (!safe.length) return null;

  return (
    <section className="illustrations" aria-label="Immagini di supporto">
      {safe.map((item) => (
        <figure key={item.page} className="illustration">
          <a href={item.page} target="_blank" rel="noopener noreferrer" className="illustration-link">
            <img
              src={item.src}
              alt={item.caption}
              width={item.width}
              height={item.height}
              loading="lazy"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          </a>
          <figcaption>
            <span className="illustration-caption">{item.caption}</span>
            <span className="illustration-credit">
              {item.author ? `${item.author} · ` : ''}
              {item.license} ·{' '}
              <a href={item.page} target="_blank" rel="noopener noreferrer">
                Wikimedia Commons
              </a>
            </span>
          </figcaption>
        </figure>
      ))}
    </section>
  );
}
