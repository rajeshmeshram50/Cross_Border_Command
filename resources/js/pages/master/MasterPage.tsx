import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Row, Col,
  Button, Input, Label, Form, FormFeedback,
  Modal, ModalBody, ModalHeader, ModalFooter, Spinner,
} from 'reactstrap';
import api from '../../api';
import MasterPlaceholder from '../MasterPlaceholder';
import TableContainer from '../../velzon/Components/Common/TableContainerReactTable';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  getMasterConfig,
  masterEndpoint,
  normalizeOpts,
  type FieldDef,
  type MasterConfig,
} from './masterConfigs';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from './masterFormKit';

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

  // Refresh user perms on every master page mount. Without this, a branch user
  // whose client admin just changed their permissions in another tab still uses
  // the stale `permissions` map cached in localStorage — so the Add button might
  // appear (or stay hidden) even after the change. Backend authorizeMaster() is
  // the source of truth, but matching the UI to current perms avoids confusion.
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg.slug]);
  const toast = useToast();
  const [records, setRecords] = useState<any[]>([]);
  const [refData, setRefData] = useState<Record<string, any[]>>({});
  const [loading, setLoading] = useState(false);

  // Module-level capabilities for the current master, resolved against the
  // permission map returned by /me. Module slugs in the DB are prefixed with
  // `master.` (e.g. `master.countries`), matching MasterPlaceholder + Sidebar.
  // Super admins bypass the granular permission table entirely.
  const isSuperAdmin = user?.user_type === 'super_admin';
  const fullSlug = `master.${cfg.slug}`;
  const modulePerm = user?.permissions?.[fullSlug];
  const caps = useMemo(() => ({
    view:   isSuperAdmin || !!modulePerm?.can_view,
    add:    isSuperAdmin || !!modulePerm?.can_add,
    edit:   isSuperAdmin || !!modulePerm?.can_edit,
    delete: isSuperAdmin || !!modulePerm?.can_delete,
    export: isSuperAdmin || !!modulePerm?.can_export,
    import: isSuperAdmin || !!modulePerm?.can_import,
  }), [isSuperAdmin, modulePerm?.can_view, modulePerm?.can_add, modulePerm?.can_edit, modulePerm?.can_delete, modulePerm?.can_export, modulePerm?.can_import]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  const [searchInput, setSearchInput] = useState('');
  // Designation-master-specific filter state. Only used when cfg.slug === 'designations'.
  const [dsnStatusFilter, setDsnStatusFilter] = useState<string>('all');
  const [dsnLevelFilter, setDsnLevelFilter] = useState<string>('all');
  const [dsnDeptFilter, setDsnDeptFilter] = useState<string>('all');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const clearFieldError = (name: string) => {
    setFieldErrors(prev => {
      if (!prev[name]) return prev;
      const n = { ...prev };
      delete n[name];
      return n;
    });
  };

  // Ownership columns injected by role:
  //  - super_admin      -> Client | Branch | Created By
  //  - client_admin/user -> Branch | Created By
  //  - branch_user      -> Created By
  // These columns render directly from the API (rows include client_name, branch_name, creator_name).
  const ownershipCols = useMemo<{ key: string; label: string }[]>(() => {
    const ut = user?.user_type;
    if (ut === 'super_admin') {
      return [
        { key: '__client',  label: 'Client' },
        { key: '__branch',  label: 'Branch' },
        { key: '__creator', label: 'Created By' },
      ];
    }
    if (ut === 'client_admin') {
      return [
        { key: '__branch',  label: 'Branch' },
        { key: '__creator', label: 'Created By' },
      ];
    }
    if (ut === 'branch_user') {
      return [{ key: '__creator', label: 'Created By' }];
    }
    return [];
  }, [user?.user_type]);

  // ref masters referenced by this master's fields
  const refSlugs = useMemo(() => {
    const set = new Set<string>();
    for (const f of cfg.fields) if (f.ref) set.add(f.ref);
    return [...set];
  }, [cfg]);

  // Group fields by section header (so each section becomes a tinted card in the modal).
  // A field with `sec` starts a new group; subsequent non-sec fields belong to it.
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

  // Shrink the modal + widen each field when the form only has a handful of inputs.
  // ≤ 4 fields → default (500px) with fields stacked, 5–9 → lg (800px), 10+ → xl (1140px).
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
    // Self-references resolve from the live `records` list. refData is loaded
    // once on mount and not re-fetched after add/edit/delete, so it can drift
    // out of sync with the master's own data — e.g. a brand-new parent row
    // created seconds ago wouldn't be in refData yet, so the column would show
    // the raw id instead of the name.
    const rows = refSlug === cfg.slug ? records : (refData[refSlug] || []);
    const row = rows.find(r => String(r.id) === String(value));
    if (!row) return String(value ?? '');
    const lf = refLabel || labelFieldForRef(refSlug);
    return String(row[lf] ?? value);
  };

  // Refetches every referenced master's rows. Used both on initial mount AND
  // every time the form modal opens — that way a department added in another
  // master shows up in this master's Department dropdown without a page reload.
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

  // Load records whenever cfg changes
  useEffect(() => {
    let aborted = false;
    setLoading(true);
    setEditingId(null);
    setViewOnly(false);
    setModalOpen(false);
    setRecords([]);

    const loadRecords = api.get(masterEndpoint(cfg)).then(r => {
      if (!aborted) setRecords(Array.isArray(r.data) ? r.data : []);
    }).catch(() => { if (!aborted) setRecords([]); });

    const loadRefs = fetchRefs();

    Promise.all([loadRecords, loadRefs]).finally(() => { if (!aborted) setLoading(false); });

    return () => { aborted = true; };
  }, [cfg.slug, refSlugs.join('|')]);

  const editing = editingId != null ? records.find(r => r.id === editingId) : null;

  // Records scoped to the *exact* tenant tuple (client_id, branch_id) the
  // current user would stamp onto a new row. Used by `autogen` so number
  // sequences (e.g. DEPT-001, DEPT-002) restart per client/branch instead of
  // running globally across the visible rows. List view, KPIs and search
  // continue to use `records` / `filteredRecords` so users still see every
  // shared row they're permitted to view.
  const tenantScopedRecords = useMemo(() => {
    if (!user) return [];
    const eq = (a: any, b: any) => String(a ?? '') === String(b ?? '');
    if (user.user_type === 'super_admin') {
      // Super-admin adds default to (null, null) — the "global" pool.
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

  // Filter rows by search input across all column accessors + ownership fields
  const filteredRecords = useMemo(() => {
    const q = searchInput.trim().toLowerCase();
    const isDsn = cfg.slug === 'designations';
    const searchableKeys = [
      ...cfg.cols,
      'client_name', 'branch_name', 'creator_name',
    ];
    return records.filter(row => {
      // Designation-master extra filters: Status / Level / Dept dropdowns.
      if (isDsn) {
        if (dsnStatusFilter !== 'all') {
          if (String(row.status ?? '').toLowerCase() !== dsnStatusFilter.toLowerCase()) return false;
        }
        if (dsnLevelFilter !== 'all') {
          if (String(row.level ?? '') !== dsnLevelFilter) return false;
        }
        if (dsnDeptFilter !== 'all') {
          if (String(row.department_id ?? '') !== String(dsnDeptFilter)) return false;
        }
      }
      if (!q) return true;
      for (const key of searchableKeys) {
        const f = cfg.fields.find(ff => ff.n === key);
        const val = f?.ref ? resolveRefLabel(f.ref, f.refL, row[key]) : row[key];
        if (val != null && String(val).toLowerCase().includes(q)) return true;
      }
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, searchInput, cfg, refData, dsnStatusFilter, dsnLevelFilter, dsnDeptFilter]);

  // Effective ref-data passed to renderField. For self-referential refs (e.g.
  // Designation's "Reports To" → Designations) we want the dropdown to reflect
  // the user's *current* records (so a freshly-added designation appears as a
  // valid manager immediately). When the master has no rows yet, fall back to
  // the seed data so the dropdown is never empty during onboarding.
  const effectiveRefData = useMemo(() => {
    const next: Record<string, any[]> = { ...refData };
    const selfList = records.length > 0 ? records : (cfg.data || []);
    if (selfList.length > 0) next[cfg.slug] = selfList;
    // Also seed any other ref this config points at when its API came back empty.
    for (const f of cfg.fields) {
      if (f.ref && (!next[f.ref] || next[f.ref].length === 0)) {
        const refCfg = getMasterConfig(f.ref);
        if (refCfg?.data?.length) next[f.ref] = refCfg.data;
      }
    }
    return next;
  }, [refData, records, cfg]);

  const openAdd = () => {
    setFieldErrors({});
    setEditingId(null);
    setViewOnly(false);
    setModalOpen(true);
    // Refresh referenced masters so dropdowns reflect anything added elsewhere.
    fetchRefs();
  };
  const openEdit = (row: any, readonly = false) => {
    setFieldErrors({});
    setEditingId(row.id);
    setViewOnly(readonly);
    setModalOpen(true);
    fetchRefs();
  };

  // Clients-page style compact action button
  const ActionBtn = ({
    title, icon, color, onClick, disabled,
  }: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) => (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="btn p-0 d-inline-flex align-items-center justify-content-center"
      style={{
        width: 30, height: 30, borderRadius: 8,
        // Disabled gets a clearly different surface: hatched grey with a
        // strike-through cursor and faded icon so it's obvious it's locked.
        background: disabled
          ? 'repeating-linear-gradient(45deg, rgba(15,23,42,0.04), rgba(15,23,42,0.04) 4px, transparent 4px, transparent 8px), var(--vz-secondary-bg)'
          : 'var(--vz-secondary-bg)',
        border: disabled
          ? '1px dashed var(--vz-border-color)'
          : '1px solid var(--vz-border-color)',
        color: disabled
          ? 'rgba(120, 120, 120, 0.5)'
          : 'var(--vz-secondary-color)',
        opacity: disabled ? 0.6 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
        transition: 'all .15s ease',
        position: 'relative',
      }}
      onMouseEnter={e => {
        if (disabled) return;
        const el = e.currentTarget as HTMLButtonElement;
        const tint =
          color === 'primary' ? '#40518918' :
          color === 'danger'  ? '#f0654818' :
          color === 'success' ? '#0ab39c18' :
          color === 'info'    ? '#299cdb18' :
          color === 'warning' ? '#f7b84b18' : 'var(--vz-secondary-bg)';
        el.style.background = tint;
        el.style.borderColor = `var(--vz-${color})`;
        el.style.color = `var(--vz-${color})`;
      }}
      onMouseLeave={e => {
        if (disabled) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.background = 'var(--vz-secondary-bg)';
        el.style.borderColor = 'var(--vz-border-color)';
        el.style.color = 'var(--vz-secondary-color)';
      }}
      onClick={onClick}
    >
      <i className={`${icon} fs-14`} />
      {/* Tiny lock badge in the bottom-right corner when disabled */}
      {disabled && (
        <span
          aria-hidden="true"
          style={{
            position: 'absolute',
            bottom: -3, right: -3,
            width: 13, height: 13,
            borderRadius: '50%',
            background: 'var(--vz-secondary-color)',
            color: 'var(--vz-secondary-bg)',
            fontSize: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: '1.5px solid var(--vz-card-bg)',
          }}
        >
          <i className="ri-lock-fill" />
        </span>
      )}
    </button>
  );

  const validateForm = (fd: FormData): Record<string, string> => {
    const errs: Record<string, string> = {};
    for (const f of cfg.fields) {
      if (f.sec || !f.n) continue;
      // Auto-generated fields are filled by the server, never the user.
      if (f.auto) continue;
      const raw = String(fd.get(f.n) ?? '').trim();
      if (f.r && !raw) {
        errs[f.n] = `${f.l} is required`;
        continue;
      }
      if (!raw) continue;
      if (f.t === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
        errs[f.n] = 'Please enter a valid email address';
      } else if (f.t === 'number' && isNaN(Number(raw))) {
        errs[f.n] = 'Must be a valid number';
      } else if (f.n === 'gstin' && !/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}Z[0-9A-Z]{1}$/.test(raw.toUpperCase())) {
        errs[f.n] = 'Invalid GSTIN — must be 15 characters (e.g. 27AADCI6120M1ZH)';
      } else if (f.n === 'ifsc_code' && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(raw.toUpperCase())) {
        errs[f.n] = 'Invalid IFSC — must be 11 characters (e.g. HDFC0000350)';
      }
    }
    return errs;
  };

  const handleSave = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);

    const errs = validateForm(fd);
    if (Object.keys(errs).length > 0) {
      setFieldErrors(errs);
      const count = Object.keys(errs).length;
      toast.error('Validation Error', `${count} field${count === 1 ? '' : 's'} need attention`);
      return;
    }
    setFieldErrors({});

    const payload: Record<string, any> = {};
    for (const f of cfg.fields) {
      if (f.sec || !f.n) continue;
      const raw = fd.get(f.n);
      if (f.t === 'number') {
        payload[f.n] = raw == null || raw === '' ? null : Number(raw);
      } else {
        const s = String(raw ?? '').trim();
        payload[f.n] = s === '' ? null : s;
      }
    }

    setSaving(true);
    try {
      const base = masterEndpoint(cfg);
      if (editingId != null) {
        const { data } = await api.put(`${base}/${editingId}`, payload);
        setRecords(prev => prev.map(r => r.id === editingId ? data : r));
        toast.success('Updated', `${cfg.titleSingular || cfg.title} updated successfully`);
      } else {
        const { data } = await api.post(base, payload);
        setRecords(prev => [data, ...prev]);
        toast.success('Created', `${cfg.titleSingular || cfg.title} created successfully`);
      }
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
    setDeleting(true);
    try {
      await api.delete(`${masterEndpoint(cfg)}/${deleteTarget.id}`);
      setRecords(prev => prev.filter(r => r.id !== deleteTarget.id));
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

    if (fieldName === 'status') {
      const active = String(raw).toLowerCase() === 'active';
      const tone = active
        ? { bg: '#d6f6ee', fg: '#0a8a78', border: '#0ab39c', text: 'Active' }
        : { bg: '#fdd9d4', fg: '#b6423a', border: '#f06548', text: raw || 'Inactive' };
      return (
        <span
          className="d-inline-block rounded-pill text-uppercase"
          style={{
            background: tone.bg,
            color: tone.fg,
            border: `1px solid ${tone.border}55`,
            padding: '3px 11px',
            fontSize: '0.7rem',
            fontWeight: 700,
            letterSpacing: '0.06em',
            lineHeight: 1.3,
            whiteSpace: 'nowrap',
          }}
        >
          {tone.text}
        </span>
      );
    }

    // Reports-To column: show the manager's name with a colored bullet (matches
    // reference design "● CEO" / "● VP Engineering"). Falls through to the
    // generic ref renderer if not a designations master.
    if (fieldName === 'reports_to_id' && f?.ref === 'designations') {
      const label = resolveRefLabel(f.ref, f.refL, raw);
      if (!label) return <span className="text-muted">—</span>;
      return (
        <span className="d-inline-flex align-items-center gap-1">
          <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#6691e7', display: 'inline-block' }} />
          <span className="text-body">{label}</span>
        </span>
      );
    }

    if (f?.ref) {
      return <span className="text-body">{resolveRefLabel(f.ref, f.refL, raw) || '—'}</span>;
    }

    if (raw === undefined || raw === null || raw === '') {
      return <span className="text-muted">—</span>;
    }

    // "code"-type identifiers (DGN-001, INMAA, USD, FOB, etc.) — amber chip,
    // typography matched 1:1 with the Designation Level chip.
    if (fieldName === 'code') {
      return (
        <span
          className="rounded-pill d-inline-block"
          style={{
            background: '#fff4d8',
            color: '#b97a00',
            border: '1px solid #f7b84b55',
            padding: '2px 8px',
            fontSize: '10.5px',
            fontWeight: 500,
            lineHeight: 1.3,
            letterSpacing: '0.02em',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
          }}
        >
          {String(raw).toUpperCase()}
        </span>
      );
    }

    // Designation Level — chip styled exactly like the hierarchy strip chips
    // (icon + bold text, fixed bg/fg/border per tier) plus a 5-star rating.
    if (fieldName === 'level') {
      const v = String(raw);
      const TOTAL_STARS = 5;
      const tone =
        /director|ceo/i.test(v)        ? { bg: '#fff4d8', fg: '#b97a00', border: '#f7b84b', star: '#f7b84b', icon: 'ri-vip-crown-fill',  rank: 5, short: 'Director / CEO' } :
        /head|hod/i.test(v)            ? { bg: '#ece6ff', fg: '#5b3fd1', border: '#7c5cfc', star: '#7c5cfc', icon: 'ri-medal-2-fill',    rank: 4, short: 'Head of Department' } :
        /lead|team/i.test(v)           ? { bg: '#dff0ff', fg: '#1e7ec5', border: '#299cdb', star: '#299cdb', icon: 'ri-team-fill',       rank: 3, short: 'Team Leader' } :
        /executive|senior/i.test(v)    ? { bg: '#d6f6ee', fg: '#0a8a78', border: '#0ab39c', star: '#0ab39c', icon: 'ri-user-star-fill',  rank: 2, short: 'Executive' } :
        /employee|mid|junior/i.test(v) ? { bg: '#dff5e8', fg: '#1f8f4d', border: '#28c76f', star: '#28c76f', icon: 'ri-user-3-fill',     rank: 1, short: 'Employee' } :
        /intern|trainee/i.test(v)      ? { bg: '#f0f1f5', fg: '#5b6478', border: '#878a99', star: '#878a99', icon: 'ri-book-open-fill',  rank: 1, short: 'Intern / Trainee' } :
                                         { bg: '#f0f1f5', fg: '#5b6478', border: '#878a99', star: '#878a99', icon: 'ri-circle-line',         rank: 0, short: v };
      return (
        <div
          className="text-center w-100 d-flex flex-column align-items-center justify-content-center"
          style={{ gap: 4 }}
          title={`${tone.rank} of ${TOTAL_STARS} hierarchy rank`}
        >
          <span
            className="d-inline-block rounded-pill"
            style={{
              /* identical to .dsn-hier-chip — same bg, fg, border, font, padding */
              background: tone.bg,
              color: tone.fg,
              border: `1px solid ${tone.border}55`,
              padding: '2px 8px',
              fontSize: '10.5px',
              fontWeight: 500,
              whiteSpace: 'nowrap',
              lineHeight: 1.3,
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

    // Identifier-style fields (GSTIN, PAN, etc.) render in a consistent
    // monospace style regardless of letter case so the column looks uniform.
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

    // Strict identifier heuristic — only render as monospace `<code>` when the
    // value is ALL UPPERCASE alphanumerics (e.g. "INMAA", "USD", "FOB"). This
    // avoids false positives on plain words like "developer" or "soft tech".
    if (typeof raw === 'string' && /^[A-Z0-9]{2,}$/.test(raw.replace(/\s|-/g, ''))) {
      return <code className="text-body" style={{ fontSize: '0.8125rem' }}>{raw}</code>;
    }

    return <span className="text-body">{String(raw)}</span>;
  };

  // Columns for TableContainer (TanStack Table). Built dynamically from cfg.cols + ownershipCols
  // so every master automatically gets the same look as the Clients table (Clients.tsx).
  const columns = useMemo(() => {
    const cols: any[] = [
      {
        header: '#',
        accessorKey: '__index',
        cell: (info: any) => <span className="text-muted fs-13">{info.row.index + 1}</span>,
      },
    ];
    // Icon column — hidden on designations (the level rating already gives a
    // strong visual cue, so the duplicate badge column wastes horizontal space).
    if (cfg.slug !== 'designations') {
      cols.push({
        header: 'Icon',
        accessorKey: '__icon',
        enableGlobalFilter: false,
        cell: () => (
          <div className="avatar-xs">
            <span className={`avatar-title rounded bg-${cfg.iconBg}-subtle text-${cfg.iconColor} fs-4`}>
              <i className={cfg.icon}></i>
            </span>
          </div>
        ),
      });
    }
    cfg.cols.forEach((colName, idx) => {
      // Centered columns — ones whose cells render visually-centered content
      // (the level rating tile, status pill, etc. read better with a centered
      // header so the column reads as a single visual unit).
      const isCentered = colName === 'level';
      cols.push({
        header: () => (
          <div className={isCentered ? 'text-center' : undefined}>
            {cfg.colL[idx] || colName}
          </div>
        ),
        // Accessor: resolve ref labels upfront so TableContainer's global filter can search them.
        accessorFn: (row: any) => {
          const f = cfg.fields.find(ff => ff.n === colName);
          if (f?.ref) return resolveRefLabel(f.ref, f.refL, row[colName]);
          return row[colName];
        },
        id: `col_${colName}`,
        cell: (info: any) => {
          const row = info.row.original;
          // First-column bold rule — but skip for "code" (it has its own pill
          // renderer in formatCell) and "status" (its own status badge).
          if (idx === 0 && colName !== 'status' && colName !== 'code') {
            const f = cfg.fields.find(ff => ff.n === colName);
            const val = f?.ref ? resolveRefLabel(f.ref, f.refL, row[colName]) || '—' : row[colName] ?? '—';
            return <b>{val}</b>;
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
    // Designation-master-only: Employees column. Reads row.employees_count when
    // the backend supplies it (later); falls back to "0 emp" so the column is
    // never empty.
    if (cfg.slug === 'designations') {
      cols.push({
        header: () => <div className="text-center">Employees</div>,
        id: '__employees',
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
    // Created Date column — every Eloquent master row carries a created_at
    // timestamp, so the column is added globally. Renders as "12-Jan-2026".
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
      enableGlobalFilter: false,
      cell: (info: any) => {
        // Hide actions the current user is not allowed to perform on this master.
        // If none are allowed, render an em-dash so the column still aligns.
        const showAny = caps.view || caps.edit || caps.delete;
        const row = info.row.original;
        // ── Hierarchical delete rule (mirrors backend MasterController::destroy) ──
        // super_admin (rank 3) > client_admin/client_user (rank 2) > branch_user (1).
        // A user can only delete records created by users at the SAME or LOWER rank.
        const rank = (t?: string): number => {
          switch (t) {
            case 'super_admin':  return 3;
            case 'client_admin':
            case 'client_user':  return 2;
            case 'branch_user':  return 1;
            default:             return 0;
          }
        };
        const myRank = rank(user?.user_type);
        const creatorRank = rank(row?.creator_user_type);
        // Block delete only when the creator is strictly higher-ranked AND
        // it's not the user's own record. Super admin always passes.
        const blockedByRank =
          user?.user_type !== 'super_admin'
          && row?.created_by
          && row?.created_by !== user?.id
          && creatorRank > myRank;
        const whoLabel = row?.creator_user_type === 'super_admin'   ? 'Super Admin'
                       : row?.creator_user_type === 'client_admin'  ? 'Client Admin'
                       : row?.creator_user_type === 'client_user'   ? 'Client user'
                       : row?.creator_user_type === 'branch_user'   ? 'Branch user'
                       : 'a higher-privileged user';
        const editTooltip   = blockedByRank ? `Cannot edit — created by ${whoLabel}`   : 'Edit';
        const deleteTooltip = blockedByRank ? `Cannot delete — created by ${whoLabel}` : 'Delete';
        return (
          <div className="d-flex gap-1 justify-content-center">
            {caps.view   && <ActionBtn title="View"   icon="ri-eye-line"        color="primary" onClick={() => openEdit(info.row.original, true)} />}
            {caps.edit   && <ActionBtn
              title={editTooltip}
              icon="ri-pencil-line"
              color="info"
              disabled={blockedByRank}
              onClick={() => openEdit(info.row.original)}
            />}
            {caps.delete && <ActionBtn
              title={deleteTooltip}
              icon="ri-delete-bin-line"
              color="danger"
              disabled={blockedByRank}
              onClick={() => handleDeleteClick(info.row.original)}
            />}
            {!showAny && <span className="text-muted">—</span>}
          </div>
        );
      },
    });
    return cols;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, ownershipCols, refData, caps, records]);

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
      return (
        <div>
          <div className="text-body fw-medium">{name}</div>
          {scope && <div className="text-muted fs-11">{scope}</div>}
        </div>
      );
    }
    return null;
  };

  const singular = cfg.titleSingular || cfg.title;

  // Guard direct-URL navigation: users without can_view should not see records,
  // even if the API didn't 403 yet. The sidebar already filters by can_view,
  // but a deep link or stale tab can land here without it.
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
              <Button color="light" onClick={() => navigate('/master')}>
                <i className="ri-arrow-left-line me-1"></i>Back to Master
              </Button>
            </CardBody>
          </Card>
        </Col>
      </Row>
    );
  }

  return (
    <>
      {/* Theme-aware strip + premium dark-mode polish for the designations page. */}
      <style>{`
        .dsn-page-strip {
          background: #ffffff;
          border: 1px solid color-mix(in srgb, var(--vz-border-color) 70%, transparent);
          box-shadow: 0 6px 22px rgba(64,81,137,0.10), 0 2px 6px rgba(64,81,137,0.05);
        }
        [data-bs-theme="dark"] .dsn-page-strip,
        [data-layout-mode="dark"] .dsn-page-strip {
          background: linear-gradient(135deg,
            color-mix(in srgb, var(--vz-card-bg) 88%, #ffffff) 0%,
            var(--vz-card-bg) 100%);
          border: 1px solid color-mix(in srgb, var(--vz-border-color) 50%, #ffffff);
          box-shadow:
            0 8px 26px rgba(0,0,0,0.28),
            0 2px 6px rgba(0,0,0,0.18),
            inset 0 1px 0 rgba(255,255,255,0.04);
        }
        /* Premium dark-mode adjustments for the table card too. */
        [data-bs-theme="dark"] .master-page-card,
        [data-layout-mode="dark"] .master-page-card {
          background: linear-gradient(180deg,
            color-mix(in srgb, var(--vz-card-bg) 94%, #ffffff) 0%,
            var(--vz-card-bg) 100%);
          border: 1px solid color-mix(in srgb, var(--vz-border-color) 50%, #ffffff);
          box-shadow: 0 8px 30px rgba(0,0,0,0.22), inset 0 1px 0 rgba(255,255,255,0.03);
        }
      `}</style>
      {/* Page title — designations gets the rich [icon|title+subtitle][Add] strip;
          departments is rendered headerless (goes straight into KPI/table);
          all other masters keep the original [back][title][breadcrumb] layout. */}
      {cfg.slug !== 'departments' && (
      <Row>
        <Col xs={12}>
          {cfg.slug === 'designations' ? (
            <div
              className="dsn-page-strip d-sm-flex align-items-center justify-content-between flex-wrap gap-3 mb-3"
              style={{
                padding: '16px 20px',
                borderRadius: 14,
              }}
            >
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 46, height: 46,
                    background: 'color-mix(in srgb, #405189 12%, #ffffff)',
                    border: '1px solid color-mix(in srgb, #405189 22%, transparent)',
                  }}
                >
                  <i className={cfg.icon} style={{ color: '#405189', fontSize: 21 }} />
                </span>
                <div className="min-w-0">
                  <h4 className="mb-0 fw-bold" style={{ color: 'var(--vz-heading-color, #2b3245)', letterSpacing: '0.01em' }}>
                    {cfg.title}
                  </h4>
                  <p className="mb-0 text-muted" style={{ fontSize: 12.5, marginTop: 2 }}>
                    Manage all job roles, hierarchy levels, and role structure for employees
                  </p>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-shrink-0">
                <button
                  type="button"
                  onClick={() => navigate('/master')}
                  title="Back to Masters"
                  className="d-inline-flex align-items-center gap-1 rounded-pill"
                  style={{
                    padding: '8px 16px',
                    background: 'color-mix(in srgb, #405189 8%, #ffffff)',
                    color: '#405189',
                    border: '1px solid color-mix(in srgb, #405189 22%, transparent)',
                    fontSize: 13,
                    fontWeight: 600,
                    cursor: 'pointer',
                    transition: 'background 0.18s ease, transform 0.18s ease',
                  }}
                  onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, #405189 14%, #ffffff)'; }}
                  onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, #405189 8%, #ffffff)'; }}
                >
                  <i className="ri-arrow-left-line" style={{ fontSize: 15 }}></i>
                  Back to Masters
                </button>
                {caps.add && (
                  <Button
                    color="secondary"
                    className="btn-label waves-effect waves-light rounded-pill border-0"
                    onClick={openAdd}
                    style={{
                      background: 'linear-gradient(120deg, #405189 0%, #6691e7 100%)',
                      color: '#fff',
                      boxShadow: '0 4px 12px rgba(64,81,137,0.28)',
                    }}
                  >
                    <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                    Add {singular}
                  </Button>
                )}
              </div>
            </div>
          ) : (
            <div className="page-title-box d-sm-flex align-items-center justify-content-between">
              <div className="d-flex align-items-center gap-2">
                <button
                  className={`btn btn-soft-${cfg.iconColor} btn-icon rounded-circle`}
                  style={{ width: 36, height: 36 }}
                  onClick={() => navigate('/master')}
                  title="Back to master"
                >
                  <i className="ri-arrow-left-line fs-16"></i>
                </button>
                <h4 className="mb-sm-0">{cfg.title}</h4>
              </div>
              <div className="page-title-right">
                <ol className="breadcrumb m-0">
                  <li className="breadcrumb-item">
                    <a href="#" onClick={(e) => { e.preventDefault(); navigate('/master'); }}>Master</a>
                  </li>
                  <li className="breadcrumb-item active">{cfg.title}</li>
                </ol>
              </div>
            </div>
          )}
        </Col>
      </Row>
      )}

      {/* "What you are doing here" — hidden on the designations master so the
          page goes straight from the title strip into the KPI/table card. */}
      {cfg.slug !== 'designations' && <WhatYouDoHere cfg={cfg} onAdd={openAdd} canAdd={caps.add} />}

      {/* KPI strip — only when the master config opts in via `kpis` */}
      {cfg.kpis && cfg.kpis.length > 0 && (
        <Row className="g-2 mb-3 align-items-stretch">
          {cfg.kpis.map(k => {
            const value = k.compute(records);
            return (
              <Col key={k.label} xl={2} md={4} sm={6} xs={12}>
                <div
                  style={{
                    borderRadius: 12,
                    border: '1px solid var(--vz-border-color)',
                    background: '#ffffff',
                    boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                    padding: '14px 16px',
                    position: 'relative',
                    overflow: 'hidden',
                    height: '100%',
                  }}
                >
                  <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                  <div className="d-flex align-items-center justify-content-between">
                    <div>
                      <p style={{ fontSize: 10.5, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 6px' }}>
                        {k.label}
                      </p>
                      <h3 style={{ fontSize: 22, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                        {value.toLocaleString()}
                      </h3>
                    </div>
                    <div
                      style={{
                        width: 38, height: 38, borderRadius: 10,
                        background: k.gradient,
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexShrink: 0,
                        boxShadow: '0 4px 10px rgba(0,0,0,0.10)',
                      }}
                    >
                      <i className={k.icon} style={{ fontSize: 18, color: '#fff' }} />
                    </div>
                  </div>
                </div>
              </Col>
            );
          })}
        </Row>
      )}

      {/* Main card — search + Add New row, then table */}
      <Row>
        <Col xs={12}>
          <Card className={`shadow-sm ${cfg.slug === 'designations' ? 'master-page-card' : ''}`} style={{ borderRadius: 16 }}>
            <CardBody>
              {/* Designations-only: KPI strip + hierarchy chips. */}
              {cfg.slug === 'designations' && (
                <DesignationExtras
                  records={records}
                  filteredCount={filteredRecords.length}
                />
              )}

              {/* Search bar (left) + (designation filters + Add New on the right). */}
              <Row className="g-2 align-items-center mb-3">
                <Col md={cfg.slug === 'designations' ? 3 : 6} sm={12}>
                  <div className="search-box">
                    <Input
                      type="text"
                      className="form-control"
                      placeholder={`Search ${cfg.title.toLowerCase()}...`}
                      value={searchInput}
                      onChange={e => setSearchInput(e.target.value)}
                    />
                    <i className="ri-search-line search-icon"></i>
                  </div>
                </Col>
                <Col md={cfg.slug === 'designations' ? 9 : 6} sm={12} className="d-flex justify-content-md-end align-items-center flex-wrap" style={{ gap: 12 }}>
                  {cfg.slug === 'designations' && (
                    <DesignationInlineFilters
                      refData={refData}
                      statusFilter={dsnStatusFilter}
                      setStatusFilter={setDsnStatusFilter}
                      levelFilter={dsnLevelFilter}
                      setLevelFilter={setDsnLevelFilter}
                      deptFilter={dsnDeptFilter}
                      setDeptFilter={setDsnDeptFilter}
                    />
                  )}
                  {/* Add button — shown here for most masters; designations puts
                      it in the page title strip, departments puts it in the
                      "What you are doing here" header row. */}
                  {cfg.slug !== 'designations' && cfg.slug !== 'departments' && caps.add && (
                    <Button
                      color="secondary"
                      className="btn-label waves-effect waves-light rounded-pill"
                      onClick={openAdd}
                    >
                      <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                      Add {singular}
                    </Button>
                  )}
                </Col>
              </Row>

              <style>{`
                .master-scroll-wrap {
                  max-height: 445px;
                  overflow-y: auto;
                }
                .master-scroll-wrap thead {
                  position: sticky;
                  top: 0;
                  z-index: 2;
                }
                .master-scroll-wrap::-webkit-scrollbar { width: 8px; }
                .master-scroll-wrap::-webkit-scrollbar-track { background: transparent; }
                .master-scroll-wrap::-webkit-scrollbar-thumb { background: var(--vz-border-color); border-radius: 8px; }
                .master-scroll-wrap::-webkit-scrollbar-thumb:hover { background: var(--vz-secondary-color); }
              `}</style>
              <TableContainer
                columns={columns}
                data={filteredRecords}
                isGlobalFilter={false}
                customPageSize={7}
                tableClass="align-middle table-nowrap mb-0"
                theadClass="table-light"
                divClass="table-responsive border rounded master-scroll-wrap"
                SearchPlaceholder={`Search ${cfg.title.toLowerCase()}...`}
              />
              {loading && <div className="text-center py-5"><Spinner /></div>}
              {!loading && records.length === 0 && (
                <div className="text-center py-5">
                  <i className="ri-inbox-line display-5 text-muted"></i>
                  <p className="text-muted mt-2">No records found</p>
                </div>
              )}
            </CardBody>
          </Card>
        </Col>
      </Row>

      {/* Add / Edit modal */}
      <MasterFormStyles />
      <Modal
        isOpen={modalOpen}
        toggle={() => { /* explicit Cancel only — outside click & Esc disabled */ }}
        size={modalSize}
        centered
        modalClassName="master-modal"
        backdrop="static"
        keyboard={false}
      >
        {/* Header — solid brand gradient strip with title, subtitle and close X. */}
        <div
          className="position-relative overflow-hidden"
          style={{
            background: 'linear-gradient(120deg, #405189 0%, #4a63a8 50%, #6691e7 100%)',
            padding: '20px 24px',
          }}
        >
          {/* Decorative bubbles */}
          <span
            aria-hidden
            style={{
              position: 'absolute', top: -30, right: -10, width: 110, height: 110, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.18) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          <span
            aria-hidden
            style={{
              position: 'absolute', bottom: -40, right: 60, width: 140, height: 140, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(102,145,231,0.35) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          <div className="d-flex align-items-center gap-3 position-relative">
            <span
              className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
              style={{
                width: 44, height: 44,
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.25)',
                backdropFilter: 'blur(6px)',
              }}
            >
              <i className={`${cfg.icon}`} style={{ color: '#fff', fontSize: 20 }}></i>
            </span>
            <div className="flex-grow-1 min-w-0">
              <h4 className="mb-0 fw-bold" style={{ color: '#fff', fontWeight: 800, letterSpacing: '0.01em' }}>
                {viewOnly ? `View ${singular}` : editingId != null ? `Edit ${singular}` : `Add ${singular}`}
              </h4>
              <small style={{ color: 'rgba(255,255,255,0.82)', fontSize: 12 }}>
                {viewOnly ? `Viewing details for this ${singular.toLowerCase()}` :
                 editingId != null ? `Update the details of this ${singular.toLowerCase()}` :
                 `Fill in the details to register a new ${singular.toLowerCase()}`}
              </small>
            </div>
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
              aria-label="Close"
              style={{
                width: 32, height: 32,
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.25)',
                color: '#fff',
                cursor: 'pointer',
                transition: 'background 0.18s ease, transform 0.18s ease',
              }}
              onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.30)'; }}
              onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'rgba(255,255,255,0.18)'; }}
            >
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>
        <Form onSubmit={handleSave}>
          <ModalBody className="p-4">
            {sectionedFields.map((group, gIdx) => {
              const p = SECTION_PALETTES[gIdx % SECTION_PALETTES.length];
              return (
                <div key={gIdx} className={gIdx > 0 ? 'mt-4 pt-1' : ''}>
                  {group.sec && (
                    <div className="d-flex align-items-center gap-2 mb-3">
                      <span
                        className="flex-shrink-0"
                        style={{ width: 4, height: 20, background: p.grad, borderRadius: 2 }}
                      />
                      <h6
                        className="mb-0 fw-bold"
                        style={{
                          color: p.color,
                          fontSize: 12,
                          textTransform: 'uppercase',
                          letterSpacing: '0.1em',
                        }}
                      >
                        {group.sec}
                      </h6>
                      <div
                        className="flex-grow-1"
                        style={{ height: 1, background: 'var(--vz-border-color)' }}
                      />
                    </div>
                  )}
                  <Row className="g-3">
                    {group.fields.map((f, i) => renderField(f, i, editing, viewOnly, refData, labelFieldForRef, fieldErrors, clearFieldError, defaultFieldSpan, tenantScopedRecords))}
                  </Row>
                </div>
              );
            })}
          </ModalBody>
          <ModalFooter className="px-4 py-3 d-flex align-items-center justify-content-between flex-wrap gap-2" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
            {/* "Fields marked * are required" hint on the left */}
            <span className="d-inline-flex align-items-center gap-1 text-muted" style={{ fontSize: 12 }}>
              {!viewOnly && (
                <>
                  <i className="ri-information-line" style={{ fontSize: 13, color: '#6691e7' }} />
                  Fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required
                </>
              )}
            </span>
            {/* Action buttons on the right */}
            <div className="d-flex align-items-center gap-2">
              <button type="button" className="master-modal-cancel" onClick={() => setModalOpen(false)}>
                <i className="ri-close-line align-middle me-1"></i>
                {viewOnly ? 'Close' : 'Cancel'}
              </button>
              {!viewOnly && (
                <Button
                  type="submit"
                  disabled={saving}
                  className={
                    saving
                      ? 'rounded-pill d-inline-flex align-items-center justify-content-center gap-2 border-0'
                      : 'btn-label waves-effect waves-light rounded-pill border-0'
                  }
                  style={{
                    minWidth: 170,
                    background: 'linear-gradient(120deg, #405189 0%, #6691e7 100%)',
                    color: '#fff',
                    boxShadow: '0 4px 12px rgba(64,81,137,0.3)',
                  }}
                >
                  {saving ? (
                    <>
                      <Spinner size="sm" />
                      <span>{editingId != null ? 'Updating...' : 'Saving...'}</span>
                    </>
                  ) : (
                    <>
                      <i className="ri-save-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                      {editingId != null ? `Update ${singular}` : `Save ${singular}`}
                    </>
                  )}
                </Button>
              )}
            </div>
          </ModalFooter>
        </Form>
      </Modal>

      <DeleteConfirmModal
        open={deleteOpen}
        title={`Delete ${cfg.titleSingular || cfg.title}`}
        itemName={deleteTarget ? deleteLabel(deleteTarget) : undefined}
        subMessage="This action cannot be undone. The record will be permanently removed."
        onClose={() => { if (!deleting) { setDeleteOpen(false); setDeleteTarget(null); } }}
        onConfirm={confirmDelete}
        loading={deleting}
      />
    </>
  );
}

/* ── Section palette — colors a section card in the Add/Edit modal ── */
const SECTION_PALETTES: { color: string; grad: string; tint: string; border: string; shadow: string }[] = [
  { color: '#6366f1', grad: 'linear-gradient(135deg, #6366f1, #8b5cf6)', tint: 'linear-gradient(135deg, rgba(99,102,241,0.08), rgba(139,92,246,0.03))', border: 'rgba(99,102,241,0.22)', shadow: 'rgba(99,102,241,0.35)' },
  { color: '#0ea5e9', grad: 'linear-gradient(135deg, #0ea5e9, #38bdf8)', tint: 'linear-gradient(135deg, rgba(14,165,233,0.08), rgba(56,189,248,0.03))', border: 'rgba(14,165,233,0.22)', shadow: 'rgba(14,165,233,0.35)' },
  { color: '#d97a08', grad: 'linear-gradient(135deg, #f59e0b, #f7b84b)', tint: 'linear-gradient(135deg, rgba(245,158,11,0.10), rgba(247,184,75,0.03))', border: 'rgba(245,158,11,0.24)', shadow: 'rgba(245,158,11,0.35)' },
  { color: '#10b981', grad: 'linear-gradient(135deg, #10b981, #14c9b1)', tint: 'linear-gradient(135deg, rgba(16,185,129,0.08), rgba(20,201,177,0.03))', border: 'rgba(16,185,129,0.22)', shadow: 'rgba(16,185,129,0.35)' },
  { color: '#8b5cf6', grad: 'linear-gradient(135deg, #8b5cf6, #a78bfa)', tint: 'linear-gradient(135deg, rgba(139,92,246,0.08), rgba(167,139,250,0.03))', border: 'rgba(139,92,246,0.22)', shadow: 'rgba(139,92,246,0.35)' },
  { color: '#db2777', grad: 'linear-gradient(135deg, #ec4899, #f9a8d4)', tint: 'linear-gradient(135deg, rgba(236,72,153,0.08), rgba(249,168,212,0.03))', border: 'rgba(236,72,153,0.22)', shadow: 'rgba(236,72,153,0.35)' },
];

/* ── "What you are doing here" — gradient step tiles ── */
const STEP_PALETTES: { grad: string; tint: string; border: string; accent: string }[] = [
  { grad: 'linear-gradient(135deg, #405189 0%, #6691e7 100%)', tint: 'linear-gradient(135deg, rgba(64,81,137,0.08), rgba(102,145,231,0.04))', border: 'rgba(64,81,137,0.20)', accent: '#405189' },
  { grad: 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)', tint: 'linear-gradient(135deg, rgba(10,179,156,0.08), rgba(48,213,181,0.04))', border: 'rgba(10,179,156,0.22)', accent: '#0ab39c' },
  { grad: 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)', tint: 'linear-gradient(135deg, rgba(247,184,75,0.10), rgba(255,212,122,0.05))', border: 'rgba(247,184,75,0.25)', accent: '#d97a08' },
  { grad: 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)', tint: 'linear-gradient(135deg, rgba(106,90,205,0.08), rgba(167,139,250,0.04))', border: 'rgba(106,90,205,0.20)', accent: '#6a5acd' },
  { grad: 'linear-gradient(135deg, #299cdb 0%, #5fc8ff 100%)', tint: 'linear-gradient(135deg, rgba(41,156,219,0.08), rgba(95,200,255,0.04))', border: 'rgba(41,156,219,0.20)', accent: '#299cdb' },
  { grad: 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)', tint: 'linear-gradient(135deg, rgba(240,101,72,0.08), rgba(255,158,124,0.04))', border: 'rgba(240,101,72,0.22)', accent: '#f06548' },
];

function WhatYouDoHere({ cfg, onAdd, canAdd }: { cfg: MasterConfig; onAdd?: () => void; canAdd?: boolean }) {
  const steps = cfg.wtd || [];
  const singular = cfg.titleSingular || cfg.title;
  const [open, setOpen] = useState(false);
  // Departments collapses the body — only the heading + Add button row is shown.
  const isDepartments = cfg.slug === 'departments';

  // Heading content reused by both the collapsible (default) and static
  // (departments) variants so the title styling stays in sync.
  const heading = (
    <div className="d-flex align-items-center gap-3">
      <span
        className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
        style={{
          width: 40, height: 40,
          background: 'linear-gradient(135deg, #405189 0%, #6691e7 100%)',
          boxShadow: '0 4px 10px rgba(64,81,137,0.25)',
        }}
      >
        <i className="ri-lightbulb-flash-line" style={{ color: '#fff', fontSize: 18 }}></i>
      </span>
      <div>
        <div className="fw-bold" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))', fontSize: 15 }}>
          {cfg.title} — What you are doing here
        </div>
        <small className="text-muted">Quick 4-step guide to set up a {singular} record</small>
      </div>
    </div>
  );

  if (isDepartments) {
    return (
      <Card
        className="border shadow-sm mb-3 overflow-hidden"
        style={{
          background: 'var(--vz-card-bg)',
          borderColor: 'var(--vz-border-color)',
          borderRadius: 16,
        }}
      >
        <div
          className="d-flex align-items-center justify-content-between flex-wrap gap-2 px-3 py-3"
          style={{ background: 'transparent' }}
        >
          {heading}
          {canAdd && onAdd && (
            <Button
              color="secondary"
              className="btn-label waves-effect waves-light rounded-pill"
              onClick={onAdd}
            >
              <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
              Add {singular}
            </Button>
          )}
        </div>
      </Card>
    );
  }

  return (
    <Card
      className="border shadow-sm mb-3 overflow-hidden"
      style={{
        background: 'var(--vz-card-bg)',
        borderColor: 'var(--vz-border-color)',
        borderRadius: 16,
      }}
    >
      <button
        type="button"
        onClick={() => setOpen(v => !v)}
        className="d-flex align-items-center justify-content-between flex-wrap gap-2 px-3 py-3 border-0 w-100 text-start"
        style={{
          cursor: 'pointer',
          background: open ? 'linear-gradient(135deg, rgba(64,81,137,0.06), rgba(102,145,231,0.03))' : 'transparent',
          borderBottom: open ? '1px solid var(--vz-border-color)' : 'none',
          transition: 'background .2s ease',
          userSelect: 'none',
        }}
      >
        {heading}
        <span
          className="d-inline-flex align-items-center justify-content-center rounded-circle bg-primary-subtle text-primary flex-shrink-0"
          style={{
            width: 32, height: 32,
            transition: 'transform .25s ease',
            transform: open ? 'rotate(180deg)' : 'rotate(0deg)',
          }}
        >
          <i className="ri-arrow-down-s-line fs-18"></i>
        </span>
      </button>

      <div
        style={{
          maxHeight: open ? 1200 : 0,
          overflow: 'hidden',
          transition: 'max-height .35s ease',
        }}
      >
        <CardBody className="pt-3">
          <div className="d-flex flex-wrap align-items-stretch" style={{ gap: 8 }}>
            {steps.map((s, i) => {
              const p = STEP_PALETTES[i % STEP_PALETTES.length];
              const isLast = i === steps.length - 1;
              return (
                <Fragment key={i}>
                  <div
                    className="position-relative"
                    style={{
                      flex: '1 1 0',
                      minWidth: 200,
                      padding: '14px 16px 14px 16px',
                      borderRadius: 14,
                      background: p.tint,
                      border: `1px solid ${p.border}`,
                      borderTop: `3px solid ${p.accent}`,
                      boxShadow: '0 2px 8px rgba(18,38,63,0.04)',
                    }}
                  >
                    <div className="d-flex align-items-center gap-2 mb-1">
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle flex-shrink-0 fw-bold"
                        style={{
                          width: 24, height: 24,
                          background: p.grad,
                          color: '#fff',
                          fontSize: 12,
                          boxShadow: `0 3px 8px ${p.border}`,
                        }}
                      >
                        {i + 1}
                      </span>
                      <div
                        className="fw-bold text-truncate"
                        style={{ color: p.accent, fontSize: 14 }}
                        title={s.title}
                      >
                        {s.title}
                      </div>
                    </div>
                    <div className="text-muted" style={{ fontSize: 12, lineHeight: 1.45 }}>
                      {s.desc}
                    </div>
                  </div>
                  {!isLast && (
                    <div
                      className="d-none d-md-flex align-items-center justify-content-center flex-shrink-0"
                      style={{ width: 26 }}
                      aria-hidden="true"
                    >
                      <span
                        className="d-inline-flex align-items-center justify-content-center rounded-circle"
                        style={{
                          width: 22, height: 22,
                          background: 'var(--vz-card-bg)',
                          border: '1px solid var(--vz-border-color)',
                          boxShadow: '0 1px 3px rgba(18,38,63,0.06)',
                        }}
                      >
                        <i
                          className="ri-arrow-right-s-line"
                          style={{
                            fontSize: 16,
                            color: 'var(--vz-secondary-color)',
                            lineHeight: 1,
                          }}
                        />
                      </span>
                    </div>
                  )}
                </Fragment>
              );
            })}
          </div>

          {steps.length === 0 && (
            <div className="text-muted text-center py-3">
              Define the workflow for {singular} records in the master config.
            </div>
          )}
        </CardBody>
      </div>
    </Card>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Designation-master extras: top hierarchy chip strip + Status/Level/Dept
 * filter dropdowns. Renders only inside the Designations master.
 * ────────────────────────────────────────────────────────────────────────── */
function DesignationExtras({
  records,
  filteredCount,
}: {
  records: any[];
  filteredCount: number;
}) {
  // Hierarchy tiers — same order/colors as the reference design.
  const TIERS: { label: string; short: string; icon: string; bg: string; fg: string; border: string }[] = [
    { label: 'Director / CEO',           short: 'Director / CEO', icon: 'ri-vip-crown-fill',  bg: '#fff4d8', fg: '#b97a00', border: '#f7b84b' },
    { label: 'Head of Department (HOD)', short: 'HOD',            icon: 'ri-medal-2-fill',    bg: '#ece6ff', fg: '#5b3fd1', border: '#7c5cfc' },
    { label: 'Team Leader',              short: 'Team Leader',    icon: 'ri-team-fill',       bg: '#dff0ff', fg: '#1e7ec5', border: '#299cdb' },
    { label: 'Executive',                short: 'Executive',      icon: 'ri-user-star-fill',  bg: '#d6f6ee', fg: '#0a8a78', border: '#0ab39c' },
    { label: 'Employee',                 short: 'Employee',       icon: 'ri-user-3-fill',     bg: '#dff5e8', fg: '#1f8f4d', border: '#28c76f' },
    { label: 'Intern / Trainee',         short: 'Intern',         icon: 'ri-book-open-fill',  bg: '#f0f1f5', fg: '#5b6478', border: '#878a99' },
  ];

  // KPI counts derived from the current records (not the filtered list — the
  // top KPIs always reflect the full dataset so users can see overall totals).
  const total = records.length;
  const tierCounts = TIERS.map(t => ({
    ...t,
    count: records.filter(r => String(r.level ?? '') === t.label).length,
  }));

  return (
    <div className="dsn-extras mb-3">
      <style>{`
        /* KPI strip — compact, responsive: 7 → 4 → 3 → 2 columns */
        .dsn-extras .dsn-kpis {
          display: grid;
          grid-template-columns: repeat(7, minmax(0, 1fr));
          gap: 8px;
          margin-bottom: 12px;
        }
        @media (max-width: 1399px) {
          .dsn-extras .dsn-kpis { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
        @media (max-width: 991px) {
          .dsn-extras .dsn-kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
        }
        @media (max-width: 575px) {
          .dsn-extras .dsn-kpis { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 6px; }
        }
        /* New layout: [Icon tile]  |  [Number on top, Label below] */
        .dsn-extras .dsn-kpi {
          background: var(--vz-card-bg);
          border: 1px solid var(--vz-border-color);
          border-radius: 10px;
          padding: 12px 14px;
          display: flex;
          align-items: center;
          gap: 12px;
          transition: transform .18s ease, box-shadow .18s ease, border-color .18s ease;
        }
        .dsn-extras .dsn-kpi:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 18px rgba(0,0,0,0.06);
        }
        .dsn-extras .dsn-kpi-icon {
          width: 38px;
          height: 38px;
          border-radius: 9px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          flex-shrink: 0;
          font-size: 17px;
        }
        .dsn-extras .dsn-kpi-text {
          display: flex;
          flex-direction: column;
          min-width: 0;
          line-height: 1.2;
        }
        .dsn-extras .dsn-kpi-num {
          font-size: 19px;
          font-weight: 700;
          line-height: 1.1;
          color: var(--kpi-deep, var(--vz-heading-color, var(--vz-body-color)));
          font-variant-numeric: tabular-nums;
        }
        [data-bs-theme="dark"] .dsn-extras .dsn-kpi-num,
        [data-layout-mode="dark"] .dsn-extras .dsn-kpi-num {
          color: var(--kpi-bright, rgba(255,255,255,0.95)) !important;
        }
        .dsn-extras .dsn-kpi-label {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--vz-secondary-color);
          line-height: 1.2;
          margin-top: 2px;
          white-space: nowrap;
          overflow: hidden;
          text-overflow: ellipsis;
        }
        /* Dark-mode polish — brighter strip + subtle glow + bolder borders so
           the KPI cards and hierarchy chips POP against the dark canvas. */
        [data-bs-theme="dark"] .dsn-extras .dsn-kpi,
        [data-layout-mode="dark"] .dsn-extras .dsn-kpi {
          background: color-mix(in srgb, var(--vz-card-bg) 92%, #ffffff);
          border-color: color-mix(in srgb, var(--vz-border-color) 60%, #ffffff);
        }
        [data-bs-theme="dark"] .dsn-extras .dsn-kpi-label,
        [data-layout-mode="dark"] .dsn-extras .dsn-kpi-label {
          color: rgba(255, 255, 255, 0.78);
        }
        [data-bs-theme="dark"] .dsn-extras .dsn-kpi-icon,
        [data-layout-mode="dark"] .dsn-extras .dsn-kpi-icon {
          filter: brightness(1.1) saturate(1.1);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.05) inset;
        }
        [data-bs-theme="dark"] .dsn-extras .dsn-hier-row,
        [data-layout-mode="dark"] .dsn-extras .dsn-hier-row {
          background: color-mix(in srgb, var(--vz-card-bg) 90%, #ffffff);
          border-color: color-mix(in srgb, var(--vz-border-color) 60%, #ffffff);
        }
        [data-bs-theme="dark"] .dsn-extras .dsn-hier-chip,
        [data-layout-mode="dark"] .dsn-extras .dsn-hier-chip {
          filter: brightness(1.05) saturate(1.1);
          box-shadow: 0 0 0 1px rgba(255,255,255,0.04) inset;
        }
      `}</style>

      <style>{`
        .dsn-extras .dsn-hier-row {
          display: flex;
          align-items: center;
          flex-wrap: wrap;
          gap: 6px;
          padding: 10px 12px;
          border: 1px solid var(--vz-border-color);
          border-radius: 12px;
          background: var(--vz-card-bg);
          margin-bottom: 12px;
        }
        @media (max-width: 575px) {
          .dsn-extras .dsn-hier-row { padding: 8px 10px; gap: 5px; }
        }
        .dsn-extras .dsn-hier-label {
          font-size: 10.5px;
          font-weight: 700;
          letter-spacing: 0.08em;
          color: var(--vz-secondary-color);
          text-transform: uppercase;
          margin-right: 4px;
        }
        .dsn-extras .dsn-hier-chip {
          display: inline-flex;
          align-items: center;
          gap: 5px;
          padding: 2px 8px;
          border-radius: 999px;
          font-size: 10.5px;
          font-weight: 500;
          line-height: 1.3;
          white-space: nowrap;
        }
        @media (max-width: 575px) {
          .dsn-extras .dsn-hier-chip { font-size: 9.5px; padding: 2px 6px; }
          .dsn-extras .dsn-hier-arrow { display: none; }
        }
        .dsn-extras .dsn-hier-arrow {
          color: var(--vz-secondary-color);
          opacity: 0.55;
          font-size: 12px;
        }
        .dsn-extras .dsn-hier-tail {
          margin-left: auto;
          font-size: 11px;
          color: var(--vz-secondary-color);
          font-style: italic;
        }
      `}</style>

      {/* Hierarchy chip strip — sits ABOVE the KPI cards (per request). */}
      <div className="dsn-hier-row">
        <span className="dsn-hier-label">Hierarchy</span>
        {TIERS.map((t, i) => (
          <span key={t.label} style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
            <span
              className="dsn-hier-chip"
              style={{ background: t.bg, color: t.fg, border: `1px solid ${t.border}55` }}
            >
              <i className={t.icon} style={{ fontSize: 13 }} />
              {t.label}
            </span>
            {i < TIERS.length - 1 && <i className="ri-arrow-right-s-line dsn-hier-arrow" />}
          </span>
        ))}
      </div>

      {/* KPI cards — [Icon tile] [Number / Label]. Sits BELOW the hierarchy strip.
          Each card carries its tier's BRIGHT brand color via a CSS var so the
          numbers stay vivid in BOTH themes (dark mode picks up the brighter
          shade automatically — see the dark-mode CSS below). */}
      <div className="dsn-kpis">
        <div
          className="dsn-kpi"
          title="Total designations"
          style={{ ['--kpi-bright' as any]: '#6691e7', ['--kpi-deep' as any]: '#405189' }}
        >
          <span className="dsn-kpi-icon" style={{ background: '#e9edf6', color: '#405189' }}>
            <i className="ri-database-2-fill" />
          </span>
          <div className="dsn-kpi-text">
            <span className="dsn-kpi-num">{total}</span>
            <span className="dsn-kpi-label">Total</span>
          </div>
        </div>
        {tierCounts.map(t => (
          <div
            className="dsn-kpi"
            key={t.label}
            title={`${t.label} designations`}
            style={{ ['--kpi-bright' as any]: t.border, ['--kpi-deep' as any]: t.fg }}
          >
            <span className="dsn-kpi-icon" style={{ background: t.bg, color: t.fg }}>
              <i className={t.icon} />
            </span>
            <div className="dsn-kpi-text">
              <span className="dsn-kpi-num">{t.count}</span>
              <span className="dsn-kpi-label">{t.short}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/* Inline Status / Level / Dept filters — sits between the search box and the
 * Add New button on the Designations master. */
function DesignationInlineFilters({
  refData,
  statusFilter, setStatusFilter,
  levelFilter,  setLevelFilter,
  deptFilter,   setDeptFilter,
}: {
  refData: Record<string, any[]>;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  levelFilter: string;
  setLevelFilter: (v: string) => void;
  deptFilter: string;
  setDeptFilter: (v: string) => void;
}) {
  const LEVELS = ['Director / CEO', 'Head of Department (HOD)', 'Team Leader', 'Executive', 'Employee', 'Intern / Trainee'];
  const departments = refData['departments'] || [];
  return (
    <div className="dsn-inline-filters d-flex align-items-center flex-wrap" style={{ gap: 12 }}>
      <style>{`
        .dsn-inline-filters .dsn-il-group { display: flex; align-items: center; gap: 6px; }
        .dsn-inline-filters .dsn-il-label {
          font-size: 11px;
          font-weight: 700;
          letter-spacing: 0.06em;
          text-transform: uppercase;
          color: var(--vz-secondary-color);
        }
        .dsn-inline-filters .form-select-sm { min-width: 120px; }
      `}</style>
      <div className="dsn-il-group">
        <span className="dsn-il-label">Status</span>
        <div style={{ minWidth: 130 }}>
          <MasterSelect
            value={statusFilter}
            onChange={(v) => setStatusFilter(v || 'all')}
            options={[
              { value: 'all', label: 'All' },
              { value: 'Active', label: 'Active' },
              { value: 'Inactive', label: 'Inactive' },
            ]}
            placeholder="All"
          />
        </div>
      </div>
      <div className="dsn-il-group">
        <span className="dsn-il-label">Level</span>
        <div style={{ minWidth: 160 }}>
          <MasterSelect
            value={levelFilter}
            onChange={(v) => setLevelFilter(v || 'all')}
            options={[
              { value: 'all', label: 'All Levels' },
              ...LEVELS.map(l => ({ value: l, label: l })),
            ]}
            placeholder="All Levels"
          />
        </div>
      </div>
      <div className="dsn-il-group">
        <span className="dsn-il-label">Department</span>
        <div style={{ minWidth: 160 }}>
          <MasterSelect
            value={deptFilter}
            onChange={(v) => setDeptFilter(v || 'all')}
            options={[
              { value: 'all', label: 'All Departments' },
              ...departments.map((d: any) => ({ value: String(d.id), label: String(d.name) })),
            ]}
            placeholder="All Departments"
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

function renderField(
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

  const span = f.full ? 12 : f.t === 'textarea' ? 12 : defaultSpan;
  // Auto-generated fields are locked in BOTH add and edit flows: on add the
  // value is computed from existing records, on edit we keep whatever was
  // saved. Either way the input is rendered read-only so users can't override
  // the auto-managed value.
  const isAutogen = !!f.autogen && !viewOnly;
  const autogenVal = (isAutogen && editing == null) ? f.autogen!(allRecords) : '';
  const defaultVal = (isAutogen && editing == null) ? autogenVal : (editing?.[f.n] ?? '');
  const err = fieldErrors[f.n];
  const onFieldChange = () => clearFieldError(f.n);
  const icon = isAutogen ? 'ri-magic-line' : iconForField(f);
  const isTextarea = f.t === 'textarea';
  const isSelect = !!(f.ref || f.t === 'select');

  let input: React.ReactNode;
  if (f.ref) {
    const rows = refData[f.ref] || [];
    const labelField = f.refL || labelFieldForRef(f.ref);
    // refLFmt lets a config render a composite label like "{name} ({level})"
    // — e.g. for the Reports To picker. Falls back to the single labelField.
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
    // Self-references: hide the row being edited so a department can't pick
    // itself as its own parent (which would create a cycle).
    const refRows = (f.ref === undefined || editing == null)
      ? rows
      : rows.filter((r: any) => String(r.id) !== String(editing.id));
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
        onChange={onFieldChange}
      />
    );
  } else if (f.t === 'select') {
    let options = normalizeOpts(f.opts);
    if (f.noneLabel) {
      options = [{ value: '', label: f.noneLabel }, ...options];
    }
    input = (
      <MasterSelect
        name={f.n}
        defaultValue={defaultVal || (f.r ? (options[0]?.value ?? '') : '')}
        options={options}
        placeholder={f.noneLabel || 'Select…'}
        disabled={viewOnly}
        invalid={!!err}
        onChange={onFieldChange}
      />
    );
  } else if (f.t === 'textarea') {
    input = (
      <Input
        type="textarea"
        name={f.n}
        rows={3}
        placeholder={f.p}
        defaultValue={defaultVal}
        disabled={viewOnly}
        invalid={!!err}
        onInput={onFieldChange}
      />
    );
  } else if (f.t === 'date') {
    input = (
      <MasterDatePicker
        name={f.n}
        defaultValue={defaultVal ? String(defaultVal) : ''}
        placeholder={f.p || 'Select date'}
        disabled={viewOnly}
        invalid={!!err}
        onChange={onFieldChange}
      />
    );
  } else {
    input = (
      <Input
        type={f.t === 'email' ? 'email' : f.t === 'number' ? 'number' : 'text'}
        name={f.n}
        placeholder={f.p}
        // `key` forces a remount when the auto-generated value changes between
        // opens of the Add modal so React picks up the new defaultValue.
        key={isAutogen ? autogenVal : undefined}
        defaultValue={defaultVal}
        disabled={viewOnly}
        readOnly={isAutogen}
        invalid={!!err}
        onInput={onFieldChange}
        className={f.auto ? 'master-field-auto' : undefined}
      />
    );
  }

  return (
    <Col md={span} key={f.n || `f-${i}`}>
      <Label className="d-flex align-items-center gap-2">
        <span>{f.l}{f.r && <span className="req-star">*</span>}</span>
        {isAutogen && (
          <span
            className="badge rounded-pill text-uppercase fw-semibold"
            style={{
              fontSize: 9.5,
              letterSpacing: '0.06em',
              padding: '3px 8px',
              background: 'linear-gradient(135deg,#7c5cfc,#a993fd)',
              color: '#fff',
              boxShadow: '0 2px 6px rgba(124,92,252,0.30)',
            }}
            title={editing == null
              ? 'Auto-generated — increments from the highest existing code'
              : 'Auto-generated — locked once a record is created'}
          >
            <i className="ri-magic-line" style={{ fontSize: 10, marginRight: 3 }} />Auto
          </span>
        )}
      </Label>
      <div className={`master-field${isTextarea ? ' ta' : ''}${isSelect ? ' sel' : ''}`}>
        <i className={`${icon} master-field-icon${isTextarea ? ' ta' : ''}`} />
        {input}
      </div>
      {err && <FormFeedback style={{ display: 'block', fontSize: 11.5, marginTop: 4 }}>{err}</FormFeedback>}
    </Col>
  );
}
