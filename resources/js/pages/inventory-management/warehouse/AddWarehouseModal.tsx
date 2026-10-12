import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
/* The P2P form chrome, whole: `Field` is the shared label + control + error
   cell, `EditSelect` is the app's standard dropdown, and the input, textarea
   and grid classes come from the wizard stylesheet. Only the handful of
   controls this form has that no other does are defined here. */
/* The stylesheet those classes live in. The list page does not load it — it
   is a table, not a form — so the modal brings its own. Without it `Field`
   renders label and control side by side with no grid at all. */
import '../../p2p/p2p-detail.css';
/* And the one `Field`'s own hint and error live in. Without it they fall back
   to the page's body text — full size, near-black in light and near-white in
   dark, where they should be small and muted in both. */
import '../../p2p/purchase-management/order/create-po/create-po.css';
/* And its own, so it is dressed wherever it is opened from rather than only
   on the page that happens to import them. */
import './warehouse-master.css';
import { Field, EditSelect } from '../../p2p/purchase-management/order/create-po/form-fields';
import { WAREHOUSES, type Warehouse, type WarehouseType } from './warehouse-data';
/* Loaded only when someone picks "Take photo": it pulls in getUserMedia
   handling that opening this form should not pay for. */
const CameraCaptureModal = lazy(() =>
  import('../../p2p/purchase-management/order/physical-inspection/CameraCaptureModal'));

/* ── Icons: the prototype's own paths ─────────────────────────────────── */
const Ico = (d: ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IcoWarehouse = (p: { size?: number }) => Ico(
  <><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" /><line x1="3" y1="21" x2="21" y2="21" /></>,
  p.size ?? 14,
);
const IcoPin = () => Ico(
  <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>, 13,
);
const IcoUser = () => Ico(
  <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>, 13,
);
const IcoClip = () => Ico(
  <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48" />, 14,
);
const IcoX = (p: { size?: number }) => Ico(
  <><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></>, p.size ?? 16,
);
const IcoCheck = () => Ico(<polyline points="20 6 9 17 4 12" />, 14);
const IcoInfo = () => Ico(
  <><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" />
    <line x1="12" y1="16" x2="12.01" y2="16" /></>, 13,
);
const ICON_UPLOAD = Ico(
  <><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="17 8 12 3 7 8" />
    <line x1="12" y1="3" x2="12" y2="15" /></>, 15,
);
const ICON_CAMERA = Ico(
  <><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
    <circle cx="12" cy="13" r="4" /></>, 15,
);

/* ── The lists the two location dropdowns offer ───────────────────────── */
const COUNTRIES = ['India', 'United Arab Emirates', 'Singapore', 'United Kingdom', 'United States', 'Other'];
const STATES = [
  'Andhra Pradesh', 'Arunachal Pradesh', 'Assam', 'Bihar', 'Chhattisgarh', 'Goa', 'Gujarat',
  'Haryana', 'Himachal Pradesh', 'Jharkhand', 'Karnataka', 'Kerala', 'Madhya Pradesh',
  'Maharashtra', 'Manipur', 'Meghalaya', 'Mizoram', 'Nagaland', 'Odisha', 'Punjab', 'Rajasthan',
  'Sikkim', 'Tamil Nadu', 'Telangana', 'Tripura', 'Uttar Pradesh', 'Uttarakhand', 'West Bengal',
  'Andaman and Nicobar Islands', 'Chandigarh', 'Dadra and Nagar Haveli and Daman and Diu',
  'Delhi', 'Jammu and Kashmir', 'Ladakh', 'Lakshadweep', 'Puducherry',
];

const TYPE_LABEL: Record<WarehouseType, string> = {
  own: 'Own Warehouse',
  tpl: 'Third-Party Warehouse',
};
const TYPE_OPTIONS = [TYPE_LABEL.own, TYPE_LABEL.tpl];

/** Everything the form collects. Strings throughout — it is a form. */
interface Draft {
  type: string;
  name: string;
  area: string;
  address: string;
  country: string;
  state: string;
  city: string;
  pin: string;
  map: string;
  contact: string;
  mobile: string;
  email: string;
  card: string;
}

const EMPTY: Draft = {
  type: '', name: '', area: '', address: '', country: 'India', state: '',
  city: '', pin: '', map: '', contact: '', mobile: '', email: '', card: '',
};

/** The id the next warehouse takes: one past the highest in the list. */
function nextId(): string {
  const max = WAREHOUSES.reduce((n, w) => Math.max(n, Number(w.id.replace(/\D/g, '')) || 0), 0);
  return `WH-${String(max + 1).padStart(3, '0')}`;
}

/** Which fields are wrong, and why. Empty means the form can be saved. */
function validate(d: Draft): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {};
  const india = d.country === 'India';
  if (!d.type) e.type = 'Choose the ownership type.';
  if (!d.name.trim()) e.name = 'Give the warehouse a name.';
  if (!d.area.trim()) e.area = 'Enter the area.';
  else if (!(Number(d.area) > 0)) e.area = 'Area must be more than zero.';
  if (!d.address.trim()) e.address = 'Enter the address.';
  if (!d.country) e.country = 'Choose a country.';
  /* States are an Indian list, so the field is only required where that list
     applies — elsewhere it has nothing right to offer. */
  if (india && !d.state) e.state = 'Choose a state.';
  if (!d.city.trim()) e.city = 'Enter the city.';
  if (!d.pin.trim()) e.pin = india ? 'Enter the 6-digit pin code.' : 'Enter the postal code.';
  else if (india && !/^\d{6}$/.test(d.pin)) e.pin = 'A pin code is 6 digits.';
  if (!d.contact.trim()) e.contact = 'Enter the contact person.';
  if (!d.mobile.trim()) e.mobile = 'Enter the mobile number.';
  else if (india && !/^\d{10}$/.test(d.mobile)) e.mobile = 'A mobile number is 10 digits.';
  if (!d.email.trim()) e.email = 'Enter the email.';
  /* Deliberately loose: the shape of an address, not a spec. Anything
     stricter rejects addresses that work. */
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email)) e.email = 'That does not look like an email.';
  if (d.map.trim() && !/^https?:\/\//i.test(d.map.trim())) e.map = 'Paste the full link, starting with https://';
  return e;
}

