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

export default function AddSupplierFlow({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  // null = still choosing the origin; set = the wizard is open for that scope.
  const [scope, setScope] = useState<SupplierScope | null>(null);

  // Portalled to <body> so these compete with the PO form as page-level layers
  // (create-po.css drops the form beneath them while they are open).
  return createPortal(
    <Suspense fallback={null}>
      {scope === null ? (
        <SupplierScopeGate onClose={onClose} onChoose={setScope} />
      ) : (
        <AddVendorModal
          scope={scope}
          // The PO form isn't the place to map products to a new supplier.
          canMapProducts={false}
          onClose={onClose}
          onSubmit={(payload) => {
            onClose();
            toast.success('Supplier added', `${payload.companyName} was added to the supplier master.`);
          }}
        />
      )}
    </Suspense>,
    document.body,
  );
}
