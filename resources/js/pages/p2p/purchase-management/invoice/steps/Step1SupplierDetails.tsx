import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import Tooltip from '../../../../../components/ui/Tooltip';
import { MasterDatePicker } from '../../../../../components/ui/MasterDatePicker';
import { EditSelect, Field, WizSpinner } from '../../order/create-po/form-fields';
import { Shimmer } from '../../../../../components/ui/Shimmer';
import {
  SevIcon, gstState, isRiskMandatory, monthsAgo, riskItems, vaultTargetOf, type Severity,
} from '../../order/create-po/supplier-checks';
import { poLookupApi, type SupplierOption } from '../../order/api/po-api';
import { legalFromVault } from '../../order/create-po/supplier-checks';
import { draftFromScrutiny, draftFromSupplier, newestScrutiny } from '../invoice-draft';
import { spiApi } from '../spi-api';
import { useToast } from '../../../../../contexts/ToastContext';

const SupplierEvidenceVaultModal = lazy(() => import('../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'));
const warmVault = () => { void import('../../../p2p-master-management/supplier-management/SupplierEvidenceVaultModal'); };

const AddSupplierFlow = lazy(() => import('../../order/create-po/AddSupplierFlow'));
const warmSupplierFlow = () => { void import('../../order/create-po/AddSupplierFlow'); };
import { MasterSelect } from '../../../../../components/ui/MasterSelect';
import { formatDmy } from '../../../../../utils/formatDmy';
import {
  IcoAlert, IcoCheck, IcoChevron, IcoClock, IcoDocSm, IcoFile, IcoLock, IcoOk, IcoPin,
  IcoPencil, IcoPlus, IcoShield, IcoStop, IcoUser, IcoWarn,
} from '../../../icons';
import type { InvoiceDraft, SetDraft } from '../invoice-draft';

const PO_TYPES = ['Material / Goods', 'Services'];
const DOC_TYPES = ['Domestics', 'International'];
/* The server's own list (PurchaseOrder::INCO_TERMS), as the PO form spells it. */
const INCO_TERMS = ['CIF', 'C&F', 'EXW', 'FOB'];
/* The ceiling App\Support\FxRate enforces. */
const FX_RATE_MAX = 10000;
const TRANSPORT_MODES = ['Road', 'Rail', 'Air', 'Sea'];
const PAYMENT_TYPES = ['Advance', 'Credit', 'Partial Advance'];
const SUPPLIER_TYPES = ['Manufacturer', 'Trader', 'Distributor', 'Service Provider'];
const RISK_LEVELS = ['Low Risk', 'Medium Risk', 'High Risk'];
const SUPPLIER_CATEGORIES = ['Star Supplier', 'Regular Supplier', 'High Risk Supplier', 'Blacklisted'];
const GST_STATUSES = ['Active', 'Suspended', 'Cancelled'];
const COUNTRIES = ['India', 'United Arab Emirates', 'Singapore', 'United States'];
const STATES = ['Maharashtra', 'Gujarat', 'Karnataka', 'Delhi', 'Tamil Nadu'];

/* Every field in these two cards is filled from the supplier record, so while
   that record is being fetched the honest thing on screen is the shape of what
   is coming — not a grid of empty inputs, which reads as a form waiting for
   you to type into it when in fact it is about to answer itself. 38px is the
   height of .spi-dt-inp, so nothing moves when the real controls land. */
const SUPPLIER_SK = ['SELECT SUPPLIER', 'COMPANY LEGAL NAME', 'SUPPLIER TYPE', 'RISK LEVEL', 'SUPPLIER CATEGORY'];
const ADDRESS_SK = ['COUNTRY', 'STATE', 'STATE CODE', 'CITY', 'CONTACT PERSON NAME', 'DESIGNATION', 'CONTACT NUMBER', 'EMAIL ID'];
function FieldSk({ label, full }: { label: string; full?: boolean }) {
  return <Field label={label} full={full}><Shimmer height={38} radius={10} /></Field>;
}

const GUIDELINES = [
  {
    title: 'Physical inspection is mandatory',
    note: 'Goods must be physically inspected and cleared by QA before the GRN is accepted into inventory.',
  },
  {
    title: 'Payment against milestones only',
    note: 'Release payment strictly against installation, goods delivery and 100% GST scrutiny — no advance.',
  },
];

