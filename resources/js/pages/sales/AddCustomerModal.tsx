import { Fragment, useEffect, useMemo, useState } from 'react';

/* ────────────────────────────────────────────────────────────────────────────
 * Add Customer — 3-stage modal
 *
 * Native React port of #addCustomerModal from Customer_Flow.html.
 *   Stage 1 — Customer Legal Identity (Identification + Address & Contact)
 *   Stage 2 — KYC / Due Diligence (Company DD / Owner KYC / Trade Licence)
 *   Stage 3 — Evidence Vault (KYC Documents / Trade Documents)
 *
 * All CSS is scoped under `.acm-root` so it doesn't bleed into the rest of
 * the app. Saving is stubbed: clicking Save/Submit fires an alert, no real
 * persistence wire-up yet — that lands when the customers table migration
 * lands and we swap the front-end arrays for /api/customers POST.
 * ──────────────────────────────────────────────────────────────────────── */

type Stage = 1 | 2 | 3;
type StageTab = 'identification' | 'address-contact';
type KycSubTab = 'company-dd' | 'owner-kyc' | 'trade-licence';
type EvTab = 'kyc-documents' | 'trade-documents';
type EvSubTab = 'dd' | 'kyc' | 'tl';

interface AddressRow {
  id: string; type: string; line: string; country: string; state: string; city: string; pin: string;
  cpName: string; cpDesignation: string; cpContact: string; cpEmail: string; cpWhatsapp: 'yes' | 'no' | '';
}
interface ContactRow {
  id: string; name: string; designation: string; contact: string; email: string;
  whatsapp: 'yes' | 'no' | '';
  type: string; line: string; country: string; state: string; city: string; pin: string;
}

const STATES_BY_COUNTRY: Record<string, string[]> = {
  India: ['Maharashtra','Delhi','Gujarat','Karnataka','Tamil Nadu','Kerala','Punjab','Rajasthan','West Bengal','Uttar Pradesh','Andhra Pradesh','Telangana'],
  UAE:   ['Dubai','Abu Dhabi','Sharjah','Ajman','RAK'],
  USA:   ['California','New York','Texas','Florida'],
  UK:    ['England','Scotland','Wales','Northern Ireland'],
  China: ['Shanghai','Beijing','Guangdong','Zhejiang'],
};

const DD_DOCS = [
  { code:'DD-001', name:'Certificate of Incorporation',                          authority:'Registrar of Companies (ROC)', expiry:'N/A',     status:'mandatory' },
  { code:'DD-002', name:'Memorandum & Articles of Association (MOA/AOA)',        authority:'Registrar of Companies (ROC)', expiry:'N/A',     status:'mandatory' },
  { code:'DD-003', name:'Board Resolution for Authorized Signatory',             authority:'Company Board',                expiry:'12/2026', status:'mandatory' },
  { code:'DD-004', name:'Financial Statements (Last 2-3 Years)',                 authority:'Statutory Auditor',            expiry:'03/2026', status:'mandatory' },
  { code:'DD-005', name:"Bank Account Verification Letter / Cancelled Cheque",   authority:'Authorized Dealer Bank',       expiry:'N/A',     status:'mandatory' },
  { code:'DD-006', name:'Tax Registration Certificate',                          authority:'Income Tax Department',        expiry:'N/A',     status:'optional'  },
];
const OWN_KYC_DOCS = [
  { code:'KYC-001', name:'PAN Card',                                  authority:'Income Tax Department',           expiry:'N/A',     status:'active' },
  { code:'KYC-002', name:'Aadhaar Card',                              authority:'UIDAI',                           expiry:'N/A',     status:'active' },
  { code:'KYC-003', name:'Address Proof',                             authority:'Bank / Utility / Govt Authority', expiry:'N/A',     status:'active' },
  { code:'KYC-004', name:'Identity Proof (Passport / DL / Voter ID)', authority:'GOI / RTO / ECI',                 expiry:'Varies',  status:'active' },
  { code:'KYC-005', name:'Company Registration Certificate',          authority:'Registrar of Companies (ROC)',    expiry:'N/A',     status:'active' },
  { code:'KYC-006', name:'GST Certificate',                           authority:'GST Department',                  expiry:'09/2030', status:'active' },
  { code:'KYC-007', name:'Passport-size Photograph',                  authority:'Self-Provided',                   expiry:'N/A',     status:'active' },
  { code:'KYC-008', name:'Bank Statement (Last 6 Months)',            authority:'Authorized Bank',                 expiry:'N/A',     status:'active' },
  { code:'KYC-009', name:'Utility Bill',                              authority:'Service Provider',                expiry:'N/A',     status:'active' },
  { code:'KYC-010', name:'Property Tax Receipt',                      authority:'Municipal Authority',             expiry:'N/A',     status:'active' },
];
const TL_DOCS = [
  { code:'TL-001', name:'Import Export Code (IEC)',         authority:'DGFT',                     expiry:'03/2026', status:'mandatory' },
  { code:'TL-002', name:'RCMC Certificate',                 authority:'Export Promotion Council', expiry:'05/2027', status:'mandatory' },
  { code:'TL-003', name:'Export Licence',                   authority:'DGFT',                     expiry:'12/2026', status:'optional'  },
  { code:'TL-004', name:'Drug Licence',                     authority:'CDSCO',                    expiry:'08/2027', status:'optional'  },
  { code:'TL-005', name:'FSSAI Licence',                    authority:'FSSAI',                    expiry:'06/2028', status:'optional'  },
  { code:'TL-006', name:'GST Registration',                 authority:'GST Department',           expiry:'N/A',     status:'mandatory' },
  { code:'TL-007', name:'ISO Certification',                authority:'Certification Body',       expiry:'11/2027', status:'optional'  },
  { code:'TL-008', name:'Pollution Control Certificate',    authority:'Pollution Control Board',  expiry:'07/2026', status:'mandatory' },
];

const KYC_PER_PAGE = 6;
const KYC_TAB_META: Record<KycSubTab, { title: string; sub: string; nameCol: string; placeholder: string; data: typeof DD_DOCS; showAdd: boolean; addLabel?: string }> = {
  'company-dd':   { title:'COMPANY DUE DILIGENCE', sub:'| Licenses, statutory documents, and compliance proofs', nameCol:'DD Document Name',     placeholder:'Search DD document name...',     data: DD_DOCS,      showAdd: false },
  'owner-kyc':    { title:'OWNER KYC DETAILS',     sub:'| Owner identity proofs, address proofs, and photographs', nameCol:'KYC Document Name', placeholder:'Search KYC document name...',    data: OWN_KYC_DOCS, showAdd: true,  addLabel:'Add More Owner KYC' },
  'trade-licence':{ title:'TRADE LICENCE',         sub:'| Trade licence documents and regulatory approvals',     nameCol:'Document Name',         placeholder:'Search trade licence document...', data: TL_DOCS,    showAdd: false },
};
const EV_SUB_META: Record<EvSubTab, { title: string; sub: string; nameCol: string; data: typeof DD_DOCS }> = {
  dd:  { title:'COMPANY DUE DILIGENCE', sub:'| Licenses, statutory documents, and compliance proofs', nameCol:'DD Document Name',  data: DD_DOCS },
  kyc: { title:'OWNER KYC DETAILS',     sub:'| Owner identity proofs, address proofs, and photographs', nameCol:'KYC Document Name', data: OWN_KYC_DOCS },
  tl:  { title:'TRADE LICENCE',         sub:'| Trade licence documents and regulatory approvals',     nameCol:'Document Name',      data: TL_DOCS },
};

const newId = (prefix: string) => prefix + '_' + Math.random().toString(36).slice(2, 9);

// Minimal customer shape the parent list passes in when editing. Mirrors the
// `Customer` type in SalesCustomers; kept inline so this modal doesn't depend
// on the parent file.
export interface EditCustomer {
  id: string; company: string; type: string; segment: string;
  country: string; contact: string; phone: string; email: string;
  whatsapp: 'Yes' | 'No';
}

interface Props {
  open: boolean;
  onClose: () => void;
  /** When set, modal opens in Edit mode with form pre-filled from this row. */
  customer?: EditCustomer | null;
}

