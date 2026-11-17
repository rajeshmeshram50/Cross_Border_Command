import { Suspense, useEffect, useMemo, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../../api';
import { useToast } from '../../../../contexts/ToastContext';
import { useConfirm } from '../../../../contexts/ConfirmContext';
import { MasterSelect } from '../../../../components/ui/MasterSelect';
import Tooltip from '../../../../components/ui/Tooltip';
import { lazyPage } from '../../../../utils/lazyPage';
import type { SupplierScope } from '../supplier-management/SupplierScopeGate';
import { GST_RATES, makeSupplier, type MappedSupplier } from './serviceData';
import { SVC_ICONS } from './serviceIcons';
import '../product-management/product-management.css';
import './service-management.css';
import './service-suppliers.css';

const SupplierScopeGate = lazyPage(() => import('../supplier-management/SupplierScopeGate'));
const AddVendorModal = lazyPage(() => import('../supplier-management/AddVendorModal'));

const SUP_VISIBLE_ROWS = 4;

type VendorOpt = { id: string; code: string; name: string; type: string; state: string; contact: string };

type BundleVendorRow = {
  id: number | string;
  vendor_code?: string | null;
  company_name?: string | null;
  vendor_type_name?: string | null;
  state?: string | null;
  primary_address?: { contact_name?: string | null } | null;
};

export const formatSupplierCode = (raw: string): string => {
  const m = String(raw ?? '').match(/(\d+)\s*$/);
  return m ? `S-${m[1].padStart(3, '0')}` : String(raw ?? '');
};

const money = (n: number) => `₹ ${n.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

let vendorCache: VendorOpt[] | null = null;
async function loadVendors(force = false): Promise<VendorOpt[]> {
  if (vendorCache && !force) return vendorCache;
  const res = await api.get<{ vendors?: BundleVendorRow[] }>('/products/master-bundle');
  vendorCache = (res.data?.vendors ?? []).map(r => ({
    id: String(r.id),
    code: String(r.vendor_code ?? ''),
    name: String(r.company_name ?? ''),
    type: String(r.vendor_type_name ?? ''),
    state: String(r.state ?? ''),
    contact: String(r.primary_address?.contact_name ?? ''),
  }));
  return vendorCache;
}

function SvmsField(props: { label: string; required?: boolean; auto?: boolean; extra?: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className={`svms-f${props.error ? ' is-err' : ''}`}>
      <span className="svms-l">
        {props.label}
        {props.required && <span className="svms-req">*</span>}
        {props.auto && <span className="svms-auto">Auto</span>}
        {props.extra}
      </span>
      {props.children}
      {props.error && <span className="svms-err">{props.error}</span>}
    </div>
  );
}

export function SupplierMapPanel({
  serviceName, suppliers, onChange,
}: {
  serviceName: string;
  suppliers: MappedSupplier[];
  onChange: (next: MappedSupplier[]) => void;
}) {
  const toast = useToast();
  const confirm = useConfirm();

  const [vendors, setVendors] = useState<VendorOpt[]>(vendorCache ?? []);
  const [vendorsLoading, setVendorsLoading] = useState(!vendorCache);
  useEffect(() => {
    let live = true;
    loadVendors()
      .then(v => { if (live) setVendors(v); })
      .catch(() => { if (live) toast.error('Could not load suppliers', 'Please refresh and try again.'); })
      .finally(() => { if (live) setVendorsLoading(false); });
    return () => { live = false; };
  }, [toast]);

  const overflow = suppliers.length > SUP_VISIBLE_ROWS;
  const grandTotal = suppliers.reduce((sum, s) => sum + (s.total || 0), 0);

  const [draftOpen, setDraftOpen] = useState(false);
  const [editIndex, setEditIndex] = useState<number | null>(null);
  const [selCode, setSelCode] = useState('');
  const [price, setPrice] = useState('');
  const [gst, setGst] = useState('18');
  const [errors, setErrors] = useState<{ supplier?: string; price?: string }>({});

  const [gateOpen, setGateOpen] = useState(false);
  const [addScope, setAddScope] = useState<SupplierScope | null>(null);
  useEffect(() => {
    const open = gateOpen || addScope !== null;
    document.body.classList.toggle('apm-supplier-wizard-open', open);
    return () => document.body.classList.remove('apm-supplier-wizard-open');
  }, [gateOpen, addScope]);

  const mappedCodes = useMemo(() => new Set(
    suppliers.filter((_, i) => i !== editIndex).map(s => s.code),
  ), [suppliers, editIndex]);
  const pickOpts = useMemo(() => vendors
    .filter(v => v.code && !mappedCodes.has(v.code) && !mappedCodes.has(formatSupplierCode(v.code)))
    .map(v => ({ value: v.code, label: `${formatSupplierCode(v.code)}: ${v.name}` })), [vendors, mappedCodes]);

  const selected = vendors.find(v => v.code === selCode) ?? null;
  const editing = editIndex != null ? suppliers[editIndex] : null;
  const shown = selected
    ? { code: formatSupplierCode(selected.code), type: selected.type, state: selected.state, contact: selected.contact }
    : editing && editing.code === selCode
      ? { code: formatSupplierCode(editing.code), type: editing.type, state: editing.state, contact: editing.contact }
      : null;

  const priceNum = parseFloat(price) || 0;
  const gstNum = Number(gst) || 0;
  const gstAmt = +(priceNum * gstNum / 100).toFixed(2);
  const total = +(priceNum + gstAmt).toFixed(2);

  const openNew = () => {
    setEditIndex(null); setSelCode(''); setPrice(''); setGst('18'); setErrors({});
    setDraftOpen(true);
  };
  const closeDraft = () => { setDraftOpen(false); setEditIndex(null); };

  const saveDraft = () => {
    const errs: typeof errors = {};
    if (!selCode) errs.supplier = 'This field is required';
    if (!(priceNum > 0)) errs.price = 'This field is required';
    setErrors(errs);
    if (Object.keys(errs).length) return;

    const base = selected
      ? { vendorId: selected.id, code: selected.code, name: selected.name, type: selected.type || '—', state: selected.state || '—', contact: selected.contact || '—' }
      : { vendorId: editing?.vendorId, code: editing!.code, name: editing!.name, type: editing!.type, state: editing!.state, contact: editing!.contact };
    const row = makeSupplier(base, priceNum, gstNum);

    if (editIndex != null) {
      onChange(suppliers.map((s, i) => (i === editIndex ? row : s)));
      toast.success('Supplier updated', `${row.name} — price and GST saved for this service.`);
    } else {
      onChange([...suppliers, row]);
      toast.success('Supplier mapped', `${row.name} mapped to this service.`);
    }
    closeDraft();
  };

  const remove = async (i: number) => {
    const s = suppliers[i];
    const ok = await confirm({
      title: 'Unmap supplier?',
      message: <>“<strong>{s.name}</strong>” will be removed from this service.</>,
      confirmLabel: 'Unmap',
    });
    if (!ok) return;
    onChange(suppliers.filter((_, k) => k !== i));
  };

  return (
    <>
      <div className="svs-card">
        <div className="svs-card-head">
          <span className="svs-card-ico">{SVC_ICONS.mapUser}</span>
          <span className="svs-card-title">Mapped Service Suppliers</span>
          {suppliers.length > 0 && <span className="svs-card-count">{suppliers.length}</span>}
          <button type="button" className="svs-btn svs-btn--primary svs-card-act" onClick={openNew}>
            {SVC_ICONS.plus} Map Supplier
          </button>
        </div>

        {suppliers.length === 0 ? (
          <div className="svs-empty">
            <b>No suppliers mapped yet</b>
            <span>Use <b>Map Supplier</b> to link a supplier with its price &amp; GST for this service.</span>
          </div>
        ) : (
          <div className={`svs-tablewrap${overflow ? ' is-scroll' : ''}`}>
            <div className="svs-tablescroll">
            <table className="svs-table">
              <thead>
                <tr>
                  <th>Sr. No</th><th className="is-l">Supplier</th><th className="is-l">Supplier Type</th>
                  <th className="is-l">State</th><th className="is-l">Contact Person</th><th className="is-r">Price</th>
                  <th>GST (%)</th><th className="is-r">GST Value</th><th className="is-r">Total Service Cost</th><th>Action</th>
                </tr>
              </thead>
              <tbody>
                {suppliers.map((s, i) => {
                  return (
                    <tr key={`${s.code}-${i}`}>
                      <td><span className="svs-sr">{i + 1}</span></td>
                      <td className="is-l">
                        <span className="svs-sup">
                          <b title={s.name}>{s.name || '—'}</b>
                          <em>{formatSupplierCode(s.code)}</em>
                        </span>
                      </td>
                      <td className="is-l">{s.type ? <span className="svs-pill">{s.type}</span> : '—'}</td>
                      <td className="is-l">{s.state || '—'}</td>
                      <td className="is-l">{s.contact || '—'}</td>
                      <td className="is-r">{money(s.price)}</td>
                      <td><span className="svs-gst">{String(Number(s.gst.toFixed(2)))}%</span></td>
                      <td className="is-r">{money(s.gstAmt)}</td>
                      <td className="is-r"><b className="svs-total">{money(s.total)}</b></td>
                      <td>
                        <Tooltip label="Unmap supplier">
                          <button type="button" className="svs-del" aria-label={`Unmap ${s.name}`} onClick={() => { void remove(i); }}>
                            {SVC_ICONS.trash}
                          </button>
                        </Tooltip>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            </div>
            {overflow && (
              <div className="svs-tablefoot">
                <span className="svs-tablefoot-count">
                  Showing <b>{suppliers.length}</b> mapped suppliers
                </span>
                <span className="svs-tablefoot-total">
                  Total Service Cost <b>{money(grandTotal)}</b>
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      {draftOpen && createPortal((
        <div className="apm-mv-backdrop svms-ov" onMouseDown={(e) => { if (e.target === e.currentTarget) closeDraft(); }}>
          <div className="svms-box" role="dialog" aria-modal="true" aria-label={editIndex != null ? 'Edit Mapped Supplier' : 'Map Supplier'}>
            <div className="svms-hd">
              <div className="svms-hd__ico">{SVC_ICONS.mapUser}</div>
              <div className="svms-hd__txt">
                <div className="svms-hd__t">{editIndex != null ? 'Edit Mapped Supplier' : 'Map Supplier'}</div>
                <div className="svms-hd__s">Link a supplier with price &amp; GST for <b>{serviceName || 'this service'}</b></div>
              </div>
              <button type="button" className="svms-x" onClick={closeDraft} aria-label="Close">{SVC_ICONS.x}</button>
            </div>

            <div className="svms-bd">
              <div className="svms-grid">
                <SvmsField label="Supplier Name" required error={errors.supplier}
                  extra={(
                    <Tooltip label="Add a new supplier">
                      <button type="button" className="svms-mini" aria-label="Add a new supplier" onClick={() => setGateOpen(true)}>{SVC_ICONS.plus}</button>
                    </Tooltip>
                  )}>
                  <div className="svms-select is-key">
                    <MasterSelect
                      value={selCode}
                      options={editing && !selected && editing.code === selCode
                        ? [{ value: editing.code, label: `${formatSupplierCode(editing.code)}: ${editing.name}` }, ...pickOpts]
                        : pickOpts}
                      placeholder="Select Supplier Name"
                      searchable
                      searchPlaceholder="Search supplier code or name"
                      loading={vendorsLoading}
                      emptyText="No suppliers available"
                      invalid={!!errors.supplier}
                      onChange={(v) => { setSelCode(v); setErrors(e => ({ ...e, supplier: undefined })); }}
                    />
                  </div>
                </SvmsField>
                <SvmsField label="Supplier Code" auto>
                  <input className="svms-i is-ro" value={shown?.code ?? ''} readOnly tabIndex={-1} placeholder="Auto-fills from supplier" />
                </SvmsField>
                <SvmsField label="Supplier Type" auto>
                  <input className="svms-i is-ro" value={shown ? (shown.type || '—') : ''} readOnly tabIndex={-1} placeholder="—" />
                </SvmsField>
                <SvmsField label="State" auto>
                  <input className="svms-i is-ro" value={shown ? (shown.state || '—') : ''} readOnly tabIndex={-1} placeholder="—" />
                </SvmsField>
                <SvmsField label="Contact Person" auto>
                  <input className="svms-i is-ro" value={shown ? (shown.contact || '—') : ''} readOnly tabIndex={-1} placeholder="—" />
                </SvmsField>
                <SvmsField label="Price (₹)" required error={errors.price}>
                  <input className="svms-i is-key" type="number" min={0} step={0.01} placeholder="Enter service price"
                    value={price} onChange={e => { setPrice(e.target.value); setErrors(er => ({ ...er, price: undefined })); }} />
                </SvmsField>
                <SvmsField label="GST %" required>
                  <div className="svms-select is-key">
                    <MasterSelect
                      value={gst}
                      options={GST_RATES.map(r => ({ value: String(r), label: String(r) }))}
                      placeholder="Select GST %"
                      onChange={setGst}
                    />
                  </div>
                </SvmsField>
                <SvmsField label="GST Amount (₹)" auto>
                  <input className="svms-i is-calc" value={price.trim() === '' ? '' : gstAmt.toFixed(2)} readOnly tabIndex={-1} placeholder="Auto-computed" />
                </SvmsField>
                <SvmsField label="Total Amount (₹)" auto>
                  <input className="svms-i is-calc" value={price.trim() === '' ? '' : total.toFixed(2)} readOnly tabIndex={-1} placeholder="Auto-computed" />
                </SvmsField>
              </div>
            </div>

            <div className="svms-ft">
              <button type="button" className="svx-btn svx-btn--ghost" onClick={closeDraft}>Cancel</button>
              <button type="button" className="svx-btn svx-btn--primary" onClick={saveDraft}>
                {SVC_ICONS.check} {editIndex != null ? 'Save Changes' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      ), document.body)}

      {createPortal((
        <>
          {gateOpen && (
            <Suspense fallback={null}>
              <SupplierScopeGate
                onClose={() => setGateOpen(false)}
                onChoose={(scope) => { setGateOpen(false); setAddScope(scope); }}
              />
            </Suspense>
          )}
          {addScope !== null && (
            <Suspense fallback={null}>
              <AddVendorModal
                scope={addScope}
                canMapProducts={false}
                onClose={() => setAddScope(null)}
                onSubmit={(payload) => {
                  setAddScope(null);
                  const wanted = String(payload.companyName ?? '').trim().toLowerCase();
                  setVendorsLoading(true);
                  loadVendors(true)
                    .then(v => {
                      setVendors(v);
                      const hit = v.find(o => o.name.trim().toLowerCase() === wanted);
                      if (hit?.code) setSelCode(hit.code);
                    })
                    .catch(() => {})
                    .finally(() => setVendorsLoading(false));
                }}
              />
            </Suspense>
          )}
        </>
      ), document.body)}
    </>
  );
}

export default function ServiceSupplierModal({
  code, serviceName, suppliers, onClose, onChange,
}: {
  code: string;
  serviceName: string;
  suppliers: MappedSupplier[];
  onClose: () => void;
  onChange: (next: MappedSupplier[]) => void;
}) {

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape' && !document.querySelector('.apm-mv-backdrop')) onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return createPortal((
    <div className="svs-overlay svs-teal" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="svs-modal" role="dialog" aria-modal="true" aria-label={`Map Service Suppliers · ${code}`}>
        <div className="svs-head">
          <div className="svs-head-ico">{SVC_ICONS.mapUser}</div>
          <div className="svs-head-txt">
            <div className="svs-title">Map Service Suppliers · {code}</div>
            <div className="svs-sub">{serviceName} — link suppliers with price &amp; GST.</div>
          </div>
          <button type="button" className="svs-close" onClick={onClose} aria-label="Close">{SVC_ICONS.x}</button>
        </div>
        <div className="svs-body">
          <SupplierMapPanel serviceName={serviceName} suppliers={suppliers} onChange={onChange} />
        </div>
        <div className="svs-foot">
          <span className="svs-note">{SVC_ICONS.info} Changes apply to <code>{code}</code></span>
          <div className="svs-foot-right">
            <button type="button" className="svs-btn svs-btn--ghost" onClick={onClose}>Cancel</button>
          </div>
        </div>
      </div>
    </div>
  ), document.body);
}
