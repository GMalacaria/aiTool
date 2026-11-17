import { useEffect, useRef, useState } from 'react';
import { imageUrl } from './api';
import { CloseIcon, DownloadIcon, ShareIcon } from './ui/icons';

interface GeneratedImageProps {
  id: string;
  /** What the user asked for: used as the text alternative. */
  request: string;
}

const EXTENSIONS: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };

/** File sharing (Web Share API level 2) exists on phones and some desktops; elsewhere the button is hidden. */
function canShareFiles(): boolean {
  if (typeof navigator === 'undefined' || typeof navigator.canShare !== 'function') return false;
  try {
    return navigator.canShare({ files: [new File([], 'probe.jpg', { type: 'image/jpeg' })] });
  } catch {
    return false;
  }
}

/** An image created by the model, always labelled as such, with download, share and a full-screen view. */
export function GeneratedImage({ id, request }: GeneratedImageProps) {
  const [failed, setFailed] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [shareable] = useState(canShareFiles);
  const [shareError, setShareError] = useState(false);
  // The file is read ahead of the tap: Safari drops the share sheet if the click waits on a download.
  const file = useRef<Promise<File | null> | null>(null);
  const src = imageUrl(id);
  const baseName = `kern-immagine-${id.slice(0, 8)}`;
  const alt = request
    ? `Immagine generata dall'intelligenza artificiale: ${request}`
    : "Immagine generata dall'intelligenza artificiale";

  const loadFile = () => {
    file.current ??= fetch(src, { credentials: 'same-origin' })
      .then(async (response) => {
        if (!response.ok) return null;
        const blob = await response.blob();
        const extension = EXTENSIONS[blob.type] ?? 'jpg';
        return new File([blob], `${baseName}.${extension}`, { type: blob.type || 'image/jpeg' });
      })
      .catch(() => null);
    return file.current;
  };

  const share = async () => {
    setShareError(false);
    const shared = await loadFile();
    if (!shared || !navigator.canShare({ files: [shared] })) {
      setShareError(true);
      return;
    }
    try {
      await navigator.share({ files: [shared], title: 'Immagine generata da Kern' });
    } catch (error) {
      // Closing the share sheet is not an error.
      if ((error as DOMException).name !== 'AbortError') setShareError(true);
    }
  };

  if (failed) {
    return <p className="muted">L'immagine non è più disponibile.</p>;
  }

  const actions = (
    <>
      <a className="image-action" href={src} download={baseName} aria-label="Scarica l'immagine" title="Scarica">
        <DownloadIcon />
      </a>
      {shareable && (
        <button type="button" className="image-action" onClick={share} aria-label="Condividi l'immagine" title="Condividi">
          <ShareIcon />
        </button>
      )}
    </>
  );

  return (
    <figure className="generated-image">
      <div className="image-preview">
        <button
          type="button"
          className="image-open"
          onClick={() => setViewerOpen(true)}
          aria-label="Ingrandisci l'immagine"
          aria-haspopup="dialog"
        >
          <img
            src={src}
            alt={alt}
            loading="lazy"
            onLoad={shareable ? () => void loadFile() : undefined}
            onError={() => setFailed(true)}
          />
        </button>
        <div className="image-actions">{actions}</div>
      </div>
      <figcaption className="muted">
        Immagine generata dall'intelligenza artificiale.
        {shareError && <span role="alert"> Condivisione non riuscita.</span>}
      </figcaption>
      <ImageViewer open={viewerOpen} src={src} alt={alt} onClose={() => setViewerOpen(false)}>
        {actions}
      </ImageViewer>
    </figure>
  );
}

interface ImageViewerProps {
  open: boolean;
  src: string;
  alt: string;
  onClose: () => void;
  children: React.ReactNode;
}

/** Full-screen native modal: Esc, the back gesture, the close button or a tap beside the picture close it. */
function ImageViewer({ open, src, alt, onClose, children }: ImageViewerProps) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      // React's autoFocus runs before the dialog opens: move focus to the close button now.
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    }
    if (!open && dialog.open) dialog.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="image-viewer"
      aria-label="Immagine ingrandita"
      onClose={onClose}
      // The dialog fills the screen, so "outside" is the empty space around the picture.
      onClick={(event) => {
        if (event.target === event.currentTarget || (event.target as HTMLElement).classList.contains('image-viewer-stage')) {
          ref.current?.close();
        }
      }}
    >
      {open && (
        <>
          <div className="image-viewer-stage">
            <img src={src} alt={alt} />
          </div>
          <div className="image-viewer-bar">
            <p className="image-viewer-label">Immagine generata dall'intelligenza artificiale</p>
            <div className="image-actions">
              {children}
              <button type="button" className="image-action" onClick={() => ref.current?.close()} aria-label="Chiudi" title="Chiudi" data-autofocus>
                <CloseIcon />
              </button>
            </div>
          </div>
        </>
      )}
    </dialog>
  );
}