/**
 * Add Warehouse — the form behind the list's Add button and its edit pencil.
 *
 * Design only: it validates and reports, and does not persist. The page it
 * opens from reads a static module, so a saved warehouse has nowhere to go
 * until there is an endpoint; Save says so rather than pretending.
 */
export default function AddWarehouseModal({ warehouse, onClose }: {
  /** Present when the pencil opened it — the form then edits that record. */
  warehouse?: Warehouse;
  onClose: () => void;
}) {
  const editing = !!warehouse;
  const toast = useToast();
  useScrollLock(true, '.whm-addmdl');

  const [d, setD] = useState<Draft>(() => (warehouse
    ? {
      type: TYPE_LABEL[warehouse.type], name: warehouse.name, area: String(warehouse.area),
      address: warehouse.address, country: warehouse.country, state: warehouse.state,
      city: warehouse.city, pin: warehouse.pin, map: warehouse.map,
      contact: warehouse.contact, mobile: warehouse.mobile.replace(/^\+91\s*/, ''),
      email: warehouse.email, card: '',
    }
    : EMPTY));
  const set = (p: Partial<Draft>) => setD(prev => ({ ...prev, ...p }));

  /* Errors appear on save, not while typing: flagging a field the moment it
     is touched tells someone their half-typed email is wrong. */
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const clear = (k: keyof Draft) => setErrors(e => (e[k] ? { ...e, [k]: undefined } : e));

  const cardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [pickOpen, setPickOpen] = useState(false);
  const [camOpen, setCamOpen] = useState(false);

  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      /* The menu and the camera close first — Escape should back out one
         layer at a time, not throw the whole form away. */
      if (pickOpen) { setPickOpen(false); return; }
      if (camOpen) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, pickOpen, camOpen]);

  const id = editing ? warehouse!.id : nextId();
  const india = d.country === 'India';

  const save = () => {
    const e = validate(d);
    setErrors(e);
    const bad = Object.keys(e).filter(k => e[k as keyof Draft]);
    if (bad.length) {
      toast.error(
        bad.length === 1 ? 'One field needs attention' : `${bad.length} fields need attention`,
        'Each one is marked below.',
      );
      /* Put them on the first problem rather than making them hunt. */
      document.querySelector('.whm-addmdl .cpf-err')
        ?.closest('.spi-dt-field')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    toast.info(
      editing ? `${id} would be updated` : `${id} would be saved`,
      'The form is complete. Saving arrives with the warehouse endpoint.',
    );
    onClose();
  };

  return createPortal(
    <div className="spi-mdl-backdrop whm-backdrop" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        className="spi-mdl whm-addmdl"
        role="dialog" aria-modal="true" aria-labelledby="whm-add-title"
        tabIndex={-1} ref={cardRef}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><IcoWarehouse size={22} /></div>
            <div>
              <div className="spi-mdl-title" id="whm-add-title">
                {editing ? 'Edit Warehouse' : 'Add Warehouse'}
              </div>
              <div className="spi-mdl-sub">
                Create a warehouse record with its location, ownership type and contact details.
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body whm-addbody">

          {/* ── Warehouse details ───────────────────────────────────── */}
          <Card icon={<IcoWarehouse size={15} />} title="Warehouse Details">
            <Field label="Warehouse ID" hint="Generated automatically">
              <div className="whm-auto">
                <input className="spi-dt-inp" value={id} readOnly />
                <span className="whm-auto__tag">AUTO</span>
              </div>
            </Field>
            <Field label="Warehouse Type" req error={errors.type}>
              <EditSelect
                value={d.type} options={TYPE_OPTIONS} invalid={!!errors.type}
                placeholder="Select warehouse type"
                onChange={v => { set({ type: v }); clear('type'); }}
              />
            </Field>
            <Field label="Warehouse Name" req error={errors.name}>
              <input
                className={`spi-dt-inp${errors.name ? ' is-invalid' : ''}`}
                placeholder="e.g. Mumbai Central Warehouse" maxLength={120}
                value={d.name} onChange={e => { set({ name: e.target.value }); clear('name'); }}
              />
            </Field>
            <Field label="Warehouse Area (Sq. Ft)" req error={errors.area}>
              <div className="whm-suf">
                <input
                  className={`spi-dt-inp${errors.area ? ' is-invalid' : ''}`}
                  type="number" min={1} placeholder="e.g. 25000"
                  value={d.area} onChange={e => { set({ area: e.target.value }); clear('area'); }}
                />
                <span>Sq. Ft</span>
              </div>
            </Field>
          </Card>

          {/* ── Location ────────────────────────────────────────────── */}
          <Card icon={<IcoPin />} title="Location Details">
            <Field label="Warehouse Address" req full error={errors.address}>
              <textarea
                className={`spi-dt-textarea whm-ta${errors.address ? ' is-invalid' : ''}`}
                rows={1} placeholder="Building, street, area / industrial estate" maxLength={255}
                value={d.address} onChange={e => { set({ address: e.target.value }); clear('address'); }}
              />
            </Field>
            <Field label="Country" req error={errors.country}>
              <EditSelect
                value={d.country} options={COUNTRIES} invalid={!!errors.country}
                placeholder="Select country"
                /* Changing country clears the state: an Indian state under a
                   different country is worse than an empty field. */
                onChange={v => { set({ country: v, state: v === 'India' ? d.state : '' }); clear('country'); }}
              />
            </Field>
            <Field
              label="State" req={india} error={errors.state}
              hint={india ? undefined : 'States are listed for India only.'}
            >
              <EditSelect
                value={d.state} options={india ? STATES : []} invalid={!!errors.state}
                placeholder={india ? 'Select state' : 'Not applicable'}
                readOnly={!india}
                onChange={v => { set({ state: v }); clear('state'); }}
              />
            </Field>
            <Field label="City" req error={errors.city}>
              <input
                className={`spi-dt-inp${errors.city ? ' is-invalid' : ''}`}
                placeholder="e.g. Mumbai" maxLength={80}
                value={d.city} onChange={e => { set({ city: e.target.value }); clear('city'); }}
              />
            </Field>
            <Field label={india ? 'Pin Code' : 'Postal Code'} req error={errors.pin}>
              <input
                className={`spi-dt-inp${errors.pin ? ' is-invalid' : ''}`}
                placeholder={india ? '6-digit pin code' : 'Postal code'}
                maxLength={india ? 6 : 12} inputMode="numeric"
                value={d.pin}
                onChange={e => {
                  const v = india ? e.target.value.replace(/\D/g, '') : e.target.value;
                  set({ pin: v }); clear('pin');
                }}
              />
            </Field>
            <Field label="Google Location Link" full error={errors.map}
              hint="Paste the Google Maps share link of the warehouse">
              <input
                className={`spi-dt-inp${errors.map ? ' is-invalid' : ''}`}
                type="url" placeholder="https://maps.google.com/..." maxLength={500}
                value={d.map} onChange={e => { set({ map: e.target.value }); clear('map'); }}
              />
            </Field>
          </Card>

          {/* ── Contact person ──────────────────────────────────────── */}
          <Card icon={<IcoUser />} title="Contact Person Details">
            <Field label="Contact Person" req error={errors.contact}>
              <input
                className={`spi-dt-inp${errors.contact ? ' is-invalid' : ''}`}
                placeholder="Full name" maxLength={80}
                value={d.contact} onChange={e => { set({ contact: e.target.value }); clear('contact'); }}
              />
            </Field>
            <Field label="Mobile Number" req error={errors.mobile}>
              <div className="whm-pre">
                {/* The dial code is fixed to the country rather than typed, so
                    the number itself is stored without one. */}
                <span>{india ? '+91' : '+'}</span>
                <input
                  className={`spi-dt-inp${errors.mobile ? ' is-invalid' : ''}`}
                  type="tel" inputMode="numeric" maxLength={india ? 10 : 15}
                  placeholder={india ? '10-digit mobile number' : 'Mobile number'}
                  value={d.mobile}
                  onChange={e => { set({ mobile: e.target.value.replace(/\D/g, '') }); clear('mobile'); }}
                />
              </div>
            </Field>
            <Field label="Email" req error={errors.email}>
              <input
                className={`spi-dt-inp${errors.email ? ' is-invalid' : ''}`}
                type="email" placeholder="name@company.com" maxLength={120}
                value={d.email} onChange={e => { set({ email: e.target.value }); clear('email'); }}
              />
            </Field>
            <Field label="Attachment (Business Card)" hint="JPG, PNG or PDF · up to 5 MB">
              <div className={`whm-file${d.card ? ' has-file' : ''}`}>
                <span className="whm-file__ico"><IcoClip /></span>
                <button type="button" className="whm-file__txt" onClick={() => setPickOpen(o => !o)}
                  title={d.card || 'Add the contact’s business card'}>
                  {d.card || 'Upload business card'}
                </button>
                {d.card && (
                  <button type="button" className="whm-file__x" aria-label="Remove file"
                    onClick={() => set({ card: '' })}>
                    <IcoX size={12} />
                  </button>
                )}
                {pickOpen && (
                  <>
                    {/* Closes on a click anywhere else, including inside the
                        form — a menu left open over the fields is in the way. */}
                    <div className="whm-file__scrim" onClick={() => setPickOpen(false)} />
                    <div className="arf-att whm-file__menu" role="menu">
                      <div className="arf-att__hd">Add attachment</div>
                      <button type="button" className="arf-att__opt" role="menuitem"
                        onClick={() => { setPickOpen(false); fileRef.current?.click(); }}>
                        <span className="arf-att__ico">{ICON_UPLOAD}</span>
                        <span><b>Upload file</b><i>Choose from this device</i></span>
                      </button>
                      <button type="button" className="arf-att__opt" role="menuitem"
                        onClick={() => { setPickOpen(false); setCamOpen(true); }}>
                        <span className="arf-att__ico arf-att__ico--cam">{ICON_CAMERA}</span>
                        <span><b>Take photo</b><i>Capture with the camera</i></span>
                      </button>
                    </div>
                  </>
                )}
                <input
                  ref={fileRef} type="file" accept="image/*,.pdf" hidden
                  onChange={e => {
                    const f = e.target.files?.[0];
                    /* 5 MB, as the hint under the field promises. */
                    if (f && f.size > 5 * 1024 * 1024) {
                      toast.error('That file is too large', `${f.name} is over the 5 MB limit.`);
                    } else if (f) {
                      set({ card: f.name });
                    }
                    e.target.value = '';
                  }}
                />
              </div>
            </Field>
          </Card>
        </div>

        <div className="spi-mdl-foot">
          <span className="whm-footnote"><IcoInfo /> Fields marked * are required</span>
          <div className="spi-mdl-foot-btns">
            <button type="button" className="spi-mdl-cancel" onClick={onClose}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" onClick={save}>
              <IcoCheck /> {editing ? 'Update Warehouse' : 'Save Warehouse'}
            </button>
          </div>
        </div>
      </div>

      {camOpen && (
        <Suspense fallback={null}>
          <CameraCaptureModal
            title="Photograph the business card"
            subject="Business card"
            namePrefix="business-card"
            max={1}
            onAttach={shots => { if (shots[0]) set({ card: shots[0].name }); setCamOpen(false); }}
            onClose={() => setCamOpen(false)}
          />
        </Suspense>
      )}
    </div>,
    document.body,
  );
}

/**
 * One section: a white card carrying a gradient bar down its left edge, its
 * title, and the fields under it.
 *
 * The title alone, with no line of description beneath it — the design drops
 * that here. Three cards of explanation above fields that already say what
 * they are is noise, and it pushes the form past a laptop screen.
 */
function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="whm-card">
      <div className="whm-sec">
        <span className="whm-sec__ico">{icon}</span>
        <b>{title}</b>
      </div>
      <div className="spi-dt-grid4">{children}</div>
    </div>
  );
}
