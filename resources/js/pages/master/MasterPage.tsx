import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardBody, Row, Col, Button, Input, Label, Form, FormFeedback, Modal, ModalBody, Spinner,
} from 'reactstrap';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import { FitTip } from '../p2p/purchase-management/order/create-po/form-fields';
import SearchClear from '../../components/ui/SearchClear';
import MasterPlaceholder from '../MasterPlaceholder';
import DataTable from '../../components/ui/DataTable';
import InlineSublist from '../../components/ui/InlineSublist';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { getMasterConfig, masterEndpoint, normalizeOpts, type FieldDef, type MasterConfig } from './masterConfigs';
import { MasterSelect, MasterDatePicker, MasterFileInput, MasterFormStyles, MasterSavingLock } from './masterFormKit';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import { bustAllMasterBundles } from '../../utils/bustMasterBundles';
import '../../../css/master.css';
import '../p2p/p2p-common.css';
import '../p2p/purchase-management/order/po-list/order.css';
import '../inventory-management/warehouse/warehouse-master.css';
import MasterBackButton from '../../components/ui/MasterBackButton';

const MP_TEAL_TONE = { bg: '#ecfeff', fg: '#0e7490', border: '#22d3ee', star: '#0891b2' };

const MP_KC_TONES = ['teal', 'sky', 'amber', 'rose', 'green', 'violet'] as const;
type MpKpi = { key: string; label: string; icon: string; value: ReactNode; sub?: string; tone?: typeof MP_KC_TONES[number] | "slate" };
function MpKpiCards({ items }: { items: MpKpi[] }) {
  return (
    <div className="mp-kc-row">
      {items.map((k, i) => (
        <div key={k.key} className={`mp-kc mp-kc--${k.tone ?? MP_KC_TONES[i % MP_KC_TONES.length]}`}>
          <span className="mp-kc__glow" />
          <div className="mp-kc__top">
            <span className="mp-kc__ico"><i className={k.icon} /></span>
            <b className="mp-kc__n">{typeof k.value === 'number' ? k.value.toLocaleString() : k.value}</b>
          </div>
          <span className="mp-kc__l">{k.label}</span>
          {k.sub && <small className="mp-kc__s">{k.sub}</small>}
        </div>
      ))}
    </div>
  );
}

function createdDateText(raw: unknown): string {
  if (!raw) return '';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return '';
  const months = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
  const dd = String(d.getDate()).padStart(2, '0');
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const y = d.getFullYear();
  const mon = months[d.getMonth()];
  return [`${dd}-${mon}-${y}`, `${dd} ${mon} ${y}`, `${dd}/${mm}/${y}`, `${dd}-${mm}-${y}`, `${y}-${mm}-${dd}`].join(' | ');
}

type MpStatusTab = 'all' | 'active' | 'inactive';
const mpStatusOf = (row: any): 'active' | 'inactive' =>
  String(row?.status ?? '').trim().toLowerCase() === 'inactive' ? 'inactive' : 'active';
const mpPlural = (w: string) =>
  /[^aeiou]y$/i.test(w) ? w.slice(0, -1) + 'ies'
  : /(s|x|z|ch|sh)$/i.test(w) ? w + 'es'
  : w + 's';
const mpSvg = (d: ReactNode) => (
  <svg width={15} height={15} viewBox="0 0 24 24" fill="none" stroke="currentColor"
    strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{d}</svg>
);
const MP_STATUS_TABS: Array<{ key: MpStatusTab; label: string; icon: ReactNode }> = [
  { key: 'all', label: 'All', icon: mpSvg(<><rect x="4" y="2" width="16" height="20" rx="1.5" /><line x1="4" y1="8" x2="20" y2="8" /><line x1="4" y1="14" x2="20" y2="14" /></>) },
  { key: 'active', label: 'Active', icon: mpSvg(<><circle cx="12" cy="12" r="9" /><polyline points="8.5 12.5 11 15 15.5 9.5" /></>) },
  { key: 'inactive', label: 'Inactive', icon: mpSvg(<><circle cx="12" cy="12" r="9" /><line x1="6" y1="18" x2="18" y2="6" /></>) },
];

export default function MasterPage() {
  const { slug } = useParams<{ slug: string }>();
  const navigate = useNavigate();
  const cfg = slug ? getMasterConfig(slug) : null;

  if (!cfg) return <MasterPlaceholder />;

  return <MasterPageInner key={cfg.slug} cfg={cfg} navigate={navigate} />;
}

