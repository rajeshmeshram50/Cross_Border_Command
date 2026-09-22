// "+ Add Supplier" from the PO form: the Supplier master's own two-step flow —
// pick Domestic / International, then its full onboarding wizard. Both screens
// are the Supplier module's components, reused as-is (the prototype's PO does
// the same), so a supplier added here is the same record the master creates.
import { Suspense, useState } from 'react';
import { createPortal } from 'react-dom';
import { lazyPage } from '../../../../../utils/lazyPage';
import { useToast } from '../../../../../contexts/ToastContext';
import type { SupplierScope } from '../../../p2p-master-management/supplier-management/SupplierScopeGate';

// Loaded only when "+ Add Supplier" is clicked — the wizard is large.
const SupplierScopeGate = lazyPage(() => import('../../../p2p-master-management/supplier-management/SupplierScopeGate'));
const AddVendorModal = lazyPage(() => import('../../../p2p-master-management/supplier-management/AddVendorModal'));

export default function AddSupplierFlow({ vendorId, onClose, onSaved }: {
  /** Set to edit that supplier instead of onboarding a new one. */
  vendorId?: number | null;
  onClose: () => void;
  /** After a successful save — the PO re-reads the supplier with this. */
  onSaved?: () => void;
}) {
  const toast = useToast();
  // null = still choosing the origin; set = the wizard is open for that scope.
  // Editing skips the choice: the supplier already has an origin.
  const [scope, setScope] = useState<SupplierScope | null>(null);
  const editing = !!vendorId;

  // Portalled to <body> so these compete with the PO form as page-level layers
  // (create-po.css drops the form beneath them while they are open).
  return createPortal(
    <Suspense fallback={null}>
      {!editing && scope === null ? (
        <SupplierScopeGate onClose={onClose} onChoose={setScope} />
      ) : (
        <AddVendorModal
          vendorId={vendorId ?? undefined}
          scope={scope ?? undefined}
          // The PO form isn't the place to map products to a supplier.
          canMapProducts={false}
          onClose={onClose}
          onSubmit={(payload) => {
            onClose();
            onSaved?.();
            toast.success(
              editing ? 'Supplier updated' : 'Supplier added',
              editing
                ? `${payload.companyName}'s details were saved.`
                : `${payload.companyName} was added to the supplier master.`,
            );
          }}
        />
      )}
    </Suspense>,
    document.body,
  );
}
