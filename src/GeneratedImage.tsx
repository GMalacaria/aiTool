import { useState } from 'react';
import { imageUrl } from './api';

interface GeneratedImageProps {
  id: string;
  /** What the user asked for: used as the text alternative. */
  request: string;
}

/** An image created by the model, always labelled as such. */
export function GeneratedImage({ id, request }: GeneratedImageProps) {
  const [failed, setFailed] = useState(false);
  const src = imageUrl(id);

  if (failed) {
    return <p className="muted">L'immagine non è più disponibile.</p>;
  }

  return (
    <figure className="generated-image">
      <img
        src={src}
        alt={request ? `Immagine generata dall'intelligenza artificiale: ${request}` : "Immagine generata dall'intelligenza artificiale"}
        loading="lazy"
        onError={() => setFailed(true)}
      />
      <figcaption className="muted">
        Immagine generata dall'intelligenza artificiale.{' '}
        <a href={src} download={`immagine-${id.slice(0, 8)}`}>
          Scarica
        </a>
      </figcaption>
    </figure>
  );
}
