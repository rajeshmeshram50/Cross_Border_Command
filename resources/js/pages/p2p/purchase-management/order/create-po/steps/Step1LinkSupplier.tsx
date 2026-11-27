import { lazy, Suspense, useEffect, useMemo, useState, useRef } from 'react';
import { EditSelect, Field, FitTip } from '../form-fields';
import { gstCheck } from '../gst-check';
const FX_RATE_MAX = 10000;

const AddSupplierFlow = lazy(() => import('../AddSupplierFlow'));
const AddVendorModal = lazy(() => import('../../../../p2p-master-management/supplier-management/AddVendorModal'));
const SupplierEvidenceVaultModal = lazy(() => import('../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));
const warmVault = () => { void import('../../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'); };
import { RISK_GUIDELINES, SevIcon, categoryLabel, isRiskMandatory, riskItems, riskLabel, vaultTargetOf, type Severity } from '../supplier-checks';
import { DOC_TYPE_OPTIONS, PO_TYPE_OPTIONS, type PoDraft, type SetDraft, OPEN_PO_TYPE, PAYMENT_TYPE_OPTIONS } from '../po-draft';
import type { StepCtx } from '../CreatePoForm';
import { MasterDatePicker } from '../../../../../../components/ui/MasterDatePicker';
import { MasterSelect } from '../../../../../../components/ui/MasterSelect';
import { formatDmy } from '../../../../../../utils/formatDmy';
import { useToast } from '../../../../../../contexts/ToastContext';
import { useAuth } from '../../../../../../contexts/AuthContext';
import type { SupplierDetail } from '../../api/po-api';
import { squash as squashType } from '../../../../p2p-master-management/supplier-management/serviceMapping';
import { IcoAlert, IcoCheck, IcoChevron, IcoClock, IcoDocSm, IcoFile, IcoLock, IcoOk, IcoPencil, IcoPin, IcoPlus, IcoShield, IcoStop, IcoUser, IcoWarn } from '../../shared/icons';

const PO_TYPES = PO_TYPE_OPTIONS.map((o) => o.label);
const DOC_TYPES = DOC_TYPE_OPTIONS.map((o) => o.label);
const TRANSPORT_MODES = ['Sea', 'Road', 'Air'];
const INCO_TERMS = ['CIF', 'C&F', 'EXW', 'FOB'];
const PAYMENT_TYPES = PAYMENT_TYPE_OPTIONS;
const LOCKED_PO_TYPES = Object.fromEntries(PO_TYPES.filter((t) => t !== OPEN_PO_TYPE).map((t) => [t, 'Not available yet — only Material / Goods POs can be raised']));

const v = (x: string | null | undefined) => x ?? '';
const NA = 'N/A — Not applicable';
const INR_LOCK = { INR: 'An international PO cannot be in INR' };

type Props = {
  draft: PoDraft;
  set: SetDraft;
  ctx: StepCtx;
  supplierLoading: boolean;
  onPickSupplier: (vendorId: number) => Promise<SupplierDetail | null>;
};

export default function Step1LinkSupplier({ draft, set, ctx, supplierLoading, onPickSupplier }: Props) {
  const toast = useToast();
  const { lookups } = ctx;
  const err = ctx.errors;
  const inv = (key: keyof typeof err) => (err[key] ? ' is-invalid' : '');
  const [poOpen, setPoOpen] = useState(true);
  const [supOpen, setSupOpen] = useState(true);
  const [supCardOpen, setSupCardOpen] = useState(true);
  const [addrOpen, setAddrOpen] = useState(true);
  const [gstOpen, setGstOpen] = useState(true);
  const [legalOpen, setLegalOpen] = useState(true);
  const [riskOpen, setRiskOpen] = useState(true);
  const [addingSupplier, setAddingSupplier] = useState(false);
  const [vaultOpen, setVaultOpen] = useState(false);
  const { user } = useAuth();
  const canEditSupplier = user?.user_type === 'super_admin' || user?.user_type === 'client_admin'
    || !!user?.permissions?.['p2p.supplier']?.can_edit;
  const [editingSupplier, setEditingSupplier] = useState(false);
  const closeSupplierEdit = async () => {
    setEditingSupplier(false);
    lookups.reloadSuppliers();
    if (!draft.vendorId) return;
    const fresh = await onPickSupplier(draft.vendorId);
    if (fresh && (fresh.category ?? '').toLowerCase().includes('blacklist')) {
      clearSupplier();
      toast.warning('Supplier removed from this PO', 'This supplier is now blacklisted — a purchase order cannot be raised on it.');
    } else if (fresh) {
      toast.success('Supplier updated', `${fresh.code} — ${fresh.name} details refreshed on this PO.`);
    }
  };

  const isInternational = draft.docType === 'International';
  const sup = draft.supplier;
  const zohoCurrency = (sup?.zohoCurrency ?? '').toUpperCase();
  const currencyOptions = lookups.currencies;
  const currencySettled = !!sup?.zohoCurrencySettled && !(zohoCurrency === 'INR' && isInternational);
  const currencyLock = useMemo(() => {
    if (!currencySettled) return INR_LOCK;
    const reason = `This supplier trades in ${zohoCurrency}`;
    return Object.fromEntries(
      currencyOptions.filter((c) => c.toUpperCase() !== zohoCurrency).map((c) => [c, reason]),
    );
  }, [currencySettled, zohoCurrency, currencyOptions]);
  const approval = ctx.detail?.gst_approval?.status;
  const supplierLocked = approval === 'pending' || approval === 'approved';
  const needType = draft.poType || OPEN_PO_TYPE;
  const docTypeLocked = !!draft.vendorId;
  const clearSupplier = () => set({ vendorId: null, supplier: null, vault: null, legal: null });

  const lockedPoType = () => toast.info('PO Type not available', 'Only Material / Goods purchase orders can be raised for now.');
  const lockedDocType = () => toast.warning('Document Type is locked', supplierLocked
    ? 'This PO has gone for senior approval — the supplier and document type can no longer change.'
    : 'It follows the selected supplier. Clear the supplier first to change the document type.');
  const lockedSupplier = () => toast.warning('Supplier is locked', 'This PO has gone for senior approval — the supplier can no longer change.');

  const supplierOptions = useMemo(() => lookups.suppliers
    .map((s) => {
      const type = (s.supplier_type ?? '').trim();
      return {
        id: s.id,
        label: `${s.code} — ${s.name}`,
        doc: s.document_type,
        type,
        blacklisted: (s.supplier_category ?? '').toLowerCase().includes('blacklist'),
        wrongType: s.id !== draft.vendorId && squashType(type) !== squashType(needType),
      };
    }),
  // eslint-disable-next-line react-hooks/exhaustive-deps
  [lookups.suppliers, needType, draft.vendorId]);
  const pickedOption = supplierOptions.find((o) => o.id === draft.vendorId)?.label ?? (sup ? `${sup.code} — ${sup.name}` : '');

  const supplierSelectOptions = useMemo(() => supplierOptions.map((o) => ({
    value: String(o.id), label: o.label,
    ...(o.blacklisted
      ? { disabled: true, disabledReason: 'Blacklisted — a purchase order cannot be raised on this supplier.' }
      : o.wrongType
        ? { disabled: true, disabledReason: `${o.type || 'Untyped'} supplier — this is a ${needType} purchase order.` }
        : {}),
    badges: [{ text: o.type || 'No type', tone: 'gray' as const, listOnly: true, ...(o.wrongType ? { lock: true } : {}) }],
    badge: o.blacklisted ? { text: 'Blacklisted', tone: 'red' as const, lock: true }
      : o.doc === 'international' ? { text: 'Int', title: 'International', tone: 'violet' as const } : { text: 'Dom', title: 'Domestic', tone: 'green' as const },
  })), [supplierOptions, needType]);

  const pickSupplier = async (label: string) => {
    const opt = supplierOptions.find((o) => o.label === label);
    if (!opt) return;
    if (opt.blacklisted) { toast.warning('Blacklisted supplier', 'A purchase order cannot be raised on a blacklisted supplier.'); return; }
    const docType = opt.doc === 'international' ? 'International' : 'Domestics';
    if (docType !== draft.docType) {
      set({ docType });
      toast.info('Document Type updated', `Set to ${docType} to match ${opt.label.split(' — ')[0]}.`);
    }
    await onPickSupplier(opt.id);
  };

  const { state: gst, scrutinyAge, filingAge } = gstCheck(draft);

  const mandatory = sup ? isRiskMandatory({ risk: v(sup.risk), category: v(sup.category) }) : false;
  const pickedSupRef = useRef(sup?.id ?? null);
  useEffect(() => {
    if (pickedSupRef.current === (sup?.id ?? null)) return;
    pickedSupRef.current = sup?.id ?? null;
    if (mandatory === draft.physInsp) return;
    set({ physInsp: mandatory });
    toast.info(
      mandatory ? 'Physical Inspection set to Yes' : 'Physical Inspection reset to No',
      mandatory
        ? `${sup?.name ?? 'This supplier'} is high risk — the goods are inspected before release. You can still switch it off.`
        : `${sup?.name ?? 'This supplier'} is not high risk — switch it on yourself if this order still needs an inspection.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sup?.id, mandatory]);

  const legal = draft.legal ?? { sections: [], done: 0, total: 0, pct: 0 };
  const legalTone = legal.pct === 100 ? 'ok' : legal.pct >= 60 ? 'warn' : 'bad';

  const risks = useMemo(() => (sup ? riskItems({
    risk: v(sup.risk), category: v(sup.category), gstStatus: v(sup.gstStatus), gstNo: v(sup.gstNo),
    filing: v(sup.filing), scrutiny: v(sup.scrutiny), legal, international: isInternational,
  }, draft.physInsp) : []), [sup, legal, draft.physInsp, isInternational]);
  const nHigh = risks.filter((r) => r.sev === 'high').length;
  const nMed = risks.filter((r) => r.sev === 'med').length;
  const nOk = risks.filter((r) => r.sev === 'ok').length;
  const riskSev: Severity = nHigh ? 'high' : nMed ? 'med' : 'ok';
  const verdict = nHigh
    ? `${nHigh} critical issue${nHigh === 1 ? '' : 's'} need attention${nMed ? ` · ${nMed} warning${nMed === 1 ? '' : 's'}` : ''}`
    : nMed
      ? `${nMed} warning${nMed === 1 ? '' : 's'} to review before release`
      : 'All checks cleared — this supplier is safe to transact with';

  const vaultTarget = sup ? vaultTargetOf(sup) : null;

  const poDate = formatDmy(ctx.detail?.po_date ?? new Date().toISOString().slice(0, 10));

  return (
    <>
    {editingSupplier && draft.vendorId && (
      <Suspense fallback={null}>
        <AddVendorModal vendorId={draft.vendorId} scope={isInternational ? 'international' : 'domestic'}
          onClose={closeSupplierEdit} onSubmit={closeSupplierEdit} />
      </Suspense>
    )}
    {addingSupplier && (
      <Suspense fallback={null}>
        <AddSupplierFlow onClose={() => setAddingSupplier(false)} />
      </Suspense>
    )}
    {vaultOpen && vaultTarget && (
      <Suspense fallback={null}>
        <SupplierEvidenceVaultModal open supplier={vaultTarget} onVaultChange={ctx.refreshVault} onClose={() => setVaultOpen(false)} />
      </Suspense>
    )}

    <div className={`spi-dt-sec ${poOpen ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head" onClick={() => setPoOpen((o) => !o)}>
        <div className="spi-dt-sec-ico"><IcoFile /></div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">Purchase Order</span>
            <span className="spi-dt-sec-sep" />
            <span className="spi-dt-sec-title">Basic Purchase Order Details</span>
          </div>
          <div className="spi-dt-sec-sub">Core details that identify this purchase order.</div>
        </div>
        <div className="spi-dt-sec-toggle"><IcoChevron /></div>
      </div>

      <div className="spi-dt-sec-body">
        <div className="spi-dt-grid4">
          <Field label="PO Type" req error={err.poType}>
            <EditSelect value={draft.poType} options={PO_TYPES} locked={LOCKED_PO_TYPES} onLockedClick={lockedPoType} onChange={(x) => set({ poType: x })} invalid={!!err.poType} />
          </Field>
          <Field label="Document Type" req error={err.docType}>
            <div className={supplierLoading ? 'cpf-sup-loading' : undefined}>
              <EditSelect value={draft.docType} options={DOC_TYPES} readOnly={docTypeLocked} onLockedClick={lockedDocType} onChange={(x) => set({ docType: x })} invalid={!!err.docType} />
            </div>
            {docTypeLocked && (
              <span className="cpf-lockhint"><IcoLock /> {supplierLocked ? 'Fixed — the PO has gone for senior approval' : 'Set by the supplier — clear the supplier to change it'}</span>
            )}
          </Field>
          <Field label="Mode of Transport" req error={err.transport}>
            <EditSelect value={draft.transport} options={TRANSPORT_MODES} onChange={(x) => set({ transport: x })} invalid={!!err.transport} />
          </Field>
          <Field label="PO Date">
            <div className="spi-dt-inp-auto">
              <input className="spi-dt-inp" value={poDate} readOnly />
              <span className="spi-dt-auto"><IcoLock /> AUTO</span>
            </div>
          </Field>
          <Field label="Expected Delivery Date" req error={err.deliveryDate}>
            <MasterDatePicker value={draft.deliveryDate} onChange={(x) => set({ deliveryDate: x })} invalid={!!err.deliveryDate}
              disabled={ctx.viewOnly} minDate={new Date().toISOString().slice(0, 10)} />
          </Field>
          <Field label="Delivery Location" req error={err.deliveryLocation}>
            <input className={`spi-dt-inp${inv('deliveryLocation')}`} placeholder="Enter delivery location" maxLength={255} value={draft.deliveryLocation} onChange={(e) => set({ deliveryLocation: e.target.value })} />
          </Field>
          <Field label="Payment Type" req error={err.paymentType}>
            <EditSelect value={draft.paymentType} options={PAYMENT_TYPES} onChange={(x) => set({ paymentType: x })} invalid={!!err.paymentType} />
          </Field>
          <Field label="Physical Inspection Required">
            <button type="button" className={`spi-dt-toggle ${draft.physInsp ? 'cpf-toggle-req' : ''}`}
              onClick={() => set({ physInsp: !draft.physInsp })}>
              <span className={`spi-dt-toggle-sw ${draft.physInsp ? 'on' : ''}`}><span className="spi-dt-toggle-knob" /></span>
              <span className="spi-dt-toggle-txt">{draft.physInsp ? 'Yes' : 'No'}</span>
              <span className={`cpf-req ${draft.physInsp ? '' : 'cpf-req--off'}`}>{draft.physInsp ? 'Required' : 'Not required'}</span>
            </button>
            {mandatory && !draft.physInsp && (
              <div className="cpf-lockhint"><i className="ri-error-warning-line" /> High-risk supplier — inspection is recommended</div>
            )}
          </Field>

          {isInternational && (
            <>
              <Field label="Currency" req
                error={err.currency}
                hint={currencySettled
                  ? `${sup?.code ?? 'This supplier'} trades in ${zohoCurrency} — Zoho Books holds one currency per supplier`
                  : zohoCurrency ? `${sup?.code ?? 'This supplier'} shows ${zohoCurrency} in Zoho Books; the first order to sync settles it` : undefined}>
                <EditSelect value={draft.currency} options={currencyOptions} onChange={(x) => set({ currency: x })} invalid={!!err.currency}
                  locked={currencyLock}
                  onLockedClick={(v) => (!currencySettled && v === 'INR')
                    ? toast.warning('INR not allowed', 'An international PO is raised in the supplier currency, not INR.')
                    : toast.warning(
                      `This supplier is on ${zohoCurrency}`,
                      `${zohoCurrency} is already used on ${sup?.zohoCurrencyPo ? `${sup.zohoCurrencyPo}, another purchase order` : 'another purchase order'} against this supplier, so its currency can no longer be changed — Zoho Books holds one currency per supplier.`,
                    )} />
              </Field>
              <Field label="Exchange Rate" req error={err.exchangeRate}>
                <input className={`spi-dt-inp${inv('exchangeRate')}`} inputMode="decimal" placeholder="e.g. 83.25" value={draft.exchangeRate}
                  onChange={(e) => {
                    const v = e.target.value.replace(/[^\d.]/g, '').slice(0, 16);
                    if (v !== '' && Number(v) > FX_RATE_MAX) return;
                    set({ exchangeRate: v });
                  }} />
              </Field>
              <Field label="INCO Term" req error={err.incoTerm}>
                <EditSelect value={draft.incoTerm} options={INCO_TERMS} onChange={(x) => set({ incoTerm: x })} invalid={!!err.incoTerm} />
              </Field>
              <Field label="Port of Loading" req error={err.portLoading}>
                <input className={`spi-dt-inp${inv('portLoading')}`} placeholder="e.g. Nhava Sheva" maxLength={255} value={draft.portLoading} onChange={(e) => set({ portLoading: e.target.value })} />
              </Field>
              <Field label="Port of Discharge" req error={err.portDischarge}>
                <input className={`spi-dt-inp${inv('portDischarge')}`} placeholder="e.g. Jebel Ali" maxLength={255} value={draft.portDischarge} onChange={(e) => set({ portDischarge: e.target.value })} />
              </Field>
              <Field label="Final Destination" req error={err.finalDestination}>
                <input className={`spi-dt-inp${inv('finalDestination')}`} placeholder="Enter final destination" maxLength={128} value={draft.finalDestination} onChange={(e) => set({ finalDestination: e.target.value })} />
              </Field>
              <Field label="Country of Origin" req error={err.countryOrigin}>
                <EditSelect value={draft.countryOrigin} options={lookups.countries} onChange={(x) => set({ countryOrigin: x })} invalid={!!err.countryOrigin} />
              </Field>
            </>
          )}
        </div>
      </div>
    </div>

    <div className={`spi-dt-sec ${supOpen ? '' : 'is-collapsed'}`}>
      <div className="spi-dt-sec-head" onClick={() => setSupOpen((o) => !o)}>
        <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoUser /></div>
        <div className="spi-dt-sec-mid">
          <div className="spi-dt-sec-row">
            <span className="spi-dt-sec-lbl">Supplier</span>
            <span className="spi-dt-sec-sep" />
            <span className="spi-dt-sec-title">Basic Supplier Details</span>
          </div>
          <div className="spi-dt-sec-sub">Primary information about the supplier this PO is issued to.</div>
        </div>
        <div className="spi-dt-sec-toggle"><IcoChevron /></div>
      </div>

      <div className="spi-dt-sec-body">
        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable" onClick={() => setSupCardOpen((o) => !o)}>
            <div className="spi-dt-card-title"><span className="spi-dt-card-ico"><IcoUser /></span> Supplier Details</div>
            <button type="button" className="cpf-addbtn" title="Onboard a supplier that is not in this list" onClick={(e) => { e.stopPropagation(); setAddingSupplier(true); }}>
              <IcoPlus /> Add Supplier
            </button>
            <span className="spi-dt-fields-badge cpf-push">5 FIELDS</span>
            <span className={`cpf-chev ${supCardOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>
          {supCardOpen && (
          <div className={`spi-dt-grid4 cpf-grid5${supplierLoading ? ' cpf-sup-loading' : ''}`}>
            <Field label="SELECT SUPPLIER" req error={err.supplier}>
              <div className="cpf-supsel">
              {supplierLocked ? (
                <EditSelect readOnly value={pickedOption} options={[]} onChange={() => {}} onLockedClick={lockedSupplier} />
              ) : (
                <MasterSelect
                  invalid={!!err.supplier}
                  value={draft.vendorId ? String(draft.vendorId) : ''}
                  currentValueLabel={pickedOption}
                  options={supplierSelectOptions}
                  fitWidth
                  allowDeselect
                  onChange={(id) => {
                    if (!id) { clearSupplier(); return; }
                    const o = supplierOptions.find((x) => String(x.id) === id);
                    if (o) void pickSupplier(o.label);
                  }}
                  placeholder={lookups.loading && !supplierOptions.length ? 'Loading suppliers…' : '— Select Supplier —'}
                  onDisabledClick={(o) => toast.warning('Supplier not available', o.disabledReason ?? 'This supplier cannot be used on this PO.')}
                />
              )}
                {draft.vendorId && canEditSupplier && (
                  <button type="button" className="cpf-supedit" title="Edit this supplier in the Supplier master"
                    aria-label="Edit supplier" onClick={() => setEditingSupplier(true)}>
                    <IcoPencil />
                  </button>
                )}
              </div>
              {supplierLoading
                ? <span className="cpf-lockhint cpf-applying"><span className="cpf-applying__ring" aria-hidden />Applying supplier — its details and document type are loading…</span>
                : supplierLocked
                  ? <span className="cpf-lockhint"><IcoLock /> Fixed — the PO has gone for senior approval</span>
                  : <span className="cpf-lockhint">Only {needType} suppliers can be picked — the rest are listed locked</span>}
            </Field>
            <Field label="COMPANY LEGAL NAME">
              <input className="spi-dt-inp" readOnly value={supplierLoading ? '' : v(sup?.legalName || sup?.name)} placeholder="—" />
            </Field>
            <Field label="SUPPLIER TYPE">
              <EditSelect readOnly value={v(sup?.type)} options={[]} onChange={() => {}} />
            </Field>
            <Field label="RISK LEVEL">
              <EditSelect readOnly value={riskLabel(sup?.risk)} options={[]} onChange={() => {}} />
            </Field>
            <Field label="SUPPLIER CATEGORY">
              <EditSelect readOnly value={categoryLabel(sup?.category)} options={[]} onChange={() => {}} />
            </Field>
          </div>
          )}
        </div>

        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable" onClick={() => setAddrOpen((o) => !o)}>
            <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-3"><IcoPin /></span> Address &amp; Contact Details</div>
            <span className="spi-dt-fields-badge cpf-push">9 FIELDS</span>
            <span className={`cpf-chev ${addrOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>
          {addrOpen && (
          <div className={`spi-dt-grid4${supplierLoading ? ' cpf-sup-loading' : ''}`}>
            <Field label="REGISTERED OFFICE ADDRESS" full>
              <input className="spi-dt-inp" readOnly value={v(sup?.addr)} placeholder="—" />
            </Field>
            <Field label="COUNTRY"><EditSelect readOnly value={v(sup?.country)} options={[]} onChange={() => {}} /></Field>
            <Field label="STATE"><EditSelect readOnly value={v(sup?.state)} options={[]} onChange={() => {}} /></Field>
            <Field label="STATE CODE"><input className="spi-dt-inp" readOnly value={isInternational ? NA : v(sup?.stateCode)} placeholder="—" /></Field>
            <Field label="CITY"><input className="spi-dt-inp" readOnly value={v(sup?.city)} placeholder="—" /></Field>
            <Field label="CONTACT PERSON NAME"><input className="spi-dt-inp" readOnly value={v(sup?.contact)} placeholder="—" /></Field>
            <Field label="DESIGNATION"><input className="spi-dt-inp" readOnly value={v(sup?.desig)} placeholder="—" /></Field>
            <Field label="CONTACT NUMBER"><input className="spi-dt-inp" readOnly value={v(sup?.phone)} placeholder="—" /></Field>
            <Field label="EMAIL ID"><input className="spi-dt-inp" readOnly value={v(sup?.email)} placeholder="—" /></Field>
          </div>
          )}
        </div>

        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable cpf-lghead" onClick={() => setLegalOpen((o) => !o)}>
            <div className="spi-dt-card-title">
              <span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoShield /></span> Supplier Legal Status
            </div>
            {sup && draft.legal ? (
              <>
                <span className={`cpf-push spi-dt-legal-badge ${legal.pct === 100 ? 'ok' : 'warn'}`}>{legal.pct === 100 ? '100% Compliant' : `${legal.pct}% · Needs Review`}</span>
                <button type="button" className="cpf-vault" onPointerEnter={warmVault} onClick={(e) => { e.stopPropagation(); setVaultOpen(true); }}>
                  <IcoShield /> <span>Visit Supplier Evidence Vault</span>
                </button>
                <span className="cpf-lgbar"><span className={`cpf-lgbar__fill cpf-fill-${legalTone}`} style={{ width: `${legal.pct}%` }} /></span>
                <span className="cpf-lgpct">{legal.pct}%</span>
              </>
            ) : (
              <>
                <span className="cpf-push spi-dt-legal-badge cpf-lgbadge--none">–</span>
                <span className="cpf-lgbar"><span className="cpf-lgbar__fill is-empty" /></span>
                <span className="cpf-lgpct">0%</span>
              </>
            )}
            <span className={`cpf-chev ${legalOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>
          {legalOpen && (
            <div className="cpf-lg">
              {sup && draft.legal ? (
                <div className="cpf-lg__tabs">
                  {legal.sections.map((sec, i) => (
                    <div key={sec.name} className={`cpf-lg__tab cpf-lg__tab--${sec.tone}`} title={sec.parts.join(' · ')}>
                      <div className="cpf-lg__hd">
                        <span className="cpf-lg__ico">{i === 0 ? <IcoShield /> : <IcoDocSm />}</span>
                        <span className="cpf-lg__txt">
                          <FitTip label={sec.name}><span className="cpf-lg__nm">{sec.name}</span></FitTip>
                          <FitTip label={sec.sub}><span className="cpf-lg__sub">{sec.sub}</span></FitTip>
                        </span>
                        <span className="cpf-lg__cnt">{sec.done} / {sec.total}</span>
                        <span className="cpf-lg__pct">{sec.pct}%</span>
                      </div>
                      <div className="cpf-lg__bar"><span className="cpf-lg__fill" style={{ width: `${sec.pct}%` }} /></div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="spi-dt-legal-note">
                  {supplierLoading || draft.vendorId
                    ? 'Reading the supplier’s Evidence Vault…'
                    : 'Select a supplier to view legal & compliance status.'}
                </div>
              )}
            </div>
          )}
        </div>

        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable" onClick={() => setGstOpen((o) => !o)}>
            <div className="spi-dt-card-title">
              <span className="spi-dt-card-ico spi-dt-card-ico-4"><IcoDocSm /></span> GST Scrutiny Details
              {gst.tone === 'stop' && <span className="spi-dt-scrutiny-badge"><IcoWarn /> Scrutiny Overdue</span>}
            </div>
            <span className="spi-dt-fields-badge cpf-push">{isInternational ? 'NOT APPLICABLE' : '5 FIELDS'}</span>
            <span className={`cpf-chev ${gstOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>

          {gstOpen && (<>
          <div className={`cpf-gst cpf-gst--${gst.tone}`}>
            <span className="cpf-gst__ico">{gst.tone === 'ok' ? <IcoOk /> : gst.tone === 'stop' ? <IcoStop /> : gst.tone === 'warn' ? <IcoWarn /> : <IcoClock />}</span>
            <span className="cpf-gst__txt">
              <span className="cpf-gst__t">{gst.title}</span>
              <span className="cpf-gst__s">{gst.note}</span>
              {sup && !isInternational && (
                <span className="cpf-gst__meta">
                  Scrutiny <b>{sup.scrutiny ? formatDmy(sup.scrutiny) : '—'}</b>
                  {scrutinyAge !== null && <span className="cpf-gst__age">{scrutinyAge.toFixed(1)} mo ago</span>}
                  <span className="cpf-gst__sep" />
                  Last filing <b>{sup.filing ? formatDmy(sup.filing) : '—'}</b>
                  {filingAge !== null && <span className="cpf-gst__age">{filingAge.toFixed(1)} mo ago</span>}
                </span>
              )}
            </span>
          </div>

          <div className={`spi-dt-grid4${supplierLoading ? ' cpf-sup-loading' : ''}`}>
            <Field label="SCRUTINY DATE"><input className="spi-dt-inp" readOnly value={isInternational ? NA : sup?.scrutiny ? formatDmy(sup.scrutiny) : ''} placeholder="—" /></Field>
            <Field label="GST NUMBER"><input className="spi-dt-inp" readOnly value={isInternational ? NA : v(sup?.gstNo)} placeholder="—" /></Field>
            <Field label="GST STATUS"><EditSelect readOnly value={isInternational ? NA : v(sup?.gstStatus)} options={[]} onChange={() => {}} /></Field>
            <Field label="LAST FILING DATE"><input className="spi-dt-inp" readOnly value={isInternational ? NA : sup?.filing ? formatDmy(sup.filing) : ''} placeholder="—" /></Field>
            <Field label="PREV. INVOICE / REMARKS" full>
              <textarea className="spi-dt-textarea" readOnly value={isInternational ? NA : v(sup?.remarks)} placeholder="—" />
            </Field>
          </div>
          </>)}
        </div>

        <div className="spi-dt-card">
          <div className="spi-dt-card-head cpf-clickable" onClick={() => setRiskOpen((o) => !o)}>
            <div className="spi-dt-card-title"><span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoAlert /></span> Supplier Risk Alert</div>
            <span className={`cpf-risk__badge cpf-risk__badge--${riskSev} ${sup ? '' : 'cpf-hide'}`}>
              {!sup ? ''
                : nHigh ? `${nHigh} critical${nMed ? ` · ${nMed} warning` : ''}`
                  : nMed ? `${nMed} warning${nMed === 1 ? '' : 's'}`
                    : 'All clear'}
            </span>
            <span className={`cpf-chev ${riskOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
          </div>
          {riskOpen && (
            <div className="cpf-risk">
              {sup ? (
                <>
                  <div className={`cpf-risk__sum cpf-risk__sum--${riskSev}`}>
                    <span className="cpf-risk__sum-ico"><SevIcon sev={riskSev} /></span>
                    <div className="cpf-risk__sum-txt">
                      <div className="cpf-risk__sum-t">{verdict}</div>
                      <div className="cpf-risk__sum-x">{nOk} of {risks.length} checks passed · {isInternational ? 'risk rating, category and documents (GST not applicable)' : 'risk rating, category, GST registration, filing, scrutiny and documents'}</div>
                    </div>
                  </div>
                  {mandatory && (
                    <div className="cpf-guide">
                      <div className="cpf-guide__hd">
                        <span className="cpf-guide__ico"><IcoLock /></span>
                        <span className="cpf-guide__t">Mandatory Guidelines</span>
                        <span className="cpf-guide__tag">Enforced on this PO</span>
                      </div>
                      <div className="cpf-guide__list">
                        {RISK_GUIDELINES.map((g) => (
                          <div key={g.title} className="cpf-guide__row">
                            <span className="cpf-guide__ck"><IcoCheck /></span>
                            <div>
                              <div className="cpf-guide__rt">{g.title}</div>
                              <div className="cpf-guide__rx">{g.note}</div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                  <div className="cpf-risk__list">
                    {risks.map((r) => (
                      <div key={r.title} className={`cpf-risk__row cpf-risk__row--${r.sev}`}>
                        <span className="cpf-risk__dot"><SevIcon sev={r.sev} /></span>
                        <div className="cpf-risk__txt">
                          <div className="cpf-risk__t">{r.title}</div>
                          <div className="cpf-risk__d">{r.note}</div>
                        </div>
                        <span className="cpf-risk__tag">{r.tag}</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <div className="cpf-risk__empty">Select a supplier to view risk alerts.</div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
    </>
  );
}
