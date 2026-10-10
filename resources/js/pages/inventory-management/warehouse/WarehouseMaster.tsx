import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
/* The P2P page chrome, whole. `p2p-common.css` carries the teal head strip,
   the "What We Are Doing Here" panel with its step cards, the segmented tabs
   and the search box. `order.css` carries the table, its scroller and the
   pager band — and this page is a list exactly like the ones it already
   dresses, so it is the same table here. Only the cells are ours. */
import '../../p2p/p2p-common.css';
import '../../p2p/purchase-management/order/po-list/order.css';
import './warehouse-master.css';
import SearchClear from '../../../components/ui/SearchClear';
import WorklistPager from '../../../components/ui/WorklistPager';
import { useFitPageSize } from '../../../hooks/useFitPageSize';
import { useToast } from '../../../contexts/ToastContext';
import { WAREHOUSES, type Warehouse, type WarehouseType } from './warehouse-data';
/* Lazy: it pulls in the QR encoder, which a visit that never opens a code
   should not pay for. */
const WarehouseQrModal = lazy(() => import('./WarehouseQrModal'));
/* Lazy too: a large form that most visits to the list never open. */
const AddWarehouseModal = lazy(() => import('./AddWarehouseModal'));

/* Built once: `Intl.NumberFormat` is costly to construct and the table formats
   one area per row. */
const inGrouping = new Intl.NumberFormat('en-IN');

/** `2025-04-12` → `12 Apr 2025`, the way the design writes a date. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
function formatDate(iso: string): string {
  const [y, m, d] = iso.split('-');
  const month = MONTHS[Number(m) - 1];
  return month ? `${d} ${month} ${y}` : iso;
}

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/* ── Icons ────────────────────────────────────────────────────────────────
   Inline rather than from a set: these are the prototype's own paths, and a
   nearby lookalike from an icon library would quietly change the drawing. */
const svg = (d: ReactNode, size = 14, width = 2.2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {d}
  </svg>
);

const IcoWarehouse = (p: { size?: number }) => svg(
  <><path d="M3 21V9l9-6 9 6v12" /><path d="M9 21v-7h6v7" /><line x1="3" y1="21" x2="21" y2="21" /></>,
  p.size ?? 14,
);
const IcoOwn = (p: { size?: number }) => svg(
  <><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" /><polyline points="9 22 9 12 15 12 15 22" /></>,
  p.size ?? 14,
);
const IcoTpl = (p: { size?: number }) => svg(
  <><rect x="1" y="7" width="15" height="11" rx="1.5" /><path d="M16 10h4l3 3v5h-7" />
    <circle cx="5.5" cy="18.5" r="2" /><circle cx="18.5" cy="18.5" r="2" /></>,
  p.size ?? 14,
);
const IcoPin = (p: { size?: number }) => svg(
  <><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></>,
  p.size ?? 14,
);
const IcoExt = () => svg(
  <><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
    <polyline points="15 3 21 3 21 9" /><line x1="10" y1="14" x2="21" y2="3" /></>,
  10,
);
const IcoPhone = () => svg(
  <path d="M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6A19.79 19.79 0 0 1 2.12 4.18 2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72c.13.96.36 1.9.7 2.81a2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45c.91.34 1.85.57 2.81.7A2 2 0 0 1 22 16.92z" />,
  11,
);
const IcoMail = () => svg(
  <><rect x="2" y="4" width="20" height="16" rx="2" /><polyline points="22 6 12 13 2 6" /></>, 11,
);
const IcoEdit = () => svg(
  <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>, 15,
);
const IcoQr = () => svg(
  <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" />
    <rect x="3" y="14" width="7" height="7" rx="1" /><path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 20h4v-3" /></>,
  15,
);
const IcoPlus = () => svg(
  <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, 13,
);
const IcoGrid = () => svg(
  <><rect x="3" y="3" width="7" height="7" /><rect x="14" y="3" width="7" height="7" />
    <rect x="14" y="14" width="7" height="7" /><rect x="3" y="14" width="7" height="7" /></>, 11,
);
const IcoUser = () => svg(
  <><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></>, 11,
);
const IcoChevron = () => svg(<polyline points="6 9 12 15 18 9" />, 10);

