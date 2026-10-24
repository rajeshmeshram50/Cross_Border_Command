import { Suspense, type ComponentProps, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import WorklistPager from "../../../components/ui/WorklistPager";
import { createPortal } from 'react-dom';
import api from '../../../api';
import { ShimmerClmMaster } from '../../../components/ui/Shimmer';
import { useToast } from '../../../contexts/ToastContext';
import { useSelectionLock } from '../../../hooks/useSelectionLock';
import { useScrollLock } from '../../../hooks/useScrollLock';
import { bustAllMasterBundles } from '../../../utils/bustMasterBundles';
import { CLM_CSS, PER_PAGE, paginate, useAutoFitRows } from '../shared/clmShared';
import { ClmPageHeader, ClmBrefBox, ICO } from '../shared/ClmPageShell';
import { TruncCell } from '../shared/clmCommon';
import BaseTooltip from '../../../components/ui/Tooltip';
const Tooltip = (props: ComponentProps<typeof BaseTooltip>) => <BaseTooltip themed {...props} />;
import { MasterSelect } from '../../../components/ui/MasterSelect';
import { MasterMultiSelect } from '../../master/masterFormKit';
import ClmDcpFilterModal, { type DcpFilters, countDcpFilters } from './ClmDcpFilterModal';
import AuthorityBadges from './AuthorityBadges';
const KycModal = lazyPage(() => import('./ClmKycModal'));
const DdModal  = lazyPage(() => import('./ClmDdModal'));
const QcModal  = lazyPage(() => import('./ClmQcModal'));
const TlModal  = lazyPage(() => import('./ClmTlModal'));
import SearchClear from '../../../components/ui/SearchClear';
import SegmentBadge, { segmentLabel } from '../../../components/ui/SegmentBadge';
import { lazyPage } from '../../../utils/lazyPage';


type DocSel = Record<string, 'M' | 'O'>;
type DocSelections = { kyc?: DocSel; dd?: DocSel; tl?: DocSel; qc?: DocSel };
type DocType = 'domestic' | 'international';

type SegRule = {
  id: number; rule_code: string; segment_id: number | null;
  segment_code: string; regulatory_status: 'highly' | 'less';
  document_type: DocType | null;
  auths_json: string[] | null;
  doc_selections: DocSelections;
  mandatory_count: number; optional_count: number;
};
const DOC_TYPE_LABEL: Record<DocType, string> = { domestic: 'Domestic', international: 'International' };

type Counts = { all: number; highly: number; less: number };

type Segment   = { id: number; code: string; name: string; regulatory_status: 'highly'|'less'; buyer_consignee: 'allowed'|'not_allowed' };
type Authority = { id: number; code: string; name: string; description: string };
type DocItem   = { id: number; code: string; name: string; authority?: string; issued_by?: string; title?: string; authority_list?: string[] };

type Bootstrap = {
  segments: Segment[]; authorities: Authority[];
  kyc: DocItem[]; dd: DocItem[]; tl: DocItem[]; td: DocItem[]; qc: DocItem[];
};

const CAT_KEYS: Array<keyof DocSelections> = ['kyc', 'dd', 'tl', 'qc'];
const CAT_LABELS: Record<keyof DocSelections, string> = {
  kyc: 'KYC', dd: 'Due Diligence', tl: 'Trade Licenses', qc: 'Quality & Compliance',
};
const CAT_SHORT: Record<keyof DocSelections, string> = { kyc: 'KYC', dd: 'DD', tl: 'TL', qc: 'QC' };
const CAT_ENDPOINT: Record<keyof DocSelections, string> = {
  kyc: '/clm/kyc-documents', dd: '/clm/dd-documents', tl: '/clm/trade-licenses', qc: '/clm/qc-documents',
};

const SEG_AUTH_MAP: Record<string, string[]> = {
  'S-011': ['AUTH-002','AUTH-003','AUTH-004','AUTH-010'],
  'S-012': ['AUTH-002','AUTH-003','AUTH-004','AUTH-010'],
  'S-013': ['AUTH-003','AUTH-004','AUTH-002'],
  'S-014': ['AUTH-003','AUTH-004','AUTH-005'],
  'S-015': ['AUTH-003','AUTH-004','AUTH-008'],
  'S-016': ['AUTH-001','AUTH-002','AUTH-003'],
  'S-017': ['AUTH-001','AUTH-003'],
  'S-018': ['AUTH-006','AUTH-007','AUTH-002'],
  'S-019': ['AUTH-003','AUTH-002','AUTH-005'],
  'S-020': ['AUTH-003','AUTH-002','AUTH-008'],
  'S-001': ['AUTH-002','AUTH-012'], 'S-002': ['AUTH-002','AUTH-012'],
  'S-003': ['AUTH-002','AUTH-003'], 'S-004': ['AUTH-002','AUTH-012'],
  'S-005': ['AUTH-002','AUTH-006'], 'S-006': ['AUTH-002','AUTH-012'],
  'S-007': ['AUTH-002','AUTH-012'], 'S-008': ['AUTH-002','AUTH-012'],
  'S-009': ['AUTH-002','AUTH-006'], 'S-010': ['AUTH-002','AUTH-012'],
};

const CHIP_LIMIT = 8;

function authsForSegment(segCode: string, allAuths: Authority[]): Authority[] {
  const codes = SEG_AUTH_MAP[segCode] ?? ['AUTH-002', 'AUTH-012'];
  return allAuths.filter(a => codes.includes(a.code));
}

const DCP_TABS_CSS = `
/* 8 on every side and an 8px gap, the CLM toolbar band — see .clm-tabs-bar in
   clmShared.ts. This was the loosest of them: 16px 18px 0 with a 14px bottom
   margin on top of that, so the rail here sat in noticeably more room than the
   same rail on every other CLM page. */
.dcp-pre-table { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; padding: 8px; margin-bottom: 0; }
/* .dcp-pills / .dcp-pill lived here and are gone: the rail is .clm-tabrail
   from clmShared now, so this page has no tab paint of its own to drift. */
.dcp-pre-table > .clm-tabrail { flex-shrink: 0; }
.dcp-toolbar { display: flex; align-items: center; justify-content: flex-end; gap: 8px; flex-wrap: nowrap; flex: 1 1 auto; min-width: 0; }
.dcp-filter-ms { flex: 0 0 auto; }
.dcp-toolbar .dcp-filter-btn { flex-shrink: 0; }
/* 500px and the 1280px step, as every other CLM list search. This one was
   680px, the widest search in the module.
   order: 2 puts it after the Filter button, so it ends the row as it does on
   every other CLM page — it was written first in the markup, which left the
   Filter button as the rightmost thing on the toolbar. */
.dcp-pre-table .dcp-toolbar .clm-search { flex: 0 0 500px; min-width: 0; max-width: 100%; order: 2; }
@media (max-width: 1280px) { .dcp-pre-table .dcp-toolbar .clm-search { flex-basis: 360px; } }
@media (max-width: 760px) {
  .dcp-toolbar { width: 100%; flex-wrap: wrap; }
  .dcp-pre-table .dcp-toolbar .clm-search { width: 100%; }
  .dcp-filter-ms { flex: 1 1 auto; }
}
.clm-table-fill.dcp-fill-empty { background: #fff; }
[data-bs-theme="dark"] .clm-table-fill.dcp-fill-empty { background: #0f172a; }
.dcp-filter-btn {
  display: inline-flex; align-items: center; gap: 7px; flex-shrink: 0;
  /* 48px and radius 11 — the height of the tab rail and the search it shares
     this row with, which is the one toolbar height across CLM. */
  height: 48px; padding: 0 20px; border-radius: 11px;
  font-size: 12.5px; font-weight: 600; cursor: pointer;
  color: #fff;
  background: linear-gradient(135deg, #0891b2 0%, #0e7490 55%, #155e75 100%);
  border: 1.5px solid #0891b2;
  box-shadow: 0 3px 12px rgba(8,145,178,.4), 0 1px 0 rgba(255,255,255,.2) inset;
  transition: all .18s;
}
.dcp-filter-btn:hover { filter: brightness(1.06); }
.dcp-filter-badge {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 19px; height: 19px; padding: 0 5px; border-radius: 999px;
  font-size: 11px; font-weight: 800; line-height: 1;
  background: rgba(255,255,255,.28); color: #fff;
}
[data-bs-theme="dark"] .dcp-filter-btn { background: linear-gradient(135deg, #0891b2, #155e75); color: #fff; }
.dcp-doctype-badge {
  display: inline-flex; align-items: center; gap: 5px;
  font-size: 11px; font-weight: 700; padding: 3px 9px; border-radius: 20px;
}
.dcp-doctype-badge--international { color: #3730a3; background: rgba(99,102,241,.12); border: 1px solid rgba(99,102,241,.30); }
.dcp-doctype-badge--domestic      { color: #0f766e; background: rgba(20,184,166,.12); border: 1px solid rgba(20,184,166,.30); }
[data-bs-theme="dark"] .dcp-doctype-badge--international { color: #c7d2fe; background: rgba(99,102,241,.22); border-color: rgba(129,140,248,.55); }
[data-bs-theme="dark"] .dcp-doctype-badge--domestic      { color: #99f6e4; background: rgba(20,184,166,.22); border-color: rgba(45,212,191,.55); }
`;

export default function ClmDcpPage() {
  const toast = useToast();

  const [rows, setRows]       = useState<SegRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab]         = useState<'all'|'highly'|'less'>('all');
  const [search, setSearch]   = useState('');
  const [page, setPage]       = useState(1);
  const [filterOpen, setFilterOpen] = useState(false);
  const [chipsExpanded, setChipsExpanded] = useState(false);
  const [dcpFilters, setDcpFilters] = useState<DcpFilters>({});

  const [boot, setBoot]       = useState<Bootstrap | null>(null);
  const [editing, setEditing] = useState<SegRule | null>(null);
  const [modalOpen, setModalOpen] = useState(false);
  const location = useLocation();
  const navigate = useNavigate();
  const [prefillSegmentCode, setPrefillSegmentCode] = useState<string | null>(null);
  const [returnToSegments, setReturnToSegments] = useState(false);
  const finishRuleSave = () => {
    setModalOpen(false); setEditing(null); setPrefillSegmentCode(null); reload();
    if (returnToSegments) { setReturnToSegments(false); navigate('/clm/segment'); }
  };
  useEffect(() => {
    const seg = (location.state as { openRuleForSegment?: { code?: string } } | null)?.openRuleForSegment;
    if (!seg?.code) return;
    navigate(location.pathname, { replace: true, state: null });
    setPrefillSegmentCode(seg.code);
    setReturnToSegments(true);
    setEditing(null);
    setModalOpen(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [location.key]);
  const [viewDocs, setViewDocs] = useState<{ rule: SegRule; cat: keyof DocSelections | 'all' } | null>(null);
  const reload = () => {
    setLoading(true);
    Promise.all([
      api.get<{ status: boolean; data: SegRule[]; counts: Counts }>('/clm/segment-rules'),
      api.get<{ status: boolean; data: Bootstrap }>('/clm/segment-rules/bootstrap'),
    ]).then(([r, b]) => {
      setRows(r.data.data ?? []);
      setBoot(b.data.data);
    }).catch(() => toast.error('Load failed', 'Could not load segment rules'))
      .finally(() => setLoading(false));
  };
  useEffect(() => { reload(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const reloadBootstrap = async () => {
    try {
      const b = await api.get<{ status: boolean; data: Bootstrap }>('/clm/segment-rules/bootstrap');
      setBoot(b.data.data);
    } catch {
      toast.error('Refresh failed', 'Could not reload document masters');
    }
  };

  const regOf = (r: SegRule) => boot?.segments.find(seg => seg.code === r.segment_code)?.regulatory_status ?? r.regulatory_status;
  const bcOf = (r: SegRule) => boot?.segments.find(seg => seg.code === r.segment_code)?.buyer_consignee;

  const docAuthByCat = useMemo(() => {
    const make = (list: DocItem[] = []) => {
      const m = new Map<string, string[]>();
      for (const d of list) {
        const names = Array.isArray(d.authority_list)
          ? d.authority_list.map(s => s.trim()).filter(Boolean)
          : (d.authority || d.issued_by || '').split(',').map(s => s.trim()).filter(Boolean);
        if (names.length) m.set(d.code, names);
      }
      return m;
    };
    return {
      kyc: make(boot?.kyc), dd: make(boot?.dd), tl: make(boot?.tl), qc: make(boot?.qc),
    } as Record<keyof DocSelections, Map<string, string[]>>;
  }, [boot]);

  const authsForRule = (r: SegRule): string[] => {
    const set = new Set<string>();
    for (const c of CAT_KEYS) {
      const sel = r.doc_selections?.[c];
      if (!sel) continue;
      for (const code of Object.keys(sel)) {
        for (const a of docAuthByCat[c].get(code) ?? []) set.add(a);
      }
    }
    return Array.from(set);
  };

  const docNameByCode = useMemo(() => {
    const m = new Map<string, string>();
    for (const list of [boot?.kyc, boot?.dd, boot?.tl, boot?.qc]) {
      for (const d of list ?? []) m.set(d.code.toLowerCase(), (d.title || d.name || '').toLowerCase());
    }
    return m;
  }, [boot]);

  const ruleHasDocMatching = (r: SegRule, s: string): boolean =>
    CAT_KEYS.some(c => Object.keys(r.doc_selections?.[c] ?? {}).some(code => {
      const lc = code.toLowerCase();
      return lc.includes(s) || (docNameByCode.get(lc) ?? '').includes(s);
    }));

  
  const allRows = useMemo<SegRule[]>(() => rows, [rows]);

  const filterMatched = useMemo(() => {
    const f = dcpFilters;
    let base = allRows;
    if (f.document_type?.length)     base = base.filter(r => !!r.document_type && f.document_type!.includes(r.document_type));
    if (f.regulatory_status?.length) base = base.filter(r => f.regulatory_status!.includes(regOf(r)));
    if (f.buyer_consignee?.length)   base = base.filter(r => f.buyer_consignee!.includes(bcOf(r) === 'allowed' ? 'allowed' : 'not'));
    if (f.segment_code?.length)      base = base.filter(r => f.segment_code!.includes(r.segment_code));
    if (f.authorities?.length)       base = base.filter(r => { const a = authsForRule(r); return f.authorities!.some(x => a.includes(x)); });
    if (search.trim()) {
      const s = search.toLowerCase();
      base = base.filter(r => {
        const segName = boot?.segments.find(seg => seg.code === r.segment_code)?.name ?? '';
        const regLabel = regOf(r) === 'highly' ? 'high' : 'less';
        return r.rule_code.toLowerCase().includes(s)
          || r.segment_code.toLowerCase().includes(s)
          || segName.toLowerCase().includes(s)
          || regLabel.includes(s)
          || ruleHasDocMatching(r, s);
      });
    }
    return base;
  }, [allRows, search, boot, dcpFilters]); // eslint-disable-line react-hooks/exhaustive-deps

  const tierCounts = useMemo<Counts>(() => ({
    all:    filterMatched.length,
    highly: filterMatched.filter(r => regOf(r) === 'highly').length,
    less:   filterMatched.filter(r => regOf(r) === 'less').length,
  }), [filterMatched, boot]); // eslint-disable-line react-hooks/exhaustive-deps

  const filterOptions = useMemo(() => {
    const authSet = new Set<string>();
    const segMap = new Map<string, string>();
    const segReg = new Map<string, string | undefined>();
    for (const r of allRows) {
      for (const a of authsForRule(r)) authSet.add(a);
      const seg = boot?.segments.find(s => s.code === r.segment_code);
      segMap.set(r.segment_code, seg ? seg.name : r.segment_code);
      segReg.set(r.segment_code, seg?.regulatory_status);
    }
    return {
      authorities: Array.from(authSet).sort((a, b) => a.localeCompare(b)).map(a => ({ value: a, label: a })),
      segments: Array.from(segMap.entries())
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([code, name]) => ({ value: code, label: `${name} (${code})`, reg: segReg.get(code) })),
    };
  }, [allRows, boot]); // eslint-disable-line react-hooks/exhaustive-deps

  const filtered = useMemo(
    () => tab === 'all' ? filterMatched : filterMatched.filter(r => regOf(r) === tab),
    [filterMatched, tab, boot] // eslint-disable-line react-hooks/exhaustive-deps
  );
  const dcpCount = countDcpFilters(dcpFilters);

  const filterChips = useMemo(() => {
    const chips: Array<{ field: keyof DcpFilters; value: string; label: string }> = [];
    for (const v of dcpFilters.document_type ?? [])     chips.push({ field: 'document_type', value: v, label: `Type: ${v === 'international' ? 'International' : 'Domestic'}` });
    for (const v of dcpFilters.regulatory_status ?? []) chips.push({ field: 'regulatory_status', value: v, label: `Regulatory: ${v === 'highly' ? 'High' : 'Less'}` });
    for (const v of dcpFilters.buyer_consignee ?? [])   chips.push({ field: 'buyer_consignee', value: v, label: `Customer ≠ Consignee: ${v === 'allowed' ? 'Allowed' : 'Not Allowed'}` });
    for (const v of dcpFilters.authorities ?? [])       chips.push({ field: 'authorities', value: v, label: `Authority: ${v}` });
    for (const v of dcpFilters.segment_code ?? [])      chips.push({ field: 'segment_code', value: v, label: `Segment: ${boot?.segments.find(s => s.code === v)?.name ?? v}` });
    return chips;
  }, [dcpFilters, boot]);

  const removeChip = (field: keyof DcpFilters, value: string) => {
    setDcpFilters(prev => {
      const cur = (prev[field] as string[] | undefined) ?? [];
      const next = cur.filter(v => v !== value);
      return { ...prev, [field]: next.length ? next : undefined };
    });
    setPage(1);
  };

  const [rpp, setRpp]     = useState(PER_PAGE);
  const autoFitRef        = useRef(true);
  const scrollRef         = useRef<HTMLDivElement | null>(null);
  const { slice, start, pageCount, safePage } = paginate(filtered, page, rpp);

  /* The shared hook, not a local copy of it. This page kept its own version
     with the footer hardcoded at 64 (and 96 in the row-fit maths), which is
     not what the footer measures — so the card stopped short of it and left
     the band of dead page below the pager. The shared one measures the
     footer instead, which is the fix the other CLM lists already carry. */
  const fillH = useAutoFitRows(scrollRef, autoFitRef, setRpp, [filtered.length]);

  const onSave = async (form: { segment_code: string; regulatory_status: 'highly'|'less'; document_type: DocType; auths: string[]; doc_selections: DocSelections }, id?: number) => {
    try {
      if (id) { await api.put(`/clm/segment-rules/${id}`, form); toast.success('Updated', `${form.segment_code} rules saved`); }
      else    { await api.post('/clm/segment-rules', form);     toast.success('Added',   `${form.segment_code} rules created`); }
      bustAllMasterBundles();
      finishRuleSave();
    } catch (e: any) {
      if (e?.response?.status === 409) { toast.info('Already exists', e.response.data?.message ?? 'A rule already exists for this segment.'); reload(); return; }
      toast.error('Save failed', e?.response?.data?.message ?? 'Could not save');
    }
  };

  const onBulkSave = async (rows: Array<{ form: { segment_code: string; regulatory_status: 'highly'|'less'; document_type: DocType; auths: string[]; doc_selections: DocSelections }; ruleId?: number }>) => {
    let created = 0, updated = 0;
    const failed: string[] = [];
    for (const { form, ruleId } of rows) {
      try {
        if (ruleId) { await api.put(`/clm/segment-rules/${ruleId}`, form); updated++; }
        else        { await api.post('/clm/segment-rules', form);          created++; }
      } catch (e: any) {
        if (e?.response?.status === 409) { failed.push(`${form.segment_code} (already exists)`); continue; }
        failed.push(`${form.segment_code} (${e?.response?.data?.message ?? 'error'})`);
      }
    }
    if (created || updated) toast.success('Saved', `${created} created · ${updated} updated${failed.length ? ` · ${failed.length} skipped` : ''}`);
    if (failed.length && !created && !updated) toast.error('Save failed', failed.join('; '));
    else if (failed.length) toast.info('Some skipped', failed.join('; '));
    if (created || updated) bustAllMasterBundles();
    if (created || updated) finishRuleSave();
    else { setModalOpen(false); setEditing(null); setPrefillSegmentCode(null); reload(); }
  };

  return (
    <div className="clm-root">
      <style>{CLM_CSS + DCP_PAGE_CSS}</style>
      {loading && <ShimmerClmMaster cols={12} />}

      <ClmPageHeader
        icon={ICO.hDcp}
        title="Document Control Panel"
        sub="Manage segment-wise document rules, authorities, and compliance document mapping."
        addLabel="Add Segment Rule"
        onAdd={() => { setEditing(null); setModalOpen(true); }}
      />

      <ClmBrefBox
        icon={ICO.bDcp}
        label="Document Control Panel"
        sub="Configure which KYC, DD, Trade License and Quality & Compliance documents are required for each business segment."
        steps={[
          { n: '01', title: 'Select Segment',      desc: 'Pick a segment — all segments from Segment Master are available.', icon: ICO.grid },
          { n: '02', title: 'Auto-Load Masters',   desc: 'KYC, DD, TL & QC masters auto-load in sequence.',                  icon: ICO.refresh },
          { n: '03', title: 'Set Requirements',    desc: 'Toggle each document as Mandatory, Optional, or Not Required.',     icon: ICO.doc },
          { n: '04', title: 'Save & Persist',      desc: 'Rules are saved per segment — settings remembered across visits.',  icon: ICO.users },
          { n: '05', title: 'Used in CLM',         desc: 'Saved rules auto-apply across CLM workflows and validations.',      icon: ICO.check },
        ]}
      />

      <div className="clm-page-card">
        <style>{DCP_TABS_CSS}</style>
        <div className="dcp-pre-table">
          {/* The module's rail (.clm-tabrail / .clm-tab), with Segment Master's
              marks and counts — this page splits the same three tiers, so the
              two rails should be the same control. It used to be .dcp-pills:
              clickable <div>s on a 14px capsule with a 1.5px #22d3ee edge, the
              count spelled into the label as "(16)", no dot and no count pill.
              A count in brackets reads as part of the name; the pill is what
              every other list uses to say how many. */}
          {/* Icons, not coloured dots — the same glyphs the Segment rail and
              Case to Case use, so the three rails read alike. */}
          <div className="clm-tabrail">
            <button type="button" className={`clm-tab ${tab === 'all' ? 'active' : ''}`} onClick={() => { setTab('all'); setPage(1); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
              All Segments <span className="clm-tab-count">{tierCounts.all}</span>
            </button>
            <button type="button" className={`clm-tab ${tab === 'highly' ? 'active' : ''}`} onClick={() => { setTab('highly'); setPage(1); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
              Highly Regulated <span className="clm-tab-count">{tierCounts.highly}</span>
            </button>
            <button type="button" className={`clm-tab ${tab === 'less' ? 'active' : ''}`} onClick={() => { setTab('less'); setPage(1); }}>
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0 }}><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" /><polyline points="9 12 11 14 15 10" /></svg>
              Less Regulated <span className="clm-tab-count">{tierCounts.less}</span>
            </button>
          </div>
          <div className="dcp-toolbar">
            <div className="clm-search">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" strokeWidth="2.2"><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
              <input autoComplete="off" type="text" placeholder="Search rules, segments or document IDs…" value={search} onChange={e => { setSearch(e.target.value); setPage(1); }} />
              <SearchClear show={search} onClear={() => { setSearch(''); setPage(1); }} />
            </div>
            <button
              type="button"
              className={`dcp-filter-btn ${dcpCount > 0 ? 'active' : ''}`}
              title="Filter segment rules"
              onClick={() => setFilterOpen(true)}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3" />
              </svg>
              Filter
              {dcpCount > 0 && <span className="dcp-filter-badge">{dcpCount}</span>}
            </button>
          </div>
        </div>

        {filterChips.length > 0 && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', padding: '0 18px 12px' }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: '#64748b' }}>Filters:</span>
            {(chipsExpanded ? filterChips : filterChips.slice(0, CHIP_LIMIT)).map(c => (
              <span key={`${c.field}-${c.value}`} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, maxWidth: 260, fontSize: 11.5, fontWeight: 600, color: '#0e7490', background: 'rgba(8,145,178,.09)', border: '1px solid rgba(8,145,178,.22)', borderRadius: 999, padding: '3px 6px 3px 11px' }}>
                <Tooltip label={c.label}>
                  <span style={{ display: 'block', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{c.label}</span>
                </Tooltip>
                <button type="button" onClick={() => removeChip(c.field, c.value)} aria-label={`Remove ${c.label}`}
                  style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 16, height: 16, borderRadius: '50%', border: 'none', cursor: 'pointer', background: 'rgba(8,145,178,.16)', color: '#0e7490', lineHeight: 1, fontSize: 12 }}>×</button>
              </span>
            ))}
            {filterChips.length > CHIP_LIMIT && (
              <button type="button" onClick={() => setChipsExpanded(x => !x)}
                style={{ fontSize: 11, fontWeight: 700, color: '#0e7490', background: 'rgba(8,145,178,.09)', border: '1px dashed rgba(8,145,178,.35)', borderRadius: 999, cursor: 'pointer', padding: '3px 10px' }}>
                {chipsExpanded ? 'Show less' : `+${filterChips.length - CHIP_LIMIT} more`}
              </button>
            )}
            <button type="button" onClick={() => { setDcpFilters({}); setPage(1); }}
              style={{ fontSize: 11, fontWeight: 700, color: '#94a3b8', background: 'transparent', border: 'none', cursor: 'pointer', padding: '2px 4px' }}>Clear all</button>
          </div>
        )}

        <div className="clm-tab-body has-data">
            <div className={`clm-table-wrap clm-table-fill ${!loading && slice.length === 0 ? 'dcp-fill-empty' : ''}`} ref={scrollRef} style={{ minHeight: fillH }}>
              <table className="clm-table" style={{ minWidth: 1100 }}>
                <thead><tr>
                  <th style={{ width: 52, textAlign: 'center' }}>SR. NO</th>
                  <th style={{ width: 110, textAlign: 'center' }}>SEGMENT ID</th>
                  <th style={{ width: 200 }}>SEGMENT NAME</th>
                  <th style={{ width: 130, textAlign: 'center' }}>REGULATORY STATUS</th>
                  <th style={{ width: 120, textAlign: 'center' }}>DOCUMENT TYPE</th>
                  <th style={{ width: 140, textAlign: 'center' }}>CUSTOMER ≠ CONSIGNEE</th>
                  <th style={{ width: 180, textAlign: 'left' }}>AUTHORITIES</th>
                  <th style={{ width: 60, textAlign: 'center' }}>KYC</th>
                  <th style={{ width: 90, textAlign: 'center' }}>DUE DILIGENCE</th>
                  <th style={{ width: 95, textAlign: 'center' }}>TRADE LICENSES</th>
                  <th style={{ width: 60, textAlign: 'center' }}>QC</th>
                  <th style={{ width: 90, textAlign: 'center' }}>ACTION</th>
                </tr></thead>
                <tbody>
                  {!loading && slice.map((r, i) => {
                    const seg = boot?.segments.find(s => s.code === r.segment_code);
                    const isHigh = (seg?.regulatory_status ?? r.regulatory_status) === 'highly';
                    const segCount = (cat: keyof DocSelections) => Object.values(r.doc_selections?.[cat] ?? {}).filter(Boolean).length;
                    return (
                      <tr key={r.id || `seg-${r.segment_code}`}>
                        <td className="clm-td-num">{start + i + 1}</td>
                        <td style={{ textAlign: 'center' }}><span className="clm-code-pill">{r.segment_code}</span></td>
                        <TruncCell value={seg?.name ?? r.segment_code} style={{ maxWidth: 200 }} />
                        <td style={{ textAlign: 'center' }}>
                          <SegmentBadge status={isHigh ? 'highly' : 'less'} />
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {r.document_type ? (
                            <span className={`dcp-doctype-badge dcp-doctype-badge--${r.document_type}`}>
                              {DOC_TYPE_LABEL[r.document_type]}
                            </span>
                          ) : <span style={{ color: '#94a3b8', fontSize: 11 }}>—</span>}
                        </td>
                        <td style={{ textAlign: 'center' }}>
                          {seg?.buyer_consignee === 'allowed'
                            ? <span style={{ color: '#16a34a', fontWeight: 700, fontSize: 12 }}>✓ Yes</span>
                            : <span style={{ color: '#dc2626', fontWeight: 700, fontSize: 12 }}>✗ No</span>}
                        </td>
                        <td style={{ textAlign: 'left' }}>
                          <AuthorityBadges value={authsForRule(r)} />
                        </td>
                        {CAT_KEYS.map(c => {
                          const n = segCount(c);
                          return (
                            <td key={c} style={{ textAlign: 'center' }}>
                              {n > 0 ? (
                                <Tooltip label={`View ${CAT_LABELS[c]} documents`}><button
                                  type="button"
                                  className="clm-count-btn"
                                  onClick={() => setViewDocs({ rule: r, cat: c })}
                                >{n}</button></Tooltip>
                              ) : (
                                <span style={{ color: '#94a3b8', fontWeight: 700 }}>—</span>
                              )}
                            </td>
                          );
                        })}
                        <td style={{ textAlign: 'center' }}>
                          <div className="clm-actions">
                            <Tooltip label="Edit rule"><button className="clm-act clm-act-edit" aria-label="Edit rule" onClick={() => { setEditing(r); setModalOpen(true); }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button></Tooltip>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              {!loading && slice.length === 0 && (
                <div className="clm-empty" style={{ flex: 1 }}>
                  <div className="clm-empty-ico">{ICO.bDcp}</div>
                  <div className="clm-empty-title">{rows.length === 0 ? 'No Segment Rules Yet' : 'No Matching Segment Rules'}</div>
                  <div className="clm-empty-sub">{rows.length === 0 ? 'Click "+ Add Segment Rule" to create your first rule.' : 'No segment rules match the current tab / search / filters.'}</div>
                </div>
              )}
              {!loading && filtered.length > 0 && (
                <WorklistPager total={filtered.length} page={safePage} pageSize={rpp} onPage={setPage} onPageSize={(n) => { autoFitRef.current = false; setRpp(n); setPage(1); }} />
              )}
            </div>
        </div>
      </div>

      {modalOpen && boot && (
        <SegmentRuleModal
          prefillSegmentCode={prefillSegmentCode}
          existing={editing}
          existingRules={rows}
          boot={boot}
          onClose={() => { setModalOpen(false); setEditing(null); setPrefillSegmentCode(null); }}
          onSave={(form, ruleId) => onSave(form, ruleId ?? editing?.id)}
          onBulkSave={onBulkSave}
          onDocAdded={reloadBootstrap}
        />
      )}
      {viewDocs && boot && (
        <DocListPopup
          rule={viewDocs.rule}
          cat={viewDocs.cat}
          boot={boot}
          onClose={() => setViewDocs(null)}
        />
      )}

      <ClmDcpFilterModal
        open={filterOpen}
        initial={dcpFilters}
        options={filterOptions}
        onClose={() => setFilterOpen(false)}
        onApply={(f) => { setDcpFilters(f); setPage(1); }}
      />

    </div>
  );
}


function SegmentRuleModal(props: {
  existing: SegRule | null; existingRules: SegRule[]; boot: Bootstrap;
  onClose: () => void;
  onSave: (f: { segment_code: string; regulatory_status: 'highly'|'less'; document_type: DocType; auths: string[]; doc_selections: DocSelections }, ruleId?: number) => void;
  onBulkSave?: (rows: Array<{ form: { segment_code: string; regulatory_status: 'highly'|'less'; document_type: DocType; auths: string[]; doc_selections: DocSelections }; ruleId?: number }>) => void;
  onDocAdded?: () => Promise<void> | void;
  prefillSegmentCode?: string | null;
}) {
  const { existing, existingRules, boot, onClose, onSave, onBulkSave, onDocAdded, prefillSegmentCode } = props;
  const toast = useToast();
  const [stage, setStage]     = useState<1 | 2>(1);
  const prefillSeg = prefillSegmentCode
    ? (boot.segments.find(sg => sg.code === prefillSegmentCode) ?? null)
    : null;
  const existingSeg = existing ? boot.segments.find(sg => sg.code === existing.segment_code) : undefined;
  const [reg, setReg]         = useState<'highly'|'less'|null>(existingSeg?.regulatory_status ?? existing?.regulatory_status ?? prefillSeg?.regulatory_status ?? null);
  const [docType, setDocType] = useState<DocType | null>(existing?.document_type ?? null);
  const [segCodes, setSegCodes] = useState<string[]>(existing?.segment_code ? [existing.segment_code] : (prefillSeg ? [prefillSeg.code] : []));
  const [docSel, setDocSel]   = useState<DocSelections>(existing?.doc_selections ?? {});
  const [activeCat, setActiveCat] = useState<keyof DocSelections>('kyc');
  const [docSearch, setDocSearch] = useState<Record<string, string>>({});
  const [saving, setSaving]   = useState(false);

  useScrollLock();
  useSelectionLock();

  const isMulti = !existing && reg === 'less';
  const segCode = segCodes[0] ?? '';

  const matchedRules = useMemo(
    () => existingRules.filter(r => r.id !== existing?.id && segCodes.includes(r.segment_code) && r.document_type === docType),
    [existingRules, segCodes, existing?.id, docType]
  );
  const matchedRule = matchedRules[0] ?? null;
  const isEdit = !!existing || (!isMulti && !!matchedRule);

  useEffect(() => {
    if (!existing && !isMulti && matchedRule) {
      setReg(boot.segments.find(sg => sg.code === matchedRule.segment_code)?.regulatory_status ?? matchedRule.regulatory_status);
      setDocSel(matchedRule.doc_selections ?? {});
    }
  }, [matchedRule, existing, isMulti]);

  const ruledCodes = useMemo(
    () => new Set(existingRules.filter(r => r.id !== existing?.id && r.document_type === docType).map(r => r.segment_code)),
    [existingRules, existing?.id, docType]
  );
  const segments = useMemo(() => reg ? boot.segments.filter(s => s.regulatory_status === reg && !ruledCodes.has(s.code)) : [], [reg, boot.segments, ruledCodes]);
  const selSeg   = useMemo(() => segCodes.length === 1 ? (boot.segments.find(s => s.code === segCodes[0]) ?? null) : null, [segCodes, boot.segments]);

  const selectAllSegments = () => setSegCodes(segments.map(s => s.code));
  const clearAllSegments  = () => setSegCodes([]);

  const goStage2 = () => {
    if (!docType)          { toast.error('Document type required', 'Select Domestic or International to continue.'); return; }
    if (!reg)              { toast.error('Regulatory status required', 'Please select a Regulatory Status to continue.'); return; }
    if (segCodes.length === 0) { toast.error('Segment required', isMulti ? 'Pick at least one segment to continue.' : 'Please select a Segment to continue.'); return; }
    setStage(2);
  };

  const setDocReq = (cat: keyof DocSelections, code: string, val: 'M' | 'O' | null) => {
    setDocSel(prev => {
      const next = { ...prev, [cat]: { ...(prev[cat] ?? {}) } };
      if (val === null) delete next[cat]![code];
      else next[cat]![code] = val;
      return next;
    });
  };

  const catData: Record<keyof DocSelections, DocItem[]> = {
    kyc: boot.kyc, dd: boot.dd, tl: boot.tl, qc: boot.qc,
  };

  const activeQuery = (docSearch[activeCat] ?? '').trim().toLowerCase();
  const visibleDocs = useMemo(() => {
    const rows = catData[activeCat].map((d, i) => ({ d, srNo: i + 1 }));
    if (!activeQuery) return rows;
    return rows.filter(({ d }) => {
      const hay = [d.code, d.title, d.name, d.authority, d.issued_by]
        .filter(Boolean).join(' ').toLowerCase();
      return hay.includes(activeQuery);
    });
  }, [boot, activeCat, activeQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  const [addOpen, setAddOpen] = useState(false);
  const openAddDoc = () => setAddOpen(true);
  const addDocViaModal = async (f: Record<string, unknown> & { name?: unknown }) => {
    const cat = activeCat;
    try {
      const { data } = await api.post(CAT_ENDPOINT[cat], f);
      await onDocAdded?.();
      const created = (data?.data ?? null) as { code?: string } | null;
      if (created?.code) setDocReq(cat, created.code, 'M');
      setDocSearch(prev => (prev[cat] ? { ...prev, [cat]: '' } : prev));
      toast.success('Added', `${String(f.name ?? 'Document')} added to ${CAT_LABELS[cat]}.`);
      setAddOpen(false);
    } catch (e: any) {
      toast.error('Add failed', e?.response?.data?.message ?? 'Could not add the document.');
    }
  };

  const totalSel = (cat: keyof DocSelections) => Object.values(docSel[cat] ?? {}).filter(Boolean).length;
  const mandCount = (cat: keyof DocSelections) => Object.values(docSel[cat] ?? {}).filter(v => v === 'M').length;
  const optCount  = (cat: keyof DocSelections) => Object.values(docSel[cat] ?? {}).filter(v => v === 'O').length;
  const grandTotal = CAT_KEYS.reduce((sum, c) => sum + totalSel(c), 0);

  const allSel  = () => visibleDocs.length > 0 && visibleDocs.every(({ d }) => !!docSel[activeCat]?.[d.code]);
  const someSel = () => visibleDocs.some(({ d }) => !!docSel[activeCat]?.[d.code]);
  const toggleAllDocs = () => {
    setDocSel(prev => {
      const cat = activeCat;
      const next = { ...prev, [cat]: { ...(prev[cat] ?? {}) } };
      const every = visibleDocs.length > 0 && visibleDocs.every(({ d }) => !!next[cat]![d.code]);
      if (every) for (const { d } of visibleDocs) delete next[cat]![d.code];
      else for (const { d } of visibleDocs) { if (!next[cat]![d.code]) next[cat]![d.code] = 'M'; }
      return next;
    });
  };

  const handleSave = async () => {
    if (saving) return;
    if (!docType || !reg || segCodes.length === 0) {
      toast.error('Incomplete form', 'Select a document type, regulatory status and segment first.');
      setStage(1);
      return;
    }
    if (grandTotal === 0) {
      toast.error('No documents selected', 'Select at least one document requirement before saving.');
      return;
    }
    setSaving(true);
    try {
      const rows = segCodes.map(code => {
        const segAuths = authsForSegment(code, boot.authorities).map(a => a.code);
        const existingRow = existingRules.find(r => r.id !== existing?.id && r.segment_code === code && r.document_type === docType);
        return {
          form: { segment_code: code, regulatory_status: reg, document_type: docType, auths: segAuths, doc_selections: docSel },
          ruleId: existing?.id && existing.segment_code === code ? existing.id : existingRow?.id,
        };
      });
      if (rows.length > 1 && onBulkSave) {
        await Promise.resolve(onBulkSave(rows));
      } else {
        for (const r of rows) await Promise.resolve(onSave(r.form, r.ruleId));
      }
    } finally { setSaving(false); }
  };

  return createPortal((
    <div className="clm-modal-bd">
      <div className="clm-modal" style={{ maxWidth: 1080, width: '100%' }}>
        {saving && <div className="clm-saving-veil" aria-hidden />}
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2"><rect x="2" y="3" width="20" height="14" rx="2"/><path d="M8 21h8M12 17v4"/></svg></div>
            <div>
              <div className="clm-modal-head-title">{isEdit ? 'Edit Segment Rule' : 'Add Segment Rule'}</div>
              <div className="clm-modal-head-sub">{isEdit ? 'Update document rules for this segment across CLM workflows.' : 'Configure document rules for a business segment across CLM workflows.'}</div>
            </div>
          </div>
          <button className="clm-modal-close" onClick={onClose} disabled={saving}>×</button>
        </div>

        <div className="dcp-stage-strip" style={{ background: '#fff', padding: '10px 18px', borderBottom: '1px solid rgba(6,182,212,.09)', display: 'flex', alignItems: 'center', gap: 0 }}>
          <div className={`dcp-stage-tile ${stage === 1 ? 'dcp-stage-tile-active' : stage > 1 ? 'dcp-stage-tile-done' : 'dcp-stage-tile-pending'}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 16px', borderRadius: 11, background: stage === 1 ? 'linear-gradient(135deg, #0891b2, #0e7490)' : stage > 1 ? 'rgba(240,253,250,.9)' : 'rgba(241,245,249,.7)', border: stage > 1 ? '1.5px solid rgba(34,197,94,.28)' : 'none', cursor: stage > 1 ? 'pointer' : 'default' }} onClick={() => stage > 1 && setStage(1)}>
            <div className={stage === 1 ? 'dcp-stage-tile-num-active' : stage > 1 ? 'dcp-stage-tile-num-done' : 'dcp-stage-tile-num-pending'} style={{ width: 26, height: 26, borderRadius: 7, background: stage === 1 ? 'rgba(255,255,255,.18)' : stage > 1 ? 'linear-gradient(135deg, #22c55e, #16a34a)' : '#e2e8f0', border: stage === 1 ? '1.5px solid rgba(255,255,255,.32)' : 'none', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: '#fff' }}>
              {stage > 1 ? <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.8"><polyline points="20 6 9 17 4 12"/></svg> : '1'}
            </div>
            <div>
              <div className="dcp-stage-tile-title" style={{ fontSize: 11.5, fontWeight: 800, color: stage === 1 ? '#fff' : stage > 1 ? '#15803d' : '#94a3b8' }}>Segment & Authority</div>
              <div className="dcp-stage-tile-sub" style={{ fontSize: 9, color: stage === 1 ? 'rgba(255,255,255,.7)' : stage > 1 ? '#16a34a' : '#b0bec5' }}>Regulatory status, segment & authorities</div>
            </div>
          </div>
          <div style={{ width: 32, height: 2, background: 'linear-gradient(90deg, #0891b2, rgba(6,182,212,.3))', margin: '0 8px' }} />
          <div className={`dcp-stage-tile ${stage === 2 ? 'dcp-stage-tile-active' : 'dcp-stage-tile-pending'}`} style={{ display: 'flex', alignItems: 'center', gap: 9, padding: '9px 16px', borderRadius: 11, background: stage === 2 ? 'linear-gradient(135deg, #0891b2, #0e7490)' : 'rgba(241,245,249,.7)' }}>
            <div className={stage === 2 ? 'dcp-stage-tile-num-active' : 'dcp-stage-tile-num-pending'} style={{ width: 26, height: 26, borderRadius: 7, background: stage === 2 ? 'rgba(255,255,255,.18)' : '#e2e8f0', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, fontWeight: 800, color: stage === 2 ? '#fff' : '#94a3b8' }}>2</div>
            <div>
              <div className="dcp-stage-tile-title" style={{ fontSize: 11.5, fontWeight: 800, color: stage === 2 ? '#fff' : '#94a3b8' }}>CLM Documents</div>
              <div className="dcp-stage-tile-sub" style={{ fontSize: 9, color: stage === 2 ? 'rgba(255,255,255,.7)' : '#b0bec5' }}>Assign document requirements per category</div>
            </div>
          </div>
          <div style={{ flex: 1 }} />
          <div className="dcp-step-badge" style={{ fontSize: 9.5, fontWeight: 700, color: '#0891b2', background: 'rgba(8,145,178,.07)', border: '1px solid rgba(8,145,178,.16)', borderRadius: 20, padding: '3px 9px' }}>Step {stage} of 2</div>
        </div>

        <div className="clm-modal-body dcp-modal-body" style={{ flex: '1 1 auto', minHeight: 0 }}>
          {stage === 1 ? (
            <>
              <div className="dcp-modal-card" style={{ background: '#fff', border: '1.5px solid rgba(6,182,212,.13)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>
                <div className="dcp-modal-card-head" style={{ padding: '8px 13px', background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1px solid rgba(6,182,212,.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.09em' }}>Document Type</span>
                  <span className="clm-req">*</span>
                </div>
                <div style={{ padding: '10px 12px' }}>
                  <div className="dcp-doctype-row" style={{ display: 'flex', gap: 8 }}>
                    {(['domestic','international'] as const).map(v => {
                      const on  = docType === v;
                      const dom = v === 'domestic';
                      const accent  = dom ? '#0891b2' : '#6366f1';
                      const onBd    = dom ? 'rgba(8,145,178,.30)' : 'rgba(99,102,241,.30)';
                      const onBg    = dom ? 'rgba(8,145,178,.12)' : 'rgba(99,102,241,.12)';
                      const titleC  = dom ? '#0e7490' : '#3730a3';
                      const subOnC  = dom ? '#0e7490' : '#3730a3';
                      return (
                        <label key={v} className={`dcp-radio-label ${on ? 'dcp-radio-label-on' : ''}`} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${on ? onBd : 'rgba(203,213,225,.38)'}`, background: on ? onBg : 'rgba(248,250,252,.5)', cursor: existing ? 'not-allowed' : 'pointer', opacity: existing && !on ? 0.55 : 1, transition: 'all .15s' }}
                          onClick={() => {
                            if (existing) return;
                            setDocType(v);
                            const ruledForType = new Set(existingRules.filter(r => r.id !== existing?.id && r.document_type === v).map(r => r.segment_code));
                            setSegCodes(prev => prev.filter(c => !ruledForType.has(c)));
                          }}>
                          <input type="radio" checked={on} onChange={() => {}} disabled={!!existing} style={{ accentColor: accent, width: 14, height: 14 }} />
                          <div>
                            <div className="dcp-radio-title" style={{ fontSize: 12, fontWeight: 700, color: on ? titleC : '#1e293b' }}>{dom ? 'Domestic' : 'International'}</div>
                            <div className="dcp-radio-sub" style={{ fontSize: 9, color: on ? subOnC : '#94a3b8', marginTop: 2 }}>{dom ? 'Rules & documents for in-country trade' : 'Rules & documents for cross-border trade'}</div>
                          </div>
                        </label>
                      );
                    })}
                  </div>
                  <div style={{ fontSize: 9.5, color: '#94a3b8', marginTop: 6 }}>
                    Each segment can have a separate Domestic and International rule with its own document set.
                  </div>
                </div>
              </div>

              {docType && (
              <div className="dcp-modal-card" style={{ background: '#fff', border: '1.5px solid rgba(6,182,212,.13)', borderRadius: 12, overflow: 'hidden' }}>
                <div className="dcp-modal-card-head" style={{ padding: '8px 13px', background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1px solid rgba(6,182,212,.08)', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 9, fontWeight: 800, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.09em' }}>Segment Regulatory Status</span>
                  <span className="clm-req">*</span>
                </div>
                <div style={{ padding: '10px 12px', display: 'flex', gap: 8 }}>
                  {(['highly','less'] as const).map(v => {
                    const on = reg === v;
                    const hi = v === 'highly';
                    return (
                      <label key={v} className={`dcp-radio-label ${on ? (hi ? 'dcp-radio-label-on-highly' : 'dcp-radio-label-on-less') : ''}`} style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px', borderRadius: 10, border: `1.5px solid ${on ? (hi ? 'rgba(239,68,68,.38)' : 'rgba(34,197,94,.32)') : 'rgba(203,213,225,.38)'}`, background: on ? (hi ? 'rgba(254,242,242,.45)' : 'rgba(240,253,244,.45)') : 'rgba(248,250,252,.5)', cursor: existing ? 'not-allowed' : 'pointer', opacity: existing && !on ? 0.55 : 1, transition: 'all .15s' }}
                        onClick={() => { if (existing) return; setReg(v); setSegCodes([]); }}>
                        <input type="radio" checked={on} onChange={() => {}} disabled={!!existing} style={{ accentColor: hi ? '#ef4444' : '#16a34a', width: 14, height: 14 }} />
                        <span style={{ width: 16, height: 16, borderRadius: '50%', background: hi ? '#ef4444' : '#22c55e' }} />
                        <div>
                          <div className="dcp-radio-title" style={{ fontSize: 12, fontWeight: 700, color: on ? (hi ? '#991b1b' : '#166534') : '#1e293b' }}>{hi ? 'High Regulatory' : 'Less Regulatory'}</div>
                          <div className="dcp-radio-sub" style={{ fontSize: 9, color: on ? (hi ? '#b91c1c' : '#15803d') : '#94a3b8', marginTop: 2 }}>{hi ? 'Requires specific segment & compliance review' : 'Pick one or many — each becomes its own rule row'}</div>
                        </div>
                      </label>
                    );
                  })}
                </div>
                {reg && (
                  <div className={reg === 'highly' ? 'dcp-select-seg-highly' : 'dcp-select-seg-less'} style={{ margin: '0 12px 12px', padding: '11px 12px', background: reg === 'highly' ? 'linear-gradient(110deg, rgba(239,68,68,.03), rgba(254,242,242,.4))' : 'linear-gradient(110deg, rgba(22,163,74,.03), rgba(240,253,244,.4))', border: `1px solid ${reg === 'highly' ? 'rgba(239,68,68,.15)' : 'rgba(22,163,74,.15)'}`, borderRadius: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 7 }}>
                      <div style={{ fontSize: 8.5, fontWeight: 800, color: reg === 'highly' ? '#dc2626' : '#15803d', textTransform: 'uppercase', letterSpacing: '.08em' }}>
                        {isMulti ? 'Select Segments (multi)' : 'Select Segment'} <span className="clm-req">*</span>
                      </div>
                      {isMulti && segments.length > 0 && (
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10, color: '#15803d' }}>
                          <span style={{ fontWeight: 700 }}>{segCodes.length} of {segments.length} picked</span>
                          <button type="button" onClick={selectAllSegments} style={{ background: 'transparent', border: '1px solid rgba(22,163,74,.32)', color: '#15803d', fontWeight: 700, fontSize: 9.5, borderRadius: 5, padding: '2px 7px', cursor: 'pointer' }}>Select all</button>
                          <button type="button" onClick={clearAllSegments} disabled={segCodes.length === 0} style={{ background: 'transparent', border: '1px solid rgba(148,163,184,.32)', color: '#64748b', fontWeight: 700, fontSize: 9.5, borderRadius: 5, padding: '2px 7px', cursor: segCodes.length === 0 ? 'not-allowed' : 'pointer', opacity: segCodes.length === 0 ? 0.5 : 1 }}>Clear</button>
                        </div>
                      )}
                    </div>

                    {isMulti ? (
                      segments.length === 0 ? (
                        <div style={{ padding: '12px', fontSize: 11, color: '#64748b', background: 'rgba(248,250,252,.6)', borderRadius: 7, border: '1px dashed rgba(148,163,184,.4)' }}>
                          No less-regulated segments configured yet. Add them in <em>CLM → Segment Master</em> first.
                        </div>
                      ) : (
                        <MasterMultiSelect
                          value={segCodes}
                          placeholder="— Select Segments —"
                          options={segments.map(s => {
                            const nm = s.name.length > 40 ? `${s.name.slice(0, 40)}…` : s.name;
                            return { value: s.code, label: `${nm} (${s.code})`, fullLabel: `${segmentLabel(s.name, s.regulatory_status)} (${s.code})` };
                          })}
                          renderBadges={(code) => <SegmentBadge status={segments.find(s => s.code === code)?.regulatory_status} />}
                          onChange={(vs) => setSegCodes(vs)}
                        />
                      )
                    ) : (
                      <MasterSelect
                        value={segCode}
                        onChange={(v) => setSegCodes(v ? [v] : [])}
                        disabled={!!existing}
                        placeholder={`— Choose a ${reg === 'highly' ? 'Highly' : 'Less'} Regulated Segment —`}
                        options={segments.map(s => {
                          const nm = s.name.length > 40 ? `${s.name.slice(0, 40)}…` : s.name;
                          return { value: s.code, label: `${nm} (${s.code})`, fullLabel: `${segmentLabel(s.name, s.regulatory_status)} (${s.code})`, badges: [{ text: '', reg: s.regulatory_status }] };
                        })}
                      />
                    )}

                    {!existing && matchedRules.length > 0 && (
                      <div className="dcp-rule-warn" style={{ marginTop: 9, display: 'flex', alignItems: 'flex-start', gap: 9, padding: '9px 11px', background: 'linear-gradient(110deg, rgba(251,191,36,.10), rgba(254,243,199,.55))', border: '1.5px solid rgba(217,119,6,.32)', borderRadius: 9 }}>
                        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#d97706" strokeWidth="2.2" style={{ flexShrink: 0, marginTop: 1 }}><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
                        <div style={{ fontSize: 11, color: '#92400e', lineHeight: 1.45 }}>
                          {isMulti
                            ? <><strong style={{ color: '#78350f' }}>{matchedRules.length} of the picked segments already have a rule</strong> ({matchedRules.map(r => `${r.segment_code} → ${r.rule_code}`).join(', ')}). Those will be updated; the rest will be created as new rows.</>
                            : <><strong style={{ color: '#78350f' }}>A rule already exists for this segment ({matchedRule!.rule_code}).</strong> One rule per segment is allowed — you're now editing that rule. Save will update it instead of creating a new one.</>}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>
              )}

              {selSeg && (
                <div className="dcp-modal-card" style={{ background: '#fff', border: '1.5px solid rgba(6,182,212,.13)', borderRadius: 12, overflow: 'hidden' }}>
                  <div className="dcp-modal-card-head" style={{ padding: '8px 13px', background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1px solid rgba(6,182,212,.08)' }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.09em' }}>Segment Details</span>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr auto auto', gap: 0 }}>
                    <div className="dcp-segdtl-cell" style={{ padding: '10px 14px', borderRight: '1px solid rgba(6,182,212,.09)' }}>
                      <div className="dcp-segdtl-label" style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Segment ID</div>
                      <div className="dcp-segdtl-val" style={{ fontFamily: "'Geist Mono', monospace", fontSize: 14, fontWeight: 800, color: '#0c4a6e' }}>{selSeg.code}</div>
                    </div>
                    <div className="dcp-segdtl-cell" style={{ padding: '10px 14px', borderRight: '1px solid rgba(6,182,212,.09)' }}>
                      <div className="dcp-segdtl-label" style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 4 }}>Segment Name</div>
                      <div className="dcp-segdtl-val" style={{ fontSize: 12, fontWeight: 700, color: '#0c4a6e' }}>{selSeg.name}</div>
                    </div>
                    <div className="dcp-segdtl-cell" style={{ padding: '10px 14px', borderRight: '1px solid rgba(6,182,212,.09)' }}>
                      <div className="dcp-segdtl-label" style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Regulatory</div>
                      <span className={`clm-badge ${reg === 'highly' ? 'clm-badge-red' : 'clm-badge-emerald'}`}><span className="clm-badge-dot" />{reg === 'highly' ? 'High' : 'Less'}</span>
                    </div>
                    <div style={{ padding: '10px 14px' }}>
                      <div className="dcp-segdtl-label" style={{ fontSize: 11, fontWeight: 700, color: '#0891b2', textTransform: 'uppercase', letterSpacing: '.06em', marginBottom: 5 }}>Customer ≠ Consignee</div>
                      <span className={`clm-badge ${selSeg.buyer_consignee === 'allowed' ? 'clm-badge-green' : 'clm-badge-red'}`}>{selSeg.buyer_consignee === 'allowed' ? 'Allowed' : 'Not Allowed'}</span>
                    </div>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div>
              {/* The shared rail's numbers — gap 8 on a 4px pad, radius 11, a
                  1px .28 hairline — rather than this modal's own gap 2 / 13 /
                  1.5px .15, which held the same .clm-tab buttons. */}
              <div className="dcp-cat-tabs" style={{ display: 'flex', gap: 8, padding: 4, background: 'rgba(255,255,255,.6)', border: '1px solid rgba(6,182,212,.28)', borderRadius: 11, overflowX: 'auto' }}>
                {CAT_KEYS.map(c => {
                  const on = activeCat === c;
                  const cnt = totalSel(c);
                  return (
                    <button key={c} className={`clm-tab ${on ? 'active' : ''}`} onClick={() => setActiveCat(c)} style={{ flexShrink: 0 }}>
                      {CAT_LABELS[c]}
                      {cnt > 0 && <span className="clm-tab-count">{cnt}</span>}
                    </button>
                  );
                })}
              </div>

              <div className="dcp-doc-card" style={{ marginTop: 8, border: '1.5px solid rgba(6,182,212,.15)', borderRadius: 14, overflow: 'hidden' }}>
                <div className="dcp-doc-head" style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 16px', background: 'linear-gradient(110deg, #0891b2, #0e7490)', color: '#fff' }}>
                  <div className="dcp-doc-head-left" style={{ flexShrink: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, letterSpacing: '-.25px' }}>{CAT_LABELS[activeCat]} Documents</div>
                      {mandCount(activeCat) > 0 && <span className="clm-badge" style={{ background: 'rgba(6,182,212,.25)', color: '#fff', border: '1px solid rgba(255,255,255,.28)' }}>Mandatory · {mandCount(activeCat)}</span>}
                      {optCount(activeCat) > 0 && <span className="clm-badge" style={{ background: 'rgba(251,191,36,.28)', color: '#fff', border: '1px solid rgba(251,191,36,.35)' }}>Optional · {optCount(activeCat)}</span>}
                    </div>
                    <div style={{ fontSize: 9.5, opacity: .7 }}>
                      {activeQuery
                        ? `${visibleDocs.length} of ${catData[activeCat].length} documents match "${docSearch[activeCat]}"`
                        : `${catData[activeCat].length} documents available to configure`}
                    </div>
                  </div>
                  <div className="dcp-doc-search" style={{ marginLeft: 'auto' }}>
                    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" style={{ flexShrink: 0, opacity: .85 }}><circle cx="11" cy="11" r="8"/><path d="m21 21-4.35-4.35"/></svg>
                    <input
                      type="text"
                      value={docSearch[activeCat] ?? ''}
                      autoComplete="off"
                      placeholder={`Search ${CAT_SHORT[activeCat]} documents…`}
                      aria-label={`Search ${CAT_LABELS[activeCat]} documents`}
                      onChange={e => setDocSearch(prev => ({ ...prev, [activeCat]: e.target.value }))}
                    />
                    {!!(docSearch[activeCat] ?? '') && (
                      <button type="button" className="dcp-doc-search-clear" aria-label="Clear search"
                        onClick={() => setDocSearch(prev => ({ ...prev, [activeCat]: '' }))}>×</button>
                    )}
                  </div>
                  <button type="button" onClick={openAddDoc} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6, flexShrink: 0, height: 34, padding: '0 14px', boxSizing: 'border-box', borderRadius: 8, background: '#fff', color: '#0e7490', border: 'none', fontFamily: 'inherit', fontSize: 12.5, fontWeight: 700, cursor: 'pointer', boxShadow: '0 2px 6px rgba(0,0,0,.12)' }}>
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                    Add {CAT_SHORT[activeCat]}
                  </button>
                </div>
                <div style={{ maxHeight: 360, overflowY: 'auto' }}>
                  <table className="clm-table">
                    <thead>
                      <tr className="dcp-thead-row" style={{ background: 'linear-gradient(110deg,#f0fdff,#e8f9fd)', borderBottom: '1.5px solid rgba(6,182,212,.12)' }}>
                        <th style={{ width: 36, padding: '9px 4px 9px 14px', textAlign: 'center' }}>
                          {visibleDocs.length > 0 && (() => {
                            const all = allSel(), some = someSel();
                            const scope = activeQuery ? 'matching documents' : 'this tab';
                            return (
                              <label className="clm-doc-check" title={all ? `Clear all ${scope}` : `Select all ${scope}`}>
                                <input type="checkbox" checked={all} ref={el => { if (el) el.indeterminate = some && !all; }} onChange={() => toggleAllDocs()} />
                                <span className={`clm-doc-check-box${some && !all ? ' is-indet' : ''}`}>
                                  {all && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>}
                                  {some && !all && <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.4" strokeLinecap="round"><line x1="6" y1="12" x2="18" y2="12"/></svg>}
                                </span>
                              </label>
                            );
                          })()}
                        </th>
                        <th style={{ width: 44, padding: '9px 8px', textAlign: 'left' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2', whiteSpace: 'nowrap' }}>Sr. No</span></th>
                        <th style={{ width: 100, padding: '9px 8px', textAlign: 'left' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2' }}>Code</span></th>
                        <th style={{ padding: '9px 12px', textAlign: 'left' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2' }}>Document Name</span></th>
                        <th style={{ padding: '9px 12px', textAlign: 'left' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2' }}>Authority / Type</span></th>
                        <th style={{ width: 200, padding: '9px 16px', textAlign: 'right' }}><span style={{ fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase', color: '#0891b2' }}>Requirement</span></th>
                      </tr>
                    </thead>
                    <tbody>
                      {visibleDocs.length === 0 && (
                        <tr>
                          <td colSpan={6} style={{ padding: '26px 16px', textAlign: 'center', fontSize: 11.5, color: '#94a3b8' }}>
                            {catData[activeCat].length === 0
                              ? <>No {CAT_LABELS[activeCat]} documents yet — use “+ Add {CAT_SHORT[activeCat]}” to create one.</>
                              : <>No {CAT_LABELS[activeCat]} document matches “{docSearch[activeCat]}”.</>}
                          </td>
                        </tr>
                      )}
                      {visibleDocs.map(({ d, srNo }) => {
                        const sel = docSel[activeCat]?.[d.code];
                        const isM = sel === 'M', isO = sel === 'O';
                        const checked = isM || isO;
                        return (
                          <tr key={d.id}>
                            <td style={{ width: 36, textAlign: 'center', padding: '6px 4px 6px 14px' }}>
                              <label className="clm-doc-check">
                                <input
                                  type="checkbox"
                                  checked={checked}
                                  onChange={e => setDocReq(activeCat, d.code, e.target.checked ? (sel ?? 'M') : null)}
                                />
                                <span className="clm-doc-check-box">
                                  {checked && (
                                    <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                                  )}
                                </span>
                              </label>
                            </td>
                            <td className="clm-td-num">{String(srNo).padStart(2, '0')}</td>
                            <td style={{ width: 100 }}><span className="clm-code-pill">{d.code}</span></td>
                            {(() => {
                              const full = String(d.title || d.name || '');
                              const shown = full.length > 25 ? `${full.slice(0, 25)}…` : full;
                              return <TruncCell value={full} shown={shown} />;
                            })()}
                            <td className="clm-td-desc">{d.authority || d.issued_by || '—'}</td>
                            <td style={{ width: 200, textAlign: 'right' }}>
                              <div className={`dcp-req-group ${isM ? 'dcp-req-group-mand' : isO ? 'dcp-req-group-opt' : ''}`} style={{ display: 'inline-flex', borderRadius: 9, overflow: 'hidden', border: `1.5px solid ${isM ? 'rgba(6,182,212,.35)' : isO ? 'rgba(245,158,11,.35)' : 'rgba(203,213,225,.4)'}` }}>
                                <button className={isM ? 'dcp-req-btn-on' : 'dcp-req-btn-off'} onClick={() => setDocReq(activeCat, d.code, isM ? null : 'M')} style={{ padding: '5px 14px', border: 'none', borderRight: '1px solid rgba(203,213,225,.35)', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', background: isM ? 'linear-gradient(135deg, #06b6d4, #0891b2)' : 'rgba(248,250,252,.8)', color: isM ? '#fff' : '#94a3b8' }}>Mandatory</button>
                                <button className={isO ? 'dcp-req-btn-on' : 'dcp-req-btn-off'} onClick={() => setDocReq(activeCat, d.code, isO ? null : 'O')} style={{ padding: '5px 14px', border: 'none', fontFamily: 'inherit', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', background: isO ? 'linear-gradient(135deg, #fbbf24, #d97706)' : 'rgba(248,250,252,.8)', color: isO ? '#fff' : '#94a3b8' }}>Optional</button>
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
          )}
        </div>

        <div className="clm-modal-foot" style={{ justifyContent: 'space-between' }}>
          <div>
            {stage === 2 && <button className="clm-btn-cancel" onClick={() => setStage(1)} disabled={saving}>← Back</button>}
          </div>
          <div style={{ display: 'flex', gap: 7 }}>
            <button className="clm-btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            {stage === 1
              ? <button className="clm-btn-save" onClick={goStage2}>Next: CLM Documents →</button>
              : <button className="clm-btn-save" onClick={() => void handleSave()} disabled={saving}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"/><polyline points="17 21 17 13 7 13 7 21"/><polyline points="7 3 7 8 15 8"/></svg>
                  {saving ? 'Saving…' : (isEdit ? `Update Rule (${grandTotal} docs)` : `Save Rule (${grandTotal} docs)`)}
                </button>}
          </div>
        </div>
      </div>

      {addOpen && activeCat === 'kyc' && (
        <Suspense fallback={null}>
        <KycModal existing={null} authorities={boot.authorities}
          nextCode={`KYC-${String(boot.kyc.length + 1).padStart(3, '0')}`}
          onClose={() => setAddOpen(false)} onSave={(f) => addDocViaModal(f)} />
        </Suspense>
      )}
      {addOpen && activeCat === 'dd' && (
        <Suspense fallback={null}>
        <DdModal existing={null} authorities={boot.authorities}
          nextCode={`DD-${String(boot.dd.length + 1).padStart(3, '0')}`}
          onClose={() => setAddOpen(false)} onSave={(f) => addDocViaModal(f)} />
        </Suspense>
      )}
      {addOpen && activeCat === 'tl' && (
        <Suspense fallback={null}>
        <TlModal existing={null} authorities={boot.authorities}
          nextCode={`TL-${String(boot.tl.length + 1).padStart(3, '0')}`}
          onClose={() => setAddOpen(false)} onSave={(f) => addDocViaModal(f)} />
        </Suspense>
      )}
      {addOpen && activeCat === 'qc' && (
        <Suspense fallback={null}>
        <QcModal existing={null} authorities={boot.authorities}
          nextCode={`QC-${String(boot.qc.length + 1).padStart(3, '0')}`}
          onClose={() => setAddOpen(false)} onSave={(f) => addDocViaModal(f)} />
        </Suspense>
      )}
    </div>
  ), document.body);
}

const DCP_PAGE_CSS = `
/* The search and the Add button sit on the same dark band and were two
   different heights - 30px here against the button's 5px of padding, about 26 -
   so the row read as two unrelated controls. Both are 34px now, on the same
   8px radius, with the 12.5px type every other CLM control uses. Fixed width
   rather than flexible: the band's left block wraps as the dialog narrows, and
   a shrinking search made the two controls drift apart. */
.dcp-doc-search {
  display: flex; align-items: center; gap: 8px;
  flex: 0 0 300px; max-width: 100%; min-width: 0;
  height: 34px; padding: 0 12px;
  border-radius: 8px;
  background: rgba(255,255,255,.16);
  border: 1.5px solid rgba(255,255,255,.30);
  color: #fff;
  transition: background .15s ease, border-color .15s ease, box-shadow .15s ease;
}
.dcp-doc-search:focus-within {
  background: rgba(255,255,255,.24);
  border-color: rgba(255,255,255,.62);
  box-shadow: 0 0 0 3px rgba(255,255,255,.14);
}
.dcp-doc-search input {
  flex: 1; min-width: 0;
  border: none; outline: none; background: transparent;
  font-family: inherit; font-size: 12.5px; font-weight: 500; color: #fff;
}
.dcp-doc-search input::placeholder { color: rgba(255,255,255,.62); }
.dcp-doc-search-clear {
  flex-shrink: 0; width: 16px; height: 16px; padding: 0;
  display: inline-flex; align-items: center; justify-content: center;
  border: none; border-radius: 50%; cursor: pointer; line-height: 1; font-size: 13px;
  background: rgba(255,255,255,.26); color: #fff;
}
.dcp-doc-search-clear:hover { background: rgba(255,255,255,.42); }
.dcp-doc-search input:-webkit-autofill,
.dcp-doc-search input:-webkit-autofill:hover,
.dcp-doc-search input:-webkit-autofill:focus {
  -webkit-text-fill-color: #fff;
  caret-color: #fff;
  -webkit-box-shadow: 0 0 0 1000px #0b7f9c inset !important;
  box-shadow: 0 0 0 1000px #0b7f9c inset !important;
  transition: background-color 9999s ease-in-out 0s;
}
@media (max-width: 720px) {
  .dcp-doc-head { flex-wrap: wrap; }
  .dcp-doc-head-left { flex: 1 1 100%; }
  .dcp-doc-search { flex: 1 1 auto; min-width: 120px; margin-left: 0 !important; }
}
.clm-count-btn {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 30px; height: 26px; padding: 0 9px;
  font-family: inherit; font-size: 11px; font-weight: 800;
  color: #0891b2; background: rgba(8,145,178,.08);
  border: 1.5px solid rgba(6,182,212,.22); border-radius: 14px;
  cursor: pointer; transition: all .14s;
}
.clm-count-btn:hover {
  background: rgba(8,145,178,.18); transform: scale(1.07);
  box-shadow: 0 3px 10px rgba(6,182,212,.22);
}
.clm-total-btn {
  display: inline-flex; align-items: center; justify-content: center;
  padding: 3px 11px; font-family: inherit; font-size: 11px; font-weight: 800;
  color: #0c4a6e; background: rgba(239,68,68,.05);
  border: 1.5px solid rgba(239,68,68,.22); border-radius: 18px;
  cursor: pointer; transition: all .14s; white-space: nowrap;
}
.clm-total-btn:hover {
  background: rgba(239,68,68,.12); transform: scale(1.05);
  box-shadow: 0 3px 10px rgba(239,68,68,.18);
}
.clm-doc-check {
  display: inline-flex; align-items: center; justify-content: center;
  cursor: pointer; user-select: none;
}
.clm-doc-check input { position: absolute; opacity: 0; width: 0; height: 0; }
.clm-doc-check-box {
  width: 18px; height: 18px; border-radius: 5px;
  border: 1.5px solid rgba(203,213,225,.7);
  background: #fff;
  display: inline-flex; align-items: center; justify-content: center;
  transition: all .14s;
}
.clm-doc-check:hover .clm-doc-check-box { border-color: #0891b2; box-shadow: 0 0 0 3px rgba(8,145,178,.12); }
.clm-doc-check input:checked + .clm-doc-check-box,
.clm-doc-check-box.is-indet {
  background: linear-gradient(135deg,#06b6d4,#0891b2);
  border-color: #0891b2;
  box-shadow: 0 2px 6px rgba(8,145,178,.28);
}

.dcp-sec-head {
  display: flex; align-items: center; gap: 8px;
  padding: 9px 22px;
  border-top: 1px solid rgba(6,182,212,.1);
  border-bottom: 1px solid rgba(6,182,212,.12);
}
.dcp-sec-head.mandatory {
  background: linear-gradient(110deg,#f0fdff,#e8f9fd);
  color: #0891b2;
}
.dcp-sec-head.optional {
  background: linear-gradient(110deg,#fffbeb,#fef9ee);
  border-top-color: rgba(245,158,11,.1);
  border-bottom-color: rgba(245,158,11,.12);
  color: #d97706;
}
.dcp-sec-head-label { font-size: 8px; font-weight: 800; letter-spacing: .12em; text-transform: uppercase; color: inherit; }
.dcp-sec-head-count {
  font-size: 9px; font-weight: 800; color: #fff;
  padding: 1px 7px; border-radius: 9px;
}
.dcp-sec-head.mandatory .dcp-sec-head-count { background: linear-gradient(135deg,#06b6d4,#0891b2); }
.dcp-sec-head.optional  .dcp-sec-head-count { background: linear-gradient(135deg,#fbbf24,#d97706); }

.dcp-doc-name { font-size: 13px; font-weight: 700; color: #0c4a6e; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcp-doc-auth { font-size: 10px; color: #94a3b8; margin-top: 2px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.dcp-doc-idx  { font-size: 10px; font-weight: 700; color: #c0d4e0; width: 22px; text-align: right; flex-shrink: 0; }

.dcp-foot-text { font-size: 11px; color: #0891b2; opacity: .75; }
.dcp-foot-text b { color: #0c4a6e; font-weight: 700; opacity: 1; }

[data-bs-theme="dark"] .dcp-sec-head.mandatory {
  background: linear-gradient(110deg, rgba(8,145,178,.18), rgba(8,145,178,.10));
  border-top-color: rgba(6,182,212,.22);
  border-bottom-color: rgba(6,182,212,.22);
  color: #67e8f9;
}
[data-bs-theme="dark"] .dcp-sec-head.optional {
  background: linear-gradient(110deg, rgba(245,158,11,.18), rgba(245,158,11,.10));
  border-top-color: rgba(245,158,11,.22);
  border-bottom-color: rgba(245,158,11,.22);
  color: #fbbf24;
}
[data-bs-theme="dark"] .dcp-doc-row { border-bottom-color: rgba(255,255,255,.06) !important; }
[data-bs-theme="dark"] .dcp-doc-name { color: #e2e8f0; }
[data-bs-theme="dark"] .dcp-doc-auth { color: #94a3b8; }
[data-bs-theme="dark"] .dcp-doc-idx  { color: #64748b; }
[data-bs-theme="dark"] .dcp-foot-text { color: #67e8f9; }
[data-bs-theme="dark"] .dcp-foot-text b { color: #e2e8f0; }

.dcp-modal-body > * { flex-shrink: 0; }
.dcp-stage-strip, .clm-modal .clm-modal-head, .clm-modal .clm-modal-foot { flex-shrink: 0; }

@media (max-width: 680px) {
  .dcp-stage-strip { padding: 8px 12px !important; gap: 4px !important; flex-wrap: nowrap !important; }
  .dcp-stage-tile { padding: 7px 10px !important; gap: 7px !important; min-width: 0 !important; }
  .dcp-stage-tile-sub { display: none !important; }
  .dcp-stage-tile-title { font-size: 11px !important; }
  .dcp-step-badge { display: none !important; }
  .dcp-doctype-row { flex-direction: column !important; }
  .dcp-doctype-row > .dcp-radio-label { width: 100% !important; }
}
@media (max-width: 460px) {
  .dcp-stage-tile-title { font-size: 10px !important; }
  .dcp-stage-strip { padding: 7px 9px !important; }
}
`;


function DocListPopup(props: {
  rule: SegRule;
  cat: keyof DocSelections | 'all';
  boot: Bootstrap;
  onClose: () => void;
}) {
  const { rule, cat, boot, onClose } = props;
  useScrollLock();
  const isAll = cat === 'all';

  const seg = boot.segments.find(s => s.code === rule.segment_code);
  const segName = seg?.name ?? rule.segment_code;
  const catData: Record<keyof DocSelections, DocItem[]> = {
    kyc: boot.kyc, dd: boot.dd, tl: boot.tl, qc: boot.qc,
  };

  type Row = DocItem & { __cat: keyof DocSelections; __req: 'M' | 'O' };
  const mand: Row[] = [];
  const opt: Row[]  = [];
  const cats: Array<keyof DocSelections> = isAll ? CAT_KEYS : [cat as keyof DocSelections];
  for (const c of cats) {
    const sel = rule.doc_selections?.[c] ?? {};
    for (const d of catData[c]) {
      const v = sel[d.code];
      if (v === 'M') mand.push({ ...d, __cat: c, __req: 'M' });
      else if (v === 'O') opt.push({ ...d, __cat: c, __req: 'O' });
    }
  }
  const totalSel = mand.length + opt.length;
  const universe = isAll
    ? CAT_KEYS.reduce((n, c) => n + catData[c].length, 0)
    : catData[cat as keyof DocSelections].length;

  const catLabel = isAll ? 'All' : CAT_LABELS[cat as keyof DocSelections];

  const renderRow = (d: Row, idx: number, isLast: boolean) => (
    <div key={`${d.__cat}-${d.code}`} className="dcp-doc-row" style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '13px 22px', borderBottom: isLast ? 'none' : '1px solid rgba(6,182,212,.07)' }}>
      <span className="dcp-doc-idx">{String(idx + 1).padStart(2, '0')}</span>
      <span className="clm-code-pill" style={{ flexShrink: 0 }}>{d.code}</span>
      {isAll && (
        <span style={{ fontFamily: "'Geist Mono', monospace", fontSize: 8.5, fontWeight: 800, color: '#4f46e5', background: 'rgba(99,102,241,.08)', padding: '2px 7px', borderRadius: 5, border: '1px solid rgba(99,102,241,.2)', whiteSpace: 'nowrap', flexShrink: 0, letterSpacing: '.05em', textTransform: 'uppercase' }}>
          {CAT_LABELS[d.__cat]}
        </span>
      )}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="dcp-doc-name">{d.title || d.name}</div>
        <div className="dcp-doc-auth">{d.authority || d.issued_by || '—'}</div>
      </div>
      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, padding: '5px 14px', borderRadius: 20, fontSize: 10.5, fontWeight: 700, whiteSpace: 'nowrap', flexShrink: 0,
        background: d.__req === 'M' ? 'rgba(8,145,178,.09)' : 'rgba(245,158,11,.09)',
        color: d.__req === 'M' ? '#0891b2' : '#d97706',
        border: `1.5px solid ${d.__req === 'M' ? 'rgba(6,182,212,.28)' : 'rgba(245,158,11,.28)'}`
      }}>
        {d.__req === 'M' ? 'Mandatory' : 'Optional'}
      </span>
    </div>
  );

  return createPortal((
    <div className="clm-modal-bd" onClick={onClose} style={{ zIndex: 200000 }}>
      <div className="clm-modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 640, width: '100%' }}>
        <div className="clm-modal-head">
          <div className="clm-modal-head-left">
            <div className="clm-modal-head-ico">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
            </div>
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,.65)', letterSpacing: '.12em', textTransform: 'uppercase', marginBottom: 3 }}>{segName}</div>
              <div className="clm-modal-head-title">{catLabel} Documents</div>
              <div className="clm-modal-head-sub">{totalSel} document{totalSel === 1 ? '' : 's'} configured</div>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
            {mand.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#fff', background: 'rgba(6,182,212,.28)', border: '1px solid rgba(255,255,255,.3)', padding: '5px 13px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                {mand.length} Mandatory
              </span>
            )}
            {opt.length > 0 && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10.5, fontWeight: 700, color: '#fff', background: 'rgba(251,191,36,.28)', border: '1px solid rgba(251,191,36,.32)', padding: '5px 13px', borderRadius: 20, whiteSpace: 'nowrap' }}>
                <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5"><circle cx="12" cy="12" r="5"/></svg>
                {opt.length} Optional
              </span>
            )}
            <button className="clm-modal-close" onClick={onClose}>×</button>
          </div>
        </div>

        <div className="dcp-doc-card" style={{ flex: 1, overflowY: 'auto', maxHeight: '60vh' }}>
          {totalSel === 0 ? (
            <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '48px 24px' }}>
              <div style={{ width: 52, height: 52, borderRadius: 15, background: 'rgba(8,145,178,.07)', border: '1.5px solid rgba(6,182,212,.18)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#0891b2' }}>
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
              </div>
              <div style={{ fontSize: 14, fontWeight: 700, color: '#0c4a6e' }}>No documents configured</div>
              <div style={{ fontSize: 11.5, color: '#94a3b8', textAlign: 'center' }}>No {isAll ? '' : catLabel + ' '}documents have been assigned<br/>for this segment rule.</div>
            </div>
          ) : (
            <>
              {mand.length > 0 && (
                <>
                  <div className="dcp-sec-head mandatory">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
                    <span className="dcp-sec-head-label">Mandatory</span>
                    <span className="dcp-sec-head-count">{mand.length}</span>
                  </div>
                  {mand.map((d, i) => renderRow(d, i, i === mand.length - 1))}
                </>
              )}
              {opt.length > 0 && (
                <>
                  <div className="dcp-sec-head optional">
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><circle cx="12" cy="12" r="4"/><circle cx="12" cy="12" r="9"/></svg>
                    <span className="dcp-sec-head-label">Optional</span>
                    <span className="dcp-sec-head-count">{opt.length}</span>
                  </div>
                  {opt.map((d, i) => renderRow(d, i, i === opt.length - 1))}
                </>
              )}
            </>
          )}
        </div>

        <div className="clm-modal-foot" style={{ justifyContent: 'space-between' }}>
          <span className="dcp-foot-text">
            <b>{totalSel}</b> of <b>{universe}</b> documents configured
          </span>
          <button className="clm-btn-cancel" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  ), document.body);
}