import { useEffect } from 'react';
import './po-supplier-theme.css';

/** While a PO or Supplier Invoice form is open, the Supplier master's chooser and
 *  wizard it opens (Add / Edit Supplier, GST scrutiny) take the PO's teal theme.
 *  The class sits on <body> because those popups portal there; the Supplier
 *  master itself keeps its violet. */
export function usePoSupplierTheme() {
  useEffect(() => {
    document.body.classList.add('po-supplier-teal');
    return () => document.body.classList.remove('po-supplier-teal');
  }, []);
}
