import { useEffect } from 'react';

/**
 * Close a popup on Escape — unless a ModalSelect dropdown is open, in which
 * case Escape only closes that dropdown (its own handler) and the form stays.
 */
export function useEscapeClose(onClose: () => void) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || document.querySelector('.spi-mdl-dd-pop')) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);
}