export default function Step1SupplierDetails({ draft, set, error = null, readOnly = false, direct = false, directSupplier, onResolved }: {
  draft: InvoiceDraft; set: SetDraft; error?: string | null; readOnly?: boolean;
  /* A Direct SPI stands on its own: there is no purchase order to describe,
     so the whole Purchase Order section goes rather than standing there with
     nothing in its fields. */
  direct?: boolean;
  /* Who the Direct SPI setup named. A label and a code, not a record — see
     the seeding effect below for why that distinction decides everything. */
  directSupplier?: { code?: string; name?: string };
  /* Fired once, when the setup's supplier has been resolved (or found not to
     resolve). The form holds the stage skeleton until it hears this, so it
     must fire on every path out of that effect — including the ones with no
     work to do — or the skeleton never lifts. */
  onResolved?: () => void;
}) {
  const [poOpen, setPoOpen] = useState(true);
  const [supOpen, setSupOpen] = useState(true);
  const [supCardOpen, setSupCardOpen] = useState(true);
  const [addrOpen, setAddrOpen] = useState(true);
  const [legalOpen, setLegalOpen] = useState(true);
  const [gstOpen, setGstOpen] = useState(true);
  const [riskOpen, setRiskOpen] = useState(true);

  const {
    poType, docType, transport, poDate, deliveryDate, deliveryLocation, paymentType,
    physInspection, poNumber, supplier, supplierCode, legalName, supplierType, riskLevel, category,
    address, country, state, stateCode, city, contactName, designation, contactNumber, email,
    scrutinyDate, gstNumber, gstStatus, filingDate, remarks,
    currency, exchangeRate, incoTerm, portLoading, portDischarge, finalDestination, countryOrigin,
  } = draft;

  const hasSupplier = !!supplier;

  const hasPo = !!poNumber;
  const locked = hasPo || readOnly;

  /* The same seven fields the purchase order shows for an international
     document. With a PO they are the PO's, read-only; a standalone invoice
     fills them in. */
  const isInternational = docType === 'International';

  /* Fetched only when they are editable — with a PO the values come from it,
     and a domestic invoice never shows the fields at all. */
  const [currencies, setCurrencies] = useState<string[]>([]);
  const [countries, setCountries] = useState<string[]>([]);
  useEffect(() => {
    if (!isInternational || hasPo || currencies.length) return;
    let live = true;
    const names = (rows: Record<string, unknown>[], key: string) =>
      rows.map(r => String(r[key] ?? r.name ?? '')).filter(Boolean);
    void (async () => {
      try {
        const [c, k] = await Promise.all([
          poLookupApi.master('currencies'), poLookupApi.master('countries'),
        ]);
        if (!live) return;
        setCurrencies(names(c, 'code'));
        setCountries(names(k, 'name'));
      } catch {
        /* The fields stay usable: an empty list leaves the select with
           nothing to offer rather than breaking the step. */
      }
    })();
    return () => { live = false; };
  }, [isInternational, hasPo, currencies.length]);

  const toast = useToast();
  const [vendorId, setVendorId] = useState<number | null>(null);
  const [vault, setVault] = useState<ReturnType<typeof vaultTargetOf> | null>(null);
  const [vaultOpen, setVaultOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [busy, setBusy] = useState<'vault' | 'edit' | null>(null);

  const resolveVendorId = async (purpose: string): Promise<number | null> => {
    if (draft.vendorId !== null) return draft.vendorId;
    if (vendorId !== null) return vendorId;
    const list = await poLookupApi.suppliers();
    const name = supplier.trim().toLowerCase();
    const byName = list.filter(s => s.name.trim().toLowerCase() === name);
    const hit = byName.length > 1
      ? byName.find(s => s.code?.toLowerCase() === supplierCode.trim().toLowerCase()) ?? byName[0]
      : byName[0];
    if (!hit) {
      toast.info('Supplier not in the master', `${supplier} could not be found, so ${purpose} cannot be opened.`);
      return null;
    }
    setVendorId(hit.id);
    return hit.id;
  };

  const openVault = async () => {
    if (vault) { setVaultOpen(true); return; }
    if (draft.supplierDetail) { setVault(vaultTargetOf(draft.supplierDetail)); setVaultOpen(true); return; }
    if (busy) return;
    setBusy('vault');
    try {
      const id = await resolveVendorId('its Evidence Vault');
      if (id === null) return;
      setVault(vaultTargetOf(await poLookupApi.supplier(id)));
      setVaultOpen(true);
    } catch {
      toast.error('Could not open the Evidence Vault', 'The supplier could not be loaded — please try again.');
    } finally {
      setBusy(null);
    }
  };

  const openEdit = async () => {
    if (busy) return;
    setBusy('edit');
    try {
      const id = await resolveVendorId('the supplier master');
      if (id !== null) setEditOpen(true);
    } catch {
      toast.error('Could not open the supplier', 'The supplier could not be loaded — please try again.');
    } finally {
      setBusy(null);
    }
  };

  const editVendorId = draft.vendorId ?? vendorId;

  const [refreshing, setRefreshing] = useState(false);

  /* Everything this form knows about a supplier, read in one go: the master
     record, its newest GST scrutiny and its Evidence Vault. Picking one on a
     Direct SPI and re-reading one after an edit want exactly the same work,
     so they share it — the vendor id is the only thing the caller supplies,
     and it goes into the draft because the save is keyed on it. */
  const loadSupplier = async (id: number) => {
    const [fresh, scrutinyRows] = await Promise.all([
      poLookupApi.supplier(id),
      spiApi.vendorScrutiny(id).catch(() => null),
    ]);
    const gst = newestScrutiny(scrutinyRows);
    set({
      vendorId: id,
      ...draftFromSupplier(fresh),
      ...(gst ? draftFromScrutiny(gst) : { scrutinyDate, filingDate }),
    });
    setVendorId(id);
    setVault(vaultTargetOf(fresh));
    poLookupApi.supplierVault(id)
      .then(v => set({ legal: legalFromVault(v) }))
      .catch(() => {});
    return fresh;
  };

  const refreshSupplier = async () => {
    const id = editVendorId;
    if (id === null) return;
    setRefreshing(true);
    try {
      const fresh = await loadSupplier(id);
      if ((fresh.category ?? '').toLowerCase().includes('blacklist')) {
        toast.warning('Supplier is now blacklisted', `${fresh.name} is blacklisted — review this invoice before saving it.`);
      } else {
        toast.success('Supplier updated', `${fresh.code} — ${fresh.name} details refreshed on this invoice.`);
      }
    } catch {
      toast.error('Could not refresh the supplier', 'The changes were saved, but this form could not reload them — reopen it to see them.');
    } finally {
      setRefreshing(false);
    }
  };

  /* A Direct SPI names its supplier here and nowhere else — there is no
     purchase order to inherit one from — so the field is a live list off the
     master rather than the single read-only value a With-PO invoice shows. */
  const [supplierOpts, setSupplierOpts] = useState<SupplierOption[]>([]);
  const [picking, setPicking] = useState(false);
  useEffect(() => {
    if (!direct || hasSupplier) return;
    let live = true;
    poLookupApi.suppliers()
      .then(rows => { if (live) setSupplierOpts(rows); })
      .catch(() => { if (live) setSupplierOpts([]); });
    return () => { live = false; };
  }, [direct, hasSupplier]);

  const pickSupplier = async (id: number) => {
    if (picking) return;
    setPicking(true);
    try {
      const fresh = await loadSupplier(id);
      if ((fresh.category ?? '').toLowerCase().includes('blacklist')) {
        toast.warning('Supplier is blacklisted', `${fresh.name} is blacklisted — review this invoice before saving it.`);
      }
    } catch {
      toast.error('Could not load the supplier', 'Please pick it again.');
    } finally {
      setPicking(false);
    }
  };

  /* The setup already asked who the supplier is, so this step should not ask
     again — it should arrive filled in and read-only.
     What it must NOT do is paste the chosen name into the draft: the save is
     keyed on a vendor id, and a name alone would lock the field on a record
     the server may never have heard of. So the chosen code is RESOLVED
     against the master first and, on a hit, goes through the very same
     loadSupplier the picker uses — the draft then holds a real id and
     hasSupplier flips the field to its read-only form on its own.
     A miss leaves the live picker exactly as it is today, which is the right
     fallback: the setup named someone this master does not carry, and the
     only honest thing to do is ask. */
  const seeded = useRef(false);
  useEffect(() => {
    if (!direct || seeded.current) return;
    const want = (directSupplier?.code ?? '').trim().toLowerCase();
    const wantName = (directSupplier?.name ?? '').trim().toLowerCase();
    /* Nothing to resolve — but the form above is holding a skeleton until it
       hears back, so every exit from this effect has to report, including the
       ones that do no work at all. */
    if (hasSupplier || (!want && !wantName)) { seeded.current = true; onResolved?.(); return; }
    seeded.current = true;
    let live = true;
    setPicking(true);
    poLookupApi.suppliers()
      .then(rows => {
        if (!live) return undefined;
        const hit = (want && rows.find(r => (r.code ?? '').trim().toLowerCase() === want))
          || (wantName && rows.find(r => r.name.trim().toLowerCase() === wantName))
          || null;
        return hit ? loadSupplier(hit.id) : undefined;
      })
      .catch(() => undefined)
      .finally(() => { if (live) { setPicking(false); onResolved?.(); } });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [direct, hasSupplier, directSupplier?.code, directSupplier?.name]);

  /* A record is on its way in and none of these fields can be answered yet —
     either the setup's supplier is being resolved, or one was just picked by
     hand. Both go through loadSupplier, so both raise `picking`. */
  const resolving = picking && !hasSupplier;

  /* Everything in step 01 is the supplier master's to state, so the moment a
     supplier is resolved the whole step reads. `locked` already covers the
     purchase-order and view-only cases; this adds the one that was missing. */
  const gstLocked = locked || hasSupplier;

  const legal = draft.legal ?? { sections: [], done: 0, total: 0, pct: 0 };
  const legalTone = legal.pct === 100 ? 'ok' : legal.pct >= 60 ? 'warn' : 'bad';

  const gst = gstState(hasSupplier ? supplier : '', scrutinyDate, filingDate);
  const scrutinyAge = monthsAgo(scrutinyDate);
  const filingAge = monthsAgo(filingDate);

  const risks = useMemo(
    () => (hasSupplier
      ? riskItems({
        risk: riskLevel, category, gstStatus, gstNo: gstNumber,
        filing: filingDate, scrutiny: scrutinyDate,
        legal: { done: legal.done, total: legal.total },
        international: docType === 'International',
      }, physInspection)
      : []),
    [hasSupplier, riskLevel, category, gstStatus, gstNumber, filingDate, scrutinyDate, legal, docType, physInspection],
  );

  const nHigh = risks.filter(r => r.sev === 'high').length;
  const nMed = risks.filter(r => r.sev === 'med').length;
  const nOk = risks.filter(r => r.sev === 'ok').length;
  const riskSev: Severity = nHigh ? 'high' : nMed ? 'med' : 'ok';
  const verdict = nHigh
    ? `${nHigh} critical issue${nHigh === 1 ? ' needs' : 's need'} attention${nMed ? ` · ${nMed} warning${nMed === 1 ? '' : 's'}` : ''}`
    : nMed
      ? `${nMed} warning${nMed === 1 ? '' : 's'} to review before release`
      : 'All checks passed';

  return (
    <>
      {vaultOpen && vault && (
        <Suspense fallback={null}>
          <SupplierEvidenceVaultModal open supplier={vault} onClose={() => setVaultOpen(false)} />
        </Suspense>
      )}

      {editOpen && editVendorId !== null && (
        <Suspense fallback={null}>
          <AddSupplierFlow vendorId={editVendorId} onClose={() => setEditOpen(false)} onSaved={() => void refreshSupplier()} />
        </Suspense>
      )}
      {adding && (
        <Suspense fallback={null}>
          <AddSupplierFlow onClose={() => setAdding(false)} />
        </Suspense>
      )}

      {error && (
        <div className="spi-dt-legal-note is-error" role="alert">
          Could not load the purchase order: {error}
        </div>
      )}

      {!direct && (
      <div className={`spi-dt-sec ${poOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-dt-sec-head" onClick={() => setPoOpen(o => !o)}>
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
            <Field label="PO Type" req>
              <EditSelect readOnly={locked} value={poType} options={PO_TYPES} onChange={v => set({ poType: v })} />
            </Field>
            <Field label="Document Type" req>
              <EditSelect readOnly={locked} value={docType} options={DOC_TYPES} onChange={v => set({ docType: v })} />
            </Field>
            <Field label="Mode of Transport" req>
              <EditSelect readOnly={locked} value={transport} options={TRANSPORT_MODES} onChange={v => set({ transport: v })} />
            </Field>
            <Field label="PO Date">
              <div className="spi-dt-inp-auto">
                <input className="spi-dt-inp" value={formatDmy(poDate)} readOnly />
                <span className="spi-dt-auto"><IcoLock /> AUTO</span>
              </div>
            </Field>
            <Field label="Expected Delivery Date" req>
              {locked
                ? <input className="spi-dt-inp" value={formatDmy(deliveryDate)} readOnly />
                : <MasterDatePicker value={deliveryDate} onChange={v => set({ deliveryDate: v })} />}
            </Field>
            <Field label="Delivery Location" req>
              <input className="spi-dt-inp" readOnly={locked}
                placeholder={locked ? '—' : 'Enter delivery location'} maxLength={255}
                value={deliveryLocation} onChange={e => set({ deliveryLocation: e.target.value })} />
            </Field>
            <Field label="Payment Type" req>
              <EditSelect readOnly={locked} value={paymentType} options={PAYMENT_TYPES} onChange={v => set({ paymentType: v })} />
            </Field>
            <Field label="Physical Inspection Status">
              <div className="spi-dt-inp-auto">
                <input className="spi-dt-inp" value={physInspection ? 'Required' : 'Not Applicable'} readOnly />
                <span className="spi-dt-auto">{physInspection ? 'MANDATORY' : 'NOT REQUIRED'}</span>
              </div>
            </Field>

            {isInternational && (
              <>
                <Field label="Currency" req>
                  <EditSelect readOnly={locked} value={currency} options={currencies}
                    onChange={v => set({ currency: v })} />
                </Field>
                <Field label="Exchange Rate" req>
                  {/* Digits and one point only, and capped the way the PO caps
                      it: a rate is a multiplier, so a typo does not add one
                      digit to the invoice, it adds as many as the typo. */}
                  <input className="spi-dt-inp" readOnly={locked} inputMode="decimal"
                    placeholder={locked ? '—' : 'e.g. 83.25'} value={exchangeRate}
                    onChange={e => {
                      const v = e.target.value.replace(/[^d.]/g, '').slice(0, 16);
                      if (v !== '' && Number(v) > FX_RATE_MAX) return;
                      set({ exchangeRate: v });
                    }} />
                </Field>
                <Field label="INCO Term" req>
                  <EditSelect readOnly={locked} value={incoTerm} options={INCO_TERMS}
                    onChange={v => set({ incoTerm: v })} />
                </Field>
                <Field label="Port of Loading" req>
                  <input className="spi-dt-inp" readOnly={locked} maxLength={255}
                    placeholder={locked ? '—' : 'e.g. Nhava Sheva'} value={portLoading}
                    onChange={e => set({ portLoading: e.target.value })} />
                </Field>
                <Field label="Port of Discharge" req>
                  <input className="spi-dt-inp" readOnly={locked} maxLength={255}
                    placeholder={locked ? '—' : 'e.g. Jebel Ali'} value={portDischarge}
                    onChange={e => set({ portDischarge: e.target.value })} />
                </Field>
                <Field label="Final Destination" req>
                  <input className="spi-dt-inp" readOnly={locked} maxLength={128}
                    placeholder={locked ? '—' : 'Enter final destination'} value={finalDestination}
                    onChange={e => set({ finalDestination: e.target.value })} />
                </Field>
                <Field label="Country of Origin" req>
                  <EditSelect readOnly={locked} value={countryOrigin} options={countries}
                    onChange={v => set({ countryOrigin: v })} />
                </Field>
              </>
            )}
          </div>
        </div>
      </div>

      )}

      <div className={`spi-dt-sec ${supOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-dt-sec-head" onClick={() => setSupOpen(o => !o)}>
          <div className="spi-dt-sec-ico spi-dt-sec-ico-2"><IcoUser /></div>
          <div className="spi-dt-sec-mid">
            <div className="spi-dt-sec-row">
              <span className="spi-dt-sec-lbl">Supplier</span>
              <span className="spi-dt-sec-sep" />
              <span className="spi-dt-sec-title">Basic Supplier Details</span>
            </div>
            <div className="spi-dt-sec-sub">
              Primary information about the supplier this {direct ? 'invoice' : 'PO'} is issued to.
            </div>
          </div>
          <div className="spi-dt-sec-toggle"><IcoChevron /></div>
        </div>

        <div className="spi-dt-sec-body">
          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable" onClick={() => setSupCardOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico"><IcoUser /></span> Supplier Details
              </div>
              {!hasPo && (
                <Tooltip label="Onboard a supplier that is not in this list"><button type="button" className="cpf-addbtn"
                  onPointerEnter={warmSupplierFlow}
                  onClick={e => { e.stopPropagation(); setAdding(true); }}>
                  <IcoPlus /> Add Supplier
                </button></Tooltip>
              )}
              <span className="spi-dt-fields-badge cpf-push">5 FIELDS</span>
              <span className={`cpf-chev ${supCardOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
            </div>
            {supCardOpen && resolving && (
              <div className="spi-dt-grid4 cpf-grid5">
                {SUPPLIER_SK.map(l => <FieldSk key={l} label={l} />)}
              </div>
            )}
            {supCardOpen && !resolving && (
              <div className="spi-dt-grid4 cpf-grid5">
                <Field label="SELECT SUPPLIER" req>
                  <div className="cpf-supsel">
                    {hasSupplier ? (
                      <EditSelect readOnly value={supplier} options={[]} onChange={() => {}} />
                    ) : (
                      <MasterSelect
                        value={draft.vendorId != null ? String(draft.vendorId) : ''}
                        /* The code is the chip, the name the label — the same
                           row the warehouse and zone pickers draw. */
                        options={supplierOpts.map(o => ({
                          value: String(o.id), label: o.name, code: o.code, fullLabel: `${o.code} · ${o.name}`,
                        }))}
                        placeholder={picking ? 'Loading supplier…' : '— Select Supplier —'}
                        searchPlaceholder="Search supplier code or name"
                        disabled={picking || readOnly}
                        onChange={v => { if (v) void pickSupplier(Number(v)); }}
                      />
                    )}
                    {/* The supplier is fetched before the form can open, and on
                        a slow server that is a second or two of nothing. The
                        button turns, so the press is visibly received. */}
                    {hasSupplier && (
                      <Tooltip label={busy === 'edit'
                        ? 'Opening the supplier…'
                        : `Edit ${supplier} in the Supplier master`}>
                        <button
                          type="button"
                          className="cpf-supedit"
                          aria-label={busy === 'edit' ? 'Opening the supplier' : 'Edit supplier'}
                          aria-busy={busy === 'edit'}
                          disabled={busy === 'edit' || refreshing}
                          onPointerEnter={warmSupplierFlow}
                          onClick={() => void openEdit()}
                        >
                          {busy === 'edit' ? <WizSpinner /> : <IcoPencil />}
                        </button>
                      </Tooltip>
                    )}
                  </div>
                </Field>
                <Field label="COMPANY LEGAL NAME">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "Registered legal entity name"} readOnly={hasSupplier}
                    value={legalName} onChange={e => set({ legalName: e.target.value })} />
                </Field>
                <Field label="SUPPLIER TYPE">
                  <EditSelect readOnly={hasSupplier} value={supplierType} options={SUPPLIER_TYPES} onChange={v => set({ supplierType: v })} />
                </Field>
                <Field label="RISK LEVEL">
                  <EditSelect readOnly={hasSupplier} value={riskLevel} options={RISK_LEVELS} onChange={v => set({ riskLevel: v })} />
                </Field>
                <Field label="SUPPLIER CATEGORY">
                  <EditSelect readOnly={hasSupplier} value={category} options={SUPPLIER_CATEGORIES} onChange={v => set({ category: v })} />
                </Field>
              </div>
            )}
          </div>

          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable" onClick={() => setAddrOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico spi-dt-card-ico-3"><IcoPin /></span> Address &amp; Contact Details
              </div>
              <span className="spi-dt-fields-badge cpf-push">9 FIELDS</span>
              <span className={`cpf-chev ${addrOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
            </div>
            {addrOpen && resolving && (
              <div className="spi-dt-grid4">
                <FieldSk label="REGISTERED OFFICE ADDRESS" full />
                {ADDRESS_SK.map(l => <FieldSk key={l} label={l} />)}
              </div>
            )}
            {addrOpen && !resolving && (
              <div className="spi-dt-grid4">
                <Field label="REGISTERED OFFICE ADDRESS" full>
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "Building / street / area / landmark, with PIN code"} readOnly={hasSupplier}
                    value={address} onChange={e => set({ address: e.target.value })} />
                </Field>
                <Field label="COUNTRY">
                  <EditSelect readOnly={hasSupplier} value={country} options={COUNTRIES} onChange={v => set({ country: v })} />
                </Field>
                <Field label="STATE">
                  <EditSelect readOnly={hasSupplier} value={state} options={STATES} onChange={v => set({ state: v })} />
                </Field>
                <Field label="STATE CODE">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "e.g. 27"} readOnly={hasSupplier}
                    value={stateCode} onChange={e => set({ stateCode: e.target.value })} />
                </Field>
                <Field label="CITY">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "Enter city"} readOnly={hasSupplier}
                    value={city} onChange={e => set({ city: e.target.value })} />
                </Field>
                <Field label="CONTACT PERSON NAME">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "Full name"} readOnly={hasSupplier}
                    value={contactName} onChange={e => set({ contactName: e.target.value })} />
                </Field>
                <Field label="DESIGNATION">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "e.g. Procurement Manager"} readOnly={hasSupplier}
                    value={designation} onChange={e => set({ designation: e.target.value })} />
                </Field>
                <Field label="CONTACT NUMBER">
                  <input className="spi-dt-inp" placeholder={hasSupplier ? "—" : "+91"} readOnly={hasSupplier}
                    value={contactNumber} onChange={e => set({ contactNumber: e.target.value })} />
                </Field>
                <Field label="EMAIL ID">
                  <input className="spi-dt-inp" type="email" placeholder={hasSupplier ? "—" : "name@company.com"} readOnly={hasSupplier}
                    value={email} onChange={e => set({ email: e.target.value })} />
                </Field>
              </div>
            )}
          </div>

          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable cpf-lghead" onClick={() => setLegalOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoShield /></span> Supplier Legal Status
              </div>
              {hasSupplier ? (
                <>
                  <span className={`cpf-push spi-dt-legal-badge ${legal.pct === 100 ? 'ok' : 'warn'}`}>
                    {legal.pct === 100 ? '100% Compliant' : `${legal.pct}% · Needs Review`}
                  </span>
                  <Tooltip label={`Open ${supplier}'s Evidence Vault`}>
                    <button
                      type="button"
                      className="cpf-vault"
                      onClick={e => { e.stopPropagation(); void openVault(); }}
                      onPointerEnter={warmVault}
                      disabled={busy === 'vault'}
                      aria-busy={busy === 'vault'}
                    >
                      {busy === 'vault' ? <WizSpinner /> : <IcoShield />}{' '}
                      <span>{busy === 'vault' ? 'Opening…' : 'Visit Supplier Evidence Vault'}</span>
                    </button>
                  </Tooltip>
                  <span className="cpf-lgbar">
                    <span className={`cpf-lgbar__fill cpf-fill-${legalTone}`} style={{ width: `${legal.pct}%` }} />
                  </span>
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
                {hasSupplier ? (
                  <div className="cpf-lg__tabs">
                    {legal.sections.map((sec, i) => (
                      <Tooltip key={sec.name} label={sec.parts.join(' · ')}>
                        <div className={`cpf-lg__tab cpf-lg__tab--${sec.tone}`}>
                          <div className="cpf-lg__hd">
                            <span className="cpf-lg__ico">{i === 0 ? <IcoShield /> : <IcoDocSm />}</span>
                            <span className="cpf-lg__txt">
                              <span className="cpf-lg__nm">{sec.name}</span>
                              <span className="cpf-lg__sub">{sec.sub}</span>
                            </span>
                            <span className="cpf-lg__cnt">{sec.done} / {sec.total}</span>
                            <span className="cpf-lg__pct">{sec.pct}%</span>
                          </div>
                          <div className="cpf-lg__bar">
                            <span className="cpf-lg__fill" style={{ width: `${sec.pct}%` }} />
                          </div>
                        </div>
                      </Tooltip>
                    ))}
                  </div>
                ) : (
                  <div className="spi-dt-legal-note">
                    Select a supplier to view legal &amp; compliance status.
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable" onClick={() => setGstOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico spi-dt-card-ico-4"><IcoDocSm /></span> GST Scrutiny Details
              </div>
              <span className="spi-dt-fields-badge cpf-push">5 FIELDS</span>
              <span className={`cpf-chev ${gstOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
            </div>
            {gstOpen && (
              <>
                <div className={`cpf-gst invf-gst${gst.tone === 'idle' ? '' : ` cpf-gst--${gst.tone}`}`}>
                  <span className="cpf-gst__ico">
                    {gst.tone === 'ok' ? <IcoOk />
                      : gst.tone === 'stop' ? <IcoStop />
                        : gst.tone === 'warn' ? <IcoWarn /> : <IcoClock />}
                  </span>
                  <span className="cpf-gst__txt">
                    <span className="cpf-gst__t">{gst.title}</span>
                    <span className="cpf-gst__s">{gst.note}</span>
                    {hasSupplier && docType !== 'International' && (
                      <span className="cpf-gst__meta">
                        Scrutiny <b>{scrutinyDate ? formatDmy(scrutinyDate) : '—'}</b>
                        {scrutinyAge !== null && <span className="cpf-gst__age">{scrutinyAge.toFixed(1)} mo ago</span>}
                        <span className="cpf-gst__sep" />
                        Last filing <b>{filingDate ? formatDmy(filingDate) : '—'}</b>
                        {filingAge !== null && <span className="cpf-gst__age">{filingAge.toFixed(1)} mo ago</span>}
                      </span>
                    )}
                  </span>
                </div>
                {/* gstLocked, not `locked`/`hasPo`. These five were the only
                    fields in step 01 still gated on there being a purchase
                    order, so on a Direct SPI — which has none by definition —
                    they stayed typeable while the supplier's name, address
                    and risk beside them were all read-only. They are not this
                    invoice's data to edit either way: they arrive from the
                    supplier's newest scrutiny record via draftFromScrutiny,
                    and typing over them here would have changed the invoice
                    and left the master saying something else. The Supplier
                    Risk Alert directly below reads from exactly these values,
                    so an edit here also silently rewrote its verdict. */}
                <div className="spi-dt-grid4">
                  <Field label="SCRUTINY DATE">
                    {gstLocked
                      ? <input className="spi-dt-inp" value={formatDmy(scrutinyDate)} readOnly />
                      : <MasterDatePicker value={scrutinyDate} onChange={v => set({ scrutinyDate: v })} />}
                  </Field>
                  <Field label="GST NUMBER">
                    <input className="spi-dt-inp" placeholder={gstLocked ? '—' : '15-digit GSTIN'} maxLength={15} readOnly={gstLocked}
                      value={gstNumber} onChange={e => set({ gstNumber: e.target.value.toUpperCase() })} />
                  </Field>
                  <Field label="GST STATUS">
                    <EditSelect readOnly={gstLocked} value={gstStatus} options={GST_STATUSES} onChange={v => set({ gstStatus: v })} />
                  </Field>
                  <Field label="LAST FILING DATE">
                    {gstLocked
                      ? <input className="spi-dt-inp" value={formatDmy(filingDate)} readOnly />
                      : <MasterDatePicker value={filingDate} onChange={v => set({ filingDate: v })} />}
                  </Field>
                  <Field label="PREV. INVOICE / REMARKS" full>
                    <textarea className="spi-dt-textarea" readOnly={gstLocked}
                      placeholder={gstLocked ? '—' : 'Notes on previous invoices, filing history or scrutiny remarks…'}
                      value={remarks} onChange={e => set({ remarks: e.target.value })} />
                  </Field>
                </div>
              </>
            )}
          </div>

          <div className="spi-dt-card">
            <div className="spi-dt-card-head cpf-clickable" onClick={() => setRiskOpen(o => !o)}>
              <div className="spi-dt-card-title">
                <span className="spi-dt-card-ico spi-dt-card-ico-2"><IcoAlert /></span> Supplier Risk Alert
              </div>
              <span className={`cpf-risk__badge cpf-risk__badge--${riskSev} ${hasSupplier ? '' : 'cpf-hide'}`}>
                {!hasSupplier ? ''
                  : nHigh ? `${nHigh} critical${nMed ? ` · ${nMed} warning` : ''}`
                    : nMed ? `${nMed} warning${nMed === 1 ? '' : 's'}`
                      : 'All clear'}
              </span>
              <span className={`cpf-chev ${riskOpen ? '' : 'is-closed'}`}><IcoChevron /></span>
            </div>
            {riskOpen && (
              <div className="cpf-risk">
                {hasSupplier ? (
                  <>
                    <div className={`cpf-risk__sum cpf-risk__sum--${riskSev}`}>
                      <span className="cpf-risk__sum-ico"><SevIcon sev={riskSev} /></span>
                      <div className="cpf-risk__sum-txt">
                        <div className="cpf-risk__sum-t">{verdict}</div>
                        <div className="cpf-risk__sum-x">
                          {nOk} of {risks.length} checks passed · {docType === 'International'
                            ? 'risk rating, category and documents (GST not applicable)'
                            : 'risk rating, category, GST registration, filing, scrutiny and documents'}
                        </div>
                      </div>
                      <span className="cpf-risk__sum-score">{nOk}/{risks.length}</span>
                    </div>
                    {isRiskMandatory({ risk: riskLevel, category }) && (
                      <div className="cpf-guide">
                        <div className="cpf-guide__hd">
                          <span className="cpf-guide__ico"><IcoLock /></span>
                          <span className="cpf-guide__t">Mandatory Guidelines</span>
                          <span className="cpf-guide__tag">Enforced on this PO</span>
                        </div>
                        <div className="cpf-guide__list">
                          {GUIDELINES.map(g => (
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
                      {risks.map(r => (
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
