import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { useToast } from '../../../contexts/ToastContext';
import { useBranchSwitcher } from '../../../contexts/BranchSwitcherContext';
import '../../p2p/p2p-detail.css';
import '../../p2p/purchase-management/order/create-po/create-po.css';
import './warehouse-master.css';
import { Field, EditSelect } from '../../p2p/purchase-management/order/create-po/form-fields';
import {
  WarehouseApiError, warehouseApi,
  type LookupOption, type Warehouse, type WarehousePayload, type WarehouseType,
} from './warehouse-data';
const CameraCaptureModal = lazy(() =>
  import('../../p2p/purchase-management/order/physical-inspection/CameraCaptureModal'));

const Ico = (d: ReactNode, size = 14) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IcoWarehouse = (p: { size?: number }) => Ico(
  <><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" /><line x1="3" y1="21" x2="21" y2="21" /></>,
  p.size ?? 14,
);
const IcoPin = () => Ico(
  <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>, 14,
);
const IcoUser = () => Ico(
  <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>, 14,
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

const TYPE_LABEL: Record<WarehouseType, string> = {
  own: 'Own Warehouse',
  tpl: 'Third-Party Warehouse',
};
const TYPE_OPTIONS = [TYPE_LABEL.own, TYPE_LABEL.tpl];

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

const FIELD_FOR: Record<string, keyof Draft> = {
  wh_name: 'name', wh_type: 'type', area_sqft: 'area', address: 'address', country_id: 'country',
  state_id: 'state', state_name: 'state', city: 'city', pincode: 'pin', map_url: 'map',
  contact_person: 'contact', contact_dial: 'mobile', contact_mobile: 'mobile', contact_email: 'email', card: 'card',
};

function validate(d: Draft, hasStates: boolean): Partial<Record<keyof Draft, string>> {
  const e: Partial<Record<keyof Draft, string>> = {};
  const india = d.country === 'India';
  if (!d.type) e.type = 'Select the warehouse type';
  if (!d.name.trim()) e.name = 'Enter the warehouse name';
  if (!(Number(d.area) > 0)) e.area = 'Enter the area in square feet';
  if (!d.address.trim()) e.address = 'Enter the warehouse address';
  if (!d.country) e.country = 'Select the country';
  if (!d.state.trim()) e.state = hasStates ? 'Select the state' : 'Enter the state';
  if (!d.city.trim()) e.city = 'Enter the city';
  const pin = d.pin.trim();
  if (!pin) e.pin = 'Enter the pin code';
  else if (india && !/^[1-9]\d{5}$/.test(pin)) e.pin = 'Pin code must be 6 digits';
  if (!d.contact.trim()) e.contact = 'Enter the contact person’s name';
  const mobile = d.mobile.replace(/[\s-]/g, '');
  if (!mobile) e.mobile = 'Enter the mobile number';
  else if (india && !/^[6-9]\d{9}$/.test(mobile)) e.mobile = 'Enter a valid 10-digit mobile number';
  else if (!india && !/^\d{6,15}$/.test(mobile)) e.mobile = 'Enter a valid mobile number';
  if (!d.email.trim()) e.email = 'Enter the email address';
  else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.email.trim())) e.email = 'Enter a valid email address';
  if (d.map.trim() && !/^https?:\/\/\S+$/i.test(d.map.trim())) e.map = 'Enter a valid link starting with https://';
  return e;
}

