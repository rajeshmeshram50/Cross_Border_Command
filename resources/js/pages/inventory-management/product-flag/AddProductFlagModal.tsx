import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
import '../../p2p/p2p-detail.css';
import '../../p2p/purchase-management/order/create-po/create-po.css';
import { Field } from '../../p2p/purchase-management/order/create-po/form-fields';
import { PRODUCT_FLAGS, type ProductFlag } from './product-flag-data';

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

/** One past the highest id in the list. */
function nextId(): string {
  const max = PRODUCT_FLAGS.reduce((n, f) => Math.max(n, Number(f.id.replace(/\D/g, '')) || 0), 0);
  return `PF-${String(max + 1).padStart(3, '0')}`;
}

/**
 * Add / Edit Product Flag.
 *
 * Two fields in one column — the design's shape for this master. Design only:
 * it validates and reports, and does not persist.
 */
export default function AddProductFlagModal({ flag, onClose }: {
  /** Present when the pencil opened it. */
  flag?: ProductFlag;
  onClose: () => void;
}) {
  const editing = !!flag;
  const toast = useToast();
  useScrollLock(true, '.pfm-addmdl');

  const [name, setName] = useState(flag?.name ?? '');
  const [purpose, setPurpose] = useState(flag?.purpose ?? '');
  const [errors, setErrors] = useState<{ name?: string; purpose?: string }>({});

  const cardRef = useRef<HTMLDivElement>(null);
  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose]);

  const id = editing ? flag!.id : nextId();

  const save = () => {
    const e: { name?: string; purpose?: string } = {};
    if (!name.trim()) e.name = 'Give the flag a name.';
    /* Compared case-insensitively, and against every flag but this one: two
       flags reading the same is two rows nobody can tell apart. */
    else if (PRODUCT_FLAGS.some(f => f.id !== id && f.name.toLowerCase() === name.trim().toLowerCase())) {
      e.name = 'A flag with that name already exists.';
    }
    if (!purpose.trim()) e.purpose = 'Say what this flag means for handling or storage.';
    setErrors(e);
    if (e.name || e.purpose) {
      toast.error('Check the form', 'Each problem is marked below.');
      return;
    }
    toast.info(
      editing ? `${id} would be updated` : `${id} would be saved`,
      'The form is complete. Saving arrives with the product-flag endpoint.',
    );
    onClose();
  };

  return createPortal(
    <div className="spi-mdl-backdrop whm-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
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
                /* At the end of the label's row, where the design puts it.
                   Under the control it would be displaced by an error — the
                   moment the count matters most. */
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
            <button type="button" className="spi-mdl-confirm" onClick={save}>
              <IcoCheck /> {editing ? 'Update Flag' : 'Save Flag'}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