function MasterPageInner({
  cfg,
  navigate,
}: {
  cfg: MasterConfig;
  navigate: ReturnType<typeof useNavigate>;
}) {
  const { user, refresh } = useAuth();
  const backTo    = cfg.parent?.path ?? '/master';
  const backLabel = cfg.parent ? 'Back' : 'Back to Master list';
  useEffect(() => {
    refresh();
  }, [cfg.slug]);
  const toast = useToast();
  const [records, setRecords] = useState<any[]>([]);
  const [refData, setRefData] = useState<Record<string, any[]>>({});
  const [apiOpts, setApiOpts] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);

  const isSuperAdmin = user?.user_type === 'super_admin';
  const fullSlug = cfg.perm ?? `master.${cfg.slug}`;
  const modulePerm = user?.permissions?.[fullSlug];
  const permitsAdd = isSuperAdmin || !!modulePerm?.can_add;

  const caps = useMemo(() => ({
    view:   isSuperAdmin || !!modulePerm?.can_view,
    add:    !cfg.lockedFixed && (isSuperAdmin || !!modulePerm?.can_add),
    edit:   isSuperAdmin || !!modulePerm?.can_edit,
    delete: !cfg.noDelete && (isSuperAdmin || !!modulePerm?.can_delete),
    export: isSuperAdmin || !!modulePerm?.can_export,
    import: isSuperAdmin || !!modulePerm?.can_import,
  }), [isSuperAdmin, modulePerm?.can_view, modulePerm?.can_add, modulePerm?.can_edit, modulePerm?.can_delete, modulePerm?.can_export, modulePerm?.can_import, cfg.lockedFixed, cfg.noDelete]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [apiAutogen, setApiAutogen] = useState<Record<string, string>>({});
  const [searchInput, setSearchInput] = useState('');
  const CLIENT_MASTERS = ['designations', 'roles', 'kpis', 'departments'];
  const serverPaged = !CLIENT_MASTERS.includes(cfg.slug);
  const [page, setPage] = useState(0);
  const [perPage, setPerPage] = useState(10);
  const [totalRows, setTotalRows] = useState(0);
  const [serverCounts, setServerCounts] = useState<{ all: number; active: number; inactive: number } | null>(null);
  // KPI cards summarise the whole master, not the page on screen: a paged master loads its full
  // set once for them (reloaded after every save / delete via kpiTick).
  const [kpiRows, setKpiRows] = useState<any[] | null>(null);
  const [kpiTick, setKpiTick] = useState(0);
  const [debouncedSearch, setDebouncedSearch] = useState('');

  useEffect(() => {
    if (!serverPaged) { setDebouncedSearch(searchInput.trim()); return; }
    const t = window.setTimeout(() => { setDebouncedSearch(searchInput.trim()); setPage(0); }, 350);
    return () => window.clearTimeout(t);
  }, [searchInput, serverPaged]);

  useEffect(() => { setPage(0); setTotalRows(0); }, [cfg.slug]);
  const [roleTab, setRoleTab] = useState<'all' | 'primary' | 'ancillary'>('all');
  const [statusTab, setStatusTab] = useState<MpStatusTab>('all');
  const [tabShimmer, setTabShimmer] = useState(false);
  const tabShimTimer = useRef<number | undefined>(undefined);
  const flashTabShimmer = () => {
    setTabShimmer(true);
    window.clearTimeout(tabShimTimer.current);
    tabShimTimer.current = window.setTimeout(() => setTabShimmer(false), 350);
  };
  const switchStatusTab = (k: MpStatusTab) => {
    if (k === statusTab) return;
    setStatusTab(k);
    if (serverPaged) setPage(0);
    flashTabShimmer();
  };
  useEffect(() => () => window.clearTimeout(tabShimTimer.current), []);
  const hasStatus = cfg.slug !== 'roles' && cfg.fields.some(ff => ff.n === 'status');
  const bumpCounts = (row: any, by: 1 | -1) => setServerCounts(c => c && ({
    ...c,
    all: Math.max(0, c.all + by),
    [mpStatusOf(row)]: Math.max(0, c[mpStatusOf(row)] + by),
  }));
  const matchesStatusTab = (row: any) => !hasStatus || statusTab === 'all' || mpStatusOf(row) === statusTab;
  const [kpiRoleFilter, setKpiRoleFilter] = useState<string>('all');
  const [kpiTargetFilter, setKpiTargetFilter] = useState<string>('all');
  const [kpiPriorityFilter, setKpiPriorityFilter] = useState<string>('all');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<any | null>(null);
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeTarget, setTreeTarget] = useState<any | null>(null);

  const [sublistValues, setSublistValues] = useState<Record<string, any[]>>({});
  const [radioValues, setRadioValues] = useState<Record<string, string>>({});

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = (name: string) => {
    setFieldErrors(prev => {
      if (!prev[name]) return prev;
      const n = { ...prev };
      delete n[name];
      return n;
    });
  };
  const ownershipCols = useMemo<{ key: string; label: string }[]>(() => {
    if (!user?.user_type) return [];
    return [{ key: '__creator', label: 'Created By' }];
  }, [user?.user_type]);

  const refSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const f of cfg.fields) if (f.ref) set.add(f.ref);
    return [...set];
  }, [cfg]);

  const sectionedFields = useMemo(() => {
    const groups: { sec: string | null; fields: FieldDef[] }[] = [];
    let current: { sec: string | null; fields: FieldDef[] } = { sec: null, fields: [] };
    groups.push(current);
    for (const f of cfg.fields) {
      if (f.sec) {
        current = { sec: f.sec, fields: [] };
        groups.push(current);
      } else {
        current.fields.push(f);
      }
    }
    if (groups[0].sec == null && groups[0].fields.length === 0) groups.shift();
    return groups;
  }, [cfg]);

  const nonSecFieldCount = useMemo(
    () => cfg.fields.filter(f => !f.sec).length,
    [cfg]
  );
  const modalSize: 'lg' | 'xl' | undefined =
    nonSecFieldCount <= 4 ? undefined : nonSecFieldCount <= 9 ? 'lg' : 'xl';
  const defaultFieldSpan: number =
    modalSize === undefined ? 12 : modalSize === 'lg' ? 6 : 4;

  const labelFieldForRef = (refSlug: string, fallback?: string): string => {
    const f = cfg.fields.find(ff => ff.ref === refSlug);
    if (f?.refL) return f.refL;
    if (fallback) return fallback;
    return 'name';
  };

  const resolveRefLabel = (refSlug: string, refLabel: string | undefined, value: any): string => {
    if (value == null || value === '') return '';
    const rows = refSlug === cfg.slug ? records : (refData[refSlug] || []);
    const row = rows.find(r => String(r.id) === String(value));
    if (!row) return String(value ?? '');
    const lf = refLabel || labelFieldForRef(refSlug);
    return String(row[lf] ?? value);
  };

  const fetchRefs = useCallback(async () => {
    if (refSlugs.length === 0) return;
    const pairs = await Promise.all(refSlugs.map(s => {
      const refCfg = getMasterConfig(s);
      const url = refCfg ? masterEndpoint(refCfg) : `/master/${s}`;
      return api.get(url)
        .then(r => [s, Array.isArray(r.data) ? r.data : []] as const)
        .catch(() => [s, [] as any[]] as const);
    }));
    const next: Record<string, any[]> = {};
    for (const [k, v] of pairs) next[k] = v;
    setRefData(next);
  }, [refSlugs.join('|')]);

  // Fields that source their select options from an API endpoint (e.g. live employees).
  const optsApiFields = useMemo(() => cfg.fields.filter(f => f.optsApi), [cfg]);

  const fetchApiOpts = useCallback(async () => {
    if (optsApiFields.length === 0) return;
    const pairs = await Promise.all(optsApiFields.map(f =>
      api.get(f.optsApi!)
        .then(r => {
          const raw = Array.isArray(r.data) ? r.data : (Array.isArray(r.data?.data) ? r.data.data : []);
          const opts = f.optsApiBuild ? f.optsApiBuild(raw) : raw;
          return [f.n, opts] as const;
        })
        .catch(() => [f.n, [] as any[]] as const)));
    const next: Record<string, any[]> = {};
    for (const [k, v] of pairs) next[k] = v;
    setApiOpts(next);
  }, [optsApiFields.map(f => f.n).join('|')]);

  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setEditingId(null);
    setViewOnly(false);
    setModalOpen(false);
    setRecords([]);
    setApiAutogen({});

    const loadRecords = serverPaged
      ? api.get(masterEndpoint(cfg), {
          params: { per_page: perPage, page: page + 1, status_tab: hasStatus && statusTab !== 'all' ? statusTab : undefined, q: debouncedSearch || undefined, tz: debouncedSearch ? Intl.DateTimeFormat().resolvedOptions().timeZone : undefined },
        }).then(r => {
          if (aborted) return;
          const body: any = r.data ?? {};
          setRecords(Array.isArray(body) ? body : (Array.isArray(body.data) ? body.data : []));
          setTotalRows(Number(body.total ?? (Array.isArray(body) ? body.length : 0)) || 0);
          setServerCounts(body.status_counts ?? null);
        }).catch(() => { if (!aborted) { setRecords([]); setTotalRows(0); } })
      : api.get(masterEndpoint(cfg)).then(r => {
          if (!aborted) setRecords(Array.isArray(r.data) ? r.data : []);
        }).catch(() => { if (!aborted) setRecords([]); });

    const loadRefs = fetchRefs();
    const loadApiOpts = fetchApiOpts();

    Promise.all([loadRecords, loadRefs, loadApiOpts]).finally(() => { if (!aborted) setLoading(false); });

    return () => { aborted = true; };
  }, [cfg.slug, refSlugs.join('|'), serverPaged, page, perPage, debouncedSearch, serverPaged ? statusTab : '']);

  useEffect(() => {
    setKpiRows(null);
    if (!serverPaged || !cfg.kpis?.length) return;
    let aborted = false;
    api.get(masterEndpoint(cfg))
      .then(r => { if (!aborted) setKpiRows(Array.isArray(r.data) ? r.data : []); })
      .catch(() => { /* fall back to the page's rows */ });
    return () => { aborted = true; };
  }, [cfg.slug, serverPaged, kpiTick]);

  const editing = editingId != null ? records.find(r => r.id === editingId) : null;
  const statusOnlyEdit = !!cfg.inUseStatusOnly && !!editing?.in_use;

  const tenantScopedRecords = useMemo(() => {
    if (!user) return [];
    const eq = (a: any, b: any) => String(a ?? '') === String(b ?? '');
    if (user.user_type === 'super_admin') {
      return records.filter(r => r.client_id == null && r.branch_id == null);
    }
    if (user.user_type === 'client_admin') {
      return records.filter(r => eq(r.client_id, user.client_id) && r.branch_id == null);
    }
    if (user.user_type === 'branch_user') {
      return records.filter(r => eq(r.client_id, user.client_id) && eq(r.branch_id, user.branch_id));
    }
    return records;
  }, [records, user]);

  const searchMatched = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    const isRole = cfg.slug === 'roles';
    const searchableKeys = [
      ...cfg.cols,
      'client_name', 'branch_name', 'creator_name',
    ];
    return records.filter(row => {
      if (isRole) {
        const rt = String(row.role_type ?? '').toLowerCase();
        if (roleTab === 'primary' && !/primary/.test(rt)) return false;
        if (roleTab === 'ancillary' && !/ancillary|auxiliary|operational|administrative|functional/.test(rt)) return false;
      }
      if (cfg.slug === 'kpis') {
        if (kpiRoleFilter !== 'all') {
          if (String(row.role_id ?? '') !== String(kpiRoleFilter)) return false;
        }
        if (kpiTargetFilter !== 'all') {
          if (String(row.target_type ?? '') !== kpiTargetFilter) return false;
        }
        if (kpiPriorityFilter !== 'all') {
          if (String(row.priority ?? '') !== kpiPriorityFilter) return false;
        }
      }
      if (!q) return true;
      if (createdDateText(row.created_at).includes(q)) return true;
      for (const key of searchableKeys) {
        const f = cfg.fields.find(ff => ff.n === key);
        const val = f?.ref ? resolveRefLabel(f.ref, f.refL, row[key]) : row[key];
        if (val != null && String(val).toLowerCase().includes(q)) return true;
      }
      return false;
    });
  }, [records, searchInput, cfg, refData, roleTab, kpiRoleFilter, kpiTargetFilter, kpiPriorityFilter]);

  const filteredRecords = useMemo(() => searchMatched.filter(matchesStatusTab), [searchMatched, statusTab, hasStatus]);

  const roleTabs = useMemo(() => {
    const isAncillary = (rt: string) => /ancillary|auxiliary|operational|administrative|functional/i.test(rt);
    return [
      { key: 'all',       label: 'All Roles',       icon: 'ri-shield-line', count: records.length },
      { key: 'primary',   label: 'Primary Roles',   icon: 'ri-star-fill',   count: records.filter(r => /primary/i.test(String(r.role_type ?? ''))).length },
      { key: 'ancillary', label: 'Ancillary Roles', icon: 'ri-time-line',   count: records.filter(r => isAncillary(String(r.role_type ?? ''))).length },
    ];
  }, [records]);


  const seedRadioValues = (row?: any) => {
    const next: Record<string, string> = {};
    const conditionalSources = new Set(
      cfg.fields.flatMap(f => f.showWhen ? [f.showWhen.field] : []),
    );
    for (const f of cfg.fields) {
      if (f.t !== 'radio' && !conditionalSources.has(f.n)) continue;
      const v = row?.[f.n];
      if (v != null && v !== '') {
        next[f.n] = String(v);
      } else {
        const first = normalizeOpts(f.opts)[0]?.value;
        if (first != null && (f.t === 'radio' || f.t === 'select')) next[f.n] = String(first);
      }
    }
    setRadioValues(next);
  };

  const openAdd = () => {
    setFieldErrors({});
    setEditingId(null);
    setViewOnly(false);
    setSublistValues({});
    setApiAutogen({});
    seedRadioValues(null);
    setModalOpen(true);
    fetchRefs();
    const apiFields = cfg.fields.filter(f => (f as any).autogenApi);
    if (apiFields.length > 0) {
      api.get(`${masterEndpoint(cfg)}/next-code`)
        .then(r => {
          const code = r?.data?.code;
          if (!code) return;
          const next: Record<string, string> = {};
          for (const f of apiFields) next[f.n] = String(code);
          setApiAutogen(next);
        })
        .catch(() => {});
    }
  };
  const openEdit = (row: any, readonly = false) => {
    setFieldErrors({});
    setEditingId(row.id);
    setViewOnly(readonly);
    const init: Record<string, any[]> = {};
    for (const f of cfg.fields) {
      if (f.t === 'sublist' && f.n) {
        const v = row?.[f.n];
        init[f.n] = Array.isArray(v) ? v : [];
      }
    }
    setSublistValues(init);
    seedRadioValues(row);
    setModalOpen(true);
    fetchRefs();
  };

  useEffect(() => {
    if (!modalOpen) return;
    const deriveFields = cfg.fields.filter((f: any) => f.autoDeriveFrom);
    if (deriveFields.length === 0) return;

    const findForm = (): HTMLFormElement | null => {
      const selectors = [
        '.master-modal form',
        '.master-form-modal form',
        'form.master-form',
        '.modal.show form',
        '.modal[role="dialog"] form',
      ];
      for (const sel of selectors) {
        const el = document.querySelector(sel) as HTMLFormElement | null;
        if (el) return el;
      }
      return null;
    };

    let attemptHandle = 0;
    const attach = () => {
      const form = findForm();
      if (!form) {
        if (attemptHandle < 12) {
          attemptHandle++;
          window.setTimeout(attach, 50);
        }
        return;
      }

      const cleanups: Array<() => void> = [];
      deriveFields.forEach((field: any) => {
        const source = form.querySelector(`[name="${field.autoDeriveFrom}"]`) as HTMLInputElement | null;
        const target = form.querySelector(`[name="${field.n}"]`) as HTMLInputElement | null;
        if (!source || !target) return;

        let userEdited = !!target.value && editing != null;
        let programmatic = false;
        const onTargetInput = () => {
          if (programmatic) return;
          userEdited = target.value !== '';
        };
        target.addEventListener('input', onTargetInput);

        const onSourceInput = () => {
          if (userEdited) return;
          const next = deriveValue(cfg.slug, field.n, source.value);
          const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')?.set;
          programmatic = true;
          try {
            setter ? setter.call(target, next) : (target.value = next);
            target.dispatchEvent(new Event('input', { bubbles: true }));
          } finally {
            programmatic = false;
          }
        };
        source.addEventListener('input', onSourceInput);

        cleanups.push(() => {
          source.removeEventListener('input', onSourceInput);
          target.removeEventListener('input', onTargetInput);
        });
      });

      (window as any).__autoDeriveCleanups = cleanups;
    };
    const timer = window.setTimeout(attach, 60);

    return () => {
      window.clearTimeout(timer);
      const cleanups: Array<() => void> = (window as any).__autoDeriveCleanups || [];
      cleanups.forEach(fn => fn());
      (window as any).__autoDeriveCleanups = [];
    };
  }, [modalOpen, cfg.slug, editing?.id]);

  const ActionBtn = ({
    title, icon, onClick, disabled,
  }: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) => (
    <Tooltip label={title}>
    <button
      type="button"
      aria-label={title}
      disabled={disabled}
      className={`whm-act mp-act${icon === 'ri-pencil-line' ? ' mp-act--edit' : ''}`}
      onClick={onClick}
    >
      {icon === 'ri-pencil-line'
        ? <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4 12.5-12.5z" /></svg>
        : <i className={icon} />}

    </button>
    </Tooltip>
  );

  const validateForm = (fd: FormData): Record<string, string> => {
    const errs: Record<string, string> = {};
    const isHiddenByShowWhen = (f: FieldDef): boolean => {
      if (!f.showWhen) return false;
      const live = radioValues[f.showWhen.field];
      const fromRow = editing?.[f.showWhen.field];
      const cur = String((live ?? fromRow) ?? '');
      const need = Array.isArray(f.showWhen.equals)
        ? f.showWhen.equals.map(String)
        : [String(f.showWhen.equals)];
      return !need.includes(cur);
    };
    for (const f of cfg.fields) {
      if (f.sec || !f.n) continue;
      if (f.auto) continue;
      if (statusOnlyEdit && f.n !== 'status') continue;
      if (f.t === 'sublist') {
        if (f.r && (!sublistValues[f.n] || sublistValues[f.n].length === 0)) {
          errs[f.n] = `Please add at least one ${f.subSingular || f.l}.`;
        }
        continue;
      }
      if (isHiddenByShowWhen(f)) continue;
      if (f.t === 'file') {
        const v = fd.get(f.n);
        const file = v instanceof File ? v : null;
        const hasFile = !!file && file.size > 0;
        const isEdit = editingId != null;
        if (f.r && !hasFile && !isEdit) {
          errs[f.n] = `${f.l} is required`;
        } else if (hasFile && f.maxMb && file!.size > f.maxMb * 1024 * 1024) {
          errs[f.n] = `${f.l} must be under ${f.maxMb}MB`;
        }
        continue;
      }
      const raw = String(fd.get(f.n) ?? '').trim();
      if (f.r && !raw) {
        errs[f.n] = `${f.l} is required`;
        continue;
      }
      if (!raw) continue;

      if (f.t === 'text' || (f.t === 'textarea' && typeof (f as any).maxLen === 'number')) {
        const cap = typeof (f as any).maxLen === 'number' ? (f as any).maxLen : 50;
        if (raw.length > cap) {
          errs[f.n] = `${f.l} must be ${cap} characters or fewer`;
          continue;
        }
      }

      if (f.t === 'text' || f.t === 'textarea') {
        if (/[<>]/.test(raw)) {
          errs[f.n] = `${f.l} cannot contain HTML characters (< or >)`;
          continue;
        }
        if (/(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/i.test(raw)) {
          errs[f.n] = `${f.l} contains disallowed patterns (possible SQL/JS injection)`;
          continue;
        }
        if (f.n !== 'symbol' && f.r && !/[A-Za-z0-9]/.test(raw)) {
          errs[f.n] = `${f.l} must contain meaningful text (letters or numbers, not only symbols)`;
          continue;
        }

        const NAME_FIELD_NAMES = new Set([
          'name', 'title', 'role_name', 'behaviour_name', 'category_name',
          'short_code', 'code', 'license_code', 'cat_code', 'iso_code', 'state_code',
        ]);
        if (NAME_FIELD_NAMES.has(f.n)) {
          if (!/^[A-Za-z0-9\s\-.,()&/'%]+$/.test(raw)) {
            errs[f.n] = `${f.l} may only contain letters, numbers, spaces, and . , - ( ) & / ' %`;
            continue;
          }
        }
        if (f.pattern && !new RegExp(f.pattern).test(raw)) {
          errs[f.n] = f.patternMessage || `${f.l} is invalid`;
          continue;
        }
      }
      if (f.t === 'date' && f.futureOnly) {
        const todayIso = new Date().toISOString().slice(0, 10);
        if (raw < todayIso) {
          errs[f.n] = `${f.l} must be a future date`;
          continue;
        }
      }
      if (f.t === 'date' && (f as any).afterField) {
        const other = String(fd.get((f as any).afterField) ?? '').trim();
        const otherLabel = cfg.fields.find(x => x.n === (f as any).afterField)?.l || 'the start date';
        if (raw && other && raw <= other) {
          errs[f.n] = `${f.l} must be after ${otherLabel}.`;
          continue;
        }
      }
      if (f.t === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        errs[f.n] = 'Please enter a valid email address';
      } else if (f.t === 'number' && isNaN(Number(raw))) {
        errs[f.n] = 'Must be a valid number';
      } else if (f.t === 'number') {
        const num = Number(raw);
        const minOverride = typeof (f as any).min === 'number' ? (f as any).min : 0;
        const maxOverride = typeof (f as any).max === 'number' ? (f as any).max : 999999999;
        if (num < minOverride) {
          errs[f.n] = `${f.l} must be at least ${minOverride}`;
        } else if (num > maxOverride) {
          errs[f.n] = `${f.l} must be at most ${maxOverride}`;
        }
      } else if (f.n === 'gstin' && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(raw.toUpperCase())) {
        errs[f.n] = 'Invalid GSTIN — must be 15 characters (e.g. 27AADCI6120M1ZH)';
      } else if (f.n === 'pan' && !/^[A-Z]{5}[0-9]{4}[A-Z]{1}$/.test(raw.toUpperCase())) {
        errs[f.n] = 'Invalid PAN — must be 10 characters (e.g. AADCI6120M)';
      } else if (f.n === 'cin' && raw.length !== 21) {
        errs[f.n] = 'Invalid CIN — must be 21 characters';
      } else if (f.n === 'ifsc_code' && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(raw.toUpperCase())) {
        errs[f.n] = 'Invalid IFSC — must be 11 characters (e.g. HDFC0000350)';
      } else if (f.n === 'hsn_code' && !/^[0-9]{4,8}$/.test(raw)) {
        errs[f.n] = 'Invalid HSN / SAC — 4 to 8 digit numeric code';
      } else if (cfg.slug === 'hsn_codes' && f.n === 'description') {
        if (!/^[A-Za-z0-9\s\-—–.,()&/'%]+$/.test(raw)) {
          errs[f.n] = "Description may only contain letters, numbers, spaces, and . , - ( ) & / ' %";
        } else if (raw.length > 150) {
          errs[f.n] = 'Description must be 150 characters or fewer';
        }
      }
    }

    if (!statusOnlyEdit && cfg.uFields && cfg.uFields.length > 0 && records.length > 0) {
      const labelOf = (u: string) => cfg.fields.find(ff => ff.n === u)?.l || u;
      if (cfg.uFields.length > 1) {
        const vals = cfg.uFields.map(u => String(fd.get(u) ?? '').trim());

        if (vals[0] !== '') {
          const dup = records.find(r => {
            if (editingId != null && r.id === editingId) return false;
            return cfg.uFields!.every((u, i) => String(r[u] ?? '').trim().toLowerCase() === vals[i].toLowerCase());
          });
          if (dup) {
            const first = cfg.uFields[0];

            const ctx = cfg.uFields.slice(1).map((u, i) => {
              const f = cfg.fields.find(ff => ff.n === u);
              const raw = vals[i + 1];
              const shown = raw
                ? (f?.ref ? resolveRefLabel(f.ref, f.refL, raw) : (normalizeOpts(f?.opts).find(o => o.value === raw)?.label ?? raw))
                : '—';
              return `${labelOf(u)}: ${shown}`;
            });
            errs[first] = ctx.length
              ? `${labelOf(first)} "${vals[0]}" already exists (${ctx.join(', ')}) — change one of them.`
              : `${labelOf(first)} "${vals[0]}" already exists — change one of them.`;
          }
        }
      } else {
        const uName = cfg.uFields[0];
        const dupRaw = String(fd.get(uName) ?? '').trim();
        if (dupRaw && !errs[uName]) {

          const dup = records.find(r => {
            if (editingId != null && r.id === editingId) return false;
            return String(r[uName] ?? '').trim().toLowerCase() === dupRaw.toLowerCase();
          });
          if (dup) {
            const ctx = (cfg.uContext ?? [])
              .filter(c => c !== uName)
              .map(c => {
                const f = cfg.fields.find(ff => ff.n === c);
                const val = f?.ref ? resolveRefLabel(f.ref, f.refL, dup[c]) : dup[c];
                const text = String(val ?? '').trim();
                return text ? `${labelOf(c)}: ${text}` : '';
              })
              .filter(Boolean);
            errs[uName] = ctx.length
              ? `${labelOf(uName)} "${dupRaw}" already exists (${ctx.join(', ')}) — pick a different value`
              : `${labelOf(uName)} "${dupRaw}" already exists — pick a different value`;
          }
        }
      }
    }

    return errs;
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (savingRef.current) return;
    const fd = new FormData(e.currentTarget);

    const errs = validateForm(fd);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      const count = Object.keys(errs).length;
      toast.error('Validation Error', `${count} field${count === 1 ? '' : 's'} need attention`);
      return;
    }
    setFieldErrors({});

    const SKIP_CAPITALIZE = new Set([
      'code', 'iso_code', 'state_code', 'short_code', 'hsn_code',
      'gstin', 'pan', 'tan', 'cin', 'iec',
      'ifsc_code', 'swift_code', 'ad_code',
      'email', 'website', 'url', 'domain', 'phone', 'mobile', 'whatsapp',
      'pincode', 'postal_code', 'zip',
    ]);
    const capitalizeFirst = (s: string): string => {
      if (!s) return s;
      const idx = s.search(/[a-zA-Z]/);
      if (idx === -1) return s;
      return s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
    };

    const isHiddenByShowWhenForPayload = (f: FieldDef): boolean => {
      if (!f.showWhen) return false;
      const live = radioValues[f.showWhen.field];
      const fromRow = editing?.[f.showWhen.field];
      const cur = String((live ?? fromRow) ?? '');
      const need = Array.isArray(f.showWhen.equals)
        ? f.showWhen.equals.map(String)
        : [String(f.showWhen.equals)];
      return !need.includes(cur);
    };
    const payload: Record<string, any> = {};
    for (const f of cfg.fields) {
      if (f.sec || !f.n) continue;
      if (f.t === 'file') continue;
      if (f.auto) continue;
      if (f.t === 'sublist') {
        payload[f.n] = sublistValues[f.n] || [];
        continue;
      }
      if (isHiddenByShowWhenForPayload(f)) {
        payload[f.n] = null;
        continue;
      }
      const raw = fd.get(f.n);
      if (f.t === 'number') {
        if (raw == null || raw === '') {
          payload[f.n] = null;
        } else {

          let num = Number(raw);
          const minOverride = typeof (f as any).min === 'number' ? (f as any).min : 0;
          const maxOverride = typeof (f as any).max === 'number' ? (f as any).max : 999999999;
          if (Number.isFinite(num)) {
            if (num < minOverride) num = minOverride;
            else if (num > maxOverride) num = maxOverride;
          } else {
            num = minOverride;
          }
          payload[f.n] = num;
        }
      } else {
        let s = String(raw ?? '').trim();
        if (s !== '' && (f.t === 'text' || f.t === 'textarea') && !SKIP_CAPITALIZE.has(f.n)) {
          s = capitalizeFirst(s);
        }
        payload[f.n] = s === '' ? null : s;
      }
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const base = masterEndpoint(cfg);

      const filesToUpload: { name: string; file: File }[] = [];
      for (const f of cfg.fields) {
        if (f.t !== 'file' || !f.n) continue;
        const v = fd.get(f.n);
        if (v instanceof File && v.size > 0) {
          filesToUpload.push({ name: f.n, file: v });
        }
      }

      let body: any = statusOnlyEdit ? { status: payload.status } : payload;
      let headers: any = undefined;
      if (filesToUpload.length > 0) {
        const out = new FormData();
        for (const k of Object.keys(payload)) {
          const v = (payload as Record<string, any>)[k];
          if (v === null || v === undefined) {
            out.append(k, '');
          } else if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof File))) {
            out.append(k, JSON.stringify(v));
          } else {
            out.append(k, String(v));
          }
        }
        for (const { name, file } of filesToUpload)     {
          out.append(name, file);
        }
        if (editingId != null) out.append('_method', 'PUT');
        body = out;
        headers = { 'Content-Type': 'multipart/form-data' };
      }

      if (editingId != null) {
        const url = `${base}/${editingId}`;
        const { data } = filesToUpload.length > 0
          ? await api.post(url, body, { headers })
          : await api.put(url, body);
        if (editing && mpStatusOf(editing) !== mpStatusOf(data)) { bumpCounts(editing, -1); bumpCounts(data, 1); }
        setRecords(prev => (matchesStatusTab(data) ? prev.map(r => r.id === editingId ? data : r) : prev.filter(r => r.id !== editingId)));
        if (serverPaged && !matchesStatusTab(data)) setTotalRows(t => Math.max(0, t - 1));
        toast.success('Updated', `${cfg.titleSingular || cfg.title} updated successfully`);
      } else {
        const { data } = await api.post(base, body, headers ? { headers } : undefined);
        if (matchesStatusTab(data)) {
          setRecords(prev => [data, ...prev]);
          setTotalRows(t => t + 1);
        }
        bumpCounts(data, 1);
        toast.success('Created', `${cfg.titleSingular || cfg.title} created successfully`);
      }
      bustAllMasterBundles();
      setKpiTick(t => t + 1);
      setModalOpen(false);
    } catch (err: any) {
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const serverErrors = err.response.data.errors as Record<string, string | string[]>;
        const mapped: Record<string, string> = {};
        for (const k of Object.keys(serverErrors)) {
          const v = serverErrors[k];
          mapped[k] = Array.isArray(v) ? String(v[0]) : String(v);
        }
        setFieldErrors(mapped);
        toast.error('Validation Error', 'Please fix the highlighted fields');
      } else {
        const msg = err?.response?.data?.message || 'Failed to save record.';
        toast.error('Error', msg);
      }
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const deleteLabel = (row: any): string => {
    const firstCol = cfg.cols[0];
    return row?.[firstCol] || `Record #${row?.id}`;
  };

  const handleDeleteClick = (row: any) => {
    setDeleteTarget(row);
    setDeleteOpen(true);
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    const label = deleteLabel(deleteTarget);
    if (deleteTarget.id == null) {
      toast.error('Cannot delete', 'This record is missing an identifier. Refresh the page and try again.');
      setDeleteOpen(false);
      setDeleteTarget(null);
      return;
    }
    setDeleting(true);
    try {
      await api.delete(`${masterEndpoint(cfg)}/${deleteTarget.id}`);
      setRecords(prev => prev.filter(r => r.id !== deleteTarget.id));
      setTotalRows(t => Math.max(0, t - 1));
      bumpCounts(deleteTarget, -1);
      bustAllMasterBundles();
      setKpiTick(t => t + 1);
      toast.success('Deleted', `"${label}" removed successfully`);
      setDeleteOpen(false);
      setDeleteTarget(null);
    } catch (err: any) {
      const msg = err?.response?.data?.message || 'Failed to delete.';
      toast.error('Error', msg);
    } finally {
      setDeleting(false);
    }
  };

  const formatCell = (fieldName: string, row: any): React.ReactNode => {
    const f = cfg.fields.find(ff => ff.n === fieldName);
    const raw = row[fieldName];

    if (f?.t === 'date') {
      if (raw == null || raw === '') return <span className="text-muted">—</span>;
      const d = new Date(String(raw));
      if (isNaN(d.getTime())) return <span>{String(raw)}</span>;
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dd = String(d.getDate()).padStart(2, '0');
      return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{`${dd}-${months[d.getMonth()]}-${d.getFullYear()}`}</span>;
    }

    if (fieldName === 'status') {
      const active = raw === true || raw === 1
        || ['active', '1', 'true', 'yes', 'enabled'].includes(String(raw).toLowerCase());
      const titleCase = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
      const inactive = raw === false || raw === 0
        || ['0', 'false'].includes(String(raw).toLowerCase());
      const tone = active
        ? { bg: '#ecfeff', fg: '#0e7490', dot: '#06b6d4', text: 'Active' }
        : { bg: '#f3f9fb', fg: '#7aa6b4', dot: '#9fc9d4', text: inactive || !raw ? 'Inactive' : titleCase(String(raw)) };
      void tone.dot;
      return (
        <span
          className={`mp-status-pill mp-status-${active ? 'active' : 'inactive'}`}
          style={{
            display: 'inline-block',
            padding: '3px 12px',
            borderRadius: 999,
            background: tone.bg,
            color: tone.fg,
            border: '1px solid #cdeef4',
            fontSize: 11.5,
            fontWeight: 700,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
          }}
        >
          {tone.text}
        </span>
      );
    }

    if (fieldName === 'reports_to_id' && f?.ref === 'designations') {
      const label = resolveRefLabel(f.ref, f.refL, raw);
      if (!label) return <span className="text-muted">—</span>;
      return (
        <span className="d-flex align-items-center gap-1" style={{ minWidth: 0 }}>
          <span style={{ flexShrink: 0, width: 6, height: 6, borderRadius: '50%', background: '#6691e7', display: 'inline-block' }} />
          <FitTip label={label}><span className="text-body mp-fit" style={{ minWidth: 0 }}>{label}</span></FitTip>
        </span>
      );
    }

    if (f?.ref) {
      const refTxt = resolveRefLabel(f.ref, f.refL, raw) || '—';
      return <FitTip label={refTxt}><span className="text-body mp-fit">{refTxt}</span></FitTip>;
    }

    if (raw === undefined || raw === null || raw === '') {
      return <span className="text-muted">—</span>;
    }

    if (fieldName === 'code') {
      const codeTxt = String(raw).toUpperCase();
      const CODE_MAX = 14;
      const display = codeTxt.length > CODE_MAX ? `${codeTxt.slice(0, CODE_MAX - 1)}…` : codeTxt;
      const chip = (
        <span
          className="rounded-pill d-inline-block mp-code-chip"
          style={{
            background: '#e4f9fa',
            color: '#0e7490',
            border: '1px solid #bfecef',
            padding: '2px 10px',
            fontSize: '10.5px',
            fontWeight: 600,
            lineHeight: 1.3,
            letterSpacing: '0.02em',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            boxShadow: 'none',
          }}
        >
          {display}
        </span>
      );
      if (codeTxt.length > CODE_MAX) {
        return <Tooltip label={codeTxt} maxWidth={320}>{chip}</Tooltip>;
      }
      return chip;
    }

    if (fieldName === 'target_type') {
      const v = String(raw);
      const toneByValue =
        /numeric|number/i.test(v)    ? { bg: '#dbeafe', fg: '#1d4ed8', border: '#3b82f6' } :
        /percent/i.test(v)           ? { bg: '#dcfce7', fg: '#15803d', border: '#22c55e' } :
        /currency/i.test(v)          ? { bg: '#ccfbf1', fg: '#0d9488', border: '#14b8a6' } :
        /boolean|done/i.test(v)      ? { bg: '#ede9fe', fg: '#6d28d9', border: '#8b5cf6' } :
        /date/i.test(v)              ? { bg: '#ffedd5', fg: '#c2410c', border: '#f97316' } :
        /rating/i.test(v)            ? { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b' } :
                                       { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8' };
      const tone = { ...toneByValue, ...MP_TEAL_TONE };
      return (
        <span
          className="d-inline-block rounded-pill mp-badge"
          style={{
            background: `linear-gradient(180deg, color-mix(in srgb, ${tone.bg} 55%, #ffffff) 0%, ${tone.bg} 100%)`,
            color: tone.fg,
            border: `1px solid ${tone.border}80`,
            padding: '2px 10px',
            fontSize: '10.5px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -1px 0 ${tone.border}24, 0 1px 3px ${tone.border}26`,
          }}
        >
          {v}
        </span>
      );
    }

    if (fieldName === 'priority') {
      const v = String(raw);
      const toneByValue =
        /critical/i.test(v) ? { bg: '#fee2e2', fg: '#b91c1c', border: '#ef4444' } :
        /high/i.test(v)     ? { bg: '#ffedd5', fg: '#c2410c', border: '#f97316' } :
        /medium/i.test(v)   ? { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b' } :
        /low/i.test(v)      ? { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8' } :
                              { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8' };
      const tone = { ...toneByValue, ...MP_TEAL_TONE };
      return (
        <span
          className="d-inline-block rounded-pill mp-badge"
          style={{
            background: `linear-gradient(180deg, color-mix(in srgb, ${tone.bg} 55%, #ffffff) 0%, ${tone.bg} 100%)`,
            color: tone.fg,
            border: `1px solid ${tone.border}80`,
            padding: '2px 10px',
            fontSize: '10.5px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -1px 0 ${tone.border}24, 0 1px 3px ${tone.border}26`,
          }}
        >
          {v}
        </span>
      );
    }

    if (fieldName === 'role_type') {
      const v = String(raw);
      const toneByValue =
        /primary/i.test(v)              ? { bg: '#ede9fe', fg: '#6d28d9', border: '#8b5cf6', icon: 'ri-star-fill' } :
        /ancillary|auxiliary/i.test(v)  ? { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b', icon: 'ri-time-fill' } :
        /operational/i.test(v)          ? { bg: '#ccfbf1', fg: '#0d9488', border: '#14b8a6', icon: 'ri-settings-3-fill' } :
        /administrative/i.test(v)       ? { bg: '#dbeafe', fg: '#1d4ed8', border: '#3b82f6', icon: 'ri-briefcase-fill' } :
        /functional/i.test(v)           ? { bg: '#dcfce7', fg: '#15803d', border: '#22c55e', icon: 'ri-shield-check-fill' } :
                                          { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8', icon: 'ri-circle-fill' };
      const tone = { ...toneByValue, ...MP_TEAL_TONE };
      return (
        <span
          className="d-inline-flex align-items-center rounded-pill mp-badge"
          style={{
            gap: 5,
            background: `linear-gradient(180deg, color-mix(in srgb, ${tone.bg} 55%, #ffffff) 0%, ${tone.bg} 100%)`,
            color: tone.fg,
            border: `1px solid ${tone.border}80`,
            padding: '2px 10px',
            fontSize: '10.5px',
            fontWeight: 600,
            whiteSpace: 'nowrap',
            lineHeight: 1.3,
            boxShadow: `inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -1px 0 ${tone.border}24, 0 1px 3px ${tone.border}26`,
          }}
        >
          <i className={tone.icon} style={{ fontSize: 10 }} />
          {v}
        </span>
      );
    }

    if (fieldName === 'level') {
      const v = String(raw);
      const TOTAL_STARS = 5;
      const toneByValue =
        /director|ceo/i.test(v)        ? { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b', star: '#f59e0b', icon: 'ri-vip-crown-fill',  rank: 5, short: 'Director / CEO' } :
        /head|hod/i.test(v)            ? { bg: '#ede9fe', fg: '#6d28d9', border: '#8b5cf6', star: '#8b5cf6', icon: 'ri-medal-2-fill',    rank: 4, short: 'Head of Department' } :
        /lead|team/i.test(v)           ? { bg: '#dbeafe', fg: '#1d4ed8', border: '#3b82f6', star: '#3b82f6', icon: 'ri-team-fill',       rank: 3, short: 'Team Leader' } :
        /executive|senior/i.test(v)    ? { bg: '#ccfbf1', fg: '#0d9488', border: '#14b8a6', star: '#14b8a6', icon: 'ri-user-star-fill',  rank: 2, short: 'Executive' } :
        /employee|mid|junior/i.test(v) ? { bg: '#dcfce7', fg: '#15803d', border: '#22c55e', star: '#22c55e', icon: 'ri-user-3-fill',     rank: 1, short: 'Employee' } :
        /intern|trainee/i.test(v)      ? { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8', star: '#94a3b8', icon: 'ri-book-open-fill',  rank: 1, short: 'Intern / Trainee' } :
                                         { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8', star: '#94a3b8', icon: 'ri-circle-line',     rank: 0, short: v };
      const tone = { ...toneByValue, ...MP_TEAL_TONE };
      return (
        <div
          className="text-center w-100 d-flex flex-column align-items-center justify-content-center"
          style={{ gap: 4 }}
          title={`${tone.rank} of ${TOTAL_STARS} hierarchy rank`}
        >
          <span
            className="d-inline-block rounded-pill mp-badge"
            style={{
              background: `linear-gradient(180deg, color-mix(in srgb, ${tone.bg} 55%, #ffffff) 0%, ${tone.bg} 100%)`,
              color: tone.fg,
              border: `1px solid ${tone.border}80`,
              padding: '2px 10px',
              fontSize: '10.5px',
              fontWeight: 600,
              whiteSpace: 'nowrap',
              lineHeight: 1.3,
              boxShadow: `inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -1px 0 ${tone.border}24, 0 1px 3px ${tone.border}26`,
            }}
          >
            {tone.short}
          </span>
          <span className="d-inline-flex align-items-center justify-content-center" style={{ gap: 1 }}>
            {Array.from({ length: TOTAL_STARS }).map((_, i) => {
              const filled = i < tone.rank;
              return (
                <i
                  key={i}
                  className={filled ? 'ri-star-fill' : 'ri-star-line'}
                  style={{
                    fontSize: 10,
                    color: filled ? tone.star : 'color-mix(in srgb, var(--vz-secondary-color) 35%, transparent)',
                    lineHeight: 1,
                  }}
                />
              );
            })}
          </span>
        </div>
      );
    }

    if (
      fieldName === 'gstin' ||
      fieldName === 'pan' ||
      fieldName === 'tan' ||
      fieldName === 'cin' ||
      fieldName === 'ifsc_code' ||
      fieldName === 'swift_code'
    ) {
      return (
        <code
          className="text-body"
          style={{
            fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace',
            fontSize: '0.8125rem',
            letterSpacing: '0.02em',
            textTransform: 'uppercase',
          }}
        >
          {String(raw).toUpperCase()}
        </code>
      );
    }

    if (typeof raw === 'string' && /^[A-Z0-9]{2,}$/.test(raw.replace(/\s|-/g, ''))) {
      const idTxt = String(raw);
      const idMax = 18;
      if (idTxt.length <= idMax) {
        return <code className="text-body" style={{ fontSize: '0.8125rem' }}>{idTxt}</code>;
      }
      return (
        <Tooltip label={idTxt} maxWidth={320}>
          <code className="text-body" style={{ fontSize: '0.8125rem' }}>{idTxt.slice(0, idMax - 1)}…</code>
        </Tooltip>
      );
    }

    if (f?.t === 'select' && f.opts?.some(o => typeof o !== 'string')) {
      const opt = normalizeOpts(f.opts).find(o => o.value === String(raw));
      if (opt) return <FitTip label={opt.label}><span className="text-body mp-fit">{opt.label}</span></FitTip>;
    }

    const txt = String(raw);
    return <FitTip label={txt}><span className="text-body mp-fit">{txt}</span></FitTip>;
  };

  const columns = useMemo(() => {
    const cols: any[] = [];
    cfg.cols.forEach((colName, idx) => {
      const isCentered = colName === 'level';
      cols.push({
        meta: isCentered ? { align: 'center' } : undefined,
        header: () => (
          <div className={isCentered ? 'text-center' : undefined}>
            {cfg.colL[idx] || colName}
          </div>
        ),
        accessorFn: (row: any) => {
          const f = cfg.fields.find(ff => ff.n === colName);
          if (f?.ref) return resolveRefLabel(f.ref, f.refL, row[colName]);
          return row[colName];
        },
        id: `col_${colName}`,
        cell: (info: any) => {
          const row = info.row.original;
          if (idx === 0 && colName !== 'status' && colName !== 'code') {
            const f = cfg.fields.find(ff => ff.n === colName);
            const raw = f?.ref ? resolveRefLabel(f.ref, f.refL, row[colName]) || '—' : row[colName] ?? '—';
            const txt = String(raw);
            return <FitTip label={txt}><b className="mp-fit">{txt}</b></FitTip>;
          }
          return formatCell(colName, row);
        },
      });
    });
    ownershipCols.forEach(o => {
      cols.push({
        header: o.label,
        id: o.key,
        accessorFn: (row: any) =>
          o.key === '__client' ? row.client_name :
          o.key === '__branch' ? row.branch_name :
          o.key === '__creator' ? row.creator_name : '',
        cell: (info: any) => renderOwnership(o.key, info.row.original),
      });
    });
    if (cfg.slug === 'designations' || cfg.slug === 'roles') {
      cols.push({
        header: () => <div className="text-center">Employees</div>,
        id: '__employees',
        meta: { align: 'center' },
        accessorFn: (row: any) => Number(row.employees_count ?? 0),
        cell: (info: any) => {
          const n = Number(info.row.original?.employees_count ?? 0);
          return (
            <div className="text-center" style={{ fontSize: '0.95rem', fontWeight: 700, color: 'var(--vz-heading-color, var(--vz-body-color))', fontVariantNumeric: 'tabular-nums' }}>
              {n.toLocaleString()}
            </div>
          );
        },
      });
    }
    if (cfg.slug === 'departments') {
      cols.push({
        header: () => <div className="text-center">Employees</div>,
        id: '__employees',
        meta: { align: 'center' },
        accessorFn: (row: any) => Number(row.employees_count ?? 0),
        cell: (info: any) => {
          const row = info.row.original;
          const n = Number(row?.employees_count ?? 0);
          return (
            <div className="text-center" style={{ lineHeight: 1.1 }}>
              <div style={{ fontSize: '1rem', fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', fontVariantNumeric: 'tabular-nums' }}>
                {n.toLocaleString()}
              </div>
              <div className="text-muted" style={{ fontSize: '0.7rem', marginTop: 2 }}>
                employees
              </div>
            </div>
          );
        },
      });
    }
    cols.push({
      header: 'Created Date',
      id: '__created_at',
      accessorFn: (row: any) => row.created_at ?? '',
      cell: (info: any) => {
        const raw = info.row.original?.created_at;
        if (!raw) return <span className="text-muted">—</span>;
        const d = new Date(raw);
        if (isNaN(d.getTime())) return <span className="text-muted">—</span>;
        const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const dd = String(d.getDate()).padStart(2, '0');
        const mmm = months[d.getMonth()];
        const yyyy = d.getFullYear();
        return (
          <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums', fontSize: '0.8125rem', whiteSpace: 'nowrap' }}>
            {dd}-{mmm}-{yyyy}
          </span>
        );
      },
    });
    cols.push({
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      meta: { align: 'center', width: 200 },
      enableGlobalFilter: false,
      cell: (info: any) => {
        const showAny = caps.view || caps.edit || caps.delete;
        const row = info.row.original;
        const rankFor = (t?: string): number => {
          switch (t) {
            case 'super_admin':                return 4;
            case 'client_admin':
            case 'client_user':                return 3;
            case 'branch_user': case 'employee': return 2;
            default:                           return 0;
          }
        };
        const myRank = rankFor(user?.user_type);
        const creatorRank = rankFor(row?.creator_user_type);
        const fallbackCreatorRank = !row?.created_by
          ? (row?.client_id == null ? 4
              : row?.branch_id == null ? 3
              : 2)
          : creatorRank;
        const blockedByRank =
          user?.user_type !== 'super_admin'
          && row?.created_by !== user?.id
          && fallbackCreatorRank > myRank;
        const whoLabel = row?.creator_user_type === 'super_admin'                            ? 'Super Admin'
                       : row?.creator_user_type === 'client_admin'                           ? 'Client Admin'
                       : row?.creator_user_type === 'client_user'                            ? 'Client user'
                       : (row?.creator_user_type === 'branch_user' || row?.creator_user_type === 'employee')
                         ? 'another Branch'
                       : 'a higher-privileged user';
        const isSystemRow = !!row?.is_system;
        const inUseRow = !!row?.in_use;
        const editTooltip   = isSystemRow ? 'System-managed — cannot be edited'
                            : blockedByRank ? `Cannot edit — created by ${whoLabel}`
                            : inUseRow && cfg.inUseStatusOnly ? 'In use by a service — only the status can be changed'
                            : 'Edit';
        const deleteTooltip = isSystemRow ? 'System-managed — cannot be deleted'
                            : blockedByRank ? `Cannot delete — created by ${whoLabel}`
                            : inUseRow ? 'In use — cannot be deleted while it is assigned to products or HSN codes'
                            : 'Delete';
        return (
          <div className="d-flex gap-1 justify-content-center">
            {caps.edit   && <ActionBtn
              title={editTooltip}
              icon="ri-pencil-line"
              color="info"
              disabled={blockedByRank || isSystemRow}
              onClick={() => openEdit(info.row.original)}
            />}
            {caps.view   && <ActionBtn title="View"   icon="ri-eye-line"        color="primary" onClick={() => openEdit(info.row.original, true)} />}
            {caps.delete && <ActionBtn
              title={deleteTooltip}
              icon="ri-delete-bin-line"
              color="danger"
              disabled={blockedByRank || isSystemRow || inUseRow}
              onClick={() => handleDeleteClick(info.row.original)}
            />}
            {cfg.slug === 'departments' ? (
              <ActionBtn
                title="Employee Tree"
                icon="ri-organization-chart"
                color="secondary"
                onClick={() => { setTreeTarget(info.row.original); setTreeOpen(true); }}
              />
            ) : (
              <ActionBtn
                title="Audit History"
                icon="ri-history-line"
                color="secondary"
                onClick={() => { setAuditTarget(info.row.original); setAuditOpen(true); }}
              />
            )}
            {!showAny && <span className="text-muted">—</span>}
          </div>
        );
      },
    });
    return cols;
  }, [cfg, ownershipCols, refData, caps, records]);

  const CREATOR_NAME_MAX = 11;

  const renderOwnership = (key: string, row: any): React.ReactNode => {
    if (key === '__client') {
      const name = row.client_name;
      return name
        ? <span className="text-body">{name}</span>
        : <span className="text-muted">—</span>;
    }
    if (key === '__branch') {
      const name = row.branch_name;
      return name
        ? <span className="badge bg-info-subtle text-info border border-info-subtle">{name}</span>
        : <span className="text-muted">—</span>;
    }
    if (key === '__creator') {
      const name = row.creator_name;
      if (!name) return <span className="text-muted">—</span>;
      const scope = row.branch_name
        ? `Branch: ${row.branch_name}`
        : row.client_name
        ? `Client: ${row.client_name}`
        : null;
      const userType = String(row.creator_user_type ?? '').toLowerCase();
      const tone =
        userType === 'super_admin' ? { bg: '#ecfeff', fg: '#0e7490', kind: 'super' as const } :
        userType === 'client_admin' || userType === 'client_user' ? { bg: '#ecfeff', fg: '#0e7490', kind: 'client' as const } :
        userType === 'branch_user' ? { bg: '#ecfeff', fg: '#0e7490', kind: 'branch' as const } :
        { bg: '#ecfeff', fg: '#0e7490', kind: 'other' as const };
      const shortName = String(name).length > CREATOR_NAME_MAX
        ? `${String(name).slice(0, CREATOR_NAME_MAX)}…`
        : String(name);
      const pill = (
        <span
          className={`mp-creator-pill mp-creator-${tone.kind}`}
          style={{
            display: 'inline-block',
            padding: '3px 10px',
            borderRadius: 999,
            background: tone.bg,
            color: tone.fg,
            fontSize: 11.5,
            fontWeight: 700,
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
          }}
        >
          {shortName}
        </span>
      );
      return (
        <div className="d-flex flex-column align-items-start" style={{ gap: 3, maxWidth: '100%' }}>
          {shortName === name ? pill : <Tooltip label={name} maxWidth={320}>{pill}</Tooltip>}
          {scope && (
            <FitTip label={scope}>
              <span
                className="text-muted mp-creator-sub"
                style={{ fontSize: 10.5, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
              >
                {scope}
              </span>
            </FitTip>
          )}
        </div>
      );
    }
    return null;
  };

  const singular = cfg.titleSingular || cfg.title;
  const statusCounts = useMemo(() => {
    if (serverPaged) {
      if (serverCounts) return serverCounts;
      const active = records.filter(r => mpStatusOf(r) === 'active').length;
      return { all: totalRows, active, inactive: records.length - active };
    }
    const active = searchMatched.filter(r => mpStatusOf(r) === 'active').length;
    return { all: searchMatched.length, active, inactive: searchMatched.length - active };
  }, [records, searchMatched, serverPaged, serverCounts, totalRows]);

  if (!caps.view) {
    return (
      <Row>
        <Col xs={12}>
          <Card className="shadow-sm" style={{ borderRadius: 16 }}>
            <CardBody className="text-center py-5">
              <div
                className="mx-auto mb-3 d-flex align-items-center justify-content-center rounded-circle bg-danger-subtle text-danger"
                style={{ width: 80, height: 80 }}
              >
                <i className="ri-lock-2-line fs-32"></i>
              </div>
              <h4 className="fw-bold mb-2">Access Denied</h4>
              <p className="text-muted mb-4" style={{ maxWidth: 460, marginInline: 'auto' }}>
                You don't have permission to view <strong>{cfg.title}</strong>.
                Please contact your administrator if you need access.
              </p>
              <Button color="light" onClick={() => navigate(backTo)}>
                <i className="ri-arrow-left-line me-1"></i>{backLabel}
              </Button>
            </CardBody>
          </Card>
        </Col>
      </Row>
    );
  }

  return (
    <div className="spi-root ord-page whm-page mp-inv">
      <style>{`
        .mp-kpi-tile + * .badge,
        .dt-table .badge {
          font-weight: 700;
          letter-spacing: 0.2px;
          padding: 5px 10px;
          border-radius: 999px;
          font-size: 11px;
        }

        .search-box .form-control {
          border: 1px solid #cbd5e1;
          transition: border-color .15s ease, box-shadow .15s ease;
        }
        .search-box .form-control:hover { border-color: #adb5bd; }
        [data-bs-theme="dark"] .search-box .form-control,
        [data-layout-mode="dark"] .search-box .form-control {
          border-color: rgba(255,255,255,0.20);
        }
        [data-bs-theme="dark"] .search-box .form-control:hover,
        [data-layout-mode="dark"] .search-box .form-control:hover {
          border-color: rgba(255,255,255,0.34);
        }
        .search-box .form-control:focus {
          border-color: rgba(8,145,178,0.45);
          box-shadow: 0 0 0 3px rgba(6,182,212,0.18);
        }

        .master-modal .modal-dialog:not(.modal-lg):not(.modal-xl) {
          max-width: 620px;
        }

        [data-bs-theme="dark"] .mp-status-active,
        [data-layout-mode="dark"] .mp-status-active,
        [data-bs-theme="dark"] .mp-creator-pill,
        [data-layout-mode="dark"] .mp-creator-pill {
          background: rgba(34, 211, 238, 0.14) !important;
          color: #67e8f9 !important;
          border-color: rgba(34, 211, 238, 0.24) !important;
        }
        [data-bs-theme="dark"] .mp-status-inactive,
        [data-layout-mode="dark"] .mp-status-inactive {
          background: rgba(34, 211, 238, 0.05) !important;
          color: #5f8ea1 !important;
          border-color: rgba(34, 211, 238, 0.14) !important;
        }
        [data-bs-theme="dark"] .mp-creator-sub,
        [data-layout-mode="dark"] .mp-creator-sub { color: rgba(255,255,255,0.55) !important; }

        .dt-table tbody td:has(.btn),
        .dt-table tbody td:has(.badge),
        .dt-table tbody td:has(.mp-status-active),
        .dt-table tbody td:has(.mp-status-inactive) {
          overflow: visible;
        }
      `}</style>

      <div className="spi-head">
        <div className="spi-head-left">
          <div className="spi-head-icon"><i className={cfg.icon} /></div>
          <div className="min-w-0">
            <div className="spi-head-title">
              {cfg.slug === 'roles' ? 'Role Master'
                : cfg.slug === 'kpis' ? 'KPI Master'
                : cfg.slug === 'assets' ? 'Asset Master'
                : cfg.slug === 'haz_class' ? 'Hazard Classifications'
                : cfg.slug === 'uom' ? 'Units of Measurement'
                : cfg.slug === 'hsn_codes' ? 'HSN Codes'
                : cfg.slug === 'gst_percentage' ? 'GST Percentages'
                : cfg.slug === 'packaging_material' ? 'Packaging Materials'
                : cfg.slug === 'conditions' ? 'Product Conditions'
                : cfg.slug === 'segments' ? 'Segments'
                : cfg.slug === 'departments' ? 'Department Master'
                : cfg.title}
            </div>
            <div className="spi-head-sub">
              {cfg.slug === 'roles'
                ? 'Manage all employee roles, role types, and role structure for workforce assignment'
                : cfg.slug === 'kpis'
                ? 'Define performance targets, role assignments and tracking criteria for KPIs'
                : cfg.slug === 'assets'
                ? 'Track company equipment, vendors, warranties and depreciation across the organisation'
                : cfg.slug === 'haz_class'
                ? 'Manage GHS/UN hazard classes used to tag products requiring special handling'
                : cfg.slug === 'uom'
                ? 'Manage units (Kg, Box, Pcs) used on product & shipment records'
                : cfg.slug === 'hsn_codes'
                ? 'Manage 8-digit HSN commodity codes used for GST & customs filings'
                : cfg.slug === 'gst_percentage'
                ? 'Manage GST slabs (0%, 5%, 12%, 18%, 28%) applied to products & invoices'
                : cfg.slug === 'packaging_material'
                ? 'Manage packaging materials (carton, drum, sack) used for product shipments'
                : cfg.slug === 'conditions'
                ? 'Manage storage & handling states (Organic, Fresh, Frozen) for products'
                : cfg.slug === 'segments'
                ? 'Manage business segments (Dry Fruits, Pharma, etc.) used to classify orders & products'
                : cfg.slug === 'departments'
                ? 'Manage department hierarchy, heads & configuration across the organisation'
                : cfg.parent && cfg.desc
                ? cfg.desc
                : `Manage ${cfg.title.toLowerCase()} records`}
            </div>
          </div>
        </div>
        <div className="mp-head-right">
          <MasterBackButton />
          {caps.add ? (
            <button type="button" className="spi-head-btn" onClick={openAdd}>
              <i className="ri-add-line" />
              Add {singular}
            </button>
          ) : cfg.lockedFixed && permitsAdd ? (
            <button
              type="button"
              className="spi-head-btn"
              disabled
              title={cfg.lockedReason || `${cfg.title} is a fixed master — no new records can be added.`}
            >
              <i className="ri-lock-line" />
              Add {singular}
            </button>
          ) : null}
        </div>
      </div>

      {cfg.kpis && cfg.kpis.length > 0 && (
        <MpKpiCards items={cfg.kpis.map(k => ({ key: k.label, label: k.label, icon: k.icon, value: k.compute(kpiRows ?? records) }))} />
      )}

      {cfg.slug === 'designations' && (
        <DesignationExtras />
      )}
      {cfg.slug === 'roles' && (
        <RolesExtras records={records} />
      )}
      {cfg.slug === 'kpis' && (
        <KpiExtras records={records} />
      )}

      <DataTable<any>
        data={serverPaged ? records.filter(matchesStatusTab) : filteredRecords}
        fitToViewport
        fillToFooter
        columns={columns}
        className="ord-list"
        {...(serverPaged ? {
          serverPagination: {
            total: totalRows,
            pageIndex: page,
            onPageChange: (p: number) => setPage(p),
            onPageSizeChange: (sz: number) => { setPerPage(sz); setPage(0); },
          },
        } : {})}
        serial
        accent="teal"
        minWidth={1100}
        pageSize={perPage}
        pageSizeOptions={[10, 25, 50]}
        loading={loading || tabShimmer}
        searchable={false}
        leadingToolbar={
          <div className="spi-segrow">
            {hasStatus && (
              <div className="spi-seg" role="tablist" aria-label={`${singular} status`}>
                {MP_STATUS_TABS.map(t => (
                  <button
                    key={t.key} type="button" role="tab"
                    aria-selected={statusTab === t.key}
                    className={`spi-seg-btn${statusTab === t.key ? ' is-active' : ''}`}
                    onClick={() => switchStatusTab(t.key)}
                  >
                    <span className="spi-seg-ico">{t.icon}</span>
                    {t.label} {mpPlural(singular)}
                    <span className="spi-seg-c">{statusCounts[t.key]}</span>
                  </button>
                ))}
              </div>
            )}
            {!hasStatus && cfg.slug !== 'roles' && (
              <div className="mp-subhead">
                <div className="mp-subhead__title">
                  {mpPlural(singular)}
                  <span className="mp-subhead__count">{statusCounts.all}</span>
                </div>
                <div className="mp-subhead__sub">{cfg.desc}</div>
              </div>
            )}
            {cfg.slug === 'roles' && (
              <div className="spi-seg" role="tablist" aria-label="Role type">
                {roleTabs.map(t => (
                  <button
                    key={t.key} type="button" role="tab"
                    aria-selected={roleTab === t.key}
                    className={`spi-seg-btn${roleTab === t.key ? ' is-active' : ''}`}
                    onClick={() => { if (t.key !== roleTab) { setRoleTab(t.key as typeof roleTab); flashTabShimmer(); } }}
                  >
                    <span className="spi-seg-ico"><i className={t.icon} /></span>
                    {t.label}
                    <span className="spi-seg-c">{t.count}</span>
                  </button>
                ))}
              </div>
            )}
            <div className="spi-search">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              <input
                type="text"
                value={searchInput}
                onChange={e => setSearchInput(e.target.value)}
                name={`${cfg.slug}-list-search`}
                placeholder={`Search ${mpPlural(singular).toLowerCase()}...`}
                aria-label={`Search ${mpPlural(singular).toLowerCase()}`}
                autoComplete="off"
              />
              <SearchClear show={searchInput} onClear={() => setSearchInput('')} />
            </div>
          </div>
        }
        emptyMessage={
          <>
            <i className="ri-inbox-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
            {records.length === 0
              ? `No ${cfg.title.toLowerCase()} yet${caps.add ? ` — click Add ${singular} to create the first one` : ''}`
              : `No ${cfg.title.toLowerCase()} match your search`}
          </>
        }
        toolbarActions={
          <>
            {cfg.slug === 'kpis' && (
              <KpiInlineFilters
                refData={refData}
                roleFilter={kpiRoleFilter}
                setRoleFilter={setKpiRoleFilter}
                targetFilter={kpiTargetFilter}
                setTargetFilter={setKpiTargetFilter}
                priorityFilter={kpiPriorityFilter}
                setPriorityFilter={setKpiPriorityFilter}
              />
            )}
          </>
        }
      />

      <MasterFormStyles />
      <Modal
        isOpen={modalOpen}
        toggle={() => {}}
        size={modalSize}
        centered
        modalClassName="master-modal mp-tealf"
        contentClassName="whm-addmdl mp-tealf-content"
        backdropClassName="mp-tealf-backdrop"
        backdrop="static"
        keyboard={false}
      >
        <div className="spi-mdl-head">
          <div className="spi-mdl-head-left">
            <div className="spi-mdl-head-ico"><i className={cfg.icon} style={{ fontSize: 20 }} /></div>
            <div className="min-w-0">
              <div className="spi-mdl-title">
                {viewOnly ? `View ${singular}` : editingId != null ? `Edit ${singular}` : `Add ${singular}`}
              </div>
              <div className="spi-mdl-sub">
                {viewOnly ? `Viewing details for this ${singular.toLowerCase()}` :
                 editingId != null ? `Update the details of this ${singular.toLowerCase()}` :
                 `Fill in the details to register a new ${singular.toLowerCase()}`}
              </div>
            </div>
          </div>
          <button type="button" className="spi-mdl-x" onClick={() => setModalOpen(false)} disabled={saving} aria-label="Close">
            <i className="ri-close-line" style={{ fontSize: 18 }} />
          </button>
        </div>
        <Form onSubmit={handleSave} noValidate>
          <ModalBody className="mp-tealf-body">
            <fieldset disabled={saving} style={{ border: 0, margin: 0, padding: 0, minWidth: 0, pointerEvents: saving ? 'none' : undefined }}>
            {sectionedFields.map((group, gIdx) => {
              return (
                <div key={gIdx} className="whm-card">
                  {group.sec && (
                    <div className="whm-sec">
                      <span className="whm-sec__ico"><i className={cfg.icon} /></span>
                      <b>{group.sec}</b>
                    </div>
                  )}
                  <Row className="g-2">
                    {group.fields
                      .filter((f) => {
                        if (!f.showWhen) return true;
                        const live = radioValues[f.showWhen.field];
                        const fromRow = editing?.[f.showWhen.field];
                        const cur = String((live ?? fromRow) ?? '');
                        const need = Array.isArray(f.showWhen.equals)
                          ? f.showWhen.equals.map(String)
                          : [String(f.showWhen.equals)];
                        return need.includes(cur);
                      })
                      .map((f, i) => renderField(f, i, editing, viewOnly || (statusOnlyEdit && f.n !== 'status'), refData, labelFieldForRef, fieldErrors, clearFieldError, defaultFieldSpan, tenantScopedRecords, sublistValues, (field, next) => setSublistValues(prev => ({ ...prev, [field.n]: next })), apiAutogen, radioValues, (name, value) => setRadioValues((prev) => ({ ...prev, [name]: value })), apiOpts))}
                  </Row>
                </div>
              );
            })}
            </fieldset>
          </ModalBody>
          <div className="spi-mdl-foot">
            {viewOnly
              ? <span />
              : <span className="whm-footnote"><i className="ri-information-line" style={{ fontSize: 15, color: '#0891b2' }} /> Fields marked * are required</span>}
            <div className="spi-mdl-foot-btns">
              <button type="button" className="spi-mdl-cancel" disabled={saving} onClick={() => setModalOpen(false)}>
                {viewOnly ? 'Close' : 'Cancel'}
              </button>
              {!viewOnly && (
                <button type="submit" className="spi-mdl-confirm" disabled={saving} aria-busy={saving || undefined}>
                  {saving ? <span className="spi-mdl-spin" aria-hidden /> : <i className="ri-check-line" style={{ fontSize: 16 }} />}
                  {saving
                    ? (editingId != null ? 'Updating...' : 'Saving...')
                    : (editingId != null ? `Update ${singular}` : `Save ${singular}`)}
                </button>
              )}
            </div>
          </div>
        </Form>
        {saving && <MasterSavingLock label={editingId != null ? `Updating ${singular.toLowerCase()}…` : `Saving ${singular.toLowerCase()}…`} />}
      </Modal>

      <DeleteConfirmModal
        open={deleteOpen}
        title={`Delete ${cfg.titleSingular || cfg.title}`}
        itemName={deleteTarget ? deleteLabel(deleteTarget) : undefined}
        subMessage="This action cannot be undone. The record will be permanently removed."
        onClose={() => { if (!deleting) { setDeleteOpen(false); setDeleteTarget(null); } }}
        onConfirm={confirmDelete}
        loading={deleting}
        loadingOverlay={<MasterSavingLock label={`Deleting ${singular.toLowerCase()}…`} />}
      />

      <AuditHistoryModal
        open={auditOpen}
        onClose={() => { setAuditOpen(false); setAuditTarget(null); }}
        masterTitle={cfg.title}
        record={auditTarget}
        primaryLabel={auditTarget ? deleteLabel(auditTarget) : ''}
      />

      <EmployeeTreeModal
        open={treeOpen}
        onClose={() => { setTreeOpen(false); setTreeTarget(null); }}
        department={treeTarget}
      />

    </div>
  );
}

function EmployeeTreeModal({
  open,
  onClose,
  department,
}: {
  open: boolean;
  onClose: () => void;
  department: any | null;
}) {
  type TreeNode = { id: string; name: string; role: string; photo?: string | null; children?: TreeNode[] };
  const [loading, setLoading] = useState(false);
  const [roots, setRoots] = useState<TreeNode[] | null>(null);
  const [error, setError] = useState('');
  const [badPhotos, setBadPhotos] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!open || !department?.id) return;
    let alive = true;
    setLoading(true); setError(''); setRoots(null);
    api.get(`/employees/department-tree/${department.id}`)
      .then(r => { if (alive) setRoots((r.data?.data?.roots ?? []) as TreeNode[]); })
      .catch(() => { if (alive) setError('Could not load the department tree.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [open, department?.id]);

  const initials = (n: string) => (n || '').trim().split(/\s+/).map(w => w[0]).slice(0, 2).join('').toUpperCase() || '?';
  const accentFor = (node: TreeNode) => {
    if (node.id.startsWith('u')) return '#0e7490';
    const r = (node.role || '').toLowerCase();
    if (r.includes('head of department') || r === 'hod') return '#0891b2';
    if (r.includes('team leader')) return '#059669';
    return '#d97706';
  };

  const chart = useMemo(() => layoutOrgChart(roots ?? []), [roots]);
  const ET_ZOOM_DEFAULT = 0.75;
  const [zoom, setZoom] = useState(ET_ZOOM_DEFAULT);
  useEffect(() => { if (open) setZoom(ET_ZOOM_DEFAULT); }, [open]);
  const zoomBy = (d: number) => setZoom(z => Math.min(1.5, Math.max(0.4, Math.round((z + d) * 100) / 100)));
  const scrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollLeft = (el.scrollWidth - el.clientWidth) / 2;
  }, [chart, zoom]);

  const renderNode = (node: TreeNode, left: number, top: number): React.ReactNode => {
    const accent = accentFor(node);
    return (
      <div key={node.id} className="et-pos" style={{ left, top }}>
        <div className="et-node" style={{ background: `linear-gradient(180deg, ${accent}20 0%, transparent 58%), var(--vz-card-bg)`, borderColor: `${accent}45`, boxShadow: `0 10px 26px ${accent}26` }}>
          <div className="et-avatar-ring" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}66)`, boxShadow: `0 6px 16px ${accent}55` }}>
            {node.photo && !badPhotos.has(node.id)
              ? <img className="et-avatar et-avatar-img" src={node.photo} alt={node.name}
                  onError={() => setBadPhotos(s => new Set(s).add(node.id))} />
              : <div className="et-avatar" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>{initials(node.name)}</div>}
          </div>
          <div className="et-name" title={node.name}>{node.name}</div>
          <div className="et-role" style={{ background: `${accent}1f`, color: accent }}>{node.role}</div>
        </div>
      </div>
    );
  };

  return (
    <Modal isOpen={open} toggle={onClose} centered backdrop="static" contentClassName="et-modal whm-addmdl" modalClassName="et-modal-wrap mp-tealf" backdropClassName="mp-tealf-backdrop">
      <style>{ET_TREE_CSS}</style>
      <div className="spi-mdl-head">
        <div className="spi-mdl-head-left">
          <div className="spi-mdl-head-ico"><i className="ri-organization-chart" style={{ fontSize: 20 }} /></div>
          <div className="min-w-0">
            <div className="spi-mdl-title">Employee Tree</div>
            <div className="spi-mdl-sub">{(department?.name ?? 'Department')}{/department/i.test(department?.name ?? '') ? '' : ' Department'}</div>
          </div>
        </div>
        <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><i className="ri-close-line" style={{ fontSize: 18 }} /></button>
      </div>
      <ModalBody className="et-modal-body" style={{ padding: '22px 12px 26px' }}>
        {loading ? (
          <div className="text-center py-5"><Spinner /></div>
        ) : error ? (
          <div className="text-center text-danger py-4">{error}</div>
        ) : roots && roots.length ? (
          <div className="et-scroll" ref={scrollRef}>
            <div className="et-zoom-box" style={{ width: chart.width * zoom, height: chart.height * zoom }}>
              <div className="et-canvas" style={{ width: chart.width, height: chart.height, transform: `scale(${zoom})` }}>
                <svg className="et-lines" width={chart.width} height={chart.height} aria-hidden>
                  <path d={chart.lines} />
                </svg>
                {chart.placed.map(p => renderNode(p.node, p.left, p.top))}
              </div>
            </div>
          </div>
        ) : (
          <div className="text-center text-muted py-4">No employees in this department yet.</div>
        )}
      </ModalBody>
      <div className="spi-mdl-foot">
        <span className="whm-footnote"><i className="ri-information-line" style={{ fontSize: 15, color: '#0891b2' }} /> Reporting lines in this department</span>
        <div className="spi-mdl-foot-btns">
          {chart.placed.length > 0 && (
            <div className="et-zoom" role="group" aria-label="Zoom">
              <button type="button" className="et-zoom-btn" onClick={() => zoomBy(-0.1)} disabled={zoom <= 0.4} aria-label="Zoom out" title="Zoom out">
                <i className="ri-zoom-out-line" />
              </button>
              <button type="button" className="et-zoom-val" onClick={() => setZoom(ET_ZOOM_DEFAULT)} title="Reset to 75%">
                {Math.round(zoom * 100)}%
              </button>
              <button type="button" className="et-zoom-btn" onClick={() => zoomBy(0.1)} disabled={zoom >= 1.5} aria-label="Zoom in" title="Zoom in">
                <i className="ri-zoom-in-line" />
              </button>
            </div>
          )}
          <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </Modal>
  );
}

type OrgNode = { id: string; children?: OrgNode[] };
const ET_CARD_W = 150;
const ET_CARD_H = 150;
const ET_GAP_X = 30;
const ET_GAP_Y = 58;

function layoutOrgChart<T extends OrgNode>(roots: T[]) {
  type Item = { node: T; x: number; depth: number; parentId: string | null };
  type Sub = { items: Item[]; left: number[]; right: number[] };

  const lay = (node: T, depth: number, parentId: string | null): Sub => {
    const kids = (node.children ?? []) as T[];
    const self: Item = { node, x: 0, depth, parentId };
    if (!kids.length) return { items: [self], left: [0], right: [0] };

    const subs = kids.map(k => lay(k, depth + 1, node.id));
    const offsets: number[] = [];
    const accL: number[] = [];
    const accR: number[] = [];
    subs.forEach((s, i) => {
      let off = 0;
      if (i > 0) {
        off = -Infinity;
        const n = Math.min(accR.length, s.left.length);
        for (let d = 0; d < n; d++) off = Math.max(off, accR[d] - s.left[d] + ET_CARD_W + ET_GAP_X);
      }
      offsets.push(off);
      s.left.forEach((v, d) => { accL[d] = accL[d] === undefined ? v + off : Math.min(accL[d], v + off); });
      s.right.forEach((v, d) => { accR[d] = accR[d] === undefined ? v + off : Math.max(accR[d], v + off); });
    });
    const mid = (offsets[0] + offsets[offsets.length - 1]) / 2;
    const items: Item[] = [self];
    subs.forEach((s, i) => s.items.forEach(it => items.push({ ...it, x: it.x + offsets[i] - mid })));
    return { items, left: [0, ...accL.map(v => v - mid)], right: [0, ...accR.map(v => v - mid)] };
  };

  const virtual = { id: '__root', children: roots } as unknown as T;
  const items = roots.length ? lay(virtual, -1, null).items.filter(it => it.node.id !== '__root') : [];
  if (!items.length) return { placed: [] as { node: T; left: number; top: number }[], lines: '', width: 0, height: 0 };

  let minX = Math.min(...items.map(i => i.x));
  const maxX = Math.max(...items.map(i => i.x));
  if (roots.length === 1) {
    const rootX = items.find(i => i.node.id === roots[0].id)!.x;
    minX = rootX - Math.max(rootX - minX, maxX - rootX);
  }
  const rowH = ET_CARD_H + ET_GAP_Y;
  const pos = new Map<string, { left: number; top: number }>();
  items.forEach(i => pos.set(i.node.id, { left: i.x - minX, top: i.depth * rowH }));

  let lines = '';
  items.forEach(i => {
    if (!i.parentId || i.parentId === '__root') return;
    const p = pos.get(i.parentId)!;
    const c = pos.get(i.node.id)!;
    const px = p.left + ET_CARD_W / 2;
    const py = p.top + ET_CARD_H;
    const my = py + ET_GAP_Y / 2;
    const cx = c.left + ET_CARD_W / 2;
    lines += `M${px} ${py}V${my}H${cx}V${c.top}`;
  });

  const width = roots.length === 1
    ? 2 * (items.find(i => i.node.id === roots[0].id)!.x - minX) + ET_CARD_W
    : maxX - minX + ET_CARD_W;
  const height = Math.max(...items.map(i => i.depth)) * rowH + ET_CARD_H;
  return { placed: items.map(i => ({ node: i.node, ...pos.get(i.node.id)! })), lines, width, height };
}

const ET_TREE_CSS = `
.et-zoom-box { position: relative; margin: 0 auto; }
.et-canvas { position: absolute; top: 0; left: 0; transform-origin: 0 0; transition: transform .15s ease; }
.et-zoom {
  display: inline-flex; align-items: center; height: 40px; padding: 3px; gap: 2px;
  border: 1px solid #cfe8ef; border-radius: 12px; background: #fff;
}
.et-zoom-btn, .et-zoom-val {
  height: 32px; border: 0; border-radius: 9px; background: transparent; color: #0e7490;
  display: inline-flex; align-items: center; justify-content: center; cursor: pointer;
  font-family: inherit; transition: background .15s;
}
.et-zoom-btn { width: 32px; font-size: 16px; }
.et-zoom-val { min-width: 52px; padding: 0 6px; font-size: 12.5px; font-weight: 700; }
.et-zoom-btn:hover:not(:disabled), .et-zoom-val:hover { background: #ecfeff; }
.et-zoom-btn:disabled { opacity: .4; cursor: not-allowed; }
[data-bs-theme="dark"] .et-zoom { background: rgba(255,255,255,.04); border-color: rgba(34,211,238,.25); }
[data-bs-theme="dark"] .et-zoom-btn, [data-bs-theme="dark"] .et-zoom-val { color: #67e8f9; }
[data-bs-theme="dark"] .et-zoom-btn:hover:not(:disabled), [data-bs-theme="dark"] .et-zoom-val:hover { background: rgba(34,211,238,.12); }
.et-lines { position: absolute; inset: 0; overflow: visible; pointer-events: none; }
.et-lines path { fill: none; stroke: rgba(8,145,178,0.35); stroke-width: 2; }
.et-pos { position: absolute; width: ${ET_CARD_W}px; }
.et-canvas .et-node { width: ${ET_CARD_W}px; height: ${ET_CARD_H}px; min-height: 0; box-sizing: border-box; overflow: hidden; justify-content: center; }
.et-canvas .et-name { display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; max-width: 100%; }
.et-modal-wrap .modal-dialog { width: min(1200px, 94vw); max-width: min(1200px, 94vw); }
.et-modal {
  border-radius: 26px !important; overflow: hidden; border: 1px solid rgba(255,255,255,.7);
  box-shadow: 0 50px 120px -30px rgba(8,47,73,.7), 0 0 0 6px rgba(255,255,255,.12);
  width: min(1200px, 94vw); max-width: 100%; margin: 0 auto;
}
.et-modal-body {
  position: relative;
  height: 70vh; overflow: hidden;
  background:
    radial-gradient(circle at 10% 8%,  rgba(34,211,238,0.14), transparent 26%),
    radial-gradient(circle at 90% 90%, rgba(8,145,178,0.10),  transparent 28%),
    linear-gradient(180deg, #f4fbfd 0%, #eef7fa 100%);
}
.et-scroll { position: relative; z-index: 1; height: 100%; overflow: auto; padding: 16px 6px 8px; box-sizing: border-box; }
.et-tree { display: inline-block; text-align: center; }
.et-avatar-img { object-fit: cover; background: var(--vz-card-bg); }
.et-tree ul { position: relative; padding: 26px 0 0; margin: 0; display: flex; justify-content: center; list-style: none; }
.et-tree li { position: relative; padding: 26px 8px 0; list-style: none; }
.et-tree li::before, .et-tree li::after {
  content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: 26px;
  border-top: 2px solid rgba(8,145,178,0.35);
}
.et-tree li::after { right: auto; left: 50%; border-left: 2px solid rgba(8,145,178,0.35); }
.et-tree li:only-child::before, .et-tree li:only-child::after { display: none; }
.et-tree li:only-child { padding-top: 26px; }
.et-tree li:first-child::before, .et-tree li:last-child::after { border: 0 none; }
.et-tree li:last-child::before { border-right: 2px solid rgba(8,145,178,0.35); border-radius: 0 7px 0 0; }
.et-tree li:first-child::after { border-radius: 7px 0 0 0; }
.et-tree ul ul::before {
  content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 26px;
  border-left: 2px solid rgba(8,145,178,0.35);
}
.et-tree > ul { padding-top: 0; }
.et-node {
  display: inline-flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 7px;
  width: 150px; min-height: 148px; padding: 14px 10px 12px; border-radius: 14px;
  border: 1px solid rgba(34,211,238,0.12); background: var(--vz-card-bg);
  box-shadow: 0 8px 20px rgba(76,29,149,0.10); transition: transform .15s ease, box-shadow .15s ease;
}
.et-node:hover { transform: translateY(-3px); box-shadow: 0 14px 28px rgba(8,145,178,0.22); }
.et-modal .spi-mdl-head { border-radius: 25px 25px 0 0; }
.et-modal .spi-mdl-foot { padding: 12px 22px; border-top-color: #e3f1f5; background: #eef7fa; }
.et-modal .spi-mdl-cancel { height: 42px; border-radius: 12px; }
[data-bs-theme="dark"] .et-modal-body { background: #0b1626; }
[data-bs-theme="dark"] .et-modal .spi-mdl-foot { background: #0b1626; border-top-color: rgba(148,163,184,.16); }
.et-avatar-ring {
  padding: 3px; border-radius: 50%; display: inline-flex;
}
.et-avatar {
  width: 46px; height: 46px; border-radius: 50%; color: #fff; display: flex;
  align-items: center; justify-content: center; font-weight: 800; font-size: 16px;
  border: 2.5px solid var(--vz-card-bg);
}
.et-name { font-weight: 700; font-size: 12.5px; line-height: 1.25; color: var(--vz-body-color); text-align: center; }
.et-role {
  display: inline-block; padding: 3px 10px; border-radius: 999px;
  font-size: 9px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em;
  text-align: center; line-height: 1.35;
}
`;

function AuditHistoryModal({
  open,
  onClose,
  masterTitle,
  record,
  primaryLabel,
}: {
  open: boolean;
  onClose: () => void;
  masterTitle: string;
  record: any | null;
  primaryLabel: string;
}) {
  type Event = {
    kind: 'created' | 'updated';
    icon: string;
    color: string;
    title: string;
    user: string;
    at: string;
  };

  const events: Event[] = useMemo(() => {
    if (!record) return [];
    const list: Event[] = [];
    const fmt = (raw: any): string => {
      if (!raw) return '—';
      const d = new Date(raw);
      if (isNaN(d.getTime())) return String(raw);
      const pad = (n: number) => String(n).padStart(2, '0');
      const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
      return `${pad(d.getDate())}-${months[d.getMonth()]}-${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    };
    const userLabel = record.creator_name || 'System';

    list.push({
      kind: 'created',
      icon: 'ri-add-line',
      color: '#0891b2',
      title: 'Created',
      user: userLabel,
      at: fmt(record.created_at),
    });

    if (record.updated_at && record.updated_at !== record.created_at) {
      list.push({
        kind: 'updated',
        icon: 'ri-edit-2-line',
        color: '#0e7490',
        title: 'Updated',
        user: userLabel,
        at: fmt(record.updated_at),
      });
    }

    return list;
  }, [record]);

  return (
    <Modal isOpen={open} toggle={onClose} centered size="md" backdrop="static" contentClassName="audit-modal whm-addmdl" modalClassName="mp-tealf" backdropClassName="mp-tealf-backdrop">
      <div className="spi-mdl-head">
        <div className="spi-mdl-head-left">
          <div className="spi-mdl-head-ico"><i className="ri-history-line" style={{ fontSize: 20 }} /></div>
          <div className="min-w-0">
            <div className="spi-mdl-title">Audit History — {masterTitle}</div>
            <div className="spi-mdl-sub">{record ? `Record #${record.id}${primaryLabel ? ` · ${primaryLabel}` : ''}` : ''}</div>
          </div>
        </div>
        <button type="button" className="spi-mdl-x" onClick={onClose} aria-label="Close"><i className="ri-close-line" style={{ fontSize: 18 }} /></button>
      </div>
      <ModalBody className="audit-modal-body" style={{ padding: '20px 22px 22px' }}>
        {events.length === 0 ? (
          <div className="text-muted text-center py-4" style={{ fontSize: 13 }}>
            No history available for this record.
          </div>
        ) : (
          <div className="audit-timeline">
            {events.map((e, idx) => (
              <div key={idx} className="audit-event">
                <span
                  className="audit-event-dot"
                  style={{
                    background: `color-mix(in srgb, ${e.color} 14%, var(--vz-card-bg))`,
                    border: `1px solid color-mix(in srgb, ${e.color} 30%, transparent)`,
                    color: e.color,
                  }}
                >
                  <i className={e.icon} />
                </span>
                <div className="flex-grow-1 min-w-0">
                  <span className="audit-event-title" style={{ color: e.color }}>{e.title}</span>
                  <div className="audit-event-meta">
                    <span className="audit-event-meta-label">{e.title} by:</span>
                    <span className="audit-event-meta-user">
                      <i className="ri-user-3-line" />{e.user}
                    </span>
                    <span className="audit-event-meta-sep">·</span>
                    <span className="audit-event-meta-time">
                      <i className="ri-time-line" />{e.at}
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </ModalBody>
      <div className="spi-mdl-foot">
        <span />
        <div className="spi-mdl-foot-btns">
          <button type="button" className="spi-mdl-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
      <style>{`
        .audit-modal {
          border-radius: 26px !important;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,.7);
          box-shadow: 0 50px 120px -30px rgba(8,47,73,.7), 0 0 0 6px rgba(255,255,255,.12);
        }
        .audit-modal .spi-mdl-head { border-radius: 25px 25px 0 0; }
        .audit-modal .spi-mdl-foot { padding: 12px 22px; border-top-color: #e3f1f5; background: transparent; }
        .audit-modal .spi-mdl-cancel { height: 42px; border-radius: 12px; }
        [data-bs-theme="dark"] .audit-modal { border-color: rgba(148,163,184,.22); }
        [data-bs-theme="dark"] .audit-modal .spi-mdl-foot { background: transparent; border-top-color: rgba(148,163,184,.16); }
        .audit-modal-body { background: transparent; }
        .audit-timeline {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .audit-timeline::before {
          content: '';
          position: absolute;
          top: 28px; bottom: 28px;
          left: 27px;
          width: 2px;
          z-index: 0;
          background: linear-gradient(180deg,
            rgba(8,145,178,0.30) 0%,
            rgba(8,145,178,0.06) 100%);
        }
        .audit-event {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          position: relative;
          padding: 10px 12px 10px 10px;
          border-radius: 10px;
          background: rgba(8,145,178,0.04);
          border: 1px solid rgba(8,145,178,0.10);
          transition: background 140ms ease, border-color 140ms ease;
        }
        .audit-event:hover {
          background: rgba(8,145,178,0.08);
          border-color: rgba(8,145,178,0.20);
        }
        .audit-event-dot {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 36px; height: 36px;
          border-radius: 50%;
          flex-shrink: 0;
          z-index: 1;
          box-shadow: 0 0 0 3px var(--vz-card-bg);
        }
        .audit-event-dot i { font-size: 16px; line-height: 1; }
        .audit-event-title {
          font-size: 13.5px;
          font-weight: 700;
          letter-spacing: 0.01em;
          display: block;
        }
        .audit-event-meta {
          margin-top: 4px;
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          font-size: 12px;
          color: var(--vz-secondary-color);
        }
        .audit-event-meta-label {
          font-weight: 600;
          color: var(--vz-secondary-color);
        }
        .audit-event-meta-user {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          color: var(--vz-body-color);
          font-weight: 600;
        }
        .audit-event-meta-user i { font-size: 12.5px; opacity: 0.75; }
        .audit-event-meta-sep { opacity: 0.45; }
        .audit-event-meta-time {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          font-variant-numeric: tabular-nums;
        }
        .audit-event-meta-time i { font-size: 12px; opacity: 0.7; }

        [data-bs-theme="dark"] .audit-event,
        [data-layout-mode="dark"] .audit-event {
          background: rgba(8,145,178,0.10);
          border-color: rgba(8,145,178,0.22);
        }
        [data-bs-theme="dark"] .audit-event:hover,
        [data-layout-mode="dark"] .audit-event:hover {
          background: rgba(8,145,178,0.18);
          border-color: rgba(8,145,178,0.40);
        }
        [data-bs-theme="dark"] .audit-timeline::before,
        [data-layout-mode="dark"] .audit-timeline::before {
          background: linear-gradient(180deg,
            rgba(34,211,238,0.50) 0%,
            rgba(34,211,238,0.10) 100%);
        }
      `}</style>
    </Modal>
  );
}

const UOM_SHORT_CODE_DICT: Record<string, string> = {
  'kilogram': 'Kg', 'kilo': 'Kg', 'kg': 'Kg',
  'gram': 'g', 'milligram': 'mg',
  'ton': 'T', 'metric ton': 'Mt', 'tonne': 'Mt', 'tonnes': 'Mt',
  'pound': 'Lb', 'pounds': 'Lb', 'ounce': 'Oz', 'ounces': 'Oz',
  'liter': 'Ltr', 'litre': 'Ltr', 'liters': 'Ltr', 'litres': 'Ltr',
  'milliliter': 'Ml', 'millilitre': 'Ml',
  'gallon': 'Gal', 'cubic meter': 'Cbm', 'cubic metre': 'Cbm',
  'meter': 'm', 'metre': 'm', 'meters': 'm', 'metres': 'm',
  'centimeter': 'Cm', 'centimetre': 'Cm', 'centimeters': 'Cm', 'centimetres': 'Cm',
  'millimeter': 'Mm', 'millimetre': 'Mm', 'millimeters': 'Mm', 'millimetres': 'Mm',
  'milimeter': 'Mm', 'milimetre': 'Mm', 'milimeters': 'Mm', 'milimetres': 'Mm',
  'kilometer': 'Km', 'kilometre': 'Km', 'kilometers': 'Km', 'kilometres': 'Km',
  'killogram': 'Kg', 'killograms': 'Kg', 'kilograms': 'Kg',
  'inch': 'IN', 'inches': 'IN', 'foot': 'FT', 'feet': 'FT', 'yard': 'YD', 'yards': 'YD',
  'piece': 'PCS', 'pieces': 'PCS', 'pcs': 'PCS',
  'box': 'BOX', 'boxes': 'BOX',
  'carton': 'CTN', 'cartons': 'CTN',
  'bag': 'BAG', 'bags': 'BAG',
  'dozen': 'DOZ', 'dozens': 'DOZ',
  'pack': 'PK', 'packs': 'PK', 'pallet': 'PLT', 'pallets': 'PLT',
  'roll': 'ROL', 'rolls': 'ROL', 'sheet': 'SHT', 'sheets': 'SHT',
  'unit': 'UNIT', 'units': 'UNIT',
  'set': 'SET', 'sets': 'SET', 'pair': 'PR', 'pairs': 'PR',
  'barrel': 'BBL', 'drum': 'DR', 'bottle': 'BTL',
};
function deriveValue(slug: string, fieldName: string, sourceValue: string): string {
  const raw = (sourceValue || '').trim();
  if (!raw) return '';
  if (slug === 'uom' && fieldName === 'short_code') {
    const key = raw.toLowerCase();
    if (UOM_SHORT_CODE_DICT[key]) return UOM_SHORT_CODE_DICT[key];
    const words = raw.split(/\s+/);
    if (words.length > 1) {
      return words.map(w => (w[0] || '').toUpperCase()).join('').slice(0, 4);
    }
    return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  }
  return raw.toUpperCase().slice(0, 4);
}



function DesignationExtras() {
  const TIERS: { label: string; icon: string; bg: string; fg: string; border: string; bright: string }[] = [
    { label: 'Director / CEO',           icon: 'ri-vip-crown-fill', bg: '#fef3c7', fg: '#92400e', border: '#f59e0b', bright: '#f59e0b' },
    { label: 'Head of Department (HOD)', icon: 'ri-medal-2-fill',   bg: '#ede9fe', fg: '#6d28d9', border: '#8b5cf6', bright: '#a78bfa' },
    { label: 'Team Leader',              icon: 'ri-team-fill',      bg: '#dbeafe', fg: '#1d4ed8', border: '#3b82f6', bright: '#60a5fa' },
    { label: 'Executive',                icon: 'ri-user-star-fill', bg: '#ccfbf1', fg: '#0d9488', border: '#14b8a6', bright: '#2dd4bf' },
    { label: 'Employee',                 icon: 'ri-user-3-fill',    bg: '#dcfce7', fg: '#15803d', border: '#22c55e', bright: '#4ade80' },
    { label: 'Intern / Trainee',         icon: 'ri-book-open-fill', bg: '#f1f5f9', fg: '#475569', border: '#94a3b8', bright: '#94a3b8' },
  ];

  return (
    <div className="dsn-extras">
      <div className="dsn-hier-row">
        <span className="dsn-hier-label">Hierarchy</span>
        {TIERS.map((t, i) => (
          <span key={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span
              className="dsn-hier-chip"
              style={{ '--hc-bg': t.bg, '--hc-fg': t.fg, '--hc-bd': t.border, '--hc-br': t.bright } as React.CSSProperties}
            >
              <i className={t.icon} style={{ fontSize: 13 }} />
              {t.label}
            </span>
            {i < TIERS.length - 1 && <i className="ri-arrow-right-s-line dsn-hier-arrow" />}
          </span>
        ))}
      </div>
    </div>
  );
}

function RolesExtras({ records }: { records: any[] }) {
  const total = records.length;
  const primaryCount = records.filter(r => /primary/i.test(String(r.role_type ?? ''))).length;
  const ancillaryCount = records.filter(r => /ancillary|auxiliary|operational|administrative|functional/i.test(String(r.role_type ?? ''))).length;
  const activeCount = records.filter(r => String(r.status ?? '').toLowerCase() === 'active').length;
  const inactiveCount = records.filter(r => String(r.status ?? '').toLowerCase() !== 'active').length;
  const assignedCount = records.filter(r => Number(r.employees_count ?? 0) > 0).length;

  const KPIS = [
    { key: 'total',     label: 'Total Roles',     icon: 'ri-shield-fill',          deep: '#3d4eb1', bright: '#6691e7', accent: 'linear-gradient(135deg,#3d4eb1 0%,#6691e7 100%)', tint: 'rgba(102,145,231,0.10)', value: total },
    { key: 'primary',   label: 'Primary Roles',   icon: 'ri-star-fill',            deep: '#6940d8', bright: '#a78bfa', accent: 'linear-gradient(135deg,#6940d8 0%,#a78bfa 100%)', tint: 'rgba(167,139,250,0.12)', value: primaryCount },
    { key: 'ancillary', label: 'Ancillary Roles', icon: 'ri-time-fill',            deep: '#e08a1a', bright: '#fbbf60', accent: 'linear-gradient(135deg,#e08a1a 0%,#fbbf60 100%)', tint: 'rgba(247,184,75,0.12)', value: ancillaryCount },
    { key: 'active',    label: 'Active',          icon: 'ri-checkbox-circle-fill', deep: '#089d7a', bright: '#34d4ad', accent: 'linear-gradient(135deg,#089d7a 0%,#34d4ad 100%)', tint: 'rgba(52,212,173,0.12)', value: activeCount },
    { key: 'assigned',  label: 'Assigned',        icon: 'ri-user-3-fill',          deep: '#1e6dd6', bright: '#5fc8ff', accent: 'linear-gradient(135deg,#1e6dd6 0%,#5fc8ff 100%)', tint: 'rgba(95,200,255,0.14)', value: assignedCount },
    { key: 'inactive',  label: 'Inactive',        icon: 'ri-forbid-fill',          deep: '#d63a5e', bright: '#ff8b9b', accent: 'linear-gradient(135deg,#d63a5e 0%,#ff8b9b 100%)', tint: 'rgba(255,139,155,0.12)', value: inactiveCount },
  ];

  return <MpKpiCards items={KPIS.map(k => ({ key: k.key, label: k.label, icon: k.icon, value: k.value }))} />;
}

function KpiExtras({ records }: { records: any[] }) {
  const total = records.length;
  const numCount       = records.filter(r => /numeric|number/i.test(String(r.target_type ?? ''))).length;
  const currencyCount  = records.filter(r => /currency/i.test(String(r.target_type ?? ''))).length;
  const booleanCount   = records.filter(r => /boolean|done/i.test(String(r.target_type ?? ''))).length;
  const highCount      = records.filter(r => /high|critical/i.test(String(r.priority ?? ''))).length;

  const KPIS = [
    { key: 'total',     label: 'Total KPIs',           sub: 'All KPIs',         icon: 'ri-bar-chart-2-fill',   tag: 'ALL',  deep: '#3d4eb1', bright: '#6691e7', accent: 'linear-gradient(135deg,#3d4eb1 0%,#6691e7 100%)', value: total },
    { key: 'numeric',   label: 'Number Target',        sub: 'Number Target',    icon: 'ri-hashtag',            tag: 'NUM',  deep: '#1d4ed8', bright: '#60a5fa', accent: 'linear-gradient(135deg,#1d4ed8 0%,#60a5fa 100%)', value: numCount },
    { key: 'currency',  label: 'Currency Target',      sub: 'Currency Target',  icon: 'ri-money-dollar-circle-fill', tag: 'CUR', deep: '#0f766e', bright: '#2dd4bf', accent: 'linear-gradient(135deg,#0f766e 0%,#2dd4bf 100%)', value: currencyCount },
    { key: 'boolean',   label: 'Done/Not Done Target', sub: 'Done/Not Done',    icon: 'ri-check-double-fill',  tag: 'D/N',  deep: '#6d28d9', bright: '#a78bfa', accent: 'linear-gradient(135deg,#6d28d9 0%,#a78bfa 100%)', value: booleanCount },
    { key: 'priority',  label: 'High Priority',        sub: 'Priority Level',   icon: 'ri-alarm-warning-fill', tag: 'HIGH', deep: '#b91c1c', bright: '#ef4444', accent: 'linear-gradient(135deg,#b91c1c 0%,#ef4444 100%)', value: highCount },
  ];

  return (
    <div className="kpi-extras">

      <div className="kpi-cards">
        {KPIS.map(k => (
          <div
            className="kpi-card"
            key={k.key}
            title={k.label}
            style={{
              ['--kpi-deep' as any]: k.deep,
              ['--kpi-bright' as any]: k.bright,
              ['--kpi-accent' as any]: k.accent,
            }}
          >
            <div className="kpi-card-text">
              <span className="kpi-card-label">{k.label}</span>
              <span className="kpi-card-num">{k.value}</span>
            </div>
            <span
              className="kpi-card-icon"
              style={{
                background: k.accent,
                boxShadow: `0 4px 10px ${k.bright}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
              }}
            >
              <i className={k.icon} />
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}

function KpiInlineFilters({
  refData,
  roleFilter,     setRoleFilter,
  targetFilter,   setTargetFilter,
  priorityFilter, setPriorityFilter,
}: {
  refData: Record<string, any[]>;
  roleFilter: string;
  setRoleFilter: (v: string) => void;
  targetFilter: string;
  setTargetFilter: (v: string) => void;
  priorityFilter: string;
  setPriorityFilter: (v: string) => void;
}) {
  const TARGETS = ['Numeric', 'Percentage', 'Currency', 'Boolean', 'Date-based', 'Rating'];
  const PRIORITIES = ['Critical', 'High', 'Medium', 'Low'];
  const roles = refData['roles'] || [];
  return (
    <div className="kpi-inline-filters d-flex align-items-center flex-wrap" style={{ gap: 12 }}>
      <div className="kpi-il-group">
        <span className="kpi-il-label">Role</span>
        <div style={{ minWidth: 150 }}>
          <MasterSelect
            value={roleFilter}
            onChange={(v) => setRoleFilter(v || 'all')}
            options={[
              { value: 'all', label: 'All Roles' },
              ...roles.map((r: any) => ({ value: String(r.id), label: String(r.name) })),
            ]}
            placeholder="All Roles"
          />
        </div>
      </div>
      <div className="kpi-il-group">
        <span className="kpi-il-label">Target</span>
        <div style={{ minWidth: 140 }}>
          <MasterSelect
            value={targetFilter}
            onChange={(v) => setTargetFilter(v || 'all')}
            options={[{ value: 'all', label: 'All Types' }, ...TARGETS.map(t => ({ value: t, label: t }))]}
            placeholder="All Types"
          />
        </div>
      </div>
      <div className="kpi-il-group">
        <span className="kpi-il-label">Priority</span>
        <div style={{ minWidth: 120 }}>
          <MasterSelect
            value={priorityFilter}
            onChange={(v) => setPriorityFilter(v || 'all')}
            options={[{ value: 'all', label: 'All' }, ...PRIORITIES.map(p => ({ value: p, label: p }))]}
            placeholder="All"
          />
        </div>
      </div>
    </div>
  );
}

function iconForField(f: FieldDef): string {
  const n = (f.n || '').toLowerCase();
  if (f.ref) return 'ri-links-line';
  if (f.t === 'email' || n.includes('email')) return 'ri-mail-line';
  if (n.includes('phone') || n.includes('mobile') || n.includes('whatsapp')) return 'ri-phone-line';
  if (n === 'name' || n.endsWith('_name') || n.includes('title') || n.includes('holder')) return 'ri-user-3-line';
  if (n.includes('address')) return 'ri-map-pin-line';
  if (n === 'city' || n === 'taluka' || n === 'district') return 'ri-map-2-line';
  if (n.includes('state') || n.includes('country') || n.includes('region')) return 'ri-earth-line';
  if (n.includes('pincode') || n.includes('postal') || n.includes('zip')) return 'ri-mail-send-line';
  if (n.includes('website') || n.includes('url') || n === 'domain') return 'ri-global-line';
  if (n.includes('gst') || n.includes('pan') || n === 'iec' || n === 'cin' || n.includes('tax')) return 'ri-file-list-3-line';
  if (n.includes('bank') || n.includes('account_number')) return 'ri-bank-line';
  if (n.includes('ifsc') || n.includes('swift') || n.includes('short_code') || (n.includes('code') && !n.includes('country'))) return 'ri-qr-code-line';
  if (n.includes('price') || n.includes('amount') || n.includes('fee') || n.includes('cost') || n.includes('rate') || n.includes('salary')) return 'ri-money-rupee-circle-line';
  if (n === 'status') return 'ri-pulse-line';
  if (n.includes('description') || n.includes('note') || n.includes('detail') || n.includes('remark')) return 'ri-file-text-line';
  if (n.includes('logo') || n.includes('image') || n.includes('icon') || n.includes('photo')) return 'ri-image-line';
  if (n.includes('quantity') || n === 'qty' || n.includes('count')) return 'ri-hashtag';
  if (n.includes('currency')) return 'ri-coins-line';
  if (n.includes('weight')) return 'ri-scales-line';
  if (n.includes('color') || n.includes('colour')) return 'ri-palette-line';
  if (n.includes('category') || n.includes('type')) return 'ri-price-tag-3-line';
  if (n === 'slug') return 'ri-link';
  if (f.t === 'textarea') return 'ri-align-left';
  if (f.t === 'number') return 'ri-hashtag';
  if (f.t === 'date' || n.includes('date') || n.endsWith('_at')) return 'ri-calendar-line';
  if (f.t === 'select') return 'ri-list-check-2';
  return 'ri-edit-box-line';
}

function CharCount({ name, max }: { name: string; max: number }) {
  const ref = useRef<HTMLSpanElement | null>(null);
  const [len, setLen] = useState(0);

  useEffect(() => {
    const el = ref.current?.closest('.master-field-row')?.querySelector(
      `input[name="${name}"], textarea[name="${name}"]`,
    ) as HTMLInputElement | HTMLTextAreaElement | null;
    if (!el) return;
    const read = () => setLen(el.value.length);
    read();
    el.addEventListener('input', read);
    return () => el.removeEventListener('input', read);
  }, [name]);

  const full = len >= max;
  return (
    <span
      ref={ref}
      className="ms-auto fw-semibold"
      style={{
        fontSize: 10.5,
        letterSpacing: '0.02em',
        color: full ? 'var(--vz-danger, #f06548)' : 'var(--vz-secondary-color)',
        opacity: len === 0 ? 0.65 : 1,
      }}
      title={`Up to ${max} characters`}
    >
      {len}/{max}
    </span>
  );
}

export function renderField(
  f: FieldDef,
  i: number,
  editing: any,
  viewOnly: boolean,
  refData: Record<string, any[]>,
  labelFieldForRef: (refSlug: string, fallback?: string) => string,
  fieldErrors: Record<string, string> = {},
  clearFieldError: (name: string) => void = () => {},
  defaultSpan: number = 4,
  allRecords: any[] = [],
  sublistValues: Record<string, any[]> = {},
  onSublistChange: (field: FieldDef, next: any[]) => void = () => {},
  apiAutogen: Record<string, string> = {},
  radioValues: Record<string, string> = {},
  onRadioChange: (name: string, value: string) => void = () => {},
  apiOpts: Record<string, any[]> = {},
): React.ReactNode {
  if (f.sec) {
    return (
      <Col md={12} key={`sec-${i}`}>
        <div className="d-flex align-items-center gap-2 mt-2 mb-1">
          <span className="fw-bold text-uppercase text-primary" style={{ fontSize: 11, letterSpacing: '0.8px' }}>
            {f.sec}
          </span>
          <div className="flex-grow-1" style={{ height: 1, background: 'var(--vz-border-color)' }} />
        </div>
      </Col>
    );
  }

  if (f.t === 'sublist') {
    const items = sublistValues[f.n] || [];
    return (
      <Col md={12} key={f.n || `sub-${i}`}>
        {f.subDesc && (
          <div className="text-muted mb-2" style={{ fontSize: 12 }}>{f.subDesc}</div>
        )}
        <InlineSublist
          field={f}
          value={items}
          viewOnly={viewOnly}
          onChange={(next) => onSublistChange(f, next)}
        />
      </Col>
    );
  }

  const span = f.full ? 12 : (f.t === 'textarea' || f.t === 'radio') ? 12 : defaultSpan;
  const isAutogen = (!!f.autogen || !!f.autogenApi) && !viewOnly;
  const apiAutogenVal = apiAutogen[f.n];
  const autogenVal = (isAutogen && editing == null)
    ? (apiAutogenVal || (f.autogen ? f.autogen(allRecords) : ''))
    : '';
  const rawDefaultVal = (isAutogen && editing == null) ? autogenVal : (editing?.[f.n] ?? '');
  const defaultVal = (() => {
    if (f.t !== 'number' || rawDefaultVal === '' || rawDefaultVal == null) return rawDefaultVal;
    const s = String(rawDefaultVal);
    const m = s.match(/^-?\d+/);
    return m ? m[0].replace(/^-/, '') : '';
  })();
  const err = fieldErrors[f.n];
  const onFieldChange = () => clearFieldError(f.n);
  const icon = isAutogen ? 'ri-magic-line' : iconForField(f);
  const isTextarea = f.t === 'textarea';
  const isSelect = !!(f.ref || f.t === 'select');

  let input: React.ReactNode;
  if (f.ref) {
    const rows = refData[f.ref] || [];
    const labelField = f.refL || labelFieldForRef(f.ref);
    const buildLabel = (r: any): string => {
      if (f.refLFmt) {
        return f.refLFmt
          .replace(/\{(\w+)\}/g, (_m: string, k: string) => {
            const v = r[k];
            return v == null || v === '' ? '' : String(v);
          })
          .replace(/\s*\(\)\s*/g, '')
          .trim() || String(r[labelField] ?? r.id);
      }
      return String(r[labelField] ?? r.id);
    };
    let refRows = (f.ref === undefined || editing == null)
      ? rows
      : rows.filter((r: any) => String(r.id) !== String(editing.id));
    // Inactive master rows are not offered for new picks; the value already
    // saved on the record stays listed so editing doesn't silently drop it.
    refRows = refRows.filter((r: any) =>
      mpStatusOf(r) === 'active' || (defaultVal != null && String(r.id) === String(defaultVal)));
    const cascadeKey = (f as any).cascadeFrom as string | undefined;
    if (cascadeKey) {
      const srcVal = radioValues[cascadeKey] ?? (editing != null ? String(editing[cascadeKey] ?? '') : '');
      if (srcVal) refRows = refRows.filter((r: any) => String(r[cascadeKey] ?? '') === String(srcVal));
    }
    let options = refRows.map((r: any) => ({
      value: String(r.id),
      label: buildLabel(r),
    }));
    if (f.noneLabel) {
      options = [{ value: '', label: f.noneLabel }, ...options];
    }
    input = (
      <MasterSelect
        name={f.n}
        defaultValue={defaultVal == null ? '' : String(defaultVal)}
        options={options}
        placeholder={f.noneLabel || `Select ${f.l}…`}
        disabled={viewOnly}
        invalid={!!err}
        onChange={(v) => { onFieldChange(); onRadioChange(f.n, v); }}
      />
    );
  } else if (f.t === 'select') {
    let options = f.optsApi ? normalizeOpts(apiOpts[f.n] || []) : normalizeOpts(f.opts);
    // Keep an already-saved value listed even if it's no longer among the loaded options.
    if (f.optsApi && defaultVal != null && String(defaultVal) !== '' && !options.some(o => String(o.value) === String(defaultVal))) {
      options = [{ value: String(defaultVal), label: String(defaultVal) }, ...options];
    }
    if (f.noneLabel) {
      options = [{ value: '', label: f.noneLabel }, ...options];
    }
    const selectDefault = typeof defaultVal === 'boolean' ? (defaultVal ? '1' : '0') : defaultVal;
    input = (
      <MasterSelect
        name={f.n}
        defaultValue={selectDefault != null && String(selectDefault) !== ''
          ? String(selectDefault)
          : (f.r ? (options[0]?.value ?? '') : '')}
        options={options}
        placeholder={f.noneLabel || 'Select…'}
        disabled={viewOnly}
        invalid={!!err}
        onChange={(v) => { onFieldChange(); onRadioChange(f.n, v); }}
      />
    );
  } else if (f.t === 'radio' && f.segmented) {
    const options = normalizeOpts(f.opts);
    const current = radioValues[f.n] ?? (defaultVal ? String(defaultVal) : (options[0]?.value ?? ''));
    input = (
      <div className="mp-seg" role="radiogroup" aria-label={f.l}>
        {options.map((o) => {
          const checked = String(current) === String(o.value);
          return (
            <label key={o.value} className={`mp-seg__opt${checked ? ' is-on' : ''}${viewOnly ? ' is-disabled' : ''}`}>
              <input
                type="radio"
                name={f.n}
                value={o.value}
                checked={checked}
                disabled={viewOnly}
                onChange={() => {
                  onRadioChange(f.n, String(o.value));
                  onFieldChange();
                }}
              />
              <span className="mp-seg__dot" />
              {o.label}
            </label>
          );
        })}
      </div>
    );
  } else if (f.t === 'radio') {
    const options = normalizeOpts(f.opts);
    const current = radioValues[f.n] ?? (defaultVal ? String(defaultVal) : (options[0]?.value ?? ''));
    input = (
      <div className="d-flex flex-column gap-2" style={{ paddingTop: 4 }}>
        {options.map((o) => {
          const checked = String(current) === String(o.value);
          const desc = f.optDesc?.[o.value];
          return (
            <label
              key={o.value}
              className="d-flex align-items-start gap-2"
              style={{
                padding: '10px 12px',
                border: `1.5px solid ${checked ? 'var(--vz-primary)' : '#94a3b8'}`,
                background: checked ? 'rgba(64,81,137,0.05)' : 'transparent',
                borderRadius: 8,
                cursor: viewOnly ? 'not-allowed' : 'pointer',
                transition: 'all 0.15s ease',
              }}
            >
              <input
                type="radio"
                name={f.n}
                value={o.value}
                checked={checked}
                disabled={viewOnly}
                onChange={() => {
                  onRadioChange(f.n, String(o.value));
                  onFieldChange();
                }}
                style={{ marginTop: 3, accentColor: 'var(--vz-primary)' }}
              />
              <span className="d-flex flex-column">
                <span style={{ fontSize: 13, fontWeight: 500, color: 'var(--vz-body-color)' }}>{o.label}</span>
                {desc && (
                  <span style={{ fontSize: 11.5, color: 'var(--vz-secondary-color)', marginTop: 2 }}>
                    {desc}
                  </span>
                )}
              </span>
            </label>
          );
        })}
      </div>
    );
  } else if (f.t === 'textarea') {
    input = (
      <Input
        type="textarea"
        name={f.n}
        rows={3}
        placeholder={f.p}
        maxLength={typeof (f as any).maxLen === 'number' ? (f as any).maxLen : undefined}
        defaultValue={defaultVal}
        disabled={viewOnly}
        invalid={!!err}
        onInput={onFieldChange}
      />
    );
  } else if (f.t === 'date') {
    const todayIso = new Date().toISOString().slice(0, 10);
    input = (
      <MasterDatePicker
        name={f.n}
        defaultValue={defaultVal ? String(defaultVal) : ''}
        placeholder={f.p || 'Select date'}
        disabled={viewOnly}
        invalid={!!err}
        onChange={onFieldChange}
        minDate={f.futureOnly ? todayIso : undefined}
      />
    );
  } else if (f.t === 'file') {
    const isEdit = !!editing;
    const hintParts: string[] = [];
    if (f.accept) hintParts.push(f.accept);
    if (f.maxMb) hintParts.push(`Max ${f.maxMb}MB`);
    const existingPath: string | null = editing
      ? (editing[`${f.n}_path`] || editing[f.n] || null)
      : null;
    const serverUrl: string | null = editing
      ? (editing[`${f.n}_path_url`] || editing[`${f.n}_url`] || null)
      : null;
    const existingUrl = serverUrl || (existingPath ? resolveFileUrl(existingPath) : '');
    const existingName = existingPath ? String(existingPath).split('/').pop() : '';
    input = (
      <>
        {existingUrl && (
          <a
            href={existingUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="d-inline-flex align-items-center gap-1 mb-2 text-decoration-none"
            style={{
              fontSize: 12, fontWeight: 600,
              padding: '5px 10px', borderRadius: 8,
              background: 'rgba(10,179,156,0.10)', color: '#0a8a78',
              border: '1px solid rgba(10,179,156,0.30)',
            }}
            title={`View existing file (${existingName})`}
          >
            <i className="ri-attachment-line" />
            <span style={{ maxWidth: 220, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {existingName || 'View existing file'}
            </span>
            <i className="ri-external-link-line" style={{ fontSize: 11 }} />
          </a>
        )}
        <MasterFileInput
          name={f.n}
          accept={f.accept}
          required={f.r && !isEdit}
          disabled={viewOnly}
          invalid={!!err}
          onChange={() => onFieldChange()}
        />
        {hintParts.length > 0 && (
          <small className="master-file-hint">
            {hintParts.join(' · ')}
            {existingUrl && ' · upload a new file to replace the one above'}
          </small>
        )}
      </>
    );
  } else {
    const SKIP_AUTOCAP_FIELDS = new Set([
      'code', 'iso_code', 'state_code', 'short_code', 'hsn_code',
      'gstin', 'pan', 'tan', 'cin', 'iec',
      'ifsc_code', 'swift_code', 'ad_code',
      'email', 'website', 'url', 'domain', 'phone', 'mobile', 'whatsapp',
      'pincode', 'postal_code', 'zip',
    ]);
    const shouldAutoCap = f.t === 'text' && !isAutogen && !SKIP_AUTOCAP_FIELDS.has(f.n);
    const NUMERIC_ONLY_FIELDS = new Set(['hsn_code']);
    const isNumericOnly = f.t === 'text' && NUMERIC_ONLY_FIELDS.has(f.n);

    const handleInput = (e: React.FormEvent<HTMLInputElement>) => {
      if (isNumericOnly) {
        const target = e.currentTarget;
        const v = target.value;
        const cleaned = v.replace(/\D/g, '');
        if (cleaned !== v) {
          const cursor = target.selectionStart;
          target.value = cleaned;
          if (cursor != null) {
            const next = Math.min(cursor, cleaned.length);
            target.setSelectionRange(next, next);
          }
        }
      } else if (shouldAutoCap) {
        const target = e.currentTarget;
        const v = target.value;
        const idx = v.search(/[a-zA-Z]/);
        if (idx !== -1 && v[idx] !== v[idx].toUpperCase()) {
          const cursor = target.selectionStart;
          target.value = v.slice(0, idx) + v[idx].toUpperCase() + v.slice(idx + 1);
          if (cursor != null) target.setSelectionRange(cursor, cursor);
        }
      }
      if (f.t === 'number') {
        const target = e.currentTarget;
        let cleaned = target.value.replace(/[^\d.]/g, '');
        const firstDot = cleaned.indexOf('.');
        if (firstDot !== -1) {
          cleaned = cleaned.slice(0, firstDot + 1) + cleaned.slice(firstDot + 1).replace(/\./g, '');
        }
        if (target.value !== cleaned) {
          const cursor = Math.max(0, (target.selectionStart ?? cleaned.length) - (target.value.length - cleaned.length));
          target.value = cleaned;
          try { target.setSelectionRange(cursor, cursor); } catch {}
        }
      }
      onFieldChange();
    };

    const handleNumberKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (f.t !== 'number') return;
      if (['e', 'E', '+', '-', ','].includes(e.key)) {
        e.preventDefault();
      }
    };

    const TEXT_MAX = 50;
    const maxLength =
      f.t === 'text' && !isAutogen
        ? (typeof (f as any).maxLen === 'number' ? (f as any).maxLen : TEXT_MAX)
        : undefined;

    const numMin = f.t === 'number'
      ? (typeof (f as any).min === 'number' ? (f as any).min : 0)
      : undefined;
    const numMax = f.t === 'number'
      ? (typeof (f as any).max === 'number' ? (f as any).max : 999999999)
      : undefined;

    input = (
      <Input
        type={f.t === 'email' ? 'email' : f.t === 'number' ? 'number' : 'text'}
        name={f.n}
        placeholder={f.p}
        maxLength={maxLength}
        min={numMin}
        max={numMax}
        inputMode={(f.t === 'number' || isNumericOnly) ? 'numeric' : undefined}
        key={isAutogen ? autogenVal : undefined}
        defaultValue={defaultVal}
        disabled={viewOnly}
        readOnly={isAutogen || !!f.auto}
        invalid={!!err}
        onInput={handleInput}
        onKeyDown={handleNumberKeyDown}
        className={f.auto ? 'master-field-auto' : undefined}
      />
    );
  }
  const optTag = f.optionalLabel;
  const isMandatoryTag = !!optTag && /mandator/i.test(optTag);

  const textCap = (f.t === 'text' || (f.t === 'textarea' && typeof (f as any).maxLen === 'number'))
    && !isAutogen && !f.auto && !viewOnly
      ? (typeof (f as any).maxLen === 'number' ? (f as any).maxLen : 50)
      : null;

  return (
    <Col md={span} key={f.n || `f-${i}`} className="master-field-row">
      <Label className="d-flex align-items-center gap-2">
        {f.icon && <i className={f.icon} style={{ fontSize: 13, color: 'var(--vz-secondary-color)' }} />}
        <span>{f.l}{f.r && <span className="req-star">*</span>}</span>
        {isTextarea && textCap !== null && f.n && <CharCount name={f.n} max={textCap} />}
        {optTag && (
          <span
            className="text-uppercase fw-semibold"
            style={{
              fontSize: 9.5,
              letterSpacing: '0.06em',
              color: isMandatoryTag ? 'var(--vz-danger, #f06548)' : 'var(--vz-secondary-color)',
            }}
          >
            {optTag}
          </span>
        )}
        {isAutogen && (
          <span
            className="badge rounded-pill text-uppercase fw-semibold"
            style={{
              fontSize: 9.5,
              letterSpacing: '0.06em',
              padding: '3px 8px',
              background: 'linear-gradient(135deg,#22d3ee,#0891b2)',
              color: '#fff',
              boxShadow: '0 2px 6px rgba(8,145,178,0.30)',
            }}
            title={editing == null
              ? 'Auto-generated — increments from the highest existing code'
              : 'Auto-generated — locked once a record is created'}
          >
            <i className="ri-magic-line" style={{ fontSize: 10, marginRight: 3 }} />Auto
          </span>
        )}
      </Label>
      {f.t === 'file' || f.t === 'radio' ? (
        <div>{input}</div>
      ) : (
        <div className={`master-field${isTextarea ? ' ta' : ''}${isSelect ? ' sel' : ''}`}>
          <i className={`${icon} master-field-icon${isTextarea ? ' ta' : ''}`} />
          {input}
        </div>
      )}
      {err && <FormFeedback style={{ display: 'block', fontSize: 11.5, marginTop: 4 }}>{err}</FormFeedback>}
    </Col>
  );
}
