import { useState } from 'react';
import { SIGN_IN_URL } from './api';
import { Modal } from './ui/Modal';
import { NewChatIcon, PlusIcon, SendIcon, SidebarIcon } from './ui/icons';
import { RotatingText } from './ui/RotatingText';

const WELCOME = ['Sono uno strumento a tua disposizione', 'Da dove iniziamo?', 'Di cosa hai bisogno?'] as const;

export function Brand() {
  return (
    <span className="brand">
      <img src="/icon.svg" alt="" width={22} height={22} />
      Kern
    </span>
  );
}

interface LoginDialogProps {
  open: boolean;
  failed: boolean;
  onClose: () => void;
}

/** Signing in happens on Google's page: the dialog explains and links there. */
function LoginDialog({ open, failed, onClose }: LoginDialogProps) {
  return (
    <Modal open={open} title="Accedi per usare Kern" onClose={onClose} className="login-modal">
      <div className="modal-body">
        <img className="login-wordmark" src="/brand/kern-wordmark.png" alt="" width={335} height={80} />
        <p>
          Kern è uno strumento di intelligenza artificiale per ottenere informazioni, documenti e immagini nel lavoro
          di tutti i giorni. Al centro ci sei tu: Kern resta uno strumento.
        </p>
        <p>
          Risponde a ciò che chiedi, senza complimenti e senza trattenerti nella chat. Non cerca un legame affettivo, ti
          corregge se sbagli e dice quando non è sicuro, quando lo è fornisce le fonti.
        </p>
        {failed && (
          <p role="alert" className="error">
            Accesso non riuscito. Riprova.
          </p>
        )}
        <p className="muted">
          Accedi con il tuo account Google. Al primo accesso l'account deve essere approvato. Le chat restano nel tuo
          account e puoi eliminarle quando vuoi.
        </p>
        <div className="modal-actions">
          <button type="button" onClick={onClose}>
            Non ora
          </button>
          <a className="button button-primary" href={SIGN_IN_URL} data-autofocus>
            Accedi con Google
          </a>
        </div>
      </div>
    </Modal>
  );
}

/**
 * The signed-out page looks like the chat itself, with an anonymous sidebar.
 * Trying to write (or attach, or start a chat) opens the sign-in dialog.
 */
export function Login() {
  const failed = new URLSearchParams(window.location.search).get('error') === 'sign_in_failed';
  const [loginOpen, setLoginOpen] = useState(failed);
  const [overlayOpen, setOverlayOpen] = useState(false);
  const askToSignIn = () => {
    setOverlayOpen(false);
    setLoginOpen(true);
  };

  return (
    <div className={`workspace guest${overlayOpen ? ' sidebar-overlay-open' : ''}`}>
      <aside className="sidebar" aria-label="Menu">
        <div className="sidebar-top">
          <Brand />
          <button
            type="button"
            className="icon-button sidebar-close-narrow"
            aria-label="Chiudi la barra laterale"
            title="Chiudi la barra laterale"
            onClick={() => setOverlayOpen(false)}
          >
            <SidebarIcon />
          </button>
        </div>

        <button type="button" className="new-chat" onClick={askToSignIn}>
          <NewChatIcon size={18} />
          Nuova chat
        </button>

        <div className="chat-list">
          <p className="muted chat-list-empty">Accedi per salvare le chat e ritrovarle qui.</p>
        </div>

        <div className="sidebar-footer">
          <button type="button" className="button-primary guest-sign-in" onClick={askToSignIn}>
            Accedi
          </button>
        </div>
      </aside>
      {overlayOpen && <div className="sidebar-scrim" aria-hidden="true" onClick={() => setOverlayOpen(false)} />}

      <div className="content">
        <div className="content-tools guest-tools">
          <button
            type="button"
            className="icon-button"
            aria-label="Apri la barra laterale"
            title="Apri la barra laterale"
            onClick={() => setOverlayOpen(true)}
          >
            <SidebarIcon />
          </button>
        </div>
        <h1 className="visually-hidden">Kern</h1>

        <main className="chat-start">
          <h2 className="welcome">
            <RotatingText phrases={WELCOME} interval={3500} />
          </h2>

          <form
            className="composer"
            onSubmit={(event) => {
              event.preventDefault();
              askToSignIn();
            }}
          >
            <div className="composer-box">
              <div className="composer-row">
                <button
                  type="button"
                  className="icon-button"
                  aria-label="Allega immagini o PDF"
                  title="Allega immagini o PDF"
                  onClick={askToSignIn}
                >
                  <PlusIcon />
                </button>
                <label htmlFor="guest-question" className="visually-hidden">
                  Richiesta
                </label>
                {/* Opening on click or key, not on focus: closing the dialog gives focus back here. */}
                <textarea
                  id="guest-question"
                  className="composer-input"
                  rows={1}
                  placeholder="Scrivi la tua richiesta"
                  readOnly
                  aria-describedby="guest-hint"
                  onClick={askToSignIn}
                  onKeyDown={(event) => {
                    if (event.key === 'Tab' || event.key === 'Shift' || event.key === 'Escape') return;
                    event.preventDefault();
                    askToSignIn();
                  }}
                />
                <button type="submit" className="send-button" aria-label="Invia" title="Invia">
                  <SendIcon />
                </button>
              </div>
            </div>
            <p id="guest-hint" className="composer-footnote muted">
              Accedi per fare richieste. Strumento di intelligenza artificiale: può commettere errori.
            </p>
          </form>
        </main>
      </div>

      <LoginDialog open={loginOpen} failed={failed} onClose={() => setLoginOpen(false)} />
    </div>
  );
}
