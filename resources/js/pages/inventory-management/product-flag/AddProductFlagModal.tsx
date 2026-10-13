import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
import '../../p2p/p2p-detail.css';
import '../../p2p/purchase-management/order/create-po/create-po.css';
import '../warehouse/warehouse-master.css';
import './product-flag.css';
import { Field } from '../../p2p/purchase-management/order/create-po/form-fields';
import { ProductFlagApiError, productFlagApi, type ProductFlag } from './product-flag-data';

const Ico = (d: ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IcoFlag = (p: { size?: number }) => Ico(
  <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" /></>,
  p.size ?? 14,
);
const IcoX = () => Ico(<><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>, 16);
const IcoCheck = () => Ico(<polyline points="20 6 9 17 4 12" />, 14);
const IcoInfo = () => Ico(
  <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" /></>, 13,
);

const NAME_MAX = 40;
const PURPOSE_MAX = 200;

export default function AddProductFlagModal({ flag, onClose, onSaved }: {
  flag?: ProductFlag;
  onClose: () => void;
  onSaved?: (flag: ProductFlag) => void;
}) {
  const editing = !!flag;
  const toast = useToast();
  useScrollLock(true, '.pfm-addmdl');

  const [name, setName] = useState(flag?.name ?? '');
  const [purpose, setPurpose] = useState(flag?.purpose ?? '');
  const [errors, setErrors] = useState<{ name?: string; purpose?: string }>({});
  const [saving, setSaving] = useState(false);

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const id = editing ? flag!.id : 'Assigned on save';

  const save = async () => {
    if (saving) return;
    const e: { name?: string; purpose?: string } = {};
    if (!name.trim()) e.name = 'Give the flag a name.';
    if (!purpose.trim()) e.purpose = 'Say what this flag means for handling or storage.';
    setErrors(e);
    if (e.name || e.purpose) {
      toast.error('Check the form', 'Each problem is marked below.');
      return;
    }
    setSaving(true);
    try {
      const body = { flag_name: name.trim(), purpose: purpose.trim() };
      const saved = editing ? await productFlagApi.update(flag!.apiId, body) : await productFlagApi.create(body);
      toast.success(editing ? `${saved.id} updated` : `${saved.id} created`, saved.name);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof ProductFlagApiError) {
        const fe = err.fieldErrors;
        const next: { name?: string; purpose?: string } = {
          name: fe.flag_name?.[0] ?? (/name/i.test(err.message) && !fe.purpose ? err.message : undefined),
          purpose: fe.purpose?.[0],
        };
        setErrors(next);
        toast.error(editing ? 'Could not update the flag' : 'Could not create the flag', next.name ?? next.purpose ?? err.message);
      } else {
        toast.error('Could not save the flag', 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  return createPortal(
    /* No backdrop-click close. The form holds unsaved input, and a stray
       click outside it must not throw that away — the dialog closes only
       through the X or Cancel. */
    <div className="spi-mdl-backdrop whm-backdrop">
      <div
        className="spi-mdl whm-addmdl pfm-addmdl"
        role="dialog" aria-modal="true" aria-labelledby="pfm-add-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoFlag size={22} /></div>
            <div>
              <div className="spi-mdl-title" id="pfm-add-title">
                {editing ? 'Edit Product Flag' : 'Add Product Flag'}
              </div>
              <div className="spi-mdl-sub">
                {editing
                  ? `Update ${id} — its name and purpose.`
                  : 'Create a flag that tells the warehouse how tagged products should be stored and handled.'}
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body whm-addbody">
          <div className="whm-card">
            <div className="whm-sec">
              <span className="whm-sec__ico"><IcoFlag size={15} /></span>
              <b>Product Flag Details</b>
            </div>
            <div className="spi-dt-grid4">
              <Field label="Flag Name" req error={errors.name}>
                <input
                  className={`spi-dt-inp${errors.name ? ' is-invalid' : ''}`}
                  placeholder="e.g. Fragile" maxLength={NAME_MAX}
                  value={name}
                  onChange={e => { setName(e.target.value); setErrors(x => ({ ...x, name: undefined })); }}
                />
              </Field>
              <Field
                label="Flag Purpose" req error={errors.purpose}
                labelEnd={<span className="pfm-cnt">{purpose.length} / {PURPOSE_MAX}</span>}
              >
                <textarea
                  className={`spi-dt-textarea pfm-ta${errors.purpose ? ' is-invalid' : ''}`}
                  rows={3} maxLength={PURPOSE_MAX}
                  placeholder="e.g. Handle with care — store on lower shelves and avoid stacking"
                  value={purpose}
                  onChange={e => { setPurpose(e.target.value); setErrors(x => ({ ...x, purpose: undefined })); }}
                />
              </Field>
            </div>
          </div>
        </div>

        <div className="spi-mdl-foot">
          <span className="whm-footnote"><IcoInfo /> Fields marked * are required</span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" onClick={() => void save()} disabled={saving}>
              <IcoCheck /> {saving ? 'Saving…' : editing ? 'Update Flag' : 'Save Flag'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