/* ── The four things this screen is for ─────────────────────────────────── */
const STEPS: Array<{ no: string; icon: ReactNode; title: string; desc: string }> = [
  {
    no: '01', icon: <IcoGrid />, title: 'Create Warehouse Record',
    desc: 'Generate and assign a unique Warehouse ID for warehouse identification and tracking.',
  },
  {
    no: '02', icon: <IcoOwn size={11} />, title: 'Define Warehouse Ownership Type',
    desc: 'Select whether the warehouse is an Own Warehouse or a Third-Party Warehouse.',
  },
  {
    no: '03', icon: <IcoPin size={11} />, title: 'Add Warehouse Location Details',
    desc: 'Capture warehouse city, state, pin code, and complete address information.',
  },
  {
    no: '04', icon: <IcoUser />, title: 'Add Warehouse Contact Person',
    desc: 'Save warehouse in-charge name and contact details for operational coordination.',
  },
];

type Tab = 'all' | WarehouseType;

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'all', label: 'All Warehouses', icon: <IcoWarehouse size={15} /> },
  { key: 'own', label: 'Own Warehouses', icon: <IcoOwn size={15} /> },
  { key: 'tpl', label: 'Third Party Warehouses', icon: <IcoTpl size={15} /> },
];

/** The nine columns, in the design's order. */
const COLUMNS = [
  'Sr. No', 'Warehouse ID', 'Warehouse', 'Warehouse Type', 'Warehouse Area (Sq. Ft)',
  'Google Location', 'Contact Person', 'Warehouse Status', 'Action',
];

/**
 * Warehouse Master.
 *
 * Design only, on static rows — this screen is being drawn before it is
 * wired, so nothing here calls an API and the toggle changes what you see
 * rather than what is stored. Everything it needs from the server arrives
 * later by replacing `warehouse-data.ts`; the page only ever reads it.
 */
