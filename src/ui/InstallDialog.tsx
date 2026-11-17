import { promptInstall, type InstallMode } from '../install';
import { Modal } from './Modal';

interface InstallDialogProps {
  open: boolean;
  mode: InstallMode;
  onClose: () => void;
}

export function InstallDialog({ open, mode, onClose }: InstallDialogProps) {
  async function install() {
    onClose();
    try {
      await promptInstall();
    } catch {
      // The browser refused the dialog: the menu entry stays available if it can be retried.
    }
  }

  return (
    <Modal open={open && mode !== null} title="Installa Kern sul telefono" onClose={onClose} className="install-modal">
      {mode === 'ios' ? (
        <div className="modal-body">
          <p>Kern può stare nella schermata Home e aprirsi come un'app, senza la barra del browser.</p>
          <ol className="install-steps">
            <li>
              Tocca <strong>Condividi</strong> (il quadrato con la freccia verso l'alto).
            </li>
            <li>
              Scegli <strong>Aggiungi alla schermata Home</strong>.
            </li>
            <li>
              Tocca <strong>Aggiungi</strong>.
            </li>
          </ol>
          <p className="muted">Alla prima apertura dall'icona dovrai accedere di nuovo con Google.</p>
          <div className="modal-actions">
            <button type="button" className="button-primary" data-autofocus onClick={onClose}>
              Ho capito
            </button>
          </div>
        </div>
      ) : (
        <div className="modal-body">
          <p>Kern può stare nella schermata Home e aprirsi come un'app, senza la barra del browser.</p>
          <div className="modal-actions">
            <button type="button" onClick={onClose}>
              Non ora
            </button>
            <button type="button" className="button-primary" data-autofocus onClick={() => void install()}>
              Installa
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