export default function AddCustomerModal({ open, onClose, customer }: Props) {
  const isEdit = !!customer;
  const [stage, setStage] = useState<Stage>(1);
  const [maxStage, setMaxStage] = useState<Stage>(1);
  const [tab, setTab] = useState<StageTab>('identification');
  const [kycSub, setKycSub] = useState<KycSubTab>('company-dd');
  const [kycPage, setKycPage] = useState<Record<KycSubTab, number>>({ 'company-dd':1, 'owner-kyc':1, 'trade-licence':1 });
  const [kycSearch, setKycSearch] = useState('');
  const [evTab, setEvTab] = useState<EvTab>('kyc-documents');
  const [evSub, setEvSub] = useState<EvSubTab>('dd');
  const [historyOpen, setHistoryOpen] = useState(false);

  // Form: company + primary address + primary contact
  const [form, setForm] = useState({
    coName:'', coLegal:'', coType:'', coWeb:'', coSeg:'', coClass:'', coRisk:'',
    addrType:'Register Office Address', addr:'', country:'', state:'', city:'', pin:'',
    cpName:'', cpDesig:'', cpTel:'', cpEmail:'', cpWa:'' as 'yes'|'no'|'',
  });
  const setF = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) => setForm(prev => ({ ...prev, [k]: v }));

  // Additional addresses + contacts
  const [addresses, setAddresses] = useState<AddressRow[]>([]);
  const [contacts, setContacts] = useState<ContactRow[]>([]);

  // Trade docs selection
  const [tdDocs, setTdDocs] = useState([
    { id:'td1', name:'Bill of Lading',           selected:true, sent:false },
    { id:'td2', name:'Phytosanitary Certificate', selected:true, sent:false },
  ]);

  // Sub-modals
  const [addrModal, setAddrModal] = useState<{ open:boolean; editing:string|null }>({ open:false, editing:null });
  const [contactModal, setContactModal] = useState<{ open:boolean; editing:string|null }>({ open:false, editing:null });

  // Reset all state when modal closes. When `customer` is provided we open in
  // Edit mode and prefill the form fields we know about (company name, type,
  // segment, country, contact person, phone, email, whatsapp). The list row
  // doesn't carry KYC/address detail so those stay blank — when the real GET
  // /api/customers/:id endpoint lands, fetch and hydrate the rest here.
  useEffect(() => {
    if (!open) return;
    setStage(1); setMaxStage(1); setTab('identification');
    setKycSub('company-dd'); setKycPage({ 'company-dd':1, 'owner-kyc':1, 'trade-licence':1 }); setKycSearch('');
    setEvTab('kyc-documents'); setEvSub('dd');
    setHistoryOpen(false);
    setForm({
      coName:   customer?.company ?? '',
      coLegal:  customer?.company ?? '',
      coType:   customer?.type ?? '',
      coWeb:    '',
      coSeg:    customer?.segment ?? '',
      coClass:  '',
      coRisk:   '',
      addrType: 'Register Office Address',
      addr:     '',
      country:  customer?.country ?? '',
      state:    '',
      city:     '',
      pin:      '',
      cpName:   customer?.contact ?? '',
      cpDesig:  '',
      cpTel:    customer?.phone ?? '',
      cpEmail:  customer?.email ?? '',
      cpWa:     customer?.whatsapp === 'Yes' ? 'yes' : customer?.whatsapp === 'No' ? 'no' : '',
    });
    setAddresses([]); setContacts([]);
    setTdDocs([
      { id:'td1', name:'Bill of Lading',           selected:true, sent:false },
      { id:'td2', name:'Phytosanitary Certificate', selected:true, sent:false },
    ]);
    setAddrModal({ open:false, editing:null });
    setContactModal({ open:false, editing:null });
  }, [open, customer]);

  // Inject DM Sans/Inter once
  useEffect(() => {
    const id = 'acm-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id;
    link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=DM+Sans:wght@400;500;600;700;800&family=JetBrains+Mono:wght@400;500;700&display=swap';
    document.head.appendChild(link);
  }, []);

  // Body scroll lock
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = prev; };
  }, [open]);

  // ESC closes sub-modals first, then main
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      if (addrModal.open) { setAddrModal({ open:false, editing:null }); return; }
      if (contactModal.open) { setContactModal({ open:false, editing:null }); return; }
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, addrModal.open, contactModal.open, onClose]);

  if (!open) return null;

  const gotoStage = (s: Stage) => {
    if (s > maxStage) return;
    setStage(s);
    if (s === 1) setTab('identification');
  };

  const goNext = () => {
    if (stage === 1) {
      if (tab === 'identification') setTab('address-contact');
      else { setStage(2); setMaxStage(m => Math.max(m, 2) as Stage); }
    } else if (stage === 2) {
      setStage(3); setMaxStage(m => Math.max(m, 3) as Stage);
    } else {
      alert(isEdit ? 'Customer updated successfully!' : 'Customer submitted successfully!');
      onClose();
    }
  };
  const goPrev = () => {
    if (stage === 1) {
      if (tab === 'address-contact') setTab('identification');
    } else if (stage === 2) { setStage(1); setTab('address-contact'); }
    else { setStage(2); }
  };

  const atStart = stage === 1 && tab === 'identification';
  const nextLabel = stage === 3
    ? (isEdit ? 'Update Customer' : 'Submit Customer')
    : 'Save & Next';

  return (
    <div className="acm-root" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <style>{SCOPED_CSS}</style>
      <div className="acm-card">

        {/* HEADER */}
        <div className="acm-header">
          <div className="acm-header-left">
            <div className="acm-header-icon">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
                <circle cx="9" cy="7" r="4" />
                <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
                <path d="M16 3.13a4 4 0 0 1 0 7.75" />
              </svg>
            </div>
            <div>
              <div className="acm-title">{isEdit ? `Edit Customer — ${customer!.id}` : 'Add Customer'}</div>
              <div className="acm-subtitle">{isEdit ? 'Update customer details, KYC, and trade documents.' : 'Capture, verify, and onboard customers with complete compliance and product readiness.'}</div>
            </div>
          </div>
          <button type="button" className="acm-close" onClick={onClose} aria-label="Close">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>

        {/* STEPPER */}
        <Stepper stage={stage} onGoto={gotoStage} />

        {/* HISTORY PANEL */}
        {stage > 1 && (
          <div className={`acm-history ${historyOpen ? 'acm-hist-open' : ''}`}>
            <div className="acm-history-header" onClick={() => setHistoryOpen(o => !o)}>
              <div className="acm-history-header-left">
                <div className="acm-history-icon">
                  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2">
                    <polyline points="12 8 12 12 14 14"/><path d="M3.05 11a9 9 0 1 1 .5 4M3 16v-5h5"/>
                  </svg>
                </div>
                <div>
                  <div className="acm-history-title">What you did in previous stages</div>
                  <div className="acm-history-meta">{stage - 1 === 1 ? 'Stage 1 completed' : `Stages 1–${stage - 1} completed`} — review your entries below</div>
                </div>
              </div>
              <div className="acm-history-actions">
                <span className="acm-history-badge">{stage - 1} stage{stage - 1 === 1 ? '' : 's'} completed</span>
                <div className={`acm-history-chevron ${historyOpen ? 'acm-open' : ''}`}>
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="6 9 12 15 18 9"/></svg>
                </div>
              </div>
            </div>
            <div className="acm-history-body">
              <HistoryStage1 form={form} addresses={addresses} contacts={contacts} />
              {stage >= 3 && <HistoryStage2 />}
            </div>
          </div>
        )}

        {/* STAGE 1 TABS */}
        {stage === 1 && (
          <div className="acm-tabs">
            <button type="button" className={`acm-tab ${tab === 'identification' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => setTab('identification')}>Customer Identification</button>
            <button type="button" className={`acm-tab ${tab === 'address-contact' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => setTab('address-contact')}>Address &amp; Contact Details</button>
          </div>
        )}

        {/* STAGE 3 TABS */}
        {stage === 3 && (
          <div className="acm-tabs">
            <button type="button" className={`acm-tab ${evTab === 'kyc-documents' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => setEvTab('kyc-documents')}>KYC Documents</button>
            <button type="button" className={`acm-tab ${evTab === 'trade-documents' ? 'acm-tab-on' : 'acm-tab-off'}`} onClick={() => setEvTab('trade-documents')}>Trade Documents</button>
          </div>
        )}

        {/* BODY */}
        <div className="acm-body">
          {stage === 1 && tab === 'identification' && <Stage1Identification form={form} setF={setF} />}
          {stage === 1 && tab === 'address-contact' && (
            <Stage1AddressContact
              addresses={addresses} contacts={contacts}
              onAddAddr={() => setAddrModal({ open:true, editing:null })}
              onEditAddr={(id) => setAddrModal({ open:true, editing:id })}
              onDelAddr={(id) => { if (confirm('Delete this address?')) setAddresses(prev => prev.filter(a => a.id !== id)); }}
              onAddContact={() => setContactModal({ open:true, editing:null })}
              onEditContact={(id) => setContactModal({ open:true, editing:id })}
              onDelContact={(id) => { if (confirm('Delete this contact person?')) setContacts(prev => prev.filter(c => c.id !== id)); }}
            />
          )}
          {stage === 2 && (
            <Stage2KYC
              sub={kycSub} setSub={(s) => { setKycSub(s); setKycSearch(''); }}
              page={kycPage} setPage={(s, p) => setKycPage(prev => ({ ...prev, [s]: p }))}
              search={kycSearch} setSearch={setKycSearch}
            />
          )}
          {stage === 3 && evTab === 'kyc-documents' && (
            <Stage3KycDocs sub={evSub} setSub={setEvSub} />
          )}
          {stage === 3 && evTab === 'trade-documents' && (
            <Stage3TradeDocs
              docs={tdDocs}
              onToggle={(id) => setTdDocs(prev => prev.map(d => d.id === id ? { ...d, selected: !d.selected } : d))}
              onToggleAll={(checked) => setTdDocs(prev => prev.map(d => ({ ...d, selected: checked })))}
              onSend={(id) => setTdDocs(prev => prev.map(d => d.id === id ? { ...d, sent: true } : d))}
              onSendSelected={() => setTdDocs(prev => prev.map(d => d.selected ? { ...d, sent: true } : d))}
            />
          )}
        </div>

        {/* FOOTER */}
        <div className="acm-footer">
          <div className="acm-req-note">
            <span className="acm-req-dot" />
            Fields marked with <span className="acm-req">*</span> are required
          </div>
          <div className="acm-footer-actions">
            {!atStart && (
              <button type="button" className="acm-btn-prev" onClick={goPrev}>
                <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6"/></svg>
                Previous
              </button>
            )}
            <button type="button" className="acm-btn-next" onClick={goNext}>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v13a2 2 0 0 1-2 2z" />
                <polyline points="17 21 17 13 7 13 7 21" />
                <polyline points="7 3 7 8 15 8" />
              </svg>
              <span>{nextLabel}</span>
            </button>
          </div>
        </div>

      </div>

      {/* SUB-MODAL: Address */}
      {addrModal.open && (
        <AddressSubModal
          editing={addrModal.editing ? addresses.find(a => a.id === addrModal.editing) ?? null : null}
          onClose={() => setAddrModal({ open:false, editing:null })}
          onSave={(rec) => {
            if (addrModal.editing) setAddresses(prev => prev.map(a => a.id === addrModal.editing ? { ...rec, id: a.id } : a));
            else setAddresses(prev => [...prev, { ...rec, id: newId('a') }]);
            setAddrModal({ open:false, editing:null });
          }}
        />
      )}
      {contactModal.open && (
        <ContactSubModal
          editing={contactModal.editing ? contacts.find(c => c.id === contactModal.editing) ?? null : null}
          onClose={() => setContactModal({ open:false, editing:null })}
          onSave={(rec) => {
            if (contactModal.editing) setContacts(prev => prev.map(c => c.id === contactModal.editing ? { ...rec, id: c.id } : c));
            else setContacts(prev => [...prev, { ...rec, id: newId('c') }]);
            setContactModal({ open:false, editing:null });
          }}
        />
      )}
    </div>
  );
}

/* ───── Stepper ───── */
function Stepper({ stage, onGoto }: { stage: Stage; onGoto: (s: Stage) => void }) {
  const steps = [
    { n:1 as Stage, title:'Customer Legal Identity', sub:'Company, GST, PAN & contact',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg> },
    { n:2 as Stage, title:'KYC / Due Diligence', sub:'Docs, identity & compliance',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/><polyline points="9 12 11 14 15 10"/></svg> },
    { n:3 as Stage, title:'Evidence Vault', sub:'Trade documents & archive',
      icon: <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="20" height="5" rx="1.5"/><path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8"/><line x1="10" y1="13" x2="14" y2="13"/><line x1="10" y1="17" x2="14" y2="17"/></svg> },
  ];
  const CHECK_BADGE = <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg>;
  const CHECK_NUM = <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5"><polyline points="20 6 9 17 4 12"/></svg>;

  return (
    <div className="acm-stepper">
      {steps.map((s, i) => {
        const cls = s.n < stage ? 'acm-step-done' : s.n === stage ? 'acm-step-active' : 'acm-step-pending';
        return (
          <Fragment key={s.n}>
            <div className={`acm-step ${cls}`} onClick={() => onGoto(s.n)}>
              <div className="acm-step-badge-wrap">
                <div className="acm-step-badge">{s.n < stage ? CHECK_BADGE : s.icon}</div>
                <div className="acm-step-num">{s.n < stage ? CHECK_NUM : s.n}</div>
              </div>
              <div className="acm-step-text">
                <div className="acm-step-title">{s.title}</div>
                <div className="acm-step-sub">{s.sub}</div>
              </div>
            </div>
            {i < steps.length - 1 && (
              <div className="acm-step-connector"><div className="acm-connector-line" data-done={s.n < stage ? '1' : '0'} /></div>
            )}
          </Fragment>
        );
      })}
    </div>
  );
}

/* ───── Stage 1 — Identification ───── */
function Stage1Identification({ form, setF }: { form: any; setF: (k: any, v: any) => void }) {
  const states = STATES_BY_COUNTRY[form.country] || [];
  return (
    <div>
      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg></div>
          <div>
            <span className="acm-section-title">BASIC COMPANY DETAILS</span>
            <span className="acm-section-sub">| Company identity, segment, and risk classification</span>
          </div>
        </div>
        <div className="acm-section-body">
          <div className="acm-row acm-row-3">
            <Field label="Company Name" required><input value={form.coName} onChange={e => setF('coName', e.target.value)} placeholder="e.g. Shree Agro Pvt Ltd" /></Field>
            <Field label="Company Legal Name" required><input value={form.coLegal} onChange={e => setF('coLegal', e.target.value)} placeholder="Registered legal entity name" /></Field>
            <Field label="Customer Type" required>
              <select value={form.coType} onChange={e => setF('coType', e.target.value)}>
                <option value="">Select customer type</option>
                {['Retailer','Wholesaler','Exporter','Reseller','Distributor','Manufacturer'].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Company Website"><input value={form.coWeb} onChange={e => setF('coWeb', e.target.value)} placeholder="https://example.com" /></Field>
            <Field label="Customer Segment" required>
              <select value={form.coSeg} onChange={e => setF('coSeg', e.target.value)}>
                <option value="">Select segment</option>
                {['Agro','Spices','Pulses','Dry Fruits','Rice & Grains','Coffee Beans','Basmati Rice','Coconut Oil','Millets'].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Classification & Flags" required>
              <select value={form.coClass} onChange={e => setF('coClass', e.target.value)}>
                <option value="">Select classification</option>
                {['Standard','Premium','VIP','Watchlist'].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Risk Level" required>
              <select value={form.coRisk} onChange={e => setF('coRisk', e.target.value)}>
                <option value="">Select risk level</option>
                {['Low','Medium','High','Critical'].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
          </div>
        </div>
      </div>

      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
          <div>
            <span className="acm-section-title">ADDRESS &amp; CONTACT PERSON DETAILS</span>
            <span className="acm-section-sub">| Registered office, location, and primary contact</span>
          </div>
        </div>
        <div className="acm-section-body">
          <div className="acm-row acm-row-2">
            <Field label="Address Type" required>
              <select value={form.addrType} onChange={e => setF('addrType', e.target.value)}>
                {['Register Office Address','Billing Address','Shipping Address','Other'].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Address" required><input value={form.addr} onChange={e => setF('addr', e.target.value)} placeholder="Street, building, area" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Country" required>
              <select value={form.country} onChange={e => { setF('country', e.target.value); setF('state', ''); }}>
                <option value="">Select country</option>
                {Object.keys(STATES_BY_COUNTRY).map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="State" required>
              <select value={form.state} onChange={e => setF('state', e.target.value)} disabled={!form.country}>
                {form.country ? <option value="">Select state</option> : <option>Select country first</option>}
                {states.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="City" required><input value={form.city} onChange={e => setF('city', e.target.value)} placeholder="City name" /></Field>
            <Field label="Pin / Postal Code" required><input value={form.pin} onChange={e => setF('pin', e.target.value)} maxLength={10} placeholder="6-digit PIN" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Contact Person Name" required><input value={form.cpName} onChange={e => setF('cpName', e.target.value)} placeholder="Full name" /></Field>
            <Field label="Designation" required><input value={form.cpDesig} onChange={e => setF('cpDesig', e.target.value)} placeholder="e.g. Director, CFO" /></Field>
            <Field label="Contact No" required><input type="tel" value={form.cpTel} onChange={e => setF('cpTel', e.target.value)} placeholder="10-digit number" /></Field>
            <Field label="Email" required><input type="email" value={form.cpEmail} onChange={e => setF('cpEmail', e.target.value)} placeholder="name@company.com" /></Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Whatsapp Enabled" required>
              <div className="acm-radio-row">
                <label className="acm-radio"><input type="radio" name="cpWa" value="yes" checked={form.cpWa === 'yes'} onChange={() => setF('cpWa', 'yes')} /> YES</label>
                <label className="acm-radio"><input type="radio" name="cpWa" value="no" checked={form.cpWa === 'no'} onChange={() => setF('cpWa', 'no')} /> NO</label>
              </div>
            </Field>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───── Stage 1 — Address & Contact tables ───── */
function Stage1AddressContact({ addresses, contacts, onAddAddr, onEditAddr, onDelAddr, onAddContact, onEditContact, onDelContact }:
  { addresses: AddressRow[]; contacts: ContactRow[]; onAddAddr: () => void; onEditAddr: (id:string) => void; onDelAddr: (id:string) => void; onAddContact: () => void; onEditContact: (id:string) => void; onDelContact: (id:string) => void }) {
  return (
    <div>
      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-head-row" style={{ width:'100%' }}>
            <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg></div>
            <div>
              <span className="acm-section-title">ADDRESS DETAILS</span>
              <span className="acm-section-sub">| All registered, branch, and warehouse addresses</span>
            </div>
            <button type="button" className="acm-add-pill" onClick={onAddAddr}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add More Address
            </button>
          </div>
        </div>
        <div className="acm-section-body acm-section-body-table">
          <div className="acm-table-wrap">
            <table className="acm-table">
              <thead><tr><th>Sr No</th><th>Address Type</th><th>Address Details</th><th>City</th><th>State</th><th>Country</th><th>Pin Code</th><th>Actions</th></tr></thead>
              <tbody>
                {addresses.length === 0 ? (
                  <tr className="acm-empty-row"><td colSpan={8}>No addresses added yet. Click <strong>+ Add More Address</strong> to add one.</td></tr>
                ) : addresses.map((a, i) => (
                  <tr key={a.id}>
                    <td>{i + 1}</td><td>{a.type}</td><td>{a.line}</td><td>{a.city}</td><td>{a.state}</td><td>{a.country}</td><td>{a.pin}</td>
                    <td>
                      <div className="acm-row-actions">
                        <button type="button" className="acm-row-btn" title="Edit" onClick={() => onEditAddr(a.id)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                        </button>
                        <button type="button" className="acm-row-btn acm-row-btn-del" title="Delete" onClick={() => onDelAddr(a.id)}>
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/></svg>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>

      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-head-row" style={{ width:'100%' }}>
            <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2"/><circle cx="12" cy="7" r="4"/></svg></div>
            <div>
              <span className="acm-section-title">CONTACT DETAILS</span>
              <span className="acm-section-sub">| Authorized contact persons for this customer</span>
            </div>
            <button type="button" className="acm-add-pill" onClick={onAddContact}>
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
              Add More Contact Person
            </button>
          </div>
        </div>
        <div className="acm-section-body acm-section-body-table">
          <div className="acm-table-wrap">
            <table className="acm-table">
              <thead><tr><th>Sr No</th><th>Contact Person Name</th><th>Designation</th><th>Address Details</th><th>Contact No</th><th>Email Id</th><th>Whatsapp Enable</th><th>Actions</th></tr></thead>
              <tbody>
                {contacts.length === 0 ? (
                  <tr className="acm-empty-row"><td colSpan={8}>No contact persons added yet. Click <strong>+ Add More Contact Person</strong> to add one.</td></tr>
                ) : contacts.map((c, i) => {
                  const addr = c.type + ' — ' + c.line;
                  const addrTrim = addr.length > 50 ? addr.slice(0, 47) + '…' : addr;
                  return (
                    <tr key={c.id}>
                      <td>{i + 1}</td><td>{c.name}</td><td>{c.designation}</td><td>{addrTrim}</td><td>{c.contact}</td><td>{c.email}</td>
                      <td>{c.whatsapp === 'yes' ? <span className="acm-pill-yes">✓ Yes</span> : <span className="acm-pill-no">✕ No</span>}</td>
                      <td>
                        <div className="acm-row-actions">
                          <button type="button" className="acm-row-btn" title="Edit" onClick={() => onEditContact(c.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
                          </button>
                          <button type="button" className="acm-row-btn acm-row-btn-del" title="Delete" onClick={() => onDelContact(c.id)}>
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/></svg>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───── Stage 2 — KYC sub-tabs + doc table ───── */
function Stage2KYC({ sub, setSub, page, setPage, search, setSearch }:
  { sub: KycSubTab; setSub: (s: KycSubTab) => void; page: Record<KycSubTab, number>; setPage: (s: KycSubTab, p: number) => void; search: string; setSearch: (s: string) => void }) {
  const meta = KYC_TAB_META[sub];
  const q = search.toLowerCase().trim();
  const all = meta.data;
  const filtered = useMemo(() => q ? all.filter(d => d.code.toLowerCase().includes(q) || d.name.toLowerCase().includes(q) || d.authority.toLowerCase().includes(q)) : all, [q, all]);
  const total = filtered.length;
  const maxPage = Math.max(1, Math.ceil(total / KYC_PER_PAGE));
  const curPage = Math.min(page[sub], maxPage);
  const start = (curPage - 1) * KYC_PER_PAGE;
  const slice = filtered.slice(start, start + KYC_PER_PAGE);

  return (
    <div>
      <div className="acm-subtabs-row">
        {(['company-dd','owner-kyc','trade-licence'] as KycSubTab[]).map(s => (
          <button key={s} type="button" className={`acm-subtab-pill ${sub === s ? 'is-active' : ''}`} onClick={() => setSub(s)}>
            {s === 'company-dd' ? 'Company Due Diligence' : s === 'owner-kyc' ? 'Owner KYC' : 'Trade Licence'}
          </button>
        ))}
      </div>

      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-head-row" style={{ width:'100%' }}>
            <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div>
              <span className="acm-section-title">{meta.title}</span>
              <span className="acm-section-sub">{meta.sub}</span>
            </div>
            {meta.showAdd && (
              <button type="button" className="acm-add-pill">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                {meta.addLabel}
              </button>
            )}
          </div>
        </div>

        <div className="acm-doc-toolbar">
          <div className="acm-doc-search">
            <svg className="acm-doc-search-icon" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="search" placeholder={meta.placeholder} value={search} onChange={e => setSearch(e.target.value)} />
          </div>
          <div className="acm-doc-count">{total} document{total === 1 ? '' : 's'}</div>
        </div>

        <div className="acm-section-body acm-section-body-table">
          <div className="acm-table-wrap">
            <table className="acm-table">
              <thead><tr><th>Sr No</th><th>Auto Code</th><th>{meta.nameCol}</th><th>Issuing Authority</th><th>Expiry</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>
                {total === 0 ? (
                  <tr className="acm-empty-row"><td colSpan={7}>No documents match your search.</td></tr>
                ) : slice.map((d, i) => <KycRow key={d.code} d={d} sr={start + i + 1} />)}
              </tbody>
            </table>
          </div>
          <div className="acm-doc-pag-wrap">
            <span className="acm-doc-pag-info">
              {total === 0 ? 'Showing 0 of 0 documents' : `Showing ${start + 1}–${Math.min(start + KYC_PER_PAGE, total)} of ${total} documents`}
            </span>
            {maxPage > 1 && (
              <div className="acm-pagination">
                <button type="button" className="acm-page-btn" disabled={curPage === 1} onClick={() => setPage(sub, curPage - 1)}>‹</button>
                {Array.from({ length: maxPage }, (_, i) => i + 1).map(p => (
                  <button key={p} type="button" className={`acm-page-btn ${p === curPage ? 'is-active' : ''}`} onClick={() => setPage(sub, p)}>{p}</button>
                ))}
                <button type="button" className="acm-page-btn" disabled={curPage === maxPage} onClick={() => setPage(sub, curPage + 1)}>›</button>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
function KycRow({ d, sr }: { d: any; sr: number }) {
  const srPad = (sr < 10 ? '0' : '') + sr;
  const expiryClass = d.expiry === 'N/A' ? 'acm-expiry-na' : d.expiry === 'Varies' ? 'acm-expiry-varies' : 'acm-expiry-date';
  let statusEl: React.ReactNode;
  if (d.status === 'active') statusEl = <span className="acm-status-active">✓ Active</span>;
  else if (d.status === 'mandatory') statusEl = <span className="acm-status-toggle"><span className="acm-status-mandatory is-on">✓ Mandatory</span><span className="acm-status-optional">Optional</span></span>;
  else statusEl = <span className="acm-status-toggle"><span className="acm-status-mandatory">Mandatory</span><span className="acm-status-optional is-on">Optional</span></span>;
  return (
    <tr>
      <td>{srPad}</td>
      <td><span className="acm-doc-code">{d.code}</span></td>
      <td style={{ fontWeight: 700, color: '#1f2937' }}>{d.name}</td>
      <td style={{ color: '#6b7280' }}>{d.authority}</td>
      <td><span className={expiryClass}>{d.expiry}</span></td>
      <td>{statusEl}</td>
      <td>
        <div className="acm-row-actions">
          <button type="button" className="acm-doc-action acm-doc-action-upload" title="Upload">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
          <button type="button" className="acm-doc-action acm-doc-action-download" title="Download">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
        </div>
      </td>
    </tr>
  );
}

/* ───── Stage 3 — Evidence Vault KYC Documents ───── */
function Stage3KycDocs({ sub, setSub }: { sub: EvSubTab; setSub: (s: EvSubTab) => void }) {
  const meta = EV_SUB_META[sub];
  return (
    <div>
      <div className="acm-nested-tabs">
        {(['dd','kyc','tl'] as EvSubTab[]).map(s => (
          <button key={s} type="button" className={`acm-nested-tab ${sub === s ? 'is-active' : ''}`} onClick={() => setSub(s)}>
            {s === 'dd' ? 'Company Due Diligence' : s === 'kyc' ? 'Owner KYC' : 'Trade License'}
          </button>
        ))}
      </div>

      <div className="acm-section acm-section-purple">
        <div className="acm-section-head">
          <div className="acm-section-head-row" style={{ width: '100%' }}>
            <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div>
            <div>
              <span className="acm-section-title">{meta.title}</span>
              <span className="acm-section-sub">{meta.sub}</span>
            </div>
          </div>
        </div>
        <div className="acm-section-body acm-section-body-table">
          <div className="acm-table-wrap">
            <table className="acm-table">
              <thead><tr><th>Sr No</th><th>Auto Code</th><th>{meta.nameCol}</th><th>Issuing Authority</th><th>Expiry</th><th>Status</th><th>Attachment</th></tr></thead>
              <tbody>
                {meta.data.map((d, i) => {
                  let st: React.ReactNode;
                  if (d.status === 'active') st = <span className="acm-status-active">✓ Active</span>;
                  else if (d.status === 'mandatory') st = <span className="acm-status-mandatory is-on">✓ Mandatory</span>;
                  else st = <span className="acm-status-optional is-on">Optional</span>;
                  const expCls = d.expiry === 'N/A' ? 'acm-expiry-na' : d.expiry === 'Varies' ? 'acm-expiry-varies' : 'acm-expiry-date';
                  return (
                    <tr key={d.code}>
                      <td>{i + 1}</td>
                      <td><span className="acm-doc-code">{d.code}</span></td>
                      <td style={{ fontWeight: 700, color: '#1f2937' }}>{d.name}</td>
                      <td style={{ color: '#6b7280' }}>{d.authority}</td>
                      <td><span className={expCls}>{d.expiry}</span></td>
                      <td>{st}</td>
                      <td>
                        <button type="button" className="acm-attach-link">
                          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/></svg>
                          View Attachment
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ───── Stage 3 — Trade Documents ───── */
function Stage3TradeDocs({ docs, onToggle, onToggleAll, onSend, onSendSelected }:
  { docs: { id:string; name:string; selected:boolean; sent:boolean }[]; onToggle:(id:string)=>void; onToggleAll:(c:boolean)=>void; onSend:(id:string)=>void; onSendSelected:()=>void }) {
  const selCount = docs.filter(d => d.selected).length;
  const allChecked = selCount === docs.length;
  return (
    <div className="acm-section acm-section-purple">
      <div className="acm-section-head">
        <div className="acm-section-icon"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><rect x="2" y="3" width="20" height="5" rx="1"/><path d="M4 8v12a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1V8"/><line x1="10" y1="12" x2="14" y2="12"/></svg></div>
        <div>
          <span className="acm-section-title">TRADE DOCUMENTS</span>
          <span className="acm-section-sub">| Trade documents for digital signature & archive</span>
        </div>
      </div>
      <div className="acm-section-body acm-section-body-table">
        <div className="acm-table-wrap">
          <table className="acm-table acm-td-table">
            <colgroup><col className="col-srno" /><col className="col-docname" /><col className="col-sig" /><col className="col-status" /><col className="col-actions" /></colgroup>
            <thead>
              <tr>
                <th>Sr No</th>
                <th>Document Name</th>
                <th>
                  <label className="acm-td-check-label">
                    <input type="checkbox" checked={allChecked} ref={el => { if (el) el.indeterminate = selCount > 0 && selCount < docs.length; }} onChange={e => onToggleAll(e.target.checked)} />
                    Send for Signature
                  </label>
                </th>
                <th className="th-status">Document Status</th>
                <th className="th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {docs.map((d, i) => (
                <tr key={d.id}>
                  <td style={{ color: '#9ca3af', fontWeight: 600 }}>{i + 1}</td>
                  <td style={{ fontWeight: 600, color: '#1f2937' }}>{d.name}</td>
                  <td>
                    <div className="acm-td-cell-check">
                      <input type="checkbox" checked={d.selected} onChange={() => onToggle(d.id)} />
                      {d.sent ? (
                        <button type="button" className="acm-btn-resend" onClick={() => onSend(d.id)}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 .49-4.5"/></svg>
                          Resend
                        </button>
                      ) : (
                        <button type="button" className="acm-btn-send" onClick={() => onSend(d.id)}>
                          <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
                          Send
                        </button>
                      )}
                    </div>
                  </td>
                  <td className="td-status"><span className="acm-expiry-na">N/A</span></td>
                  <td className="td-actions">
                    <div className="acm-row-actions">
                      <button type="button" className="acm-doc-action acm-doc-action-view" title="View"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg></button>
                      <button type="button" className="acm-doc-action acm-doc-action-download" title="Download"><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="acm-td-actions">
          <button type="button" className="acm-btn-purple-lg" onClick={onSendSelected}>
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>
            Send Selected Documents for Signature
          </button>
          <button type="button" className="acm-btn-purple-lg-out">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            Customer Specific Document
          </button>
        </div>
      </div>
    </div>
  );
}

/* ───── Address / Contact sub-modals ───── */
function AddressSubModal({ editing, onClose, onSave }: { editing: AddressRow | null; onClose: () => void; onSave: (rec: Omit<AddressRow, 'id'>) => void }) {
  const [d, setD] = useState<Omit<AddressRow, 'id'>>(() => editing ? { ...editing } : {
    type:'', line:'', country:'', state:'', city:'', pin:'',
    cpName:'', cpDesignation:'', cpContact:'', cpEmail:'', cpWhatsapp:'' as 'yes'|'no'|''
  });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(prev => ({ ...prev, [k]: v }));
  const states = STATES_BY_COUNTRY[d.country] || [];
  const submit = () => {
    const required: (keyof typeof d)[] = ['type','line','country','state','city','pin','cpName','cpDesignation','cpContact','cpEmail','cpWhatsapp'];
    for (const k of required) if (!d[k]) { alert('Please fill all required fields.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(d.cpEmail)) { alert('Please enter a valid Email Id.'); return; }
    onSave(d);
  };
  return (
    <div className="acm-sub-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="acm-sub-card">
        <div className="acm-sub-header">
          <div className="acm-sub-title">{editing ? 'Edit' : 'Add New'} <span className="acm-sub-title-accent">Address</span></div>
          <button type="button" className="acm-sub-close" onClick={onClose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="acm-sub-body">
          <div className="acm-row acm-row-2">
            <Field label="Address Type" required>
              <select value={d.type} onChange={e => set('type', e.target.value)}>
                <option value="">Select</option>{['Registered Office','Branch Office','Warehouse','Billing Address','Shipping Address','Other'].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Address" required><input value={d.line} onChange={e => set('line', e.target.value)} placeholder="Enter complete address" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Country" required>
              <select value={d.country} onChange={e => { set('country', e.target.value); set('state', ''); }}>
                <option value="">Select</option>{Object.keys(STATES_BY_COUNTRY).map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="State" required>
              <select value={d.state} onChange={e => set('state', e.target.value)} disabled={!d.country}>
                {d.country ? <option value="">Select state</option> : <option>Select country first</option>}{states.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="City" required><input value={d.city} onChange={e => set('city', e.target.value)} placeholder="Enter City" /></Field>
            <Field label="Pin / Postal Code" required><input value={d.pin} onChange={e => set('pin', e.target.value)} maxLength={10} placeholder="Enter 6-digit PIN code" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Contact Person Name" required><input value={d.cpName} onChange={e => set('cpName', e.target.value)} placeholder="Full name" /></Field>
            <Field label="Designation" required><input value={d.cpDesignation} onChange={e => set('cpDesignation', e.target.value)} placeholder="Enter designation" /></Field>
            <Field label="Contact No" required><input type="tel" value={d.cpContact} onChange={e => set('cpContact', e.target.value)} placeholder="10–15 digit mobile" /></Field>
            <Field label="Email Id" required><input type="email" value={d.cpEmail} onChange={e => set('cpEmail', e.target.value)} placeholder="name@company.com" /></Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Whatsapp Enabled?" required>
              <div className="acm-radio-pills">
                <label className={`acm-radio-pill ${d.cpWhatsapp === 'yes' ? 'is-active' : ''}`}><input type="radio" name="addrWa" value="yes" checked={d.cpWhatsapp === 'yes'} onChange={() => set('cpWhatsapp', 'yes')} /> Yes</label>
                <label className={`acm-radio-pill ${d.cpWhatsapp === 'no' ? 'is-active' : ''}`}><input type="radio" name="addrWa" value="no" checked={d.cpWhatsapp === 'no'} onChange={() => set('cpWhatsapp', 'no')} /> No</label>
              </div>
            </Field>
          </div>
        </div>
        <div className="acm-sub-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="acm-btn-save" onClick={submit}>{editing ? 'Update' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

function ContactSubModal({ editing, onClose, onSave }: { editing: ContactRow | null; onClose: () => void; onSave: (rec: Omit<ContactRow, 'id'>) => void }) {
  const [d, setD] = useState<Omit<ContactRow, 'id'>>(() => editing ? { ...editing } : {
    name:'', designation:'', contact:'', email:'', whatsapp:'' as 'yes'|'no'|'',
    type:'', line:'', country:'', state:'', city:'', pin:'',
  });
  const set = <K extends keyof typeof d>(k: K, v: (typeof d)[K]) => setD(prev => ({ ...prev, [k]: v }));
  const states = STATES_BY_COUNTRY[d.country] || [];
  const submit = () => {
    const required: (keyof typeof d)[] = ['name','designation','contact','email','whatsapp','type','line','country','state','city','pin'];
    for (const k of required) if (!d[k]) { alert('Please fill all required fields.'); return; }
    if (!/^\S+@\S+\.\S+$/.test(d.email)) { alert('Please enter a valid Email Id.'); return; }
    onSave(d);
  };
  return (
    <div className="acm-sub-modal" onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="acm-sub-card">
        <div className="acm-sub-header">
          <div className="acm-sub-title">{editing ? 'Edit' : 'Add New'} <span className="acm-sub-title-accent">Contact</span></div>
          <button type="button" className="acm-sub-close" onClick={onClose}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>
        <div className="acm-sub-body">
          <div className="acm-row acm-row-4">
            <Field label="Contact Person Name" required><input value={d.name} onChange={e => set('name', e.target.value)} placeholder="Full name" /></Field>
            <Field label="Designation" required><input value={d.designation} onChange={e => set('designation', e.target.value)} placeholder="Enter designation" /></Field>
            <Field label="Contact No" required><input type="tel" value={d.contact} onChange={e => set('contact', e.target.value)} placeholder="10–15 digit mobile" /></Field>
            <Field label="Email Id" required><input type="email" value={d.email} onChange={e => set('email', e.target.value)} placeholder="name@company.com" /></Field>
          </div>
          <div className="acm-row acm-row-1">
            <Field label="Whatsapp Enabled?" required>
              <div className="acm-radio-pills">
                <label className={`acm-radio-pill ${d.whatsapp === 'yes' ? 'is-active' : ''}`}><input type="radio" name="cpsWa" value="yes" checked={d.whatsapp === 'yes'} onChange={() => set('whatsapp', 'yes')} /> Yes</label>
                <label className={`acm-radio-pill ${d.whatsapp === 'no' ? 'is-active' : ''}`}><input type="radio" name="cpsWa" value="no" checked={d.whatsapp === 'no'} onChange={() => set('whatsapp', 'no')} /> No</label>
              </div>
            </Field>
          </div>
          <div className="acm-row acm-row-2">
            <Field label="Address Type" required>
              <select value={d.type} onChange={e => set('type', e.target.value)}>
                <option value="">Select</option>{['Registered Office','Branch Office','Warehouse','Billing Address','Shipping Address','Other'].map(o => <option key={o}>{o}</option>)}
              </select>
            </Field>
            <Field label="Address" required><input value={d.line} onChange={e => set('line', e.target.value)} placeholder="Enter complete address" /></Field>
          </div>
          <div className="acm-row acm-row-4">
            <Field label="Country" required>
              <select value={d.country} onChange={e => { set('country', e.target.value); set('state', ''); }}>
                <option value="">Select</option>{Object.keys(STATES_BY_COUNTRY).map(c => <option key={c}>{c}</option>)}
              </select>
            </Field>
            <Field label="State" required>
              <select value={d.state} onChange={e => set('state', e.target.value)} disabled={!d.country}>
                {d.country ? <option value="">Select state</option> : <option>Select country first</option>}{states.map(s => <option key={s}>{s}</option>)}
              </select>
            </Field>
            <Field label="City" required><input value={d.city} onChange={e => set('city', e.target.value)} placeholder="Enter City" /></Field>
            <Field label="Pin / Postal Code" required><input value={d.pin} onChange={e => set('pin', e.target.value)} maxLength={10} placeholder="Enter 6-digit PIN code" /></Field>
          </div>
        </div>
        <div className="acm-sub-footer">
          <button type="button" className="acm-btn-mini-cancel" onClick={onClose}>Cancel</button>
          <button type="button" className="acm-btn-save" onClick={submit}>{editing ? 'Update' : 'Save'}</button>
        </div>
      </div>
    </div>
  );
}

/* ───── History panels ───── */
function HistoryStage1({ form, addresses, contacts }: { form: any; addresses: AddressRow[]; contacts: ContactRow[] }) {
  const fld = (key: string, val: string) => (
    <div className="acm-hs-field">
      <span className="acm-hs-key">{key}</span>
      <span className={`acm-hs-val ${!val ? 'acm-hs-empty' : ''}`}>{val || '—'}</span>
    </div>
  );
  return (
    <div className="acm-hs-block">
      <div className="acm-hs-header">
        <div className="acm-hs-num"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div className="acm-hs-title">Stage 1 — Customer Legal Identity</div>
        <div className="acm-hs-divider" />
      </div>
      <div className="acm-hs-group">
        <div className="acm-hs-group-label">Company Information</div>
        <div className="acm-hs-fields acm-hs-fields-3" style={{ marginBottom: 5 }}>
          {fld('Company Name', form.coName)}{fld('Legal Name', form.coLegal)}{fld('Customer Type', form.coType)}
        </div>
        <div className="acm-hs-fields">
          {fld('Website', form.coWeb)}{fld('Segment', form.coSeg)}{fld('Classification', form.coClass)}{fld('Risk Level', form.coRisk)}
        </div>
      </div>
      <div className="acm-hs-group">
        <div className="acm-hs-group-label">Primary Address {addresses.length > 0 && `(+ ${addresses.length} more)`}</div>
        <div className="acm-hs-inline">{[form.addrType, form.addr, form.city, form.state, form.country, form.pin].filter(Boolean).join(' • ') || <span className="acm-hs-inline-empty">No data entered</span>}</div>
      </div>
      <div className="acm-hs-group">
        <div className="acm-hs-group-label">Primary Contact {contacts.length > 0 && `(+ ${contacts.length} more)`}</div>
        <div className="acm-hs-inline">{[form.cpName + (form.cpDesig ? ` (${form.cpDesig})` : ''), form.cpTel, form.cpEmail, form.cpWa ? `WhatsApp: ${form.cpWa.toUpperCase()}` : ''].filter(Boolean).join(' • ') || <span className="acm-hs-inline-empty">No data entered</span>}</div>
      </div>
    </div>
  );
}
function HistoryStage2() {
  return (
    <div className="acm-hs-block">
      <div className="acm-hs-header">
        <div className="acm-hs-num"><svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="20 6 9 17 4 12"/></svg></div>
        <div className="acm-hs-title">Stage 2 — KYC / Due Diligence</div>
        <div className="acm-hs-divider" />
      </div>
      <div className="acm-hs-group">
        <div className="acm-hs-group-label">Document Summary</div>
        <div className="acm-hs-stats">
          <div className="acm-hs-stat"><div className="acm-hs-stat-num">{DD_DOCS.length}</div><div className="acm-hs-stat-lbl">DD Docs</div></div>
          <div className="acm-hs-stat"><div className="acm-hs-stat-num">{OWN_KYC_DOCS.length}</div><div className="acm-hs-stat-lbl">Owner KYC</div></div>
          <div className="acm-hs-stat"><div className="acm-hs-stat-num">{TL_DOCS.length}</div><div className="acm-hs-stat-lbl">Trade Lic.</div></div>
          <div className="acm-hs-stat"><div className="acm-hs-stat-num">{DD_DOCS.length + OWN_KYC_DOCS.length + TL_DOCS.length}</div><div className="acm-hs-stat-lbl">Total</div></div>
        </div>
      </div>
    </div>
  );
}

/* ───── Reusable field wrapper ───── */
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="acm-field">
      <label>{label} {required && <span className="acm-req">*</span>}</label>
      {children}
    </div>
  );
}

/* ───── Scoped CSS (root: .acm-root) ───── */
const SCOPED_CSS = `
.acm-root {
  position: fixed; inset: 0; z-index: 10000;
  display: flex; align-items: center; justify-content: center;
  padding: 16px;
  background: radial-gradient(ellipse at center, rgba(76,29,149,.45) 0%, rgba(15,5,40,.78) 100%);
  -webkit-backdrop-filter: blur(10px) saturate(1.3);
          backdrop-filter: blur(10px) saturate(1.3);
  font-family: 'DM Sans', system-ui, -apple-system, sans-serif;
  animation: acmFadeIn .25s ease;
}
@keyframes acmFadeIn { from { opacity: 0; } to { opacity: 1; } }

.acm-root *, .acm-root *::before, .acm-root *::after { box-sizing: border-box; }

.acm-card {
  width: 100%; max-width: 1200px; max-height: calc(100vh - 32px);
  background: linear-gradient(165deg,#faf7ff 0%,#f5efff 45%,#ede9fe 100%);
  border: 1px solid rgba(167,139,250,.5);
  border-radius: 20px;
  box-shadow: 0 32px 80px -20px rgba(76,29,149,.55), 0 12px 30px rgba(15,5,40,.25), inset 0 1px 0 rgba(255,255,255,.75);
  overflow: hidden; display: flex; flex-direction: column;
  animation: acmSlideUp .35s cubic-bezier(.34,1.56,.64,1);
}
@keyframes acmSlideUp { from { opacity: 0; transform: translateY(24px) scale(.96); } to { opacity: 1; transform: translateY(0) scale(1); } }

.acm-header {
  background: linear-gradient(135deg,#2e1065 0%,#4c1d95 30%,#6d28d9 65%,#7c3aed 100%);
  padding: 16px 22px; display: flex; align-items: center; justify-content: space-between;
  position: relative; overflow: hidden; flex-shrink: 0;
}
.acm-header::before {
  content: ''; position: absolute; inset: 0; pointer-events: none;
  background-image: radial-gradient(ellipse at 15% 50%, rgba(167,139,250,.32) 0%, transparent 55%), radial-gradient(ellipse at 85% 50%, rgba(139,92,246,.22) 0%, transparent 55%);
}
.acm-header-left { display: flex; align-items: center; gap: 14px; position: relative; z-index: 1; }
.acm-header-icon { width: 40px; height: 40px; border-radius: 12px; background: rgba(255,255,255,.18); border: 1.5px solid rgba(255,255,255,.3); display: flex; align-items: center; justify-content: center; -webkit-backdrop-filter: blur(4px); backdrop-filter: blur(4px); flex-shrink: 0; }
.acm-title { font-size: 17px; font-weight: 800; color: #fff; letter-spacing: -.3px; line-height: 1.2; }
.acm-subtitle { font-size: 12px; color: rgba(255,255,255,.78); margin-top: 3px; }
.acm-close { width: 34px; height: 34px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.3); background: rgba(255,255,255,.1); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; transition: all .25s; position: relative; z-index: 1; }
.acm-close:hover { background: rgba(255,255,255,.28); transform: rotate(90deg); }

/* Stepper */
.acm-stepper { padding: 16px 22px 14px; display: flex; align-items: center; gap: 0; flex-shrink: 0; }
.acm-step-connector { flex: 0 0 28px; height: 28px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; position: relative; z-index: 0; }
.acm-connector-line { width: 100%; height: 3px; background: #e2e8f0; border-radius: 3px; position: relative; overflow: hidden; }
.acm-connector-line::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, #10b981, #059669); border-radius: 3px; transform: scaleX(0); transform-origin: left; transition: transform .5s cubic-bezier(.4,0,.2,1); }
.acm-connector-line[data-done="1"]::after { transform: scaleX(1); }
.acm-step { flex: 1; padding: 11px 14px; border-radius: 14px; display: flex; align-items: center; gap: 12px; position: relative; overflow: hidden; transition: all .25s; cursor: pointer; min-width: 0; }
.acm-step-badge-wrap { position: relative; flex-shrink: 0; width: 40px; height: 40px; }
.acm-step-badge { width: 40px; height: 40px; border-radius: 12px; display: flex; align-items: center; justify-content: center; transition: all .25s; }
.acm-step-num { position: absolute; bottom: -4px; right: -4px; width: 18px; height: 18px; border-radius: 50%; display: flex; align-items: center; justify-content: center; font-size: 9px; font-weight: 900; border: 2px solid #fff; line-height: 1; box-shadow: 0 1px 3px rgba(0,0,0,.15); }
.acm-step-text { min-width: 0; flex: 1; }
.acm-step-title { font-size: 12px; font-weight: 800; letter-spacing: -.2px; line-height: 1.25; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-step-sub { font-size: 9.5px; margin-top: 2px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-step-active { background: linear-gradient(135deg, #ede9fe 0%, #ddd6fe 100%); border: 2px solid #7c3aed; box-shadow: 0 6px 22px rgba(109,40,217,.22), 0 1px 0 rgba(255,255,255,.85) inset; }
.acm-step-active .acm-step-badge { background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; box-shadow: 0 5px 14px rgba(109,40,217,.48); }
.acm-step-active .acm-step-num { background: linear-gradient(135deg, #6d28d9, #4c1d95); color: #fff; }
.acm-step-active .acm-step-title { color: #2e1065; }
.acm-step-active .acm-step-sub { color: #6d28d9; }
.acm-step-done { background: linear-gradient(135deg, #ecfdf5 0%, #d1fae5 100%); border: 2px solid #10b981; box-shadow: 0 6px 20px rgba(16,185,129,.2), 0 1px 0 rgba(255,255,255,.85) inset; }
.acm-step-done .acm-step-badge { background: linear-gradient(135deg, #10b981, #047857); color: #fff; box-shadow: 0 5px 12px rgba(16,185,129,.42); }
.acm-step-done .acm-step-num { background: linear-gradient(135deg, #059669, #047857); color: #fff; }
.acm-step-done .acm-step-title { color: #065f46; }
.acm-step-done .acm-step-sub { color: #10b981; }
.acm-step-pending { background: #f8fafc; border: 1.5px solid #e2e8f0; cursor: not-allowed; opacity: .75; }
.acm-step-pending .acm-step-badge { background: linear-gradient(135deg, #f1f5f9, #e2e8f0); color: #94a3b8; border: 1px solid #e2e8f0; }
.acm-step-pending .acm-step-num { background: #e2e8f0; color: #94a3b8; }
.acm-step-pending .acm-step-title { color: #94a3b8; font-weight: 700; }
.acm-step-pending .acm-step-sub { color: #cbd5e1; }

/* Tabs */
.acm-tabs { padding: 14px 22px 0; display: flex; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }
.acm-tab { padding: 7px 18px; border-radius: 10px; border: 1.5px solid transparent; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .2s; white-space: nowrap; }
.acm-tab-on { background: linear-gradient(135deg,#7c3aed,#6d28d9); color: #fff; border-color: #7c3aed; box-shadow: 0 3px 10px rgba(109,40,217,.35); }
.acm-tab-off { background: #fff; color: #6d28d9; border-color: #c4b5fd; }
.acm-tab-off:hover { background: #ede9fe; border-color: #7c3aed; }

/* Body */
.acm-body { flex: 1; overflow-y: auto; padding: 16px 22px 20px; scrollbar-width: thin; scrollbar-color: #a78bfa #ede9fe; }
.acm-body::-webkit-scrollbar { width: 6px; }
.acm-body::-webkit-scrollbar-track { background: #ede9fe; border-radius: 10px; }
.acm-body::-webkit-scrollbar-thumb { background: #a78bfa; border-radius: 10px; }

/* Section card */
.acm-section { background: #fff; border: 1.5px solid #e0d9f7; border-radius: 14px; margin-bottom: 16px; overflow: hidden; box-shadow: 0 2px 12px rgba(109,40,217,.06); }
.acm-section:last-child { margin-bottom: 0; }
.acm-section-purple { border-top: 3px solid #7c3aed; }
.acm-section-head { padding: 11px 16px; background: linear-gradient(110deg,#faf5ff 0%,#f0ebff 100%); display: flex; align-items: center; gap: 10px; border-bottom: 1px solid #ede9fe; }
.acm-section-icon { width: 28px; height: 28px; border-radius: 8px; display: flex; align-items: center; justify-content: center; flex-shrink: 0; background: linear-gradient(135deg,#ede9fe,#ddd6fe); color: #7c3aed; border: 1px solid #c4b5fd; }
.acm-section-title { font-size: 11px; font-weight: 800; letter-spacing: .1em; text-transform: uppercase; color: #5b21b6; }
.acm-section-sub { font-size: 11px; color: #9ca3af; font-weight: 500; display: inline-block; margin-left: 6px; }
.acm-section-body { padding: 16px; }
.acm-section-body-table { padding: 0 !important; }
.acm-section-head-row { display: flex; align-items: center; gap: 10px; flex-wrap: wrap; width: 100%; }
.acm-section-head-row > div:nth-child(2) { flex: 1; min-width: 0; }

/* Forms */
.acm-row { display: grid; gap: 14px; margin-bottom: 14px; }
.acm-row:last-child { margin-bottom: 0; }
.acm-row-2 { grid-template-columns: 1fr 2fr; }
.acm-row-3 { grid-template-columns: repeat(3, 1fr); }
.acm-row-4 { grid-template-columns: repeat(4, 1fr); }
.acm-row-1 { grid-template-columns: 1fr; }
.acm-field { display: flex; flex-direction: column; min-width: 0; }
.acm-field label { font-size: 10px; font-weight: 800; letter-spacing: .09em; color: #6b7280; text-transform: uppercase; margin-bottom: 5px; }
.acm-req { color: #ef4444; font-weight: 700; }
.acm-field input, .acm-field select, .acm-field textarea {
  width: 100%; padding: 9px 12px; border: 1.5px solid #e0d9f7; border-radius: 9px;
  font-family: inherit; font-size: 12px; color: #3b0764;
  background: #fff; outline: none; transition: border-color .18s, box-shadow .18s, background .18s;
  appearance: auto; box-sizing: border-box;
}
.acm-field input:focus, .acm-field select:focus, .acm-field textarea:focus { border-color: #7c3aed; box-shadow: 0 0 0 3.5px rgba(124,58,237,.14); }
.acm-field input::placeholder { color: #c4b5fd; font-size: 11.5px; }
.acm-radio-row { display: flex; align-items: center; gap: 16px; padding: 9px 0; }
.acm-radio { display: inline-flex; align-items: center; gap: 6px; font-size: 11.5px; font-weight: 700; color: #6b7280; cursor: pointer; letter-spacing: .04em; user-select: none; }
.acm-radio input[type="radio"] { accent-color: #7c3aed; width: 14px; height: 14px; cursor: pointer; }

/* Footer */
.acm-footer {
  padding: 14px 22px; border-top: 1px solid rgba(167,139,250,.35);
  background: linear-gradient(180deg, rgba(255,255,255,.6) 0%, rgba(237,233,254,.92) 100%);
  display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-shrink: 0;
}
.acm-req-note { font-size: 11.5px; color: #6d28d9; font-weight: 500; display: inline-flex; align-items: center; gap: 7px; }
.acm-req-dot { width: 7px; height: 7px; border-radius: 50%; background: linear-gradient(135deg,#a78bfa,#7c3aed); box-shadow: 0 0 0 3px rgba(167,139,250,.18); }
.acm-footer-actions { display: inline-flex; align-items: center; gap: 10px; }
.acm-btn-prev, .acm-btn-next {
  padding: 9px 22px; border-radius: 10px; font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; display: inline-flex; align-items: center; gap: 7px; transition: all .22s;
  letter-spacing: .02em;
}
.acm-btn-prev { border: 1.5px solid rgba(124,58,237,.3); background: rgba(255,255,255,.92); color: #5b21b6; box-shadow: 0 1px 0 rgba(255,255,255,.9) inset, 0 2px 6px rgba(124,58,237,.08); }
.acm-btn-prev:hover { background: #fff; border-color: #7c3aed; color: #4c1d95; transform: translateY(-1px); }
.acm-btn-next { border: none; background: linear-gradient(135deg,#8b5cf6 0%,#7c3aed 45%,#6d28d9 100%); color: #fff; box-shadow: 0 6px 18px -4px rgba(109,40,217,.55), 0 2px 4px rgba(76,29,149,.25), inset 0 1px 0 rgba(255,255,255,.28); }
.acm-btn-next:hover { transform: translateY(-1.5px); box-shadow: 0 10px 24px -4px rgba(109,40,217,.65); }

/* Sub-tabs (Stage 2) */
.acm-subtabs-row { display: flex; gap: 8px; margin-bottom: 16px; flex-wrap: wrap; }
.acm-subtab-pill { padding: 7px 18px; border-radius: 10px; border: 1.5px solid #c4b5fd; background: #fff; color: #6d28d9; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; transition: all .2s; white-space: nowrap; }
.acm-subtab-pill:hover:not(.is-active) { background: #ede9fe; }
.acm-subtab-pill.is-active { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; border-color: #7c3aed; box-shadow: 0 3px 10px rgba(109,40,217,.35); }

/* Nested tabs (Stage 3) */
.acm-nested-tabs { display: flex; gap: 0; margin-bottom: 16px; border-bottom: 1.5px solid #ede9fe; padding: 0 4px; flex-wrap: wrap; }
.acm-nested-tab { padding: 10px 18px; border: none; background: transparent; color: #9ca3af; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; position: relative; transition: color .2s; white-space: nowrap; margin-bottom: -1.5px; }
.acm-nested-tab::after { content: ''; position: absolute; bottom: 0; left: 14px; right: 14px; height: 2.5px; background: linear-gradient(90deg, #7c3aed, #6d28d9); border-radius: 3px 3px 0 0; transform: scaleX(0); transform-origin: center; transition: transform .25s ease; }
.acm-nested-tab:hover:not(.is-active) { color: #6d28d9; }
.acm-nested-tab.is-active { color: #6d28d9; }
.acm-nested-tab.is-active::after { transform: scaleX(1); }

/* Doc toolbar */
.acm-doc-toolbar { display: flex; justify-content: space-between; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px 16px; background: linear-gradient(180deg, #faf7ff, #f5efff); border-bottom: 1px solid #ede9fe; }
.acm-doc-search { position: relative; flex: 1; max-width: 340px; min-width: 200px; }
.acm-doc-search input { width: 100%; padding: 8px 14px 8px 36px !important; border: 1.5px solid #e0d9f7 !important; border-radius: 22px !important; font-size: 12px !important; background: #fff !important; font-family: inherit; color: #3b0764; outline: none; box-sizing: border-box; }
.acm-doc-search input:focus { border-color: #7c3aed !important; box-shadow: 0 0 0 3px rgba(124,58,237,.12) !important; }
.acm-doc-search-icon { position: absolute; left: 13px; top: 50%; transform: translateY(-50%); color: #a78bfa; pointer-events: none; }
.acm-doc-count { font-size: 11.5px; color: #6d28d9; font-weight: 700; white-space: nowrap; letter-spacing: .02em; }

/* Tables */
.acm-table-wrap { width: 100%; overflow-x: auto; }
.acm-table { width: 100%; border-collapse: collapse; font-size: 11.5px; min-width: 900px; }
.acm-table thead tr { background: linear-gradient(180deg, #faf7ff, #f5efff); }
.acm-table thead th { padding: 13px 14px; text-align: left; font-size: 9.5px; font-weight: 800; letter-spacing: .1em; color: #6b7280; text-transform: uppercase; border-bottom: 1px solid #ede9fe; white-space: nowrap; }
.acm-table tbody td { padding: 13px 14px; border-bottom: 1px solid #f5f3ff; color: #3b0764; vertical-align: middle; font-size: 11.5px; }
.acm-table tbody tr:last-child td { border-bottom: none; }
.acm-table tbody tr:hover td { background: #faf7ff; }
.acm-empty-row td { text-align: center; color: #9ca3af; padding: 26px 14px !important; font-size: 11.5px; font-style: italic; background: #fafaff; }
.acm-empty-row strong { color: #6d28d9; font-style: normal; }

/* Pills + chips */
.acm-doc-code { display: inline-block; padding: 3px 9px; border-radius: 6px; background: linear-gradient(135deg, #f5f3ff, #ede9fe); color: #5b21b6; font-family: 'JetBrains Mono', monospace; font-size: 10.5px; font-weight: 700; border: 1px solid #c4b5fd; letter-spacing: .02em; }
.acm-status-toggle { display: inline-flex; gap: 6px; align-items: center; }
.acm-status-mandatory, .acm-status-optional { display: inline-flex; align-items: center; gap: 4px; padding: 3px 10px; border-radius: 20px; font-size: 10.5px; font-weight: 700; border: 1px solid transparent; }
.acm-status-mandatory { background: #f5f3ff; color: #9ca3af; border-color: #e5e1f3; }
.acm-status-mandatory.is-on { background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #15803d; border-color: #86efac; }
.acm-status-optional { background: #fff; color: #9ca3af; border-color: #e5e1f3; }
.acm-status-optional.is-on { background: #fff; color: #374151; border-color: #9ca3af; font-weight: 700; }
.acm-status-active { display: inline-flex; align-items: center; gap: 5px; padding: 3px 11px; border-radius: 20px; font-size: 10.5px; font-weight: 700; background: linear-gradient(135deg, #dcfce7, #bbf7d0); color: #15803d; border: 1px solid #86efac; }
.acm-expiry-na, .acm-expiry-date, .acm-expiry-varies { display: inline-block; padding: 3px 11px; border-radius: 20px; font-size: 10.5px; font-weight: 700; white-space: nowrap; }
.acm-expiry-na { background: #f3f4f6; color: #6b7280; border: 1px solid #e5e7eb; }
.acm-expiry-date { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #b91c1c; border: 1px solid #fca5a5; }
.acm-expiry-varies { background: linear-gradient(135deg,#fef3c7,#fde68a); color: #92400e; border: 1px solid #fcd34d; }

/* Action buttons */
.acm-row-actions { display: inline-flex; gap: 4px; }
.acm-row-btn { width: 26px; height: 26px; border-radius: 7px; border: 1px solid #e0d9f7; background: #fff; color: #7c3aed; cursor: pointer; display: inline-flex; align-items: center; justify-content: center; padding: 0; }
.acm-row-btn:hover { background: #ede9fe; border-color: #c4b5fd; }
.acm-row-btn-del { color: #ef4444; }
.acm-row-btn-del:hover { background: #fee2e2; border-color: #fca5a5; }
.acm-doc-action { width: 28px; height: 28px; border-radius: 7px; border: 1.5px solid; display: inline-flex; align-items: center; justify-content: center; cursor: pointer; padding: 0; transition: all .15s; }
.acm-doc-action-upload { border-color: #bae6fd; background: linear-gradient(135deg, #f0f9ff, #e0f2fe); color: #0284c7; }
.acm-doc-action-upload:hover { background: linear-gradient(135deg, #0ea5e9, #0284c7); color: #fff; border-color: #0284c7; }
.acm-doc-action-download { border-color: #bbf7d0; background: linear-gradient(135deg, #f0fdf4, #dcfce7); color: #16a34a; }
.acm-doc-action-download:hover { background: linear-gradient(135deg, #22c55e, #16a34a); color: #fff; border-color: #16a34a; }
.acm-doc-action-view { border-color: #c4b5fd; background: linear-gradient(135deg, #f5f3ff, #ede9fe); color: #6d28d9; }
.acm-doc-action-view:hover { background: linear-gradient(135deg, #a78bfa, #7c3aed); color: #fff; }

/* Whatsapp pills in tables */
.acm-pill-yes, .acm-pill-no { display: inline-block; padding: 2px 9px; border-radius: 20px; font-size: 10px; font-weight: 700; }
.acm-pill-yes { background: linear-gradient(135deg,#dcfce7,#bbf7d0); color: #15803d; border: 1px solid #86efac; }
.acm-pill-no { background: linear-gradient(135deg,#fee2e2,#fecaca); color: #b91c1c; border: 1px solid #fca5a5; }

/* Add pill button */
.acm-add-pill { display: inline-flex; align-items: center; gap: 5px; padding: 6px 14px; border-radius: 20px; border: 1px solid #c4b5fd; background: #fff; color: #6d28d9; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all .18s; white-space: nowrap; box-shadow: 0 2px 6px rgba(109,40,217,.1); flex-shrink: 0; }
.acm-add-pill:hover { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; border-color: #7c3aed; transform: translateY(-1px); }

/* Pagination */
.acm-doc-pag-wrap { display: flex; justify-content: space-between; align-items: center; gap: 10px; padding: 11px 16px; border-top: 1px solid #ede9fe; background: #fafafd; flex-wrap: wrap; }
.acm-doc-pag-info { font-size: 11px; color: #6b7280; font-weight: 500; }
.acm-pagination { display: inline-flex; gap: 4px; }
.acm-page-btn { min-width: 28px; height: 28px; padding: 0 8px; border-radius: 7px; border: 1px solid #e5e1f3; background: #fff; color: #6b7280; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; transition: all .15s; }
.acm-page-btn:hover:not(.is-active):not(:disabled) { border-color: #c4b5fd; color: #6d28d9; background: #f5f3ff; }
.acm-page-btn.is-active { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; border-color: #7c3aed; }
.acm-page-btn:disabled { opacity: .4; cursor: not-allowed; }

/* Attachment link */
.acm-attach-link { display: inline-flex; align-items: center; gap: 5px; color: #2563eb; font-family: inherit; font-size: 11.5px; font-weight: 600; cursor: pointer; background: none; border: none; padding: 0; }
.acm-attach-link:hover { color: #1d4ed8; text-decoration: underline; }

/* Trade docs table */
.acm-td-table col.col-srno { width: 52px; }
.acm-td-table col.col-docname { width: 30%; }
.acm-td-table col.col-sig { width: 220px; }
.acm-td-table col.col-status { width: 130px; }
.acm-td-table col.col-actions { width: 90px; }
.acm-td-table td.td-status, .acm-td-table th.th-status, .acm-td-table td.td-actions, .acm-td-table th.th-actions { text-align: center; }
.acm-td-check-label { display: inline-flex; align-items: center; gap: 8px; cursor: pointer; font-family: inherit; font-size: 9px; font-weight: 800; letter-spacing: .1em; color: #6b7280; text-transform: uppercase; user-select: none; }
.acm-td-check-label input[type="checkbox"] { accent-color: #7c3aed; width: 15px; height: 15px; margin: 0; cursor: pointer; }
.acm-td-cell-check { display: flex; align-items: center; gap: 10px; }
.acm-td-cell-check > input[type="checkbox"] { width: 15px; height: 15px; accent-color: #7c3aed; cursor: pointer; margin: 0; }
.acm-btn-resend { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 20px; border: 1.5px solid #7c3aed; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; font-family: inherit; font-size: 10.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.acm-btn-send { display: inline-flex; align-items: center; gap: 5px; padding: 4px 12px; border-radius: 20px; border: 1.5px solid #7c3aed; background: #fff; color: #6d28d9; font-family: inherit; font-size: 10.5px; font-weight: 700; cursor: pointer; white-space: nowrap; }
.acm-btn-send:hover { background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; }
.acm-td-actions { display: flex; justify-content: center; align-items: center; gap: 14px; padding: 16px; border-top: 1px solid #ede9fe; background: linear-gradient(180deg, #faf7ff, #f5efff); flex-wrap: wrap; }
.acm-btn-purple-lg { padding: 9px 20px; border-radius: 10px; border: none; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; box-shadow: 0 4px 12px rgba(109,40,217,.38); }
.acm-btn-purple-lg-out { padding: 9px 20px; border-radius: 10px; border: 1.5px solid #c4b5fd; background: #fff; color: #6d28d9; font-family: inherit; font-size: 12px; font-weight: 700; cursor: pointer; display: inline-flex; align-items: center; gap: 7px; }
.acm-btn-purple-lg-out:hover { background: #ede9fe; }

/* Sub-modals */
.acm-sub-modal { position: fixed; inset: 0; z-index: 10001; display: flex; align-items: center; justify-content: center; padding: 18px; background: rgba(20,20,30,.45); -webkit-backdrop-filter: blur(8px); backdrop-filter: blur(8px); }
.acm-sub-card { width: 100%; max-width: 880px; max-height: calc(100vh - 36px); background: #fff; border: 1px solid #e9e6f5; border-radius: 14px; overflow: hidden; display: flex; flex-direction: column; box-shadow: 0 20px 56px -16px rgba(15,15,30,.32), 0 8px 24px rgba(15,15,30,.14); animation: acmSlideUp .3s cubic-bezier(.34,1.56,.64,1); }
.acm-sub-header { background: linear-gradient(110deg, #7c3aed 0%, #8b5cf6 60%, #a78bfa 100%); padding: 14px 22px; display: flex; align-items: center; justify-content: space-between; flex-shrink: 0; }
.acm-sub-title { font-size: 16px; font-weight: 800; color: #fff; letter-spacing: -.3px; }
.acm-sub-title-accent { color: #fff; }
.acm-sub-close { width: 30px; height: 30px; border-radius: 50%; border: 1.5px solid rgba(255,255,255,.4); background: rgba(255,255,255,.15); color: #fff; cursor: pointer; display: flex; align-items: center; justify-content: center; padding: 0; }
.acm-sub-close:hover { background: rgba(255,255,255,.32); transform: rotate(90deg); }
.acm-sub-body { flex: 1; padding: 20px 24px; overflow-y: auto; background: linear-gradient(180deg, #fff 0%, #fbfaff 100%); }
.acm-sub-footer { padding: 14px 22px; display: flex; justify-content: center; gap: 12px; border-top: 1px solid #efeaf9; background: #faf9fd; flex-shrink: 0; }
.acm-btn-save { padding: 7px 18px; border-radius: 9px; border: none; background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; box-shadow: 0 3px 10px rgba(109,40,217,.35); }
.acm-btn-save:hover { background: linear-gradient(135deg, #6d28d9, #4c1d95); transform: translateY(-1px); }
.acm-btn-mini-cancel { padding: 7px 18px; border-radius: 9px; border: 1.5px solid rgba(124,58,237,.3); background: #fff; color: #5b21b6; font-family: inherit; font-size: 11.5px; font-weight: 700; cursor: pointer; }
.acm-btn-mini-cancel:hover { border-color: #7c3aed; }

/* Radio pills */
.acm-radio-pills { display: inline-flex; gap: 10px; flex-wrap: wrap; }
.acm-radio-pill { display: inline-flex; align-items: center; gap: 8px; padding: 8px 18px; border: 1.5px solid #e5e1f3; border-radius: 9px; background: #fff; cursor: pointer; font-size: 12px; font-weight: 700; color: #6b7280; user-select: none; }
.acm-radio-pill input[type="radio"] { accent-color: #7c3aed; width: 13px; height: 13px; margin: 0; }
.acm-radio-pill.is-active { border-color: #7c3aed; background: #f5f3ff; color: #5b21b6; box-shadow: 0 0 0 3px rgba(124,58,237,.10); }

/* History panel */
.acm-history { margin: 10px 22px 0; border-radius: 12px; border: 1.5px solid #c4b5fd; background: #fff; overflow: hidden; box-shadow: 0 2px 12px rgba(109,40,217,.09); flex-shrink: 0; max-height: 46px; transition: max-height .38s cubic-bezier(.4,0,.2,1); }
.acm-history.acm-hist-open { max-height: 280px; }
.acm-history-header { height: 46px; box-sizing: border-box; display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 0 16px; cursor: pointer; background: linear-gradient(110deg, #f5f3ff 0%, #ede9fe 100%); border-left: 4px solid #7c3aed; user-select: none; }
.acm-history-header:hover { background: linear-gradient(110deg, #ede9fe, #ddd6fe); }
.acm-history-header-left { display: flex; align-items: center; gap: 10px; min-width: 0; }
.acm-history-icon { width: 28px; height: 28px; border-radius: 8px; background: linear-gradient(135deg, #7c3aed, #5b21b6); color: #fff; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.acm-history-title { font-size: 12px; font-weight: 800; color: #3b0764; white-space: nowrap; }
.acm-history-meta { font-size: 9.5px; color: #7c3aed; margin-top: 1px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-history-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; }
.acm-history-badge { padding: 3px 11px; border-radius: 20px; background: linear-gradient(135deg, #7c3aed, #6d28d9); color: #fff; font-size: 9.5px; font-weight: 800; white-space: nowrap; }
.acm-history-chevron { width: 22px; height: 22px; border-radius: 50%; background: rgba(124,58,237,.12); display: flex; align-items: center; justify-content: center; color: #7c3aed; transition: transform .3s; }
.acm-history-chevron.acm-open { transform: rotate(180deg); }
.acm-history-body { overflow-y: auto; max-height: calc(280px - 46px); border-top: 1px solid #ede9fe; }
.acm-hs-block { padding: 12px 16px 10px; border-bottom: 1px solid #f3f0fb; }
.acm-hs-block:last-child { border-bottom: none; }
.acm-hs-header { display: flex; align-items: center; gap: 8px; margin-bottom: 10px; }
.acm-hs-num { width: 20px; height: 20px; border-radius: 50%; background: linear-gradient(135deg, #10b981, #047857); color: #fff; font-size: 8px; font-weight: 900; display: flex; align-items: center; justify-content: center; flex-shrink: 0; }
.acm-hs-title { font-size: 10px; font-weight: 800; color: #065f46; text-transform: uppercase; letter-spacing: .08em; }
.acm-hs-divider { flex: 1; height: 1px; background: linear-gradient(90deg, #bbf7d0, transparent); }
.acm-hs-group { margin-bottom: 9px; }
.acm-hs-group:last-child { margin-bottom: 0; }
.acm-hs-group-label { font-size: 8.5px; font-weight: 800; color: #a78bfa; text-transform: uppercase; letter-spacing: .1em; margin-bottom: 5px; padding-bottom: 4px; border-bottom: 1px dashed #ede9fe; }
.acm-hs-fields { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px 0; }
.acm-hs-fields-3 { grid-template-columns: repeat(3, 1fr); }
.acm-hs-field { padding-right: 10px; padding-left: 8px; min-width: 0; border-right: 1px solid #f3f0fb; }
.acm-hs-field:first-child { padding-left: 0; }
.acm-hs-field:last-child { border-right: none; }
.acm-hs-key { display: block; font-size: 8.5px; font-weight: 700; color: #9ca3af; text-transform: uppercase; letter-spacing: .07em; margin-bottom: 2px; }
.acm-hs-val { display: block; font-size: 11px; font-weight: 700; color: #1f2937; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.acm-hs-val.acm-hs-empty { color: #d1d5db; font-style: italic; font-weight: 400; }
.acm-hs-inline { font-size: 10.5px; font-weight: 600; color: #374151; padding: 5px 8px; border-radius: 7px; background: #faf8ff; border: 1px solid #ede9fe; }
.acm-hs-inline-empty { color: #d1d5db; font-style: italic; font-weight: 400; }
.acm-hs-stats { display: grid; grid-template-columns: repeat(4,1fr); gap: 6px; }
.acm-hs-stat { background: linear-gradient(135deg, #f5f3ff, #ede9fe); border: 1px solid #ddd6fe; border-radius: 8px; padding: 6px 10px; text-align: center; }
.acm-hs-stat-num { font-size: 14px; font-weight: 900; color: #5b21b6; line-height: 1; }
.acm-hs-stat-lbl { font-size: 8px; font-weight: 700; color: #7c3aed; text-transform: uppercase; letter-spacing: .07em; margin-top: 2px; }

@media (max-width: 900px) {
  .acm-card { max-width: 100%; }
  .acm-row-3, .acm-row-4 { grid-template-columns: repeat(2, 1fr); }
}
@media (max-width: 680px) {
  .acm-row-2, .acm-row-3, .acm-row-4 { grid-template-columns: 1fr; }
  .acm-stepper { overflow-x: auto; }
  .acm-step { min-width: 200px; flex: 0 0 auto; }
}
`;
