import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useToast } from '../../../../contexts/ToastContext';
import api from '../../../../api';
import { useModalGuard } from './useModalGuard';
import SupplierPriceFields, { priceErrors, pricePayload, type PriceDraft, type PriceMasters, type SupplierOrigin } from './SupplierPriceFields';
import './bulk-sourcing.css';

/* Edit Price on a mapped supplier (Supplier Master or New Supplier):
 * PATCH /p2p/sourcing-targets/{targetId}/products/{productId}/suppliers/{mappingId}/price */

export type PriceEditRow = {
  mappingId: string; name: string; source: string;
  origin?: SupplierOrigin | null; currency?: string | null; price?: number | null;
  gstPercentage?: number | null; exchangeRate?: number | null; validTill?: string | null;
};

export default function EditSupplierPriceModal({ row, productName, targetPrice, targetId, productId, onClose, onSaved }: {
  row: PriceEditRow; productName: string; targetPrice?: string; targetId: string; productId: string | number;
  onClose: () => void; onSaved: (name: string) => void;
}) {
  const toast = useToast();
  const { pulse, guardOverlay } = useModalGuard();
  const origin: SupplierOrigin = row.origin === 'international' ? 'international' : 'domestic';
  const [masters, setMasters] = useState<PriceMasters>({ currencies: [], gstRates: [] });
  const [draft, setDraft] = useState<PriceDraft>({
    price: row.price != null ? String(row.price) : '',
    gst: row.gstPercentage != null ? String(row.gstPercentage) : '18',
    currency: row.currency && row.currency !== 'INR' ? row.currency : '',
    rate: row.exchangeRate != null ? String(row.exchangeRate) : '',
    validTill: row.validTill ?? '',
  });
  const [submitted, setSubmitted] = useState(false);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    api.get<{ data: PriceMasters }>('/p2p/form-masters')
      .then(r => setMasters({ currencies: r.data?.data?.currencies ?? [], gstRates: r.data?.data?.gstRates ?? [] }))
      .catch(() => {});
  }, []);

  const errs = submitted ? priceErrors(origin, draft) : {};
  const save = () => {
    setSubmitted(true);
    if (Object.keys(priceErrors(origin, draft)).length) { toast.warning('Missing details', 'Please fill the price fields highlighted in red.'); return; }
    setSaving(true);
    api.patch(`/p2p/sourcing-targets/${targetId}/products/${productId}/suppliers/${row.mappingId}/price`, pricePayload(origin, draft))
      .then(() => { toast.success('Price updated', row.name); onSaved(row.name); })
      .catch(err => toast.error('Update failed', err?.response?.data?.message || 'Please try again.'))
      .finally(() => setSaving(false));
  };

  return createPortal(
    <div id="smp-overlay" onMouseDown={guardOverlay}>
      <div className={`smp-box${pulse ? ' bsm-pulse' : ''}`}>
        <div className="smp-header">
          <div className="smp-hrow">
            <div className="smp-title-wrap">
              <div className="smp-title-block">
                <h3 className="smp-title">Edit Supplier Price</h3>
                <p className="smp-sub">{row.name} &nbsp;·&nbsp; {row.source} &nbsp;·&nbsp; {productName}</p>
              </div>
            </div>
          </div>
        </div>
        <button className="smp-close" style={{ position: 'absolute', top: 18, right: 22 }} onClick={onClose}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        <div className="smp-body snf-body">
          <SupplierPriceFields origin={origin} value={draft} onChange={setDraft} masters={masters} targetPrice={targetPrice} errors={errs} />
          <div className="snf-foot">
            <button className="smp-btn-back" onClick={onClose}>Cancel</button>
            <button className="smp-btn-save smp-btn-map" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Update Price'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
