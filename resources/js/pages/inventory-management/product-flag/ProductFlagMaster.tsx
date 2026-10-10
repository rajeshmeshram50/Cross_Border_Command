import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
/* The P2P page chrome, then the warehouse master's cells. The prototype shares
   those between these two screens the same way — its root here is
   `whm-page pfm-page` — so this page carries both classes and adds only what a
   four-column list of flags needs that a nine-column list of warehouses did
   not. */
import '../../p2p/p2p-common.css';
import '../../p2p/purchase-management/order/po-list/order.css';
import '../warehouse/warehouse-master.css';
import './product-flag.css';
import SearchClear from '../../../components/ui/SearchClear';
import WorklistPager from '../../../components/ui/WorklistPager';
import { useFitPageSize } from '../../../hooks/useFitPageSize';
import { useToast } from '../../../contexts/ToastContext';
import { PRODUCT_FLAGS, type ProductFlag } from './product-flag-data';

const AddProductFlagModal = lazy(() => import('./AddProductFlagModal'));

const PAGE_SIZE_OPTIONS = [10, 25, 50];

/* ── Icons: the prototype's own paths ─────────────────────────────────── */
const svg = (d: ReactNode, size = 14, width = 2.2) => (
  <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const IcoFlag = (p: { size?: number }) => svg(
  <><path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z" />
    <line x1="4" y1="22" x2="4" y2="15" /></>,
  p.size ?? 14,
);
const IcoCheckCircle = (p: { size?: number }) => svg(
  <><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14" /><polyline points="22 4 12 14.01 9 11.01" /></>,
  p.size ?? 14,
);
const IcoBan = (p: { size?: number }) => svg(
  <><circle cx="12" cy="12" r="10" /><line x1="4.93" y1="4.93" x2="19.07" y2="19.07" /></>,
  p.size ?? 14,
);
const IcoTag = () => svg(
  <><path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z" />
    <line x1="7" y1="7" x2="7.01" y2="7" /></>, 11,
);
const IcoShield = () => svg(
  <><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></>, 11,
);
const IcoBox = () => svg(
  <><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z" />
    <polyline points="3.27 6.96 12 12.01 20.73 6.96" /><line x1="12" y1="22.08" x2="12" y2="12" /></>, 11,
);
const IcoEdit = () => svg(
  <><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></>, 15,
);
const IcoPlus = () => svg(
  <><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></>, 13,
);
const IcoChevron = () => svg(<polyline points="6 9 12 15 18 9" />, 10);

/* ── What this screen is for ──────────────────────────────────────────── */
const STEPS: Array<{ no: string; icon: ReactNode; title: string; desc: string }> = [
  {
    no: '01', icon: <IcoFlag size={11} />, title: 'Create Flag Record',
    desc: 'Auto-generate the Flag ID and enter the flag name and short code.',
  },
  {
    no: '02', icon: <IcoTag />, title: 'Choose Flag Category',
    desc: 'Handling, Storage or Compliance — with a colour and icon for quick recognition.',
  },
  {
    no: '03', icon: <IcoShield />, title: 'Set Storage Rules',
    desc: 'Link the flag to zone and rack needs, such as a cold chain range or hazardous handling.',
  },
  {
    no: '04', icon: <IcoBox />, title: 'Apply to Products',
    desc: 'Tag products with the flag so putaway and picking always follow its rules.',
  },
];

type Tab = 'all' | 'active' | 'inactive';

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'all', label: 'All Product Flags', icon: <IcoFlag size={15} /> },
  { key: 'active', label: 'Active Product Flags', icon: <IcoCheckCircle size={15} /> },
  { key: 'inactive', label: 'Inactive Product Flags', icon: <IcoBan size={15} /> },
];

const COLUMNS = ['No.', 'Product Flag', 'Purpose', 'Action'];

/**
 * Product Flags Master.
 *
 * Design only, on static rows, like the warehouse list it shares its chrome
 * with. The status switch changes what the row says; nothing is persisted.
 */
