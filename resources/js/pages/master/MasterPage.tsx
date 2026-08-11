import { Fragment, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import {
  Card, CardBody, CardHeader, Row, Col,
  Button, Input, Label, Form, FormFeedback,
  Modal, ModalBody, ModalHeader, ModalFooter, Spinner,
} from 'reactstrap';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import MasterPlaceholder from '../MasterPlaceholder';
import DataTable from '../../components/ui/DataTable';
import InlineSublist from '../../components/ui/InlineSublist';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import { ShimmerStatCards } from '../../components/ui/Shimmer';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  getMasterConfig,
  masterEndpoint,
  normalizeOpts,
  type FieldDef,
  type MasterConfig,
} from './masterConfigs';
import { MasterSelect, MasterDatePicker, MasterFileInput, MasterFormStyles } from './masterFormKit';
import { resolveFileUrl } from '../../utils/resolveFileUrl';
import { bustAllMasterBundles } from '../../utils/bustMasterBundles';
import '../../../css/master.css';

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
  /* Back target. A master that belongs to another module (cfg.parent — e.g.
     Trigger Point Master, which lives in the HR sidebar) returns to THAT
     module's page; everything else belongs to the Master Control Center and
     returns there. A fixed parent, deliberately, not history: the same call HR
     > Custom Fields makes, because navigate(-1) drops the user on whatever
     page they happened to come from rather than the module that owns this
     master. */
  const backTo    = cfg.parent?.path ?? '/master';
  const backLabel = cfg.parent ? 'Back' : 'Back to Master list';
  const backTitle = cfg.parent ? `Back to ${cfg.parent.label}` : 'Back to Master list';

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
    // `lockedFixed` masters (e.g. address_types) override permissions —
    // not even super_admin can add rows. Backend rejects POST anyway;
    // hiding the button keeps the UI honest. Edit/delete still gated
    // by the per-row is_system flag (handled in row actions).
    add:    !cfg.lockedFixed && (isSuperAdmin || !!modulePerm?.can_add),
    edit:   isSuperAdmin || !!modulePerm?.can_edit,
    delete: isSuperAdmin || !!modulePerm?.can_delete,
    export: isSuperAdmin || !!modulePerm?.can_export,
    import: isSuperAdmin || !!modulePerm?.can_import,
  }), [isSuperAdmin, modulePerm?.can_view, modulePerm?.can_add, modulePerm?.can_edit, modulePerm?.can_delete, modulePerm?.can_export, modulePerm?.can_import, cfg.lockedFixed]);

  const [modalOpen, setModalOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [viewOnly, setViewOnly] = useState(false);
  const [saving, setSaving] = useState(false);
  // Server-derived auto-generated values (e.g. next DEPT-### code) keyed by
  // field name. Populated when openAdd() fires for any field with
  // `autogenApi: true`. Cleared on master switch / modal close so a stale
  // value doesn't bleed into the next form open.
  const [apiAutogen, setApiAutogen] = useState<Record<string, string>>({});
  const [searchInput, setSearchInput] = useState('');
  // Designation-master-specific filter state. Only used when cfg.slug === 'designations'.
  const [dsnStatusFilter, setDsnStatusFilter] = useState<string>('all');
  const [dsnLevelFilter, setDsnLevelFilter] = useState<string>('all');
  const [dsnDeptFilter, setDsnDeptFilter] = useState<string>('all');
  // Department-master-specific filter state. Only used when cfg.slug === 'departments'.
  const [dpStatusFilter, setDpStatusFilter] = useState<string>('all');
  const [dpParentFilter, setDpParentFilter] = useState<string>('all');
  // Role-master-specific filter state. Only used when cfg.slug === 'roles'.
  const [roleStatusFilter, setRoleStatusFilter] = useState<string>('all');
  const [roleTypeFilter, setRoleTypeFilter] = useState<string>('all');
  const [roleDeptFilter, setRoleDeptFilter] = useState<string>('all');
  const [roleTab, setRoleTab] = useState<'all' | 'primary' | 'ancillary'>('all');
  // KPI-master-specific filter state.
  const [kpiRoleFilter, setKpiRoleFilter] = useState<string>('all');
  const [kpiTargetFilter, setKpiTargetFilter] = useState<string>('all');
  const [kpiPriorityFilter, setKpiPriorityFilter] = useState<string>('all');

  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<any | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Audit history modal — shown when a row's history (clock) button is clicked.
  const [auditOpen, setAuditOpen] = useState(false);
  const [auditTarget, setAuditTarget] = useState<any | null>(null);
  // Employee-tree modal — replaces the audit button on the Department master.
  const [treeOpen, setTreeOpen] = useState(false);
  const [treeTarget, setTreeTarget] = useState<any | null>(null);

  // Sublist values keyed by field name (e.g. { banks: [{ bank_name, account_number, ... }] }).
  // Sublists live OUTSIDE the form's FormData because each item is a multi-field card,
  // not a single input. They're synced to local state via the sub-modal and merged into
  // the JSON payload at save time.
  const [sublistValues, setSublistValues] = useState<Record<string, any[]>>({});
  // Tracks the current value of any `t: 'radio'` field so other fields can
  // conditionally show/hide based on it (`showWhen`). Uncontrolled inputs
  // alone can't drive re-renders — this lightweight controlled state powers
  // the "Calendar vs If Joining" style branches in the Leave Plan form.
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

  // Ownership columns injected by role: just "Created By" for every role.
  // Client / Branch columns were removed — the audit log shown in the
  // Actions column already surfaces that ownership information, so they
  // were redundant in the table itself.
  const ownershipCols = useMemo<{ key: string; label: string }[]>(() => {
    if (!user?.user_type) return [];
    return [{ key: '__creator', label: 'Created By' }];
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
    setApiAutogen({});

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
    const isDp  = cfg.slug === 'departments';
    const isRole = cfg.slug === 'roles';
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
      // Department-master extra filters: Status / Parent dropdowns.
      if (isDp) {
        if (dpStatusFilter !== 'all') {
          if (String(row.status ?? '').toLowerCase() !== dpStatusFilter.toLowerCase()) return false;
        }
        if (dpParentFilter !== 'all') {
          if (dpParentFilter === 'root') {
            if (row.parent_id != null && row.parent_id !== '') return false;
          } else if (String(row.parent_id ?? '') !== String(dpParentFilter)) {
            return false;
          }
        }
      }
      // Role-master extra filters: tab (All/Primary/Ancillary) + Type/Status/Dept.
      if (isRole) {
        const rt = String(row.role_type ?? '').toLowerCase();
        if (roleTab === 'primary' && !/primary/.test(rt)) return false;
        if (roleTab === 'ancillary' && !/ancillary|auxiliary|operational|administrative|functional/.test(rt)) return false;
        if (roleStatusFilter !== 'all') {
          if (String(row.status ?? '').toLowerCase() !== roleStatusFilter.toLowerCase()) return false;
        }
        if (roleTypeFilter !== 'all') {
          if (String(row.role_type ?? '') !== roleTypeFilter) return false;
        }
        if (roleDeptFilter !== 'all') {
          if (String(row.department_id ?? '') !== String(roleDeptFilter)) return false;
        }
      }
      // KPI-master extra filters: Role / Target Type / Priority dropdowns.
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
      for (const key of searchableKeys) {
        const f = cfg.fields.find(ff => ff.n === key);
        const val = f?.ref ? resolveRefLabel(f.ref, f.refL, row[key]) : row[key];
        if (val != null && String(val).toLowerCase().includes(q)) return true;
      }
      return false;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [records, searchInput, cfg, refData, dsnStatusFilter, dsnLevelFilter, dsnDeptFilter, dpStatusFilter, dpParentFilter, roleStatusFilter, roleTypeFilter, roleDeptFilter, roleTab, kpiRoleFilter, kpiTargetFilter, kpiPriorityFilter]);

  /* Roles master — the All / Primary / Ancillary rail that rides in the table
     toolbar. Counts come from the unfiltered record set, so each tab always
     shows its own total rather than a count of the current view. Type matching
     mirrors the filter in filteredRecords above. */
  const roleTabs = useMemo(() => {
    const isAncillary = (rt: string) => /ancillary|auxiliary|operational|administrative|functional/i.test(rt);
    return [
      { key: 'all',       label: 'All Roles',       icon: 'ri-shield-line', count: records.length },
      { key: 'primary',   label: 'Primary Roles',   icon: 'ri-star-fill',   count: records.filter(r => /primary/i.test(String(r.role_type ?? ''))).length },
      { key: 'ancillary', label: 'Ancillary Roles', icon: 'ri-time-line',   count: records.filter(r => isAncillary(String(r.role_type ?? ''))).length },
    ];
  }, [records]);

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

  // Initialize controlled radio state from a record (or defaults). Used on
  // both Add and Edit so `showWhen` immediately reflects the form's value
  // — without this, the conditional inputs would always start hidden.
  const seedRadioValues = (row?: any) => {
    const next: Record<string, string> = {};
    for (const f of cfg.fields) {
      if (f.t !== 'radio') continue;
      const v = row?.[f.n];
      if (v != null && v !== '') {
        next[f.n] = String(v);
      } else {
        const first = normalizeOpts(f.opts)[0]?.value;
        if (first != null) next[f.n] = String(first);
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
    // Refresh referenced masters so dropdowns reflect anything added elsewhere.
    fetchRefs();
    // Pre-fill any field flagged `autogenApi` from the server. The backend
    // returns a tenant-scoped next code (e.g. DEPT-001) computed straight
    // from the DB, so the value reflects what `store()` will accept rather
    // than what the page happens to have loaded.
    const apiFields = cfg.fields.filter(f => (f as any).autogenApi);
    if (apiFields.length > 0) {
      api.get(`${masterEndpoint(cfg)}/next-code`)
        .then(r => {
          const code = r?.data?.code;
          if (!code) return;
          // Currently only one such field per master ('code'); apply the
          // returned value to every autogenApi field by name.
          const next: Record<string, string> = {};
          for (const f of apiFields) next[f.n] = String(code);
          setApiAutogen(next);
        })
        .catch(() => { /* fall back to client-side autogen() */ });
    }
  };
  const openEdit = (row: any, readonly = false) => {
    setFieldErrors({});
    setEditingId(row.id);
    setViewOnly(readonly);
    // Hydrate sublist state from the row — backend returns child arrays inline
    // (e.g. row.banks for a bank-accounts sublist), so the form pre-fills with
    // any existing items.
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

  // Wire up `autoDeriveFrom` fields once the form is in the DOM. The fields
  // are uncontrolled (defaultValue + onInput), so we hook the source input's
  // 'input' event and write the computed default into the target input until
  // the user manually edits it. Re-runs on every modal open and on slug
  // changes so the listener targets the right form.
  useEffect(() => {
    if (!modalOpen) return;
    const deriveFields = cfg.fields.filter((f: any) => f.autoDeriveFrom);
    if (deriveFields.length === 0) return;

    // Resolve the form lazily. Reactstrap's modal can be off-DOM for
    // a tick after `modalOpen` flips, and on some systems the 60ms
    // delay races the actual mount. Retry up to ~600ms before giving
    // up. The selector list widens progressively to handle different
    // modal wrappers across the project.
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

        // Once the user manually types in the target we stop auto-filling.
        // Clearing the target back to empty re-enables auto-fill, so users
        // can re-trigger derivation by emptying the short code.
        let userEdited = !!target.value && editing != null;
        // Guard flag — set true while we programmatically update the
        // target. Without it, dispatching the synthetic 'input' event
        // below fires onTargetInput, which sees a non-empty value and
        // flips userEdited to true permanently — that left every UOM
        // entry stuck at the first letter ("K" instead of "KG"). The
        // guard makes onTargetInput ignore self-fired events.
        let programmatic = false;
        const onTargetInput = () => {
          if (programmatic) return;
          userEdited = target.value !== '';
        };
        target.addEventListener('input', onTargetInput);

        const onSourceInput = () => {
          if (userEdited) return;
          const next = deriveValue(cfg.slug, field.n, source.value);
          // Set via the native setter so React/Reactstrap don't strip the
          // change; then dispatch an 'input' event so any listeners fire.
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

      // Stash for cleanup phase below.
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

  // Clients-page style compact action button
  const ActionBtn = ({
    title, icon, color, onClick, disabled,
  }: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) => (
    <Tooltip label={title}>
    <button
      type="button"
      aria-label={title}
      disabled={disabled}
      className="btn p-0 d-inline-flex align-items-center justify-content-center"
      style={{
        width: 30, height: 30, borderRadius: 8,
        background: 'var(--vz-secondary-bg)',
        border: '1px solid var(--vz-border-color)',
        color: 'var(--vz-secondary-color)',
        opacity: disabled ? 0.55 : 1,
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
      {disabled ? (
        // Custom prohibit indicator: clean circle border wrapping the icon
        // with a diagonal slash clipped inside the circle (overflow: hidden).
        <span
          aria-hidden="true"
          style={{
            position: 'relative',
            width: 18, height: 18,
            borderRadius: '50%',
            border: '1.5px solid var(--vz-secondary-color)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            color: 'var(--vz-secondary-color)',
            opacity: 0.7,
            overflow: 'hidden',
          }}
        >
          <i className={icon} style={{ fontSize: 9, lineHeight: 1 }} />
          {/* Diagonal slash — clipped by the round wrapper so it stays inside. */}
          <span
            style={{
              position: 'absolute',
              top: '50%',
              left: 0,
              right: 0,
              height: '1.5px',
              background: 'currentColor',
              transform: 'translateY(-50%) rotate(-45deg)',
              transformOrigin: 'center',
            }}
          />
        </span>
      ) : (
        <i className={`${icon} fs-14`} />
      )}
    </button>
    </Tooltip>
  );

  const validateForm = (fd: FormData): Record<string, string> => {
    const errs: Record<string, string> = {};
    // Helper — a field gated by `showWhen` shouldn't be validated when its
    // controlling field's current value doesn't match (it's not in the DOM).
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
      // Auto-generated fields are filled by the server, never the user.
      if (f.auto) continue;
      // Sublist values aren't tied to a single FormData input — they live in
      // their own state and are validated by the sub-modal at add/edit time.
      // A REQUIRED sublist must hold at least one entry (bug #9 — Bank Details).
      if (f.t === 'sublist') {
        if (f.r && (!sublistValues[f.n] || sublistValues[f.n].length === 0)) {
          errs[f.n] = `Please add at least one ${f.subSingular || f.l}.`;
        }
        continue;
      }
      if (isHiddenByShowWhen(f)) continue;
      // File inputs: required check uses File.size; skip the rest of validation.
      // On EDIT the existing file already lives on the server, so we don't
      // force a re-upload — only the size cap (when a new file is chosen)
      // and the required check on CREATE stay active.
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
      /* Length cap on text fields — backstop for cases where the
       * input's maxLength was bypassed (paste, browser quirks, …).
       * Default 50, overridable per field via `maxLen`. */
      if (f.t === 'text' || (f.t === 'textarea' && typeof (f as any).maxLen === 'number')) {
        const cap = typeof (f as any).maxLen === 'number' ? (f as any).maxLen : 50;
        if (raw.length > cap) {
          errs[f.n] = `${f.l} must be ${cap} characters or fewer`;
          continue;
        }
      }
      /* ── Security validators (text + textarea only) ──────────────
       * XSS — angle brackets never legitimately appear in master
       * names, descriptions, codes, etc. Blocking them at the form
       * boundary kills <script>…</script>, <img onerror=…>, and
       * every other HTML-injection payload regardless of which master
       * is being edited.
       *
       * SQL injection — block the signature patterns a tester would
       * paste (' OR 1=1 --, ; DROP …, UNION SELECT, javascript:,
       * inline event handlers). Backend ORM already parameterises
       * queries, but rejecting the payload up front prevents the
       * data from being stored verbatim and surfacing later in
       * exports / reports.
       *
       * Meaningful input — required free-text fields can be bypassed
       * by submitting "...", "!!!", "---", or other symbol-only
       * strings (raw.trim() leaves them non-empty). Require at least
       * one letter or digit so "Segment Name" can't be saved as ":::".
       *
       * Name whitelist — per-slug list of fields that must stay in a
       * conservative letters/digits/space/basic-punctuation charset
       * (covers Segment Name, UOM Title & Short Code, Condition
       * Title, Haz Class Name, Packaging Material). Other free-text
       * fields (descriptions, addresses, action-required notes,
       * incoterm full names) keep their broader charset. */
      if (f.t === 'text' || f.t === 'textarea') {
        if (/[<>]/.test(raw)) {
          errs[f.n] = `${f.l} cannot contain HTML characters (< or >)`;
          continue;
        }
        if (/(\bOR\b\s+\d+\s*=\s*\d+|--|;\s*(?:DROP|DELETE|INSERT|UPDATE|TRUNCATE|ALTER)\b|\bUNION\s+SELECT\b|javascript:|\bon\w+\s*=)/i.test(raw)) {
          errs[f.n] = `${f.l} contains disallowed patterns (possible SQL/JS injection)`;
          continue;
        }
        // The currency Symbol field is legitimately symbol-only (₹, $, €, £),
        // so it's exempt from the "must contain letters/numbers" check (bug #19).
        if (f.n !== 'symbol' && f.r && !/[A-Za-z0-9]/.test(raw)) {
          errs[f.n] = `${f.l} must contain meaningful text (letters or numbers, not only symbols)`;
          continue;
        }
        /* Identifier-style fields (name, title, code, short_code, role
         * names, etc.) get a stricter charset whitelist so users can't
         * paste emoji, symbol soup, or anything outside basic Latin
         * punctuation into the master's primary label. The list is by
         * field name rather than slug, so the rule auto-extends to any
         * future master that uses one of these conventional names. */
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
        // Per-field regex from the config — stricter field-specific formats
        // (e.g. "no numbers" name fields, numeric-only codes). Runs when the
        // field declares a `pattern` and has a value.
        if (f.pattern && !new RegExp(f.pattern).test(raw)) {
          errs[f.n] = f.patternMessage || `${f.l} is invalid`;
          continue;
        }
      }
      // Future-only date guard — kicks in for fields like Warranty
      // Expiry where a backdated value doesn't make sense. Lexical
      // YYYY-MM-DD compare is fine because that's what the picker
      // emits and what we store on the row.
      if (f.t === 'date' && f.futureOnly) {
        const todayIso = new Date().toISOString().slice(0, 10);
        if (raw < todayIso) {
          errs[f.n] = `${f.l} must be a future date`;
          continue;
        }
      }
      // Cross-date constraint — this date must be AFTER another date field
      // (e.g. Warranty Expiry must be later than Purchase Date, bug #27). Only
      // checks when both dates are present; lexical YYYY-MM-DD compare is safe.
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
        /* Range guard — both per-field overrides (`min` / `max`) and the
         * default 0..999999999 cap from the input renderer above. Stops
         * users from pasting numbers that overflow the backend column
         * before the request ever leaves the browser. */
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
      } else if (f.n === 'hsn_code' && !/^[0-9]{4,10}$/.test(raw)) {
        /* HSN / SAC are strictly numeric per Indian GST notification —
         * 4, 6, or 8 (occasionally 10) digit codes. Mirrors the backend
         * rule (^[0-9]{4,10}$) so the user sees an instant inline error
         * instead of a server-side 422 round-trip. */
        errs[f.n] = 'Invalid HSN / SAC — 4 to 10 digit numeric code';
      } else if (cfg.slug === 'hsn_codes' && f.n === 'description') {
        /* HSN/SAC commodity descriptions are short product names like
         * "Almonds — Shelled" or "Sesame Seeds, Whole". Allow letters,
         * digits, spaces, and the punctuation real descriptions actually
         * use (hyphen, em/en dash, period, comma, parentheses, ampersand,
         * slash, apostrophe, percent). Block everything else so a user
         * can't paste markup, control characters, or symbol soup. */
        if (!/^[A-Za-z0-9\s\-—–.,()&/'%]+$/.test(raw)) {
          errs[f.n] = "Description may only contain letters, numbers, spaces, and . , - ( ) & / ' %";
        } else if (raw.length > 150) {
          errs[f.n] = 'Description must be 150 characters or fewer';
        }
      }
    }

    /* Duplicate-row check — every master config lists its unique columns
     * in cfg.uFields (e.g. segments uFields=['title']). Before the form
     * hits the server, scan the in-memory `records` list and reject if
     * another row already has the same value (case-insensitive). Edit-
     * mode skips the row being edited so its own name doesn't collide
     * with itself. Surfaces a clear inline error on the duplicate field
     * instead of waiting for a 422 round-trip. */
    if (cfg.uFields && cfg.uFields.length > 0 && records.length > 0) {
      const labelOf = (u: string) => cfg.fields.find(ff => ff.n === u)?.l || u;
      if (cfg.uFields.length > 1) {
        // COMPOSITE uniqueness — only the COMBINATION of all uFields must be
        // unique (matches the backend). Checking each field independently wrongly
        // flagged e.g. module_scope as a duplicate whenever ANY row used the same
        // scope, so every option errored (bug #29).
        const vals = cfg.uFields.map(u => String(fd.get(u) ?? '').trim());
        if (vals.every(v => v !== '')) {
          const dup = records.some(r => {
            if (editingId != null && r.id === editingId) return false;
            return cfg.uFields!.every((u, i) => String(r[u] ?? '').trim().toLowerCase() === vals[i].toLowerCase());
          });
          if (dup) {
            const first = cfg.uFields[0];
            errs[first] = `A record with this ${cfg.uFields.map(labelOf).join(' + ')} combination already exists — change one of them.`;
          }
        }
      } else {
        const uName = cfg.uFields[0];
        const dupRaw = String(fd.get(uName) ?? '').trim();
        if (dupRaw && !errs[uName]) {
          const dup = records.some(r => {
            if (editingId != null && r.id === editingId) return false;
            return String(r[uName] ?? '').trim().toLowerCase() === dupRaw.toLowerCase();
          });
          if (dup) {
            errs[uName] = `${labelOf(uName)} "${dupRaw}" already exists — pick a different value`;
          }
        }
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

    // Auto-capitalize the first letter of text/textarea values across every
    // master form. Skips identifier-style fields (codes / GSTIN / PAN / etc.)
    // and email, which have their own casing rules.
    const SKIP_CAPITALIZE = new Set([
      'code', 'iso_code', 'state_code', 'short_code', 'hsn_code',
      'gstin', 'pan', 'tan', 'cin', 'iec',
      'ifsc_code', 'swift_code', 'ad_code',
      'email', 'website', 'url', 'domain', 'phone', 'mobile', 'whatsapp',
      'pincode', 'postal_code', 'zip',
    ]);
    const capitalizeFirst = (s: string): string => {
      if (!s) return s;
      // Find first letter (skip leading whitespace/punctuation) and uppercase it.
      const idx = s.search(/[a-zA-Z]/);
      if (idx === -1) return s;
      return s.slice(0, idx) + s[idx].toUpperCase() + s.slice(idx + 1);
    };

    // Helper — same gate used in validateForm. A field hidden by `showWhen`
    // must be sent as NULL on save so toggling away wipes the stale value
    // (otherwise switching "Calendar → If Joining" would silently leave the
    // previously-picked month attached on the row).
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
      // File fields are not yet wired to backend storage — skip them in the
      // JSON payload so the request stays a plain JSON POST/PUT.
      if (f.t === 'file') continue;
      // Auto-generated fields (code/AST-XXXX/ROL-XX) are filled by the
      // server's creating-hook on insert and preserved as-is on update —
      // skip them so the backend stays the single source of truth and
      // the frontend's preview value never overrides the canonical code.
      if (f.auto) continue;
      // Sublist fields ride alongside the parent's own fields — emit the
      // current array for each so the controller can sync child rows.
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
          /* Belt-and-suspenders clamp — validateForm already rejects
           * out-of-range numbers, but if a future code path skips it
           * (or scientific-notation input slips past the HTML control)
           * we still cap here so the server never sees a value that
           * would overflow the column. */
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

    setSaving(true);
    try {
      const base = masterEndpoint(cfg);

      // Collect actual File uploads from the form. When at least one
      // file is selected, switch the request to multipart/form-data so
      // the backend can read it via $request->file(...). Previously
      // file fields were skipped entirely from the JSON payload, which
      // meant invoices / warranty cards uploaded against an asset
      // never reached the server — they were gone the moment the user
      // hit Save and the form re-opened with empty file inputs.
      const filesToUpload: { name: string; file: File }[] = [];
      for (const f of cfg.fields) {
        if (f.t !== 'file' || !f.n) continue;
        const v = fd.get(f.n);
        if (v instanceof File && v.size > 0) {
          filesToUpload.push({ name: f.n, file: v });
        }
      }

      // Build the request body. Without files, keep posting JSON so
      // existing masters that don't carry uploads aren't disturbed.
      let body: any = payload;
      let headers: any = undefined;
      if (filesToUpload.length > 0) {
        const out = new FormData();
        for (const k of Object.keys(payload)) {
          const v = (payload as Record<string, any>)[k];
          if (v === null || v === undefined) {
            // Laravel treats a missing key as null; explicit empty
            // string is closer to the intent ("clear this column").
            out.append(k, '');
          } else if (Array.isArray(v) || (typeof v === 'object' && !(v instanceof File))) {
            out.append(k, JSON.stringify(v));
          } else {
            out.append(k, String(v));
          }
        }
        for (const { name, file } of filesToUpload) {
          out.append(name, file);
        }
        // Laravel only honors PATCH/PUT methods in multipart bodies
        // when the verb is spoofed via _method, so we POST + spoof on
        // the update path.
        if (editingId != null) out.append('_method', 'PUT');
        body = out;
        headers = { 'Content-Type': 'multipart/form-data' };
      }

      if (editingId != null) {
        const url = `${base}/${editingId}`;
        const { data } = filesToUpload.length > 0
          ? await api.post(url, body, { headers })  // _method=PUT spoof for multipart
          : await api.put(url, body);
        setRecords(prev => prev.map(r => r.id === editingId ? data : r));
        toast.success('Updated', `${cfg.titleSingular || cfg.title} updated successfully`);
      } else {
        const { data } = await api.post(base, body, headers ? { headers } : undefined);
        setRecords(prev => [data, ...prev]);
        toast.success('Created', `${cfg.titleSingular || cfg.title} created successfully`);
      }
      // The form-bundle caches (Customer/Consignee/Product/Vendor/Client/
      // Branch) may now be stale — drop them so this new/edited master shows
      // in their dropdowns on the next form open instead of after the TTL.
      bustAllMasterBundles();
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
    // Defensive: an upstream API that returns a wrapped payload (e.g. legacy
    // `{ message, record }`) can leave a row in state without an `id`. Catch
    // it here so we never send `/endpoint/undefined` to the backend.
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
      bustAllMasterBundles();
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

    // Date fields render as "28-Mar-2026" — applied to every column whose
    // FieldDef declares t: 'date' (purchase_date, warranty_expiry_date, etc.)
    if (f?.t === 'date') {
      if (raw == null || raw === '') return <span className="text-muted">—</span>;
      const d = new Date(String(raw));
      if (isNaN(d.getTime())) return <span>{String(raw)}</span>;
      const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
      const dd = String(d.getDate()).padStart(2, '0');
      return <span style={{ fontVariantNumeric: 'tabular-nums' }}>{`${dd}-${months[d.getMonth()]}-${d.getFullYear()}`}</span>;
    }

    if (fieldName === 'status') {
      const active = String(raw).toLowerCase() === 'active';
      const titleCase = (s: string) => s ? s.charAt(0).toUpperCase() + s.slice(1).toLowerCase() : s;
      const tone = active
        ? { bg: '#dcfce7', fg: '#15803d', dot: '#22c55e', text: 'Active' }
        : { bg: '#fee2e2', fg: '#b91c1c', dot: '#ef4444', text: raw ? titleCase(String(raw)) : 'Inactive' };
      void tone.dot;  // dot indicator dropped per UX request — keep tone struct for parity
      return (
        <span
          className={`mp-status-pill mp-status-${active ? 'active' : 'inactive'}`}
          style={{
            display: 'inline-block',
            padding: '3px 12px',
            borderRadius: 999,
            background: tone.bg,
            color: tone.fg,
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

    // "code"-type identifiers — bold honey-amber glossy chip.
    if (fieldName === 'code') {
      const codeTxt = String(raw).toUpperCase();
      const CODE_MAX = 14;
      const display = codeTxt.length > CODE_MAX ? `${codeTxt.slice(0, CODE_MAX - 1)}…` : codeTxt;
      const chip = (
        <span
          className="rounded-pill d-inline-block"
          style={{
            background: 'linear-gradient(180deg, #fef3c7 0%, #fde68a 100%)',
            color: '#92400e',
            border: '1px solid #f59e0b99',
            padding: '2px 10px',
            fontSize: '10.5px',
            fontWeight: 600,
            lineHeight: 1.3,
            letterSpacing: '0.02em',
            fontVariantNumeric: 'tabular-nums',
            whiteSpace: 'nowrap',
            boxShadow: 'inset 0 1px 0 rgba(255,255,255,0.75), inset 0 -1px 0 rgba(245,158,11,0.22), 0 1px 3px rgba(245,158,11,0.26)',
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

    // KPI Target Type — colored text pill (matches Status/Created By style).
    if (fieldName === 'target_type') {
      const v = String(raw);
      const tone =
        /numeric|number/i.test(v)    ? { bg: '#dbeafe', fg: '#1d4ed8', border: '#3b82f6' } :
        /percent/i.test(v)           ? { bg: '#dcfce7', fg: '#15803d', border: '#22c55e' } :
        /currency/i.test(v)          ? { bg: '#ccfbf1', fg: '#0d9488', border: '#14b8a6' } :
        /boolean|done/i.test(v)      ? { bg: '#ede9fe', fg: '#6d28d9', border: '#8b5cf6' } :
        /date/i.test(v)              ? { bg: '#ffedd5', fg: '#c2410c', border: '#f97316' } :
        /rating/i.test(v)            ? { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b' } :
                                       { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8' };
      return (
        <span
          className="d-inline-block rounded-pill"
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

    // KPI Priority — colored text pill (matches Status/Created By style).
    if (fieldName === 'priority') {
      const v = String(raw);
      const tone =
        /critical/i.test(v) ? { bg: '#fee2e2', fg: '#b91c1c', border: '#ef4444' } :
        /high/i.test(v)     ? { bg: '#ffedd5', fg: '#c2410c', border: '#f97316' } :
        /medium/i.test(v)   ? { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b' } :
        /low/i.test(v)      ? { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8' } :
                              { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8' };
      return (
        <span
          className="d-inline-block rounded-pill"
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

    // Role Type — bold Tailwind-style palette with leading filled icon.
    if (fieldName === 'role_type') {
      const v = String(raw);
      const tone =
        /primary/i.test(v)              ? { bg: '#ede9fe', fg: '#6d28d9', border: '#8b5cf6', icon: 'ri-star-fill' } :
        /ancillary|auxiliary/i.test(v)  ? { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b', icon: 'ri-time-fill' } :
        /operational/i.test(v)          ? { bg: '#ccfbf1', fg: '#0d9488', border: '#14b8a6', icon: 'ri-settings-3-fill' } :
        /administrative/i.test(v)       ? { bg: '#dbeafe', fg: '#1d4ed8', border: '#3b82f6', icon: 'ri-briefcase-fill' } :
        /functional/i.test(v)           ? { bg: '#dcfce7', fg: '#15803d', border: '#22c55e', icon: 'ri-shield-check-fill' } :
                                          { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8', icon: 'ri-circle-fill' };
      return (
        <span
          className="d-inline-flex align-items-center rounded-pill"
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

    // Designation Level — chip styled exactly like the hierarchy strip chips
    // (icon + bold text, fixed bg/fg/border per tier) plus a 5-star rating.
    if (fieldName === 'level') {
      const v = String(raw);
      const TOTAL_STARS = 5;
      const tone =
        /director|ceo/i.test(v)        ? { bg: '#fef3c7', fg: '#92400e', border: '#f59e0b', star: '#f59e0b', icon: 'ri-vip-crown-fill',  rank: 5, short: 'Director / CEO' } :
        /head|hod/i.test(v)            ? { bg: '#ede9fe', fg: '#6d28d9', border: '#8b5cf6', star: '#8b5cf6', icon: 'ri-medal-2-fill',    rank: 4, short: 'Head of Department' } :
        /lead|team/i.test(v)           ? { bg: '#dbeafe', fg: '#1d4ed8', border: '#3b82f6', star: '#3b82f6', icon: 'ri-team-fill',       rank: 3, short: 'Team Leader' } :
        /executive|senior/i.test(v)    ? { bg: '#ccfbf1', fg: '#0d9488', border: '#14b8a6', star: '#14b8a6', icon: 'ri-user-star-fill',  rank: 2, short: 'Executive' } :
        /employee|mid|junior/i.test(v) ? { bg: '#dcfce7', fg: '#15803d', border: '#22c55e', star: '#22c55e', icon: 'ri-user-3-fill',     rank: 1, short: 'Employee' } :
        /intern|trainee/i.test(v)      ? { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8', star: '#94a3b8', icon: 'ri-book-open-fill',  rank: 1, short: 'Intern / Trainee' } :
                                         { bg: '#f1f5f9', fg: '#475569', border: '#94a3b8', star: '#94a3b8', icon: 'ri-circle-line',     rank: 0, short: v };
      return (
        <div
          className="text-center w-100 d-flex flex-column align-items-center justify-content-center"
          style={{ gap: 4 }}
          title={`${tone.rank} of ${TOTAL_STARS} hierarchy rank`}
        >
          <span
            className="d-inline-block rounded-pill"
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

    /* Long free-text cells — truncate with ellipsis + hover tooltip so a
     * 200-char milestone description or address doesn't blow out the
     * column. Mirrors the first-column truncation rule. */
    const txt = String(raw);
    const MAX = 24;
    if (txt.length <= MAX) {
      return <span className="text-body">{txt}</span>;
    }
    return (
      <Tooltip label={txt} maxWidth={320}>
        <span className="text-body" style={{ display: 'inline-block', maxWidth: '100%' }}>
          {txt.slice(0, MAX - 1)}…
        </span>
      </Tooltip>
    );
  };

  // Columns for the shared <DataTable> (TanStack Table). Built dynamically from
  // cfg.cols + ownershipCols so every master renders the same table.
  // No Sr No column here — DataTable's `serial` prop prepends it and numbers the
  // row's VISIBLE position, which stays 1..n when a column is sorted.
  const columns = useMemo(() => {
    const cols: any[] = [];
    cfg.cols.forEach((colName, idx) => {
      // Only the 'level' rating tile is visually centered as a square
      // badge — everything else (status pill, code chip, plain text)
      // reads more natural left-aligned so the column header sits
      // directly above its content's left edge.
      const isCentered = colName === 'level';
      cols.push({
        meta: isCentered ? { align: 'center' } : undefined,
        header: () => (
          <div className={isCentered ? 'text-center' : undefined}>
            {cfg.colL[idx] || colName}
          </div>
        ),
        // Accessor: resolve ref labels upfront so sorting/search see the label.
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
          // Long values are truncated to ~20 chars and hover-tooltipped via
          // the project-wide Tooltip so the column width stays predictable
          // even when someone enters a 50-char master name.
          if (idx === 0 && colName !== 'status' && colName !== 'code') {
            const f = cfg.fields.find(ff => ff.n === colName);
            const raw = f?.ref ? resolveRefLabel(f.ref, f.refL, row[colName]) || '—' : row[colName] ?? '—';
            const txt = String(raw);
            const MAX = 20;
            if (txt.length <= MAX || txt === '—') return <b>{txt}</b>;
            return (
              <Tooltip label={txt} maxWidth={320}>
                <b style={{ display: 'inline-block', maxWidth: '100%' }}>
                  {txt.slice(0, MAX - 1)}…
                </b>
              </Tooltip>
            );
          }
          return formatCell(colName, row);
        },
      });
    });
    ownershipCols.forEach(o => {
      cols.push({
        // Left-aligned (default) — the "Super Admin" / "Client Admin"
        // pill sits naturally at the start of the cell, directly under
        // the header label. Centering wide columns made the small pill
        // float in empty space.
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
    /* Department-master Employees column. Two-line cell ("18" / "employees").
     *
     * Reads the REAL count: MasterController::list withCount('employees') on the
     * departments slug. It used to fall back to a hash-of-the-row-id mock (4-25)
     * when the field was absent — which it always was, so every figure on screen
     * was invented, and the totals happily exceeded the entire employee table.
     * No fallback now: a department with no staff must read 0, not a number. */
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
    // Created Date column — every Eloquent master row carries a created_at
    // timestamp, so the column is added globally. Renders as "12-Jan-2026".
    cols.push({
      // Left-aligned — date text reads cleanest at the cell's start edge.
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
      meta: { align: 'center' },
      enableGlobalFilter: false,
      cell: (info: any) => {
        // Hide actions the current user is not allowed to perform on this master.
        // If none are allowed, render an em-dash so the column still aligns.
        const showAny = caps.view || caps.edit || caps.delete;
        const row = info.row.original;
        // ── Hierarchical edit/delete rule (mirrors backend MasterVisibility) ──
        // super_admin (4) > client_admin/client_user (3) > branch_user/employee (2).
        // Every branch is an isolated peer, so all branch_user/employee
        // creators share one tier.
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
        // Fallback: when the row carries no creator user (NULL or stale
        // created_by) rank it by its own ownership stamp (client-level row
        // with no branch ranks above a branch-stamped row).
        const fallbackCreatorRank = !row?.created_by
          ? (row?.client_id == null ? 4
              : row?.branch_id == null ? 3
              : 2)
          : creatorRank;
        // Block edit/delete only when the creator is strictly higher-
        // ranked AND it's not the user's own record. Super admin always
        // passes.
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
        // System-seeded rows ("Office" address type, "Laptop" / "Mobile"
        // asset categories, "Standard" / "VIP" classifications, etc.)
        // come back from the API with is_system=true. The backend
        // returns 403 on both edit and delete now — block the buttons
        // up front so the user gets a clear tooltip instead of a
        // failed request toast.
        const isSystemRow = !!row?.is_system;
        // Rows the backend reports as still referenced (e.g. a GST rate used by
        // products / HSN codes) can't be deleted — the API 409s. Block the
        // button up front with an explanatory tooltip instead of a failed
        // request (QA #43).
        const inUseRow = !!row?.in_use;
        const editTooltip   = isSystemRow ? 'System-managed — cannot be edited'
                            : blockedByRank ? `Cannot edit — created by ${whoLabel}`
                            : 'Edit';
        const deleteTooltip = isSystemRow ? 'System-managed — cannot be deleted'
                            : blockedByRank ? `Cannot delete — created by ${whoLabel}`
                            : inUseRow ? 'In use — cannot be deleted while it is assigned to products or HSN codes'
                            : 'Delete';
        return (
          <div className="d-flex gap-1 justify-content-center">
            {caps.view   && <ActionBtn title="View"   icon="ri-eye-line"        color="primary" onClick={() => openEdit(info.row.original, true)} />}
            {caps.edit   && <ActionBtn
              title={editTooltip}
              icon="ri-pencil-line"
              color="info"
              // System rows are fully locked — the backend 403s edit
              // attempts, so block the button up front. Users can
              // still hit View to inspect the system-managed values.
              disabled={blockedByRank || isSystemRow}
              onClick={() => openEdit(info.row.original)}
            />}
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, ownershipCols, refData, caps, records]);

  /** Chars of a creator name the "Created By" pill shows before ellipsising. */
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
      // Pick a tone based on the creator's user_type so super-admin / client /
      // branch users each show a distinct pill color.
      const userType = String(row.creator_user_type ?? '').toLowerCase();
      const tone =
        userType === 'super_admin' ? { bg: '#ede9fe', fg: '#6d28d9', kind: 'super' as const } :
        userType === 'client_admin' || userType === 'client_user' ? { bg: '#dbeafe', fg: '#1d4ed8', kind: 'client' as const } :
        userType === 'branch_user' ? { bg: '#ccfbf1', fg: '#0d9488', kind: 'branch' as const } :
        { bg: '#f1f5f9', fg: '#475569', kind: 'other' as const };
      /* The pill is nowrap, so a long creator name (an org name like "INORBVICT
         HEALTHCARE INDIA PRIVATE LIMITED") ran past the column and over
         Employees. Cut at 11 characters; the full name is on hover. */
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
          {/* Same clipping for the scope caption — it carries the same long name. */}
          {scope && (
            <span
              className="text-muted mp-creator-sub"
              title={scope}
              style={{ fontSize: 10.5, maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}
            >
              {scope}
            </span>
          )}
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
    <>
      {/* ───── Shared visual polish for every master ──────────────────────────
          The page header strip, KPI tile hover, the toolbar Add button, badge
          refinements and their dark-mode overrides. Scoped via the .mp-*
          class names so nothing leaks off this surface. */}
      <style>{`
        /* KPI tile lift + indigo glow on hover */
        .mp-kpi-tile { transition: transform 180ms ease, box-shadow 220ms ease, border-color 180ms ease; cursor: default; }
        .mp-kpi-tile:hover {
          transform: translateY(-3px);
          box-shadow: 0 14px 28px rgba(99,102,241,0.14), 0 4px 10px rgba(15,23,42,0.05) !important;
          border-color: rgba(99,102,241,0.40) !important;
        }
        [data-bs-theme="dark"] .mp-kpi-tile:hover,
        [data-layout-mode="dark"] .mp-kpi-tile:hover {
          box-shadow: 0 14px 32px rgba(99,102,241,0.35), 0 4px 10px rgba(0,0,0,0.35) !important;
          border-color: rgba(139,92,246,0.55) !important;
        }

        /* ── Page header strip ────────────────────────────────────────────────
           Ported from the Supplier Management header (.sup-fig .cstrip in
           pages/p2p/p2p-master-management/supplier-management/
           supplier-management.css) so every master opens with the same 58px
           violet strip as the Supplier list. Values are that file's verbatim —
           only the class prefix changed. */
        .mp-cstrip {
          position: relative; overflow: hidden;
          display: flex; align-items: center; justify-content: space-between;
          min-height: 58px; padding: 0 20px;
          border: 1px solid #c4b5fd; border-radius: 16px;
          background: linear-gradient(110deg,#faf5ff 0%,#f3e8ff 25%,#ede9fe 55%,#ddd6fe 85%,#c4b5fd 100%);
          box-shadow: 0 2px 0 rgba(255,255,255,.85) inset, 0 8px 28px rgba(139,92,246,.2), 0 2px 8px rgba(0,0,0,.06);
        }
        .mp-cstrip__accent { position: absolute; left: 0; top: 0; bottom: 0; width: 4px; background: linear-gradient(180deg,#a78bfa,#7c3aed,#5b21b6); border-radius: 16px 0 0 16px; }
        .mp-cstrip__glow { position: absolute; inset: 0; pointer-events: none; background-image: radial-gradient(ellipse at 10% 50%,rgba(196,181,253,.45) 0%,transparent 50%), radial-gradient(ellipse at 90% 50%,rgba(167,139,250,.25) 0%,transparent 55%); }
        .mp-cstrip__sheen { position: absolute; top: 0; left: 0; right: 0; height: 50%; pointer-events: none; background: linear-gradient(180deg,rgba(255,255,255,.5),transparent); border-radius: 16px 16px 0 0; }
        .mp-cstrip__left { display: flex; align-items: center; gap: 13px; z-index: 1; padding-left: 10px; min-width: 0; }
        .mp-cstrip__avatar-wrap { position: relative; flex-shrink: 0; }
        .mp-cstrip__avatar {
          width: 38px; height: 38px; border-radius: 12px;
          display: flex; align-items: center; justify-content: center;
          color: #fff; font-size: 18px;
          background: linear-gradient(135deg,#8b5cf6 0%,#7c3aed 55%,#5b21b6 100%);
          box-shadow: 0 0 0 3px rgba(139,92,246,.25), 0 4px 14px rgba(124,58,237,.45);
        }
        .mp-cstrip__dot { position: absolute; bottom: -1px; right: -1px; width: 10px; height: 10px; border-radius: 50%; background: linear-gradient(135deg,#4ade80,#22c55e); border: 2px solid #f3e8ff; box-shadow: 0 2px 4px rgba(34,197,94,.4); }
        .mp-cstrip__title { font-size: 14.5px; font-weight: 700; color: #3b0764; letter-spacing: -.3px; line-height: 1.2; }
        .mp-cstrip__sub { font-size: 10px; font-weight: 500; color: #6d28d9; opacity: .85; margin-top: 2px; line-height: 1.3; }
        .mp-cstrip__right { display: flex; align-items: center; gap: 7px; z-index: 1; flex-shrink: 0; }
        .mp-cstrip__back {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          height: 34px; padding: 0 14px; border-radius: 12px;
          border: 1px solid rgba(124,58,237,.35); background: rgba(255,255,255,.75);
          color: #6d28d9; font-family: inherit; font-size: 12px; font-weight: 700;
          white-space: nowrap; cursor: pointer;
          transition: background .15s ease, border-color .15s ease, transform .15s ease;
        }
        .mp-cstrip__back:hover { background: #fff; border-color: #a78bfa; transform: translateY(-1px); }
        .mp-cstrip__back i { font-size: 14px; }
        @media (max-width: 640px) {
          .mp-cstrip { flex-direction: column; align-items: flex-start; gap: 10px; padding: 12px 16px; }
        }
        [data-bs-theme="dark"] .mp-cstrip,
        [data-layout-mode="dark"] .mp-cstrip { background: #34216b; border-color: rgba(167,139,250,.28); box-shadow: 0 8px 28px rgba(0,0,0,.4); }
        [data-bs-theme="dark"] .mp-cstrip__glow, [data-layout-mode="dark"] .mp-cstrip__glow,
        [data-bs-theme="dark"] .mp-cstrip__sheen, [data-layout-mode="dark"] .mp-cstrip__sheen { display: none; }
        [data-bs-theme="dark"] .mp-cstrip__title, [data-layout-mode="dark"] .mp-cstrip__title { color: #f3e8ff; }
        [data-bs-theme="dark"] .mp-cstrip__sub, [data-layout-mode="dark"] .mp-cstrip__sub { color: #c4b5fd; }
        [data-bs-theme="dark"] .mp-cstrip__back, [data-layout-mode="dark"] .mp-cstrip__back { background: rgba(255,255,255,.08); color: #ddd6fe; }
        [data-bs-theme="dark"] .mp-cstrip__back:hover, [data-layout-mode="dark"] .mp-cstrip__back:hover { background: rgba(255,255,255,.16); }

        /* "Add <master>" — rides in the DataTable toolbar (right end). Same
           gradient pill the search row used to carry. */
        .mp-add-btn {
          display: inline-flex; align-items: center; justify-content: center; gap: 6px;
          height: 34px; padding: 0 18px; border: 0; border-radius: 999px;
          background: linear-gradient(135deg, #8b5cf6 0%, #7c3aed 45%, #6d28d9 100%);
          color: #fff; font-family: inherit; font-size: 12.5px; font-weight: 600;
          white-space: nowrap; cursor: pointer;
          box-shadow: 0 5px 16px rgba(124,58,237,0.40), 0 2px 5px rgba(91,33,182,0.25);
          transition: transform .18s ease, box-shadow .18s ease, filter .18s ease;
        }
        .mp-add-btn:hover { transform: translateY(-1px); filter: brightness(1.05); }
        .mp-add-btn i { font-size: 15px; }

        /* Status / created-by badges — softer Velzon "subtle" treatment inside
           the table body. */
        .mp-kpi-tile + * .badge,
        .dt-table .badge {
          font-weight: 700;
          letter-spacing: 0.2px;
          padding: 5px 10px;
          border-radius: 999px;
          font-size: 11px;
        }

        /* Search box — give the resting + hover border real contrast so the
           field reads as interactive (not just on focus), then the violet
           focus ring on top. Applied to every search box (HRMS-BUG-116)
           with the hover treatment carried over from the master list card
           fix (HRMS-BUG-085). */
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
          border-color: rgba(99,102,241,0.45);
          box-shadow: 0 0 0 3px rgba(99,102,241,0.18);
        }

        /* Small-form modal — bump the default width so 3-4 field forms
           (Trigger Point, Leave Type, etc.) don't feel cramped. Larger
           lg/xl sizes still take their own reactstrap widths. */
        .master-modal .modal-dialog:not(.modal-lg):not(.modal-xl) {
          max-width: 620px;
        }

        /* Status + Created-By pills — flat translucent fills in dark mode so
           they read as native dark-mode chips rather than light pastels
           floating on a dark surface. */
        [data-bs-theme="dark"] .mp-status-active,
        [data-layout-mode="dark"] .mp-status-active {
          background: rgba(34, 197, 94, 0.18) !important;
          color: #86efac !important;
        }
        [data-bs-theme="dark"] .mp-status-inactive,
        [data-layout-mode="dark"] .mp-status-inactive {
          background: rgba(239, 68, 68, 0.18) !important;
          color: #fca5a5 !important;
        }
        [data-bs-theme="dark"] .mp-creator-super,
        [data-layout-mode="dark"] .mp-creator-super {
          background: rgba(139, 92, 246, 0.18) !important;
          color: #c4b5fd !important;
        }
        [data-bs-theme="dark"] .mp-creator-client,
        [data-layout-mode="dark"] .mp-creator-client {
          background: rgba(59, 130, 246, 0.18) !important;
          color: #93c5fd !important;
        }
        [data-bs-theme="dark"] .mp-creator-branch,
        [data-layout-mode="dark"] .mp-creator-branch {
          background: rgba(20, 184, 166, 0.18) !important;
          color: #5eead4 !important;
        }
        [data-bs-theme="dark"] .mp-creator-other,
        [data-layout-mode="dark"] .mp-creator-other {
          background: rgba(148, 163, 184, 0.18) !important;
          color: #cbd5e1 !important;
        }
        [data-bs-theme="dark"] .mp-creator-sub,
        [data-layout-mode="dark"] .mp-creator-sub { color: rgba(255,255,255,0.55) !important; }

        /* Master list table — clamp long cell values to one line with
         * ellipsis so a 500-char Segment Name (or pasted SQL payload)
         * doesn't blow the row height out and break the table grid.
         * The first-column renderer already adds a hover tooltip for its
         * truncated value; for other columns, browsers show the title
         * attribute on hover when it's present. */
        /* Cells holding a button / badge / status pill must not clip it —
           DataTable's td truncates text by default. */
        .dt-table tbody td:has(.btn),
        .dt-table tbody td:has(.badge),
        .dt-table tbody td:has(.mp-status-active),
        .dt-table tbody td:has(.mp-status-inactive) {
          overflow: visible;
        }
      `}</style>


      {/* A master that belongs to another module (cfg.parent) wears THAT
          module's header instead — the .frm-cstrip strip HR > Custom Fields
          uses — with a Back button to its fixed parent page. Trigger Point
          Master sits in the HR sidebar beside Document Templates and Custom
          Fields, so opening it should not feel like leaving HRMS. */}
      {cfg.parent ? (
        <div className="frm-cstrip mb-3">
          <span className="frm-cstrip-accent" />
          <div className="frm-cstrip-left">
            <div className="frm-cstrip-icon"><i className={cfg.icon} /></div>
            <div className="min-w-0">
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <span className="frm-cstrip-title">{cfg.title}</span>
              </div>
              <div className="frm-cstrip-sub">{cfg.desc}</div>
            </div>
          </div>
          <button
            type="button"
            className="frm-cstrip-back flex-shrink-0"
            onClick={() => navigate(backTo)}
            title={backTitle}
          >
            <i className="ri-arrow-left-line" />
            Back
          </button>
        </div>
      ) : (
      /* Page header — the Supplier Management strip (.sup-fig .cstrip in
          p2p/.../supplier-management.css): violet gradient wash, accent rail,
          glow + sheen, 38px icon tile with an online dot, action on the right.
          Every other master renders it, so those pages open identically. */
      <div className="mp-cstrip mb-3">
        <span className="mp-cstrip__accent" />
        <span className="mp-cstrip__glow" />
        <span className="mp-cstrip__sheen" />
        <div className="mp-cstrip__left">
          <div className="mp-cstrip__avatar-wrap">
            <div className="mp-cstrip__avatar"><i className={cfg.icon} /></div>
            <span className="mp-cstrip__dot" />
          </div>
          <div className="min-w-0">
            <div className="mp-cstrip__title">
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
            <div className="mp-cstrip__sub">
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
                : `Manage ${cfg.title.toLowerCase()} records`}
            </div>
          </div>
        </div>
        <div className="mp-cstrip__right">
          <button type="button" className="mp-cstrip__back" onClick={() => navigate(backTo)} title={backTitle}>
            <i className="ri-arrow-left-line" />
            {backLabel}
          </button>
        </div>
      </div>
      )}

      {/* "What you are doing here" guide — fully retired. Departments now uses
          the same rich client-style header + search-row Add as every other
          master, so this standalone guide strip is no longer rendered. */}

      {/* KPI strip — only when the master config opts in via `kpis`.
          Flex row (flex:1 per tile) so ANY number of KPIs always fills the
          full width evenly — Bootstrap Col spans left a gap when the count
          didn't divide into 12 (e.g. 5 KPIs → 10/12 cols). Wraps on small
          screens via flex-wrap + min-width. */}
      {cfg.kpis && cfg.kpis.length > 0 && (
        <div className="d-flex flex-wrap align-items-stretch mb-3" style={{ gap: 16 }}>
          {cfg.kpis.map(k => {
            const value = k.compute(records);
            return (
              <div
                key={k.label}
                className="mp-kpi-tile"
                style={{
                  flex: '1 1 0',
                  minWidth: 180,
                  borderRadius: 12,
                  border: '1px solid var(--vz-border-color)',
                  background: '#ffffff',
                  boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                  padding: '14px 16px',
                  position: 'relative',
                  overflow: 'hidden',
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
            );
          })}
        </div>
      )}

      {/* Designations-only: KPI strip + hierarchy chips. */}
      {cfg.slug === 'designations' && (
        <DesignationExtras
          records={records}
          filteredCount={filteredRecords.length}
        />
      )}
      {/* Roles-only: KPI strip. The All / Primary / Ancillary tabs moved into the
          table toolbar below (DataTable's `tabs` rail, left of the search). */}
      {cfg.slug === 'roles' && (
        <RolesExtras records={records} />
      )}
      {/* KPI-master only: KPI count cards. */}
      {cfg.slug === 'kpis' && (
        <KpiExtras records={records} />
      )}

      {/* Shared list table (components/ui/DataTable) — the same component the
          rest of the app uses: search, sortable headers, the rows-per-page
          footer and the fit-the-viewport row sizing all live in the component.
          Each master's inline filters and its Add button ride in the toolbar,
          which is where the old search Row used to put them. */}
      <DataTable<any>
        data={filteredRecords}
        columns={columns}
        serial
        accent="violet"
        minWidth={1100}
        fitToViewport
        autoFitRows
        loading={loading}
        searchValue={searchInput}
        onSearchChange={setSearchInput}
        searchPlaceholder={`Search ${cfg.title.toLowerCase()}...`}
        {...(cfg.slug === 'roles' ? {
          tabs: roleTabs,
          activeTab: roleTab,
          onTabChange: (k: string) => setRoleTab(k as typeof roleTab),
        } : {})}
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
            {cfg.slug === 'departments' && (
              <DepartmentInlineFilters
                records={records}
                statusFilter={dpStatusFilter}
                setStatusFilter={setDpStatusFilter}
                parentFilter={dpParentFilter}
                setParentFilter={setDpParentFilter}
              />
            )}
            {cfg.slug === 'roles' && (
              <RolesInlineFilters
                refData={refData}
                typeFilter={roleTypeFilter}
                setTypeFilter={setRoleTypeFilter}
                statusFilter={roleStatusFilter}
                setStatusFilter={setRoleStatusFilter}
                deptFilter={roleDeptFilter}
                setDeptFilter={setRoleDeptFilter}
              />
            )}
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
            {caps.add && (
              <button type="button" className="mp-add-btn" onClick={openAdd}>
                <i className="ri-add-line" />
                Add {singular}
              </button>
            )}
          </>
        }
      />

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
        {/* Header — rich layered gradient with brand-blue → indigo → violet flow,
            decorative glows, and a subtle diagonal sheen for depth. */}
        <div
          className="position-relative overflow-hidden"
          style={{
            background:
              'linear-gradient(135deg, #2b3a85 0%, #405189 28%, #5562c4 55%, #6e7eee 78%, #8b6fe8 100%)',
            padding: '22px 24px',
          }}
        >
          {/* Top-right warm glow — adds a hint of indigo-pink sparkle */}
          <span
            aria-hidden
            style={{
              position: 'absolute', top: -50, right: -30, width: 200, height: 200, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(255,255,255,0.28) 0%, rgba(167,139,250,0.18) 35%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          {/* Bottom-right cyan accent — cools the bottom edge */}
          <span
            aria-hidden
            style={{
              position: 'absolute', bottom: -60, right: 80, width: 180, height: 180, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(102,145,231,0.45) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          {/* Bottom-left violet halo — depth on the title side */}
          <span
            aria-hidden
            style={{
              position: 'absolute', bottom: -50, left: -30, width: 160, height: 160, borderRadius: '50%',
              background: 'radial-gradient(circle, rgba(139,111,232,0.32) 0%, transparent 70%)',
              pointerEvents: 'none',
            }}
          />
          {/* Subtle diagonal sheen — top-left highlight to bottom-right shadow */}
          <span
            aria-hidden
            style={{
              position: 'absolute', inset: 0,
              background: 'linear-gradient(115deg, rgba(255,255,255,0.10) 0%, transparent 35%, transparent 65%, rgba(0,0,0,0.08) 100%)',
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
            {/* No top-right X — footer has Cancel; one dismiss path. */}
          </div>
        </div>
        <Form onSubmit={handleSave} noValidate>
          <ModalBody className="px-4 py-3">
            {sectionedFields.map((group, gIdx) => {
              const p = SECTION_PALETTES[gIdx % SECTION_PALETTES.length];
              return (
                <div key={gIdx} className={gIdx > 0 ? 'mt-3' : ''}>
                  {group.sec && (
                    <div className="d-flex align-items-center gap-2 mb-2">
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
                  <Row className="g-2">
                    {group.fields
                      .filter((f) => {
                        // showWhen — hide a field unless the controlling field
                        // currently equals one of the listed values. Falls back
                        // to `editing` so already-saved rows still gate correctly
                        // on first render before any radio change fires.
                        if (!f.showWhen) return true;
                        const live = radioValues[f.showWhen.field];
                        const fromRow = editing?.[f.showWhen.field];
                        const cur = String((live ?? fromRow) ?? '');
                        const need = Array.isArray(f.showWhen.equals)
                          ? f.showWhen.equals.map(String)
                          : [String(f.showWhen.equals)];
                        return need.includes(cur);
                      })
                      .map((f, i) => renderField(f, i, editing, viewOnly, refData, labelFieldForRef, fieldErrors, clearFieldError, defaultFieldSpan, tenantScopedRecords, sublistValues, (field, next) => setSublistValues(prev => ({ ...prev, [field.n]: next })), apiAutogen, radioValues, (name, value) => setRadioValues((prev) => ({ ...prev, [name]: value }))))}
                  </Row>
                </div>
              );
            })}
          </ModalBody>
          <ModalFooter className="px-4 py-3 d-flex align-items-center justify-content-between flex-wrap gap-2" style={{ borderTop: '1px solid var(--vz-border-color)' }}>
            <span />
            {/* Action buttons on the right */}
            <div className="d-flex align-items-center gap-2">
              <button type="button" className="master-modal-cancel" onClick={() => setModalOpen(false)}>
                <i className="ri-close-line align-middle me-1"></i>
                {viewOnly ? 'Close' : 'Cancel'}
              </button>
              {!viewOnly && (
                /* Hover/active states live on the shared `.master-modal-save`
                   class (masterFormKit.tsx) so every master form gets the
                   same lift-on-hover behaviour — inline styles can't carry
                   :hover so the class is required. */
                <Button
                  type="submit"
                  disabled={saving}
                  className="master-modal-save waves-effect waves-light"
                  style={{ fontSize: 14 }}
                >
                  {saving ? (
                    <>
                      <Spinner size="sm" />
                      <span>{editingId != null ? 'Updating...' : 'Saving...'}</span>
                    </>
                  ) : (
                    <>
                      <i className="ri-save-line" style={{ fontSize: 16 }}></i>
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

    </>
  );
}




/* ────────────────────────────────────────────────────────────────────
 * Employee Tree modal — opens from the Department master's row action
 * (replaces the audit button there). Renders the department's org chart as
 * four tiers: Director / CEO (Branch User) → single HOD → Team Leaders →
 * Employees, connected top-to-bottom. Data from GET /employees/department-tree.
 * ──────────────────────────────────────────────────────────────────── */
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
  // Colour a node by its tier: Branch User = violet, HOD = cyan, Team Leader =
  // green, everyone else = amber.
  const accentFor = (node: TreeNode) => {
    if (node.id.startsWith('u')) return '#7c3aed';
    const r = (node.role || '').toLowerCase();
    if (r.includes('head of department') || r === 'hod') return '#0891b2';
    if (r.includes('team leader')) return '#059669';
    return '#d97706';
  };

  const renderNode = (node: TreeNode): React.ReactNode => {
    const accent = accentFor(node);
    return (
      <li key={node.id}>
        <div className="et-node" style={{ background: `linear-gradient(180deg, ${accent}20 0%, transparent 58%), var(--vz-card-bg)`, borderColor: `${accent}45`, boxShadow: `0 10px 26px ${accent}26` }}>
          <div className="et-avatar-ring" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}66)`, boxShadow: `0 6px 16px ${accent}55` }}>
            {node.photo
              ? <img className="et-avatar et-avatar-img" src={node.photo} alt={node.name} />
              : <div className="et-avatar" style={{ background: `linear-gradient(135deg, ${accent}, ${accent}cc)` }}>{initials(node.name)}</div>}
          </div>
          <div className="et-name">{node.name}</div>
          <div className="et-role" style={{ background: `${accent}1f`, color: accent }}>{node.role}</div>
        </div>
        {node.children && node.children.length > 0 && <ul>{node.children.map(renderNode)}</ul>}
      </li>
    );
  };

  return (
    <Modal isOpen={open} toggle={onClose} centered backdrop="static" contentClassName="et-modal" modalClassName="et-modal-wrap">
      <style>{ET_TREE_CSS}</style>
      <div className="et-modal-header">
        <div className="d-flex align-items-center justify-content-between gap-3">
          <div className="d-flex align-items-center gap-3 min-w-0">
            <span className="et-modal-icon"><i className="ri-organization-chart" /></span>
            <div className="min-w-0">
              <h5 className="mb-0 fw-bold et-modal-title">Employee Tree</h5>
              <div className="et-modal-sub">{(department?.name ?? 'Department')}{/department/i.test(department?.name ?? '') ? '' : ' Department'}</div>
            </div>
          </div>
          <button type="button" className="et-modal-close" onClick={onClose} aria-label="Close"><i className="ri-close-line" /></button>
        </div>
      </div>
      <ModalBody className="et-modal-body" style={{ padding: '22px 12px 26px' }}>
        {loading ? (
          <div className="text-center py-5"><Spinner /></div>
        ) : error ? (
          <div className="text-center text-danger py-4">{error}</div>
        ) : roots && roots.length ? (
          <div className="et-scroll">
            <div className="et-tree"><ul>{roots.map(renderNode)}</ul></div>
          </div>
        ) : (
          <div className="text-center text-muted py-4">No employees in this department yet.</div>
        )}
      </ModalBody>
    </Modal>
  );
}

/* Employee-tree modal styling. The header mirrors the Audit History modal
 * (indigo → violet → purple gradient + white icon box); the body is a pure-CSS
 * org chart (classic nested-UL connectors) with card-style nodes. Theme-aware
 * via the Velzon CSS variables so it reads in light and dark. */
const ET_TREE_CSS = `
.et-modal-wrap .modal-dialog { max-width: 94vw; }
.et-modal {
  border-radius: 16px !important; overflow: hidden; border: 0;
  box-shadow: 0 25px 60px rgba(15,23,42,0.25);
  width: fit-content; min-width: 340px; max-width: 100%; margin: 0 auto;
}
.et-modal-header {
  padding: 16px 18px;
  background:
    radial-gradient(rgba(255,255,255,0.16) 1px, transparent 1px) 0 0 / 13px 13px,
    linear-gradient(135deg, #6366f1 0%, #8b5cf6 55%, #a855f7 100%);
}
.et-modal-title { color: #ffffff !important; letter-spacing: 0.01em; font-size: 16px; }
.et-modal-sub { color: rgba(255,255,255,0.85); font-size: 12px; }
.et-modal-icon {
  display: inline-flex; align-items: center; justify-content: center;
  width: 40px; height: 40px; border-radius: 10px; flex-shrink: 0;
  background: rgba(255,255,255,0.20); color: #ffffff;
  box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
}
.et-modal-icon i { font-size: 18px; line-height: 1; }
.et-modal-close {
  width: 30px; height: 30px; border-radius: 8px; border: 0; flex-shrink: 0;
  background: rgba(255,255,255,0.18); color: #ffffff; cursor: pointer;
  display: inline-flex; align-items: center; justify-content: center;
  transition: background 0.15s ease;
}
.et-modal-close:hover { background: rgba(255,255,255,0.30); }
.et-modal-close i { font-size: 16px; line-height: 1; }
.et-modal-body {
  position: relative;
  max-height: 76vh; overflow-y: auto;
  background:
    radial-gradient(circle at 10% 8%,  rgba(139,92,246,0.22), transparent 24%),
    radial-gradient(circle at 90% 12%, rgba(236,72,153,0.18), transparent 22%),
    radial-gradient(circle at 88% 90%, rgba(6,182,212,0.18),  transparent 26%),
    radial-gradient(circle at 12% 92%, rgba(16,185,129,0.16), transparent 24%),
    linear-gradient(160deg, rgba(139,92,246,0.10) 0%, rgba(168,85,247,0.05) 45%, rgba(236,72,153,0.04) 100%),
    var(--vz-card-bg);
}
.et-scroll { position: relative; z-index: 1; overflow-x: auto; padding: 16px 6px 8px; }
.et-tree { display: inline-block; text-align: center; }
.et-avatar-img { object-fit: cover; background: var(--vz-card-bg); }
.et-tree ul { position: relative; padding: 26px 0 0; margin: 0; display: flex; justify-content: center; list-style: none; }
.et-tree li { position: relative; padding: 26px 8px 0; list-style: none; }
.et-tree li::before, .et-tree li::after {
  content: ''; position: absolute; top: 0; right: 50%; width: 50%; height: 26px;
  border-top: 2px solid rgba(124,58,237,0.32);
}
.et-tree li::after { right: auto; left: 50%; border-left: 2px solid rgba(124,58,237,0.32); }
.et-tree li:only-child::before, .et-tree li:only-child::after { display: none; }
.et-tree li:only-child { padding-top: 26px; }
.et-tree li:first-child::before, .et-tree li:last-child::after { border: 0 none; }
.et-tree li:last-child::before { border-right: 2px solid rgba(124,58,237,0.32); border-radius: 0 7px 0 0; }
.et-tree li:first-child::after { border-radius: 7px 0 0 0; }
.et-tree ul ul::before {
  content: ''; position: absolute; top: 0; left: 50%; width: 0; height: 26px;
  border-left: 2px solid rgba(124,58,237,0.32);
}
.et-tree > ul { padding-top: 0; }
.et-node {
  display: inline-flex; flex-direction: column; align-items: center; justify-content: flex-start; gap: 9px;
  width: 184px; min-height: 184px; padding: 18px 14px 15px; border-radius: 16px;
  border: 1px solid rgba(139,92,246,0.12); background: var(--vz-card-bg);
  box-shadow: 0 8px 20px rgba(76,29,149,0.10); transition: transform .15s ease, box-shadow .15s ease;
}
.et-node:hover { transform: translateY(-3px); box-shadow: 0 14px 28px rgba(99,102,241,0.20); }
.et-avatar-ring {
  padding: 3px; border-radius: 50%; display: inline-flex;
}
.et-avatar {
  width: 60px; height: 60px; border-radius: 50%; color: #fff; display: flex;
  align-items: center; justify-content: center; font-weight: 800; font-size: 20px;
  border: 3px solid var(--vz-card-bg);
}
.et-name { font-weight: 700; font-size: 14.5px; line-height: 1.25; color: var(--vz-body-color); text-align: center; }
.et-role {
  display: inline-block; padding: 4px 12px; border-radius: 999px;
  font-size: 10px; font-weight: 800; text-transform: uppercase; letter-spacing: .04em;
}
`;

/* ────────────────────────────────────────────────────────────────────
 * Audit History modal — opens from the row's "clock" action button.
 * Shows a compact event timeline for that record. Today the entries are
 * synthesized from the record's own created_at / updated_at fields (and
 * the creator/branch/client metadata the API already returns); a real
 * activity_logs feed can be wired later from the existing backend table.
 * ──────────────────────────────────────────────────────────────────── */
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
      color: '#10b981',
      title: 'Created',
      user: userLabel,
      at: fmt(record.created_at),
    });

    if (record.updated_at && record.updated_at !== record.created_at) {
      list.push({
        kind: 'updated',
        icon: 'ri-edit-2-line',
        color: '#6366f1',
        title: 'Updated',
        user: userLabel,
        at: fmt(record.updated_at),
      });
    }

    return list;
  }, [record]);

  return (
    <Modal isOpen={open} toggle={onClose} centered size="md" backdrop="static" contentClassName="audit-modal">
      <div className="audit-modal-header">
        <div className="d-flex align-items-start justify-content-between gap-3">
          <div className="d-flex align-items-center gap-3 min-w-0">
            <span className="audit-modal-icon">
              <i className="ri-history-line" />
            </span>
            <div className="min-w-0">
              <h5 className="mb-0 fw-bold audit-modal-title">
                Audit History — {masterTitle}
              </h5>
              <small className="audit-modal-sub">
                {record ? `Record #${record.id}${primaryLabel ? ` · ${primaryLabel}` : ''}` : ''}
              </small>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="audit-modal-close"
          >
            <i className="ri-close-line" />
          </button>
        </div>
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
      <style>{`
        .audit-modal {
          border-radius: 16px !important;
          overflow: hidden;
          border: 0;
          box-shadow: 0 25px 60px rgba(15,23,42,0.25);
        }
        /* Gradient header — matches the Edit Trigger modal + every other
           in-app gradient (indigo → violet → purple). */
        .audit-modal-header {
          padding: 18px 22px;
          background: linear-gradient(135deg, #6366f1 0%, #8b5cf6 60%, #a855f7 100%);
          border-bottom: 0;
        }
        .audit-modal-title {
          color: #ffffff !important;
          letter-spacing: 0.01em;
          font-size: 16px;
        }
        .audit-modal-sub {
          color: rgba(255,255,255,0.85) !important;
          font-size: 12px;
        }
        .audit-modal-icon {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 40px; height: 40px;
          border-radius: 10px;
          flex-shrink: 0;
          background: rgba(255,255,255,0.20);
          color: #ffffff;
          box-shadow: inset 0 1px 0 rgba(255,255,255,0.18);
        }
        .audit-modal-icon i { font-size: 18px; line-height: 1; }
        .audit-modal-close {
          width: 30px; height: 30px;
          border-radius: 8px;
          border: 0;
          background: rgba(255,255,255,0.18);
          color: #ffffff;
          cursor: pointer;
          flex-shrink: 0;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          transition: background 0.15s ease;
        }
        .audit-modal-close:hover {
          background: rgba(255,255,255,0.30);
        }
        .audit-modal-close i { font-size: 16px; line-height: 1; }
        /* Body picks up the card-bg variable so dark mode inverts cleanly. */
        .audit-modal-body { background: var(--vz-card-bg); }
        /* Timeline — vertical rail behind the icon dots */
        .audit-timeline {
          position: relative;
          display: flex;
          flex-direction: column;
          gap: 10px;
        }
        .audit-timeline::before {
          content: '';
          position: absolute;
          top: 22px; bottom: 22px;
          left: 19px;
          width: 2px;
          background: linear-gradient(180deg,
            rgba(99,102,241,0.30) 0%,
            rgba(99,102,241,0.06) 100%);
        }
        .audit-event {
          display: flex;
          align-items: flex-start;
          gap: 12px;
          position: relative;
          padding: 10px 12px 10px 10px;
          border-radius: 10px;
          background: rgba(99,102,241,0.04);
          border: 1px solid rgba(99,102,241,0.10);
          transition: background 140ms ease, border-color 140ms ease;
        }
        .audit-event:hover {
          background: rgba(99,102,241,0.08);
          border-color: rgba(99,102,241,0.20);
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

        /* Dark-mode parity */
        [data-bs-theme="dark"] .audit-event,
        [data-layout-mode="dark"] .audit-event {
          background: rgba(99,102,241,0.10);
          border-color: rgba(99,102,241,0.22);
        }
        [data-bs-theme="dark"] .audit-event:hover,
        [data-layout-mode="dark"] .audit-event:hover {
          background: rgba(99,102,241,0.18);
          border-color: rgba(99,102,241,0.40);
        }
        [data-bs-theme="dark"] .audit-timeline::before,
        [data-layout-mode="dark"] .audit-timeline::before {
          background: linear-gradient(180deg,
            rgba(139,92,246,0.50) 0%,
            rgba(139,92,246,0.10) 100%);
        }
      `}</style>
    </Modal>
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

// Auto-derive a target field's value from a source field's typed value.
// Per-master/per-field algorithms: today only UOM `short_code` is wired
// (Kilogram → KG, Metric Ton → MT). Falls back to the first 3 uppercase
// letters of the source string so unknown inputs still produce a usable
// suggestion the user can refine.
// Unit short codes follow the standard "First letter caps + prefix
// lowercase" convention used on Indian commerce forms — e.g. "Kg"
// rather than "KG", "Mm" rather than "MM". Counts / non-SI units
// (PCS, BOX, CTN…) stay uppercase since that's how they read in
// stock and packaging lists.
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
  // Common one-L misspellings — surface the same Mm short code so a
  // typo in the title still produces the correct unit code.
  'milimeter': 'Mm', 'milimetre': 'Mm', 'milimeters': 'Mm', 'milimetres': 'Mm',
  'kilometer': 'Km', 'kilometre': 'Km', 'kilometers': 'Km', 'kilometres': 'Km',
  // "Killogram" with double L — same Kg short code.
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
    // Multi-word fallback — first letter of each word, up to 4 chars.
    const words = raw.split(/\s+/);
    if (words.length > 1) {
      return words.map(w => (w[0] || '').toUpperCase()).join('').slice(0, 4);
    }
    // Single word fallback — first 3 letters uppercase.
    return raw.toUpperCase().replace(/[^A-Z]/g, '').slice(0, 3);
  }
  // Generic fallback for unknown master/field pairs.
  return raw.toUpperCase().slice(0, 4);
}

/* ── "What you are doing here" — gradient step tiles ── */
const STEP_PALETTES: { grad: string; tint: string; border: string; accent: string }[] = [
  { grad: 'linear-gradient(135deg, #405189 0%, #6691e7 100%)', tint: 'linear-gradient(135deg, rgba(64,81,137,0.08), rgba(102,145,231,0.04))', border: 'rgba(64,81,137,0.20)', accent: '#405189' },
  { grad: 'linear-gradient(135deg, #0ab39c 0%, #30d5b5 100%)', tint: 'linear-gradient(135deg, rgba(10,179,156,0.08), rgba(48,213,181,0.04))', border: 'rgba(10,179,156,0.22)', accent: '#0ab39c' },
  { grad: 'linear-gradient(135deg, #f7b84b 0%, #ffd47a 100%)', tint: 'linear-gradient(135deg, rgba(247,184,75,0.10), rgba(255,212,122,0.05))', border: 'rgba(247,184,75,0.25)', accent: '#d97a08' },
  { grad: 'linear-gradient(135deg, #6a5acd 0%, #a78bfa 100%)', tint: 'linear-gradient(135deg, rgba(106,90,205,0.08), rgba(167,139,250,0.04))', border: 'rgba(106,90,205,0.20)', accent: '#6a5acd' },
  { grad: 'linear-gradient(135deg, #299cdb 0%, #5fc8ff 100%)', tint: 'linear-gradient(135deg, rgba(41,156,219,0.08), rgba(95,200,255,0.04))', border: 'rgba(41,156,219,0.20)', accent: '#299cdb' },
  { grad: 'linear-gradient(135deg, #f06548 0%, #ff9e7c 100%)', tint: 'linear-gradient(135deg, rgba(240,101,72,0.08), rgba(255,158,124,0.04))', border: 'rgba(240,101,72,0.22)', accent: '#f06548' },
];

function WhatYouDoHere({ cfg, onAdd, canAdd, onBack }: { cfg: MasterConfig; onAdd?: () => void; canAdd?: boolean; onBack?: () => void }) {
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
          <div className="d-flex align-items-center gap-2 flex-wrap">
            {/* "Back to Master list" pill sits immediately before Add so
                the action cluster matches the Legal Entities header
                layout (back action + primary CTA on the right). */}
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                title="Back to Master list"
                className="d-inline-flex align-items-center justify-content-center gap-2 rounded-pill"
                style={{
                  height: 38,
                  padding: '0 18px',
                  background: 'color-mix(in srgb, #405189 8%, #ffffff)',
                  color: '#405189',
                  border: '1px solid color-mix(in srgb, #405189 22%, transparent)',
                  fontSize: 13,
                  fontWeight: 600,
                  cursor: 'pointer',
                  transition: 'background 0.18s ease',
                  whiteSpace: 'nowrap',
                }}
                onMouseEnter={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, #405189 14%, #ffffff)'; }}
                onMouseLeave={(e) => { (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, #405189 8%, #ffffff)'; }}
              >
                <i className="ri-arrow-left-line" style={{ fontSize: 15 }}></i>
                Back to Master list
              </button>
            )}
            {canAdd && onAdd && (
              <Button
                className="btn-label waves-effect waves-light rounded-pill border-0"
                onClick={onAdd}
                style={{
                  background: 'linear-gradient(135deg, #405189 0%, #6691e7 100%)',
                  color: '#fff',
                  boxShadow: '0 4px 10px rgba(64,81,137,0.25)',
                }}
              >
                <i className="ri-add-line label-icon align-middle rounded-pill fs-16 me-2"></i>
                Add {singular}
              </Button>
            )}
          </div>
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
  // Fresh Tailwind-style palette — bright + deep pair per tier, plus an
  // accent gradient that drives the KPI icon tile + colored shadow halo.
  const TIERS: {
    label: string; short: string; icon: string;
    bg: string; fg: string; border: string;
    deep: string; bright: string; accent: string;
  }[] = [
    { label: 'Director / CEO',           short: 'Director / CEO', icon: 'ri-vip-crown-fill',  bg: '#fef3c7', fg: '#92400e', border: '#f59e0b', deep: '#b45309', bright: '#f59e0b', accent: 'linear-gradient(135deg,#b45309 0%,#f59e0b 100%)' },
    { label: 'Head of Department (HOD)', short: 'HOD',            icon: 'ri-medal-2-fill',    bg: '#ede9fe', fg: '#6d28d9', border: '#8b5cf6', deep: '#6d28d9', bright: '#a78bfa', accent: 'linear-gradient(135deg,#6d28d9 0%,#a78bfa 100%)' },
    { label: 'Team Leader',              short: 'Team Leader',    icon: 'ri-team-fill',       bg: '#dbeafe', fg: '#1d4ed8', border: '#3b82f6', deep: '#1d4ed8', bright: '#60a5fa', accent: 'linear-gradient(135deg,#1d4ed8 0%,#60a5fa 100%)' },
    { label: 'Executive',                short: 'Executive',      icon: 'ri-user-star-fill',  bg: '#ccfbf1', fg: '#0d9488', border: '#14b8a6', deep: '#0f766e', bright: '#2dd4bf', accent: 'linear-gradient(135deg,#0f766e 0%,#2dd4bf 100%)' },
    { label: 'Employee',                 short: 'Employee',       icon: 'ri-user-3-fill',     bg: '#dcfce7', fg: '#15803d', border: '#22c55e', deep: '#15803d', bright: '#4ade80', accent: 'linear-gradient(135deg,#15803d 0%,#4ade80 100%)' },
    { label: 'Intern / Trainee',         short: 'Intern',         icon: 'ri-book-open-fill',  bg: '#f1f5f9', fg: '#475569', border: '#94a3b8', deep: '#475569', bright: '#94a3b8', accent: 'linear-gradient(135deg,#475569 0%,#94a3b8 100%)' },
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
          style={{
            ['--kpi-bright' as any]: '#6691e7',
            ['--kpi-deep' as any]: '#3d4eb1',
            ['--kpi-accent' as any]: 'linear-gradient(135deg,#3d4eb1 0%,#6691e7 100%)',
          }}
        >
          <div className="dsn-kpi-text">
            <span className="dsn-kpi-label">Total</span>
            <span className="dsn-kpi-num">{total}</span>
          </div>
          <span
            className="dsn-kpi-icon"
            style={{
              background: 'linear-gradient(135deg, #3d4eb1 0%, #6691e7 100%)',
              color: '#ffffff',
              boxShadow: '0 4px 10px rgba(102,145,231,0.40), inset 0 1px 0 rgba(255,255,255,0.25)',
            }}
          >
            <i className="ri-database-2-fill" />
          </span>
        </div>
        {tierCounts.map(t => (
          <div
            className="dsn-kpi"
            key={t.label}
            title={`${t.label} designations`}
            style={{
              ['--kpi-bright' as any]: t.bright,
              ['--kpi-deep' as any]: t.deep,
              ['--kpi-accent' as any]: t.accent,
            }}
          >
            <div className="dsn-kpi-text">
              <span className="dsn-kpi-label">{t.short}</span>
              <span className="dsn-kpi-num">{t.count}</span>
            </div>
            <span
              className="dsn-kpi-icon"
              style={{
                background: t.accent,
                color: '#ffffff',
                boxShadow: `0 4px 10px ${t.bright}55, inset 0 1px 0 rgba(255,255,255,0.25)`,
              }}
            >
              <i className={t.icon} />
            </span>
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

/* Inline Status / Parent filters — sits between the search box and the
 * Add button row on the Department master. */
function DepartmentInlineFilters({
  records,
  statusFilter, setStatusFilter,
  parentFilter, setParentFilter,
}: {
  records: any[];
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  parentFilter: string;
  setParentFilter: (v: string) => void;
}) {
  return (
    <div className="dsn-inline-filters d-flex align-items-center flex-wrap" style={{ gap: 12 }}>
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
        <span className="dsn-il-label">Parent</span>
        <div style={{ minWidth: 160 }}>
          <MasterSelect
            value={parentFilter}
            onChange={(v) => setParentFilter(v || 'all')}
            options={(() => {
              // Only departments that are actually being used as a parent of
              // another row appear in this dropdown — filtering by a leaf
              // department would always return zero rows, so it shouldn't show.
              const parentIds = new Set<string>();
              for (const r of records) {
                if (r?.parent_id != null && r.parent_id !== '') parentIds.add(String(r.parent_id));
              }
              const parentRows = records.filter((d: any) => parentIds.has(String(d.id)));
              return [
                { value: 'all',  label: 'All' },
                { value: 'root', label: 'Root (no parent)' },
                ...parentRows.map((d: any) => ({ value: String(d.id), label: String(d.name) })),
              ];
            })()}
            placeholder="All"
          />
        </div>
      </div>
    </div>
  );
}

/* ────────────────────────────────────────────────────────────────────────────
 * Role-master extras: KPI strip (Total / Primary / Ancillary / Active /
 * Assigned / Inactive) + filter chip tabs (All / Primary / Ancillary).
 * Renders only inside the Roles master.
 * ────────────────────────────────────────────────────────────────────────── */
/* KPI strip for the Roles master. The All / Primary / Ancillary tabs used to
   live here too; they now ride in the DataTable toolbar (see `roleTabs`). */
function RolesExtras({ records }: { records: any[] }) {
  const total = records.length;
  const primaryCount = records.filter(r => /primary/i.test(String(r.role_type ?? ''))).length;
  const ancillaryCount = records.filter(r => /ancillary|auxiliary|operational|administrative|functional/i.test(String(r.role_type ?? ''))).length;
  const activeCount = records.filter(r => String(r.status ?? '').toLowerCase() === 'active').length;
  const inactiveCount = records.filter(r => String(r.status ?? '').toLowerCase() !== 'active').length;
  const assignedCount = records.filter(r => Number(r.employees_count ?? 0) > 0).length;

  // Fresh palette — paired bright + deep colors per tier, plus an accent
  // gradient that drives the card's top strip + bg wash.
  const KPIS = [
    { key: 'total',     label: 'Total Roles',     icon: 'ri-shield-fill',          deep: '#3d4eb1', bright: '#6691e7', accent: 'linear-gradient(135deg,#3d4eb1 0%,#6691e7 100%)', tint: 'rgba(102,145,231,0.10)', value: total },
    { key: 'primary',   label: 'Primary Roles',   icon: 'ri-star-fill',            deep: '#6940d8', bright: '#a78bfa', accent: 'linear-gradient(135deg,#6940d8 0%,#a78bfa 100%)', tint: 'rgba(167,139,250,0.12)', value: primaryCount },
    { key: 'ancillary', label: 'Ancillary Roles', icon: 'ri-time-fill',            deep: '#e08a1a', bright: '#fbbf60', accent: 'linear-gradient(135deg,#e08a1a 0%,#fbbf60 100%)', tint: 'rgba(247,184,75,0.12)', value: ancillaryCount },
    { key: 'active',    label: 'Active',          icon: 'ri-checkbox-circle-fill', deep: '#089d7a', bright: '#34d4ad', accent: 'linear-gradient(135deg,#089d7a 0%,#34d4ad 100%)', tint: 'rgba(52,212,173,0.12)', value: activeCount },
    { key: 'assigned',  label: 'Assigned',        icon: 'ri-user-3-fill',          deep: '#1e6dd6', bright: '#5fc8ff', accent: 'linear-gradient(135deg,#1e6dd6 0%,#5fc8ff 100%)', tint: 'rgba(95,200,255,0.14)', value: assignedCount },
    { key: 'inactive',  label: 'Inactive',        icon: 'ri-forbid-fill',          deep: '#d63a5e', bright: '#ff8b9b', accent: 'linear-gradient(135deg,#d63a5e 0%,#ff8b9b 100%)', tint: 'rgba(255,139,155,0.12)', value: inactiveCount },
  ];

  return (
    <div className="role-extras mb-3">

      {/* KPI cards */}
      <div className="role-kpis">
        {KPIS.map(k => (
          <div
            className="role-kpi"
            key={k.key}
            title={k.label}
            style={{
              ['--kpi-deep' as any]: k.deep,
              ['--kpi-bright' as any]: k.bright,
              ['--kpi-accent' as any]: k.accent,
              ['--kpi-tint' as any]: k.tint,
            }}
          >
            <div className="role-kpi-text">
              <span className="role-kpi-label">{k.label}</span>
              <span className="role-kpi-num">{k.value}</span>
            </div>
            <span
              className="role-kpi-icon"
              style={{
                background: k.accent,
                color: '#ffffff',
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

/* Inline Type / Status / Department filters for the Roles master. */
function RolesInlineFilters({
  refData,
  typeFilter,   setTypeFilter,
  statusFilter, setStatusFilter,
  deptFilter,   setDeptFilter,
}: {
  refData: Record<string, any[]>;
  typeFilter: string;
  setTypeFilter: (v: string) => void;
  statusFilter: string;
  setStatusFilter: (v: string) => void;
  deptFilter: string;
  setDeptFilter: (v: string) => void;
}) {
  const TYPES = ['Primary', 'Ancillary'];
  const departments = refData['departments'] || [];
  return (
    <div className="role-inline-filters d-flex align-items-center flex-wrap" style={{ gap: 12 }}>
      <div className="role-il-group">
        <span className="role-il-label">Type</span>
        <div style={{ minWidth: 140 }}>
          <MasterSelect
            value={typeFilter}
            onChange={(v) => setTypeFilter(v || 'all')}
            options={[{ value: 'all', label: 'All Types' }, ...TYPES.map(t => ({ value: t, label: t }))]}
            placeholder="All Types"
          />
        </div>
      </div>
      <div className="role-il-group">
        <span className="role-il-label">Status</span>
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
      <div className="role-il-group">
        <span className="role-il-label">Department</span>
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

/* ────────────────────────────────────────────────────────────────────────────
 * KPI-master extras: 5 KPI count cards.
 * ────────────────────────────────────────────────────────────────────────── */
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
    <div className="kpi-extras mb-3">

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

/* Inline Role / Target / Priority filters for the KPI master. */
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

  // Sublist field — renders inline cards + an inline editor panel that
  // expands when adding/editing (no modal-on-modal stacking).
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
  // Auto-generated fields are locked in BOTH add and edit flows: on add the
  // value is computed from existing records, on edit we keep whatever was
  // saved. Either way the input is rendered read-only so users can't override
  // the auto-managed value.
  const isAutogen = (!!f.autogen || !!f.autogenApi) && !viewOnly;
  // Server-derived value (from /master/{slug}/next-code) wins when present.
  // Otherwise fall back to the client-side autogen() preview so the field
  // never renders empty between modal-open and the API response.
  const apiAutogenVal = apiAutogen[f.n];
  const autogenVal = (isAutogen && editing == null)
    ? (apiAutogenVal || (f.autogen ? f.autogen(allRecords) : ''))
    : '';
  /* Clean the hydrated value for number fields so edit-mode never
   * shows stale decimals / scientific-notation entries that pre-date
   * the integer-only rule (e.g. legacy "34334434.0000" rows show as
   * "34334434"). The sanitised value also feeds back into the form
   * payload as integer. */
  const rawDefaultVal = (isAutogen && editing == null) ? autogenVal : (editing?.[f.n] ?? '');
  const defaultVal = (() => {
    if (f.t !== 'number' || rawDefaultVal === '' || rawDefaultVal == null) return rawDefaultVal;
    // Truncate at the first non-digit (drops decimals + exponent suffix),
    // so "34334434.0000" → "34334434" and "1.5e3" → "1".
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
    let refRows = (f.ref === undefined || editing == null)
      ? rows
      : rows.filter((r: any) => String(r.id) !== String(editing.id));
    // Cascade filter — e.g. the State dropdown shows only states of the selected
    // Country (bug #10). Uses the source field's live value (tracked in
    // radioValues) or the editing row's value; shows all when nothing's picked
    // yet so the field is never empty-locked.
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
        // Track the value so cascade targets (e.g. State ← Country) can filter.
        onChange={(v) => { onFieldChange(); onRadioChange(f.n, v); }}
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
  } else if (f.t === 'radio') {
    // Vertical radio group with optional per-option helper text. Drives the
    // controlled `radioValues` map so sibling fields can toggle visibility
    // via `showWhen`. The actual posted value comes from the checked
    // <input>'s `name`, picked up by FormData on submit.
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
                // Stronger unchecked border in light mode so each option
                // reads as a tappable card, not a label floating in space.
                // Dark mode still uses the theme variable.
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
    // Future-only dates (e.g. warranty expiry) get a hard min on the
    // picker so the calendar literally can't open a past day. The
    // on-save validator below catches typed / pasted values that
    // bypass the picker.
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
    // The `required` attribute is only set on CREATE — on EDIT the
    // existing file already lives on the server, so native browser
    // validation must not block submit when the user hasn't picked
    // a new file. Backend convention: column ending in `_path` holds
    // the stored disk path. We surface a "View" link for it so the
    // user can confirm what's already attached before replacing.
    const isEdit = !!editing;
    const hintParts: string[] = [];
    if (f.accept) hintParts.push(f.accept);
    if (f.maxMb) hintParts.push(`Max ${f.maxMb}MB`);
    const existingPath: string | null = editing
      ? (editing[`${f.n}_path`] || editing[f.n] || null)
      : null;
    /* Prefer the URL the SERVER resolved (MasterController::withOwnership adds
     * `<column>_url` for every *_path). Building it here from the raw path
     * assumes files sit under {origin}/storage/, which is only true on the
     * local disk — on the Azure deployment they live on the blob host, so the
     * client-built link 404'd there. resolveFileUrl stays as the fallback for
     * responses that predate the `_url` field. */
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
    // Auto-capitalize the first alphabetic character on text inputs as the
    // user types — only the first letter, rest of the casing is preserved
    // exactly as typed. Skipped for email/number, code-style, and contact
    // fields (handled by SKIP_AUTOCAP_FIELDS below).
    const SKIP_AUTOCAP_FIELDS = new Set([
      'code', 'iso_code', 'state_code', 'short_code', 'hsn_code',
      'gstin', 'pan', 'tan', 'cin', 'iec',
      'ifsc_code', 'swift_code', 'ad_code',
      'email', 'website', 'url', 'domain', 'phone', 'mobile', 'whatsapp',
      'pincode', 'postal_code', 'zip',
    ]);
    const shouldAutoCap = f.t === 'text' && !isAutogen && !SKIP_AUTOCAP_FIELDS.has(f.n);
    /* Numeric-only text fields — HSN/SAC codes are 4–10 digit numeric per
     * Indian GST notification, so strip anything non-numeric as the user
     * types / pastes. The validateForm pattern catches anything that slips
     * through (e.g. programmatic value setters); this just gives instant
     * feedback while typing. Extend this set if more code-style fields
     * need the same behaviour (e.g. PIN, mobile). */
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
          // Re-position the caret roughly where it was — clamped to the
          // new (possibly shorter) string length.
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
      /* Number-input sanitiser. HTML `type="number"` accepts scientific
       * notation (`e`, `+`, `-`) which silently breaks numeric fields — a
       * user typing "e" leaves the value as just "e" and the form submits NaN.
       * Strip everything except digits and a SINGLE decimal point so valid
       * decimals (e.g. GST 18.5, exchange rates) are preserved (bug #18). */
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
          try { target.setSelectionRange(cursor, cursor); } catch { /* selection on type=number is finicky in some browsers */ }
        }
      }
      onFieldChange();
    };

    /* Block the keys that drive HTML number inputs off the integer
     * rails before they ever land in the value — keeps the cursor in
     * a sensible spot and avoids the "I typed e and nothing shows" UX
     * trap. Paste is still cleaned by handleInput above. */
    const handleNumberKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
      if (f.t !== 'number') return;
      // Allow '.' for decimals (bug #18); still block scientific-notation keys.
      if (['e', 'E', '+', '-', ','].includes(e.key)) {
        e.preventDefault();
      }
    };

    /* Default 50-char cap on text inputs — names, titles, labels and
     * other free-text master fields are way short of 50 chars in
     * practice, so this stops anyone pasting paragraphs into a name.
     * Number / email inputs and explicit `maxLen` overrides bypass it. */
    const TEXT_MAX = 50;
    const maxLength =
      f.t === 'text' && !isAutogen
        ? (typeof (f as any).maxLen === 'number' ? (f as any).maxLen : TEXT_MAX)
        : undefined;

    /* Number-range defaults — uncapped numeric fields previously let users
     * paste 30M+ values that overflowed the column on the backend. The
     * defaults below are wide enough for any sane business value (credit
     * days, percentages, INR thresholds, etc.) but stop the SQL overflow.
     * Field configs can override via `min` / `max` for stricter ranges
     * (e.g. percentages at max:100). */
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
        // Number fields and numeric-only text fields (HSN/SAC) get the on-screen
        // numeric keypad on mobile + a hint to the browser's autofill heuristics.
        inputMode={(f.t === 'number' || isNumericOnly) ? 'numeric' : undefined}
        // `key` forces a remount when the auto-generated value changes between
        // opens of the Add modal so React picks up the new defaultValue.
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

  // Optional uppercase tag after the label — used by file fields to show
  // "MANDATORY" (red) vs "OPTIONAL" (muted) so users immediately know which
  // attachments are required.
  const optTag = f.optionalLabel;
  const isMandatoryTag = !!optTag && /mandator/i.test(optTag);

  return (
    <Col md={span} key={f.n || `f-${i}`}>
      <Label className="d-flex align-items-center gap-2">
        {f.icon && <i className={f.icon} style={{ fontSize: 13, color: 'var(--vz-secondary-color)' }} />}
        <span>{f.l}{f.r && <span className="req-star">*</span>}</span>
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