export default function WarehouseMaster() {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  /* Collapsed on arrival, as the SPI list opens: the four steps explain the
     screen once, and after that they are four cards between you and the
     table. The header stays, so it is one click back. */
  const [briefOpen, setBriefOpen] = useState(false);

  /* Held here rather than in the data module: the switch is part of what this
     screen demonstrates, so a flip has to survive a re-render, and a static
     module is not somewhere to write to. */
  const [inactive, setInactive] = useState<Record<string, boolean>>(
    () => Object.fromEntries(WAREHOUSES.filter(w => w.status === 'inactive').map(w => [w.id, true])),
  );
  const toast = useToast();
  const toggle = useCallback((id: string) => {
    const next = !inactive[id];
    setInactive(m => ({ ...m, [id]: next }));
    /* Outside the updater on purpose: React may run an updater twice, and a
       toast fired from inside one would appear twice with it.

       Through the app's own toast, which has a single place on screen for
       every message. The prototype drew its own and it landed in the middle
       of the table, over the rows you had just been reading. */
    if (next) toast.warning(`${id} marked Inactive`, 'It stays in the list, dimmed.');
    else toast.success(`${id} marked Active`);
  }, [inactive, toast]);
  const isOff = useCallback((w: Warehouse) => !!inactive[w.id], [inactive]);

  /* Which warehouse's code is open. The row itself, not its id: the modal
     needs every field it prints, and null is closed. */
  const [qrFor, setQrFor] = useState<Warehouse | null>(null);

  /* The form, in its two modes. 'new' is Add; a row is Edit. Null is
     closed — one piece of state rather than an open flag that could
     disagree with the row beside it. */
  const [formFor, setFormFor] = useState<Warehouse | 'new' | null>(null);

  /* Counts come from the whole set, never the searched one — a tab count that
     shrinks as you type reads as data disappearing. */
  const counts = useMemo(() => ({
    all: WAREHOUSES.length,
    own: WAREHOUSES.filter(w => w.type === 'own').length,
    tpl: WAREHOUSES.filter(w => w.type === 'tpl').length,
  }), []);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return WAREHOUSES.filter(w => {
      if (tab !== 'all' && w.type !== tab) return false;
      if (!q) return true;
      /* The same haystack the prototype searches, so a query that worked in
         the design works here: ids, names, the whole address, the contact and
         the two labels that are never stored as written. */
      return [
        w.id, w.name, w.address, w.city, w.state, w.pin, w.country,
        w.contact, w.mobile, w.email,
        w.type === 'own' ? 'own warehouse' : 'third party warehouse 3pl',
        inactive[w.id] ? 'inactive' : 'active',
      ].join(' ').toLowerCase().includes(q);
    });
  }, [tab, query, inactive]);

  /* ── Paging, as every P2P list pages ──────────────────────────────────── */
  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, choosePageSize, refitPageSize] = useFitPageSize(scrollRef);
  useEffect(() => { if (rows.length) refitPageSize(); }, [rows.length, refitPageSize]);
  /* A tab or a search leaves page 4 of a list that may now have one. */
  useEffect(() => { setPage(1); }, [tab, query]);

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const paged = useMemo(() => rows.slice(start, start + pageSize), [rows, start, pageSize]);
  const changePageSize = useCallback((n: number) => { choosePageSize(n); setPage(1); }, [choosePageSize]);

  return (
    /* `ord-page` and `ord-list` are not decoration: order.css scopes its
       Figma-exact sizing to them — the 40px head button, the 38px tabs and the
       44px search. `whm-page` scopes this screen's own cells. */
    <div className="spi-root ord-page whm-page">

      {/* ── Head strip ─────────────────────────────────────────────────── */}
      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoWarehouse size={17} /></div>
          <div>
            <div className="spi-head-title">Warehouse Management</div>
            <div className="spi-head-sub">
              Manage warehouses, storage locations, ownership types, and warehouse operations.
            </div>
          </div>
        </div>
        {/* Inert while this screen is a design: the Add Warehouse form is the
            next piece, and a button that opens nothing is better than one
            that half-opens something. */}
        <button type="button" className="spi-head-btn" onClick={() => setFormFor('new')}>
          <IcoPlus /> Add Warehouse
        </button>
      </div>

      {/* ── What We Are Doing Here ─────────────────────────────────────── */}
      <div className={`spi-bref ${briefOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-bref-head" onClick={() => setBriefOpen(o => !o)}>
          <div className="spi-bref-ico"><IcoWarehouse size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Warehouse Management</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              Creating and configuring warehouse records with location, ownership type, and contact details.
            </div>
          </div>
          <div className="spi-bref-toggle"><IcoChevron /></div>
        </div>
        <div className="spi-bref-body">
          {STEPS.map(s => (
            <div className="spi-step" key={s.no}>
              <div className="spi-step-top">
                <span className="spi-step-ico">{s.icon}</span>
                <span className="spi-step-num">STEP {s.no}</span>
              </div>
              <div className="spi-step-title">{s.title}</div>
              <div className="spi-step-desc">{s.desc}</div>
            </div>
          ))}
        </div>
      </div>

      {/* ── Tabs, search, table, pager ─────────────────────────────────── */}
      <div className="spi-card ord-list">
        <div className="spi-segrow">
          <div className="spi-seg" role="tablist" aria-label="Warehouse type">
            {TABS.map(t => (
              <button
                key={t.key} type="button" role="tab"
                aria-selected={tab === t.key}
                className={`spi-seg-btn${tab === t.key ? ' is-active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span className="spi-seg-ico">{t.icon}</span>
                {t.label}
                <span className="spi-seg-c">{counts[t.key]}</span>
              </button>
            ))}
          </div>

          <div className="spi-search">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
            </svg>
            <input
              type="text"
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search by warehouse ID, name, city, state or contact person..."
              aria-label="Search warehouses"
              /* Browsers autofill anything that looks like a form field; a
                 list filter is not one. */
              autoComplete="off"
            />
            <SearchClear show={query} onClear={() => setQuery('')} />
          </div>
        </div>

        {total === 0 ? (
          /* In place of the table, not inside it: a centred colSpan cell in a
             table wider than the viewport sits off-screen. */
          <div className="ord-empty">
            {query.trim() ? 'No warehouses match your search.' : 'No warehouses in this view yet.'}
          </div>
        ) : (
          <div className="ord-table-scroll" ref={scrollRef}>
            <table className="ord-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              {paged.map((w, i) => (
                /* One tbody per row, which is how this table stripes:
                   order.css shades alternate tbody groups. */
                <tbody key={w.id}>
                  <Row w={w} sr={start + i + 1} off={isOff(w)} onToggle={toggle} onQr={setQrFor} onEdit={setFormFor} />
                </tbody>
              ))}
            </table>
          </div>
        )}

        <WorklistPager
          className="wl-teal"
          total={total}
          page={page}
          pageSize={pageSize}
          onPage={setPage}
          onPageSize={changePageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </div>

      {formFor && (
        <Suspense fallback={null}>
          <AddWarehouseModal
            warehouse={formFor === 'new' ? undefined : formFor}
            onClose={() => setFormFor(null)}
          />
        </Suspense>
      )}

      {qrFor && (
        <Suspense fallback={null}>
          <WarehouseQrModal warehouse={qrFor} onClose={() => setQrFor(null)} />
        </Suspense>
      )}
    </div>
  );
}