export default function ProductFlagMaster() {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  /* Collapsed on arrival: the four steps explain the screen once, and after
     that they are four cards between you and the table. */
  const [briefOpen, setBriefOpen] = useState(false);

  const toast = useToast();
  const [inactive, setInactive] = useState<Record<string, boolean>>(
    () => Object.fromEntries(PRODUCT_FLAGS.filter(f => f.status === 'inactive').map(f => [f.id, true])),
  );
  const toggle = useCallback((id: string) => {
    const next = !inactive[id];
    setInactive(m => ({ ...m, [id]: next }));
    /* Outside the updater: React may run one twice, and the toast with it. */
    if (next) toast.warning(`${id} marked Inactive`, 'It stays in the list, dimmed.');
    else toast.success(`${id} marked Active`);
  }, [inactive, toast]);
  const isOff = useCallback((f: ProductFlag) => !!inactive[f.id], [inactive]);

  const [formFor, setFormFor] = useState<ProductFlag | 'new' | null>(null);

  /* Counts follow the switch, because Active and Inactive are what the switch
     changes — a count that ignored it would contradict the row beside it. */
  const counts = useMemo(() => {
    const act = PRODUCT_FLAGS.filter(f => !inactive[f.id]).length;
    return { all: PRODUCT_FLAGS.length, active: act, inactive: PRODUCT_FLAGS.length - act };
  }, [inactive]);

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return PRODUCT_FLAGS.filter(f => {
      const off = !!inactive[f.id];
      if (tab === 'active' && off) return false;
      if (tab === 'inactive' && !off) return false;
      if (!q) return true;
      return [f.id, f.name, f.purpose, off ? 'inactive' : 'active']
        .join(' ').toLowerCase().includes(q);
    });
  }, [tab, query, inactive]);

  const [page, setPage] = useState(1);
  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, choosePageSize, refitPageSize] = useFitPageSize(scrollRef);
  useEffect(() => { if (rows.length) refitPageSize(); }, [rows.length, refitPageSize]);
  useEffect(() => { setPage(1); }, [tab, query]);

  const total = rows.length;
  const start = (page - 1) * pageSize;
  const paged = useMemo(() => rows.slice(start, start + pageSize), [rows, start, pageSize]);
  const changePageSize = useCallback((n: number) => { choosePageSize(n); setPage(1); }, [choosePageSize]);

  return (
    <div className="spi-root ord-page whm-page pfm-page">

      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><IcoFlag size={17} /></div>
          <div>
            <div className="spi-head-title">Product Flags Management</div>
            <div className="spi-head-sub">
              Define handling and storage flags — cold chain, hazardous, fragile and more — that
              decide where products are stored and how they move.
            </div>
          </div>
        </div>
        <button type="button" className="spi-head-btn" onClick={() => setFormFor('new')}>
          <IcoPlus /> Add Product Flag
        </button>
      </div>

      <div className={`spi-bref ${briefOpen ? '' : 'is-collapsed'}`}>
        <div className="spi-bref-head" onClick={() => setBriefOpen(o => !o)}>
          <div className="spi-bref-ico"><IcoFlag size={14} /></div>
          <div className="spi-bref-mid">
            <div className="spi-bref-row">
              <div className="spi-bref-label">Product Flags Management</div>
              <div className="spi-bref-sep" />
              <div className="spi-bref-title">What We Are Doing Here</div>
            </div>
            <div className="spi-bref-sub">
              Creating product flags with a category and storage rules, then tagging products so
              putaway and picking follow them.
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

      <div className="spi-card ord-list">
        <div className="spi-segrow">
          <div className="spi-seg" role="tablist" aria-label="Product flag status">
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
              placeholder="Search by product flag or purpose..."
              aria-label="Search product flags"
              autoComplete="off"
            />
            <SearchClear show={query} onClear={() => setQuery('')} />
          </div>
        </div>

        {total === 0 ? (
          <div className="ord-empty">
            {query.trim() ? 'No product flags match your search.' : 'No product flags in this view yet.'}
          </div>
        ) : (
          <div className="ord-table-scroll" ref={scrollRef}>
            <table className="ord-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              {paged.map((f, i) => (
                <tbody key={f.id}>
                  <Row f={f} no={start + i + 1} off={isOff(f)} onToggle={toggle} onEdit={setFormFor} />
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
          <AddProductFlagModal
            flag={formFor === 'new' ? undefined : formFor}
            onClose={() => setFormFor(null)}
          />
        </Suspense>
      )}
    </div>
  );
}

/** One flag. */
function Row({ f, no, off, onToggle, onEdit }: {
  f: ProductFlag;
  no: number;
  off: boolean;
  onToggle: (id: string) => void;
  onEdit: (f: ProductFlag) => void;
}) {
  return (
    <tr className={off ? 'is-off' : undefined}>
      <td><span className="whm-sr">{no}</span></td>

      <td>
        <div className="whm-namecell">
          <span className="whm-namecell__ico"><IcoFlag size={15} /></span>
          <div className="whm-namecell__t"><b>{f.name}</b></div>
        </div>
      </td>

      <td><span className="pfm-purp">{f.purpose}</span></td>

      <td>
        <div className="whm-acts">
          <button type="button" className="whm-act" aria-label={`Edit ${f.id}`}
            title="Edit this product flag" onClick={() => onEdit(f)}>
            <IcoEdit />
          </button>
          <button
            type="button"
            className={`whm-toggle${off ? '' : ' is-on'}`}
            role="switch" aria-checked={!off}
            aria-label={`Toggle status of ${f.id}`}
            title={off ? 'Inactive — click to activate' : 'Active — click to deactivate'}
            onClick={() => onToggle(f.id)}
          >
            <span />
          </button>
        </div>
      </td>
    </tr>
  );
}
