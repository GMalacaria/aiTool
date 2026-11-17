import { useEffect, useId, useRef, type ReactNode } from 'react';

interface ModalProps {
  open: boolean;
  title: string;
  /** Called however the dialog closes: buttons, Esc, back gesture or a click outside. */
  onClose: () => void;
  children: ReactNode;
  className?: string;
}

/**
 * A native modal <dialog>: the browser makes the page inert, keeps focus
 * inside, closes it on Esc or the back gesture and returns focus to the
 * control that opened it. `closedby="any"` adds click-outside, with a small
 * fallback where the attribute is not supported (Safari).
 */
export function Modal({ open, title, onClose, children, className }: ModalProps) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) dialog.showModal();
    if (!open && dialog.open) dialog.close();
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog || 'closedBy' in HTMLDialogElement.prototype) return;

    // Test the pointer position: the dialog is also the target of its own padding.
    const outside = (event: PointerEvent) => {
      const box = dialog.getBoundingClientRect();
      return event.clientX < box.left || event.clientX > box.right || event.clientY < box.top || event.clientY > box.bottom;
    };
    let pressedOutside = false;
    const down = (event: PointerEvent) => {
      pressedOutside = outside(event);
    };
    // Press and release both outside, so a text selection ending on the backdrop does not close it.
    const up = (event: PointerEvent) => {
      if (pressedOutside && outside(event)) dialog.close();
    };
    dialog.addEventListener('pointerdown', down);
    dialog.addEventListener('pointerup', up);
    return () => {
      dialog.removeEventListener('pointerdown', down);
      dialog.removeEventListener('pointerup', up);
    };
  }, []);

  return (
    <dialog
      ref={ref}
      className={`modal${className ? ` ${className}` : ''}`}
      aria-labelledby={titleId}
      onClose={onClose}
      {...({ closedby: 'any' } as Record<string, string>)}
    >
      <h2 id={titleId} className="modal-title">
        {title}
      </h2>
      {children}
    </dialog>
  );
}