/** One warehouse. */
function Row({ w, sr, off, onToggle, onQr, onEdit }: {
  w: Warehouse;
  sr: number;
  off: boolean;
  onToggle: (id: string) => void;
  onQr: (w: Warehouse) => void;
  onEdit: (w: Warehouse) => void;
}) {
  /* The country is left off unless it is not India — on a list that is almost
     entirely Indian, printing it on every row says nothing. */
  const place = [w.city, w.state, w.pin].filter(Boolean).join(', ')
    + (w.country && w.country !== 'India' ? `, ${w.country}` : '');

  return (
    /* No `is-first is-last` here. Those mark the ends of a GROUP on the PO
       list, where one tbody is a purchase order holding several document
       rows, and they carry a 2.5px separator. A warehouse is one row, so
       every row would have been drawn with the heavy group line. */
    <tr className={off ? 'is-off' : undefined}>
      <td><span className="whm-sr">{sr}</span></td>

      <td>
        <div className="whm-idcell">
          <span className="whm-idpill">{w.id}</span>
          <span className="whm-iddate">{formatDate(w.date)}</span>
        </div>
      </td>

      <td>
        <div className="whm-namecell">
          <span className="whm-namecell__ico">
            {w.type === 'own' ? <IcoOwn size={15} /> : <IcoTpl size={15} />}
          </span>
          <div className="whm-namecell__t">
            <b>{w.name}</b>
            <span>{w.address}</span>
            <span className="whm-namecell__loc"><IcoPin size={11} />{place}</span>
          </div>
        </div>
      </td>

      <td>
        <span className={`whm-type whm-type--${w.type}`}>
          {w.type === 'own' ? <IcoOwn size={12} /> : <IcoTpl size={12} />}
          {w.type === 'own' ? 'Own Warehouse' : 'Third Party (3PL)'}
        </span>
      </td>

      <td>
        <span className="whm-area"><b>{inGrouping.format(w.area)}</b><small>Sq. Ft</small></span>
      </td>

      <td>
        <div className="whm-loc">
          <div className="whm-loc__city"><b>{w.city}</b>, {w.state}</div>
          <div className="whm-loc__row">
            <span className="whm-loc__pin">{w.pin}</span>
            {w.map ? (
              <a className="whm-maplink" href={w.map} target="_blank" rel="noopener noreferrer"
                title="Open in Google Maps">
                <IcoPin size={11} />View Map<IcoExt />
              </a>
            ) : (
              <span className="whm-nomap">No map link</span>
            )}
          </div>
        </div>
      </td>

      <td>
        <div className="whm-contact">
          <b>{w.contact}</b>
          <span><IcoPhone />{w.mobile}</span>
          <span><IcoMail /><a href={`mailto:${w.email}`}>{w.email}</a></span>
        </div>
      </td>

      <td>
        <span className={`whm-status whm-status--${off ? 'off' : 'on'}`}>
          <i />{off ? 'Inactive' : 'Active'}
        </span>
      </td>

      <td>
        <div className="whm-acts">
          <button type="button" className="whm-act" aria-label={`Edit ${w.id}`}
            title="Edit this warehouse" onClick={() => onEdit(w)}>
            <IcoEdit />
          </button>
          {/* The one control that does something: it flips what the row says,
              which is as far as a design on static rows can honestly go. */}
          <button
            type="button"
            className={`whm-toggle${off ? '' : ' is-on'}`}
            role="switch" aria-checked={!off}
            aria-label={`Toggle status of ${w.id}`}
            title={off ? 'Inactive — click to activate' : 'Active — click to deactivate'}
            onClick={() => onToggle(w.id)}
          >
            <span />
          </button>
          <button type="button" className="whm-act" aria-label={`Warehouse QR for ${w.id}`}
            title="Warehouse QR" onClick={() => onQr(w)}>
            <IcoQr />
          </button>
        </div>
      </td>
    </tr>
  );
}