export default function AddWarehouseModal({ warehouse, onClose, onSaved }: {
  warehouse?: Warehouse;
  onClose: () => void;
  onSaved?: (warehouse: Warehouse) => void;
}) {
  const editing = !!warehouse;
  /* Four fields settle once the first zone is built.

     A zone is allocated AGAINST the warehouse's area, so shrinking it afterwards
     leaves every zone over-committed and the free figure pinned at nothing. And
     the address is not a label: the goods are physically in that city, under
     that state's tax code, and they do not move because a dropdown changed.

     The server refuses all four (WarehouseController::guardSettled); this says
     so before the form is filled in rather than after it is sent. */
  const zoneCount = editing ? (warehouse!.zones ?? 0) : 0;
  const settled = zoneCount > 0;
  /* Said ONCE, when the field is touched — not standing under all four.
     The same sentence printed four times reads as four problems, and it pushes
     the form apart while saying nothing the user asked. A locked control that
     answers when you click it is quieter and arrives at the moment the question
     is actually being asked. */
  const lockedNote = () => toast.info(
    'Settled once zones exist',
    zoneCount + (zoneCount === 1 ? ' zone is' : ' zones are')
      + ' allocated against this warehouse, so its area and location can no longer change.'
      + ' Remove the zones first, or raise a new warehouse.',
  );
  const toast = useToast();
  useScrollLock(true, '.whm-addmdl');

  const [d, setD] = useState<Draft>(() => (warehouse
    ? {
      type: TYPE_LABEL[warehouse.type], name: warehouse.name, area: String(warehouse.area),
      address: warehouse.address, country: warehouse.country, state: warehouse.state,
      city: warehouse.city, pin: warehouse.pin, map: warehouse.map,
      contact: warehouse.contact, mobile: warehouse.mobile.replace(/^\+91\s*/, ''),
      email: warehouse.email, card: warehouse.cardName ?? '',
    }
    : EMPTY));
  const set = (p: Partial<Draft>) => setD(prev => ({ ...prev, ...p }));

  const [cardFile, setCardFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const { selectedBranchId } = useBranchSwitcher();

  const [countries, setCountries] = useState<LookupOption[]>([]);
  useEffect(() => {
    warehouseApi.countries().then(setCountries).catch(() => {
      toast.error('Could not load countries', 'Close the form and open it again.');
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const countryId = useMemo(
    () => countries.find(c => c.name === d.country)?.id
      ?? (warehouse && warehouse.country === d.country ? warehouse.countryId ?? undefined : undefined),
    [countries, d.country, warehouse],
  );

  const [states, setStates] = useState<LookupOption[]>([]);
  const [statesFor, setStatesFor] = useState<number | null>(null);
  useEffect(() => {
    if (!countryId) { setStates([]); setStatesFor(null); return; }
    let live = true;
    warehouseApi.states(countryId)
      .then(list => { if (live) { setStates(list); setStatesFor(countryId); } })
      .catch(() => { if (live) { setStates([]); setStatesFor(countryId); } });
    return () => { live = false; };
  }, [countryId]);
  const hasStates = states.length > 0;

  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const clear = (k: keyof Draft) => setErrors(e => (e[k] ? { ...e, [k]: undefined } : e));

  const cardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  /* The attachment field, so the menu can be placed against it. */
  const dropRef = useRef<HTMLDivElement>(null);
  const [pickAt, setPickAt] = useState<{ top: number; left: number; width: number } | null>(null);

  /* Below the field when there is room, above it when there is not — in a
     dialog this close to the bottom of the screen, there often is not. */
  const openPicker = () => {
    const r = dropRef.current?.getBoundingClientRect();
    if (!r) return;
    const H = 158;
    const below = r.bottom + 6 + H <= window.innerHeight - 12;
    setPickAt({
      top: below ? r.bottom + 6 : Math.max(12, r.top - H - 6),
      left: r.left,
      width: Math.min(320, Math.max(268, r.width)),
    });
  };

  /* A portalled menu does not travel with its field, so it closes rather than
     drifting away from it. */
  useEffect(() => {
    if (!pickAt) return;
    const close = () => setPickAt(null);
    const onDown = (e: MouseEvent) => {
      const t = e.target as Element | null;
      if (t?.closest?.('.arf-att') || (t && dropRef.current?.contains(t))) return;
      close();
    };
    window.addEventListener('scroll', close, true);
    window.addEventListener('resize', close);
    document.addEventListener('mousedown', onDown);
    return () => {
      window.removeEventListener('scroll', close, true);
      window.removeEventListener('resize', close);
      document.removeEventListener('mousedown', onDown);
    };
  }, [pickAt]);
  const [camOpen, setCamOpen] = useState(false);

  useEffect(() => { cardRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || saving) return;
      /* The menu and the camera close first — Escape should back out one
         layer at a time, not throw the whole form away. */
      if (pickAt) { setPickAt(null); return; }
      if (camOpen) return;
      onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [onClose, pickAt, camOpen, saving]);

  const [nextCode, setNextCode] = useState<string | null>(null);
  useEffect(() => {
    if (editing) return;
    let live = true;
    warehouseApi.nextCode()
      .then(code => { if (live) setNextCode(code || 'Assigned on save'); })
      .catch(() => { if (live) setNextCode('Assigned on save'); });
    return () => { live = false; };
  }, [editing]);

  const id = editing ? warehouse!.id : (nextCode ?? 'Loading…');
  const india = d.country === 'India';

  const save = async () => {
    if (saving) return;
    /* Until the country's states arrive, hasStates is false and the state
       would go up as free text with no id — moving the warehouse off the
       States master, or tripping "State cannot be changed" on one with zones. */
    if (countryId && statesFor !== countryId) {
      toast.error('Still loading states', 'Try again in a moment.');
      return;
    }
    const e = validate(d, hasStates);
    if (!e.country && !countryId) e.country = 'Select the country';
    const stateId = hasStates ? states.find(x => x.name === d.state)?.id : undefined;
    if (!e.state && hasStates && !stateId) e.state = 'Select the state';
    setErrors(e);
    const bad = Object.keys(e).filter(k => e[k as keyof Draft]);
    if (bad.length) {
      toast.error(
        bad.length === 1 ? 'One field needs attention' : `${bad.length} fields need attention`,
        'Each one is marked below.',
      );
      document.querySelector('.whm-addmdl .cpf-err')
        ?.closest('.spi-dt-field')?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      return;
    }
    const payload: WarehousePayload = {
      wh_name: d.name.trim(),
      wh_type: d.type === TYPE_LABEL.tpl ? 'tpl' : 'own',
      area_sqft: Number(d.area),
      address: d.address.trim(),
      country_id: countryId!,
      state_id: stateId ?? null,
      state_name: stateId ? null : d.state.trim(),
      city: d.city.trim(),
      pincode: d.pin.trim(),
      map_url: d.map.trim() || null,
      contact_person: d.contact.trim(),
      contact_dial: india ? '+91' : (warehouse?.dial || null),
      contact_mobile: d.mobile.replace(/[\s-]/g, ''),
      contact_email: d.email.trim(),
      card: cardFile,
      // A POST gets no branch from the Axios interceptor; the server needs one.
      ...(editing ? {} : { branch_id: selectedBranchId }),
    };

    setSaving(true);
    try {
      const saved = editing && warehouse!.apiId
        ? await warehouseApi.update(warehouse!.apiId, payload)
        : await warehouseApi.create(payload);
      toast.success(`${saved.id} · ${saved.name} ${editing ? 'updated' : 'added'}`);
      onSaved?.(saved);
      onClose();
    } catch (err) {
      if (err instanceof WarehouseApiError) {
        const next: Partial<Record<keyof Draft, string>> = {};
        for (const [k, msgs] of Object.entries(err.fieldErrors)) {
          const f = FIELD_FOR[k];
          if (f && !next[f]) next[f] = msgs[0];
        }
        setErrors(next);
        toast.error(editing ? 'Could not update the warehouse' : 'Could not create the warehouse',
          Object.values(next)[0] ?? err.message);
      } else {
        toast.error('Could not save the warehouse', 'Please try again.');
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
                {editing
                  ? `Update the location, ownership type and contact details of ${id}.`
                  : 'Create a warehouse record with its location, ownership type and contact details.'}
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><IcoX /></button>
        </div>

        <div className="spi-mdl-body whm-addbody">

          <Card icon={<IcoWarehouse />} title="Warehouse Details">
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
                  className={`spi-dt-inp${errors.area ? ' is-invalid' : ''}${settled ? ' is-locked' : ''}`}
                  type="number" min={1} placeholder="e.g. 25000"
                  readOnly={settled} onClick={settled ? lockedNote : undefined}
                  value={d.area} onChange={e => { set({ area: e.target.value }); clear('area'); }}
                />
                <span>Sq. Ft</span>
              </div>
            </Field>
          </Card>

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
                value={d.country} options={countries.map(c => c.name)} invalid={!!errors.country}
                placeholder={countries.length ? 'Select country' : 'Loading countries…'}
                readOnly={settled} onLockedClick={settled ? lockedNote : undefined}
                onChange={v => { set({ country: v, state: v === d.country ? d.state : '' }); clear('country'); clear('state'); }}
              />
            </Field>
            <Field
              label={hasStates || statesFor !== countryId ? 'State' : 'State / Province'} req error={errors.state}
              hint={!hasStates && statesFor === countryId && countryId ? 'No states are listed for this country — type it.' : undefined}
            >
              {hasStates || statesFor !== countryId ? (
                <EditSelect
                  value={d.state} options={states.map(x => x.name)} invalid={!!errors.state}
                  placeholder={countryId ? (statesFor === countryId ? 'Select state' : 'Loading states…') : 'Choose a country first'}
                  readOnly={!hasStates || settled}
                  onLockedClick={settled ? lockedNote : undefined}
                  onChange={v => { set({ state: v }); clear('state'); }}
                />
              ) : (
                <input
                  className={`spi-dt-inp${errors.state ? ' is-invalid' : ''}`}
                  placeholder="State or province" maxLength={100}
                  readOnly={settled} onClick={settled ? lockedNote : undefined}
                  value={d.state} onChange={e => { set({ state: e.target.value }); clear('state'); }}
                />
              )}
            </Field>
            <Field label="City" req error={errors.city}>
              <input
                className={`spi-dt-inp${errors.city ? ' is-invalid' : ''}${settled ? ' is-locked' : ''}`}
                placeholder="e.g. Mumbai" maxLength={80}
                readOnly={settled} onClick={settled ? lockedNote : undefined}
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
            <Field label="Attachment (Business Card)" hint="JPG, PNG or PDF · up to 5 MB" error={errors.card}>
              <div className={`whm-file${d.card ? ' has-file' : ''}`} ref={dropRef}>
                <span className="whm-file__ico"><IcoClip /></span>
                <button type="button" className="whm-file__txt" onClick={() => (pickAt ? setPickAt(null) : openPicker())}
                  title={d.card || 'Add the contact’s business card'}>
                  {d.card || 'Upload business card'}
                </button>
                {cardFile && (
                  <button type="button" className="whm-file__x" aria-label="Remove file"
                    onClick={() => { setCardFile(null); set({ card: warehouse?.cardName ?? '' }); }}>
                    <IcoX size={12} />
                  </button>
                )}
                {/* Portalled and positioned from the field's own rect, the way
                    Add Payment's attachment menu is. Absolute placement inside
                    the field looked right until the dialog's body scrolled
                    under it, at which point the menu stayed with the page and
                    the field moved. */}
                {pickAt && createPortal(
                  <div className="arf-att" role="menu"
                    style={{ top: pickAt.top, left: pickAt.left, width: pickAt.width }}>
                    <div className="arf-att__hd">Add attachment</div>
                    <button type="button" className="arf-att__opt" role="menuitem"
                      onClick={() => { setPickAt(null); fileRef.current?.click(); }}>
                      <span className="arf-att__ico">{ICON_UPLOAD}</span>
                      <span><b>Upload file</b><i>Choose from this device</i></span>
                    </button>
                    <button type="button" className="arf-att__opt" role="menuitem"
                      onClick={() => { setPickAt(null); setCamOpen(true); }}>
                      <span className="arf-att__ico arf-att__ico--cam">{ICON_CAMERA}</span>
                      <span><b>Take photo</b><i>Capture with the camera</i></span>
                    </button>
                  </div>,
                  document.body,
                )}
                <input
                  ref={fileRef} type="file" accept="image/*,.pdf" hidden
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f && f.size > 5 * 1024 * 1024) {
                      toast.error('That file is too large', `${f.name} is over the 5 MB limit.`);
                    } else if (f) {
                      setCardFile(f);
                      set({ card: f.name });
                      clear('card');
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
            <button type="button" className="spi-mdl-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="button" className="spi-mdl-confirm" onClick={() => void save()} disabled={saving}>
              <IcoCheck /> {saving ? 'Saving…' : editing ? 'Update Warehouse' : 'Save Warehouse'}
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
            onAttach={shots => {
              if (shots[0]) { setCardFile(shots[0]); set({ card: shots[0].name }); clear('card'); }
              setCamOpen(false);
            }}
            onClose={() => setCamOpen(false)}
          />
        </Suspense>
      )}
    </div>,
    document.body,
  );
}

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
