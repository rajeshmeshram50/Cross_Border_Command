import { lazy, Suspense, useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import '../../p2p/p2p-common.css';
import '../../p2p/purchase-management/order/po-list/order.css';
import '../warehouse/warehouse-master.css';
import './product-flag.css';
import SearchClear from '../../../components/ui/SearchClear';
import WorklistPager from '../../../components/ui/WorklistPager';
import { useFitPageSize } from '../../../hooks/useFitPageSize';
import { useToast } from '../../../contexts/ToastContext';
import { useServerList } from '../../../hooks/useServerList';
import { useDebouncedValue } from '../../../hooks/useDebouncedValue';
import { ProductFlagApiError, productFlagApi, type ProductFlag, type ProductFlagTab } from './product-flag-data';

const AddProductFlagModal = lazy(() => import('./AddProductFlagModal'));

const PAGE_SIZE_OPTIONS = [10, 25, 50];

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

type Tab = ProductFlagTab;

const TABS: Array<{ key: Tab; label: string; icon: ReactNode }> = [
  { key: 'all', label: 'All Product Flags', icon: <IcoFlag size={15} /> },
  { key: 'active', label: 'Active Product Flags', icon: <IcoCheckCircle size={15} /> },
  { key: 'inactive', label: 'Inactive Product Flags', icon: <IcoBan size={15} /> },
];

const COLUMNS = ['No.', 'Product Flag', 'Purpose', 'Action'];

export default function ProductFlagMaster() {
  const [tab, setTab] = useState<Tab>('all');
  const [query, setQuery] = useState('');
  const [briefOpen, setBriefOpen] = useState(false);

  const toast = useToast();
  const debouncedQuery = useDebouncedValue(query.trim(), 400);

  const scrollRef = useRef<HTMLDivElement>(null);
  const [pageSize, choosePageSize, refitPageSize] = useFitPageSize(scrollRef);

  const list = useServerList(
    (q) => productFlagApi.list({ tab: (q.tab as Tab) ?? 'all', search: q.search, page: q.page, per_page: q.per_page }),
    { perPage: pageSize, search: debouncedQuery, tab },
    (e) => toast.error('Could not load product flags', e instanceof ProductFlagApiError ? e.message : 'Please refresh the page.'),
  );
  const reload = list.reload;

  const rowCount = list.rows.length;
  useEffect(() => { if (rowCount) refitPageSize(); }, [rowCount, refitPageSize]);

  const [busyId, setBusyId] = useState<number | null>(null);
  const toggle = useCallback(async (f: ProductFlag) => {
    if (busyId) return;
    const activate = f.status !== 'active';
    setBusyId(f.apiId);
    try {
      await productFlagApi.setStatus(f.apiId, activate);
      if (activate) toast.success(`${f.id} marked Active`);
      else toast.warning(`${f.id} marked Inactive`, 'It stays in the list, dimmed, and is no longer offered when packing boxes.');
      reload();
    } catch (e) {
      toast.error('Could not change the status', e instanceof ProductFlagApiError ? e.message : 'Please try again.');
    } finally {
      setBusyId(null);
    }
  }, [busyId, reload, toast]);

  const [formFor, setFormFor] = useState<ProductFlag | 'new' | null>(null);

  const tabs = list.meta?.tabs;
  const counts: Record<Tab, number> = { all: tabs?.all ?? 0, active: tabs?.active ?? 0, inactive: tabs?.inactive ?? 0 };

  const rows = list.rows;
  const total = list.meta?.total ?? 0;
  const page = list.page;
  const start = (page - 1) * pageSize;
  const changePageSize = useCallback((n: number) => choosePageSize(n), [choosePageSize]);
  const loading = list.loading || list.replacing;

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
              placeholder="Search by flag ID, product flag or purpose..."
              aria-label="Search product flags"
              autoComplete="off"
            />
            <SearchClear show={query} onClear={() => setQuery('')} />
          </div>
        </div>

        {loading && rows.length === 0 ? (
          <div className="ord-empty">Loading product flags…</div>
        ) : total === 0 ? (
          <div className="ord-empty">
            {debouncedQuery ? 'No product flags match your search.' : 'No product flags in this view yet.'}
          </div>
        ) : (
          <div className="ord-table-scroll" ref={scrollRef}>
            <table className="ord-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c} scope="col">{c}</th>)}</tr>
              </thead>
              {rows.map((f, i) => (
                <tbody key={f.apiId}>
                  <Row f={f} no={start + i + 1} off={f.status !== 'active'} busy={busyId === f.apiId}
                    onToggle={t => void toggle(t)} onEdit={setFormFor} />
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
          onPage={list.goTo}
          onPageSize={changePageSize}
          pageSizeOptions={PAGE_SIZE_OPTIONS}
        />
      </div>

      {formFor && (
        <Suspense fallback={null}>
          <AddProductFlagModal
            flag={formFor === 'new' ? undefined : formFor}
            onClose={() => setFormFor(null)}
            onSaved={() => reload()}
          />
        </Suspense>
      )}
    </div>
  );
}

function Row({ f, no, off, busy, onToggle, onEdit }: {
  f: ProductFlag;
  no: number;
  off: boolean;
  busy: boolean;
  onToggle: (f: ProductFlag) => void;
  onEdit: (f: ProductFlag) => void;
}) {
  return (
    <tr className={off ? 'is-off' : undefined}>
      <td><span className="whm-sr">{no}</span></td>

      <td>
        <div className="whm-namecell">
          <span className="whm-namecell__ico"><IcoFlag size={15} /></span>
          <div className="whm-namecell__t"><b>{f.name}</b><span>{f.id}</span></div>
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
            disabled={busy}
            onClick={() => onToggle(f)}
          >
            <span />
          </button>
        </div>
      </td>
    </tr>
  );
}
