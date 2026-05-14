import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Input } from 'reactstrap';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { MasterSelect } from '../../components/ui/MasterSelect';
import { ShimmerTableRows } from '../../components/ui/Shimmer';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import CustomFieldModal, { CustomFieldFormPayload } from './doc-templates/CustomFieldModal';
import '../../../css/recruitment.css';

// â”€â”€ Types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
type FieldType = 'text' | 'date' | 'number' | 'textarea';

interface UsedInRef { id: number; code: string | null; name: string | null; }

interface CustomFieldRow {
  id: number;
  name: string;
  type: FieldType;
  description: string | null;
  // The user's intent — free-text label they typed in the "Used in Templates"
  // input. Persisted as-is. Shown when the auto-scan returns empty so newly
  // created fields aren't blank.
  used_in_hint: string | null;
  // Server-derived: which templates currently reference {{name}}. Updated on
  // every read by scanning hr_document_templates.content_html — never stored.
  used_in: UsedInRef[];
  used_count: number;
}

interface Stats { total: number; text: number; date: number; number: number; textarea: number; other: number; }
const ZERO_STATS: Stats = { total: 0, text: 0, date: 0, number: 0, textarea: 0, other: 0 };

// â”€â”€ Type tones (matches the chip colours from the spec) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
const TYPE_TONES: Record<FieldType, { bg: string; fg: string; border: string; label: string; icon: string }> = {
  text:     { bg: '#ccfbf1', fg: '#0f766e', border: '#5eead4', label: 'text',     icon: 'ri-text' },
  date:     { bg: '#ede9fe', fg: '#6d28d9', border: '#c4b5fd', label: 'date',     icon: 'ri-calendar-line' },
  number:   { bg: '#dcfce7', fg: '#15803d', border: '#86efac', label: 'number',   icon: 'ri-hashtag' },
  textarea: { bg: '#ffedd5', fg: '#9a3412', border: '#fdba74', label: 'textarea', icon: 'ri-chat-1-line' },
};

// â”€â”€ Page â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€
export default function HrCustomFields() {
  const toast = useToast();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();

  const [rows, setRows]   = useState<CustomFieldRow[]>([]);
  const [stats, setStats] = useState<Stats>(ZERO_STATS);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');

  // Add / Edit modal state. `prefillName` lets the TemplateEditor deep-link
  // here with ?new=NewVariable to pre-fill an unrecognised token.
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing]     = useState<CustomFieldRow | null>(null);
  const [prefillName, setPrefillName] = useState<string>('');

  // Delete modal state
  const [deleteTarget, setDeleteTarget] = useState<CustomFieldRow | null>(null);
  const [deleting, setDeleting]         = useState(false);

  const fetchAll = async () => {
    try {
      setLoading(true);
      const [listRes, statsRes] = await Promise.all([
        api.get('/hr-custom-fields'),
        api.get('/hr-custom-fields/stats').catch(() => ({ data: ZERO_STATS })),
      ]);
      setRows(Array.isArray(listRes.data) ? listRes.data : []);
      setStats({ ...ZERO_STATS, ...(statsRes.data || {}) });
    } catch (err: any) {
      toast.error('Could not load custom fields', err?.response?.data?.message || 'Please try again.');
      setRows([]);
      setStats(ZERO_STATS);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, []);

  // Deep-link from TemplateEditor: /hr/custom-fields?new=NewVariable opens
  // the Add modal pre-filled. Consume the param once and strip it so a
  // page refresh doesn't re-open the modal.
  useEffect(() => {
    const newToken = searchParams.get('new');
    if (newToken) {
      setPrefillName(newToken);
      setEditing(null);
      setModalOpen(true);
      searchParams.delete('new');
      setSearchParams(searchParams, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows
      .filter(r => !typeFilter || r.type === typeFilter)
      .filter(r => {
        if (!needle) return true;
        const desc = (r.description || '').toLowerCase();
        const hint = (r.used_in_hint || '').toLowerCase();
        const usedIn = (r.used_in || []).map(t => `${t.code || ''} ${t.name || ''}`).join(' ').toLowerCase();
        return r.name.toLowerCase().includes(needle) || desc.includes(needle) || hint.includes(needle) || usedIn.includes(needle);
      });
  }, [rows, typeFilter, search]);

  const handleSave = async (payload: CustomFieldFormPayload) => {
    try {
      if (payload.id) {
        await api.put(`/hr-custom-fields/${payload.id}`, payload);
        toast.success('Field updated', `{{${payload.name}}} saved.`);
      } else {
        await api.post('/hr-custom-fields', payload);
        toast.success('Field added', `{{${payload.name}}} is now available in templates.`);
      }
      setModalOpen(false);
      setEditing(null);
      setPrefillName('');
      fetchAll();
    } catch (err: any) {
      const msg = err?.response?.data?.message || err?.response?.data?.errors?.name?.[0] || 'Please try again.';
      toast.error('Could not save', msg);
    }
  };

  const confirmDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      await api.delete(`/hr-custom-fields/${deleteTarget.id}`);
      toast.success('Deleted', `{{${deleteTarget.name}}} removed.`);
      setDeleteTarget(null);
      fetchAll();
    } catch (err: any) {
      // 422 from the controller when the field is still referenced by templates
      toast.error('Cannot delete', err?.response?.data?.message || 'This field may still be referenced by templates.');
    } finally {
      setDeleting(false);
    }
  };

  // KPI strip — jewel-tone palette: indigo · cyan · fuchsia · emerald
  const KPI = [
    { label: 'Total Fields', value: stats.total, icon: 'ri-star-fill',     deep: '#4338ca', gradient: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)' },
    { label: 'Text Fields',  value: stats.text,  icon: 'ri-text',          deep: '#0e7490', gradient: 'linear-gradient(135deg,#06b6d4 0%,#0ea5e9 100%)' },
    { label: 'Date Fields',  value: stats.date,  icon: 'ri-calendar-line', deep: '#a21caf', gradient: 'linear-gradient(135deg,#d946ef 0%,#ec4899 100%)' },
    { label: 'Other Types',  value: stats.other, icon: 'ri-chat-1-line',   deep: '#047857', gradient: 'linear-gradient(135deg,#10b981 0%,#14b8a6 100%)' },
  ];

  return (
    <Row>
      <Col xs={12}>
        <style>{`
          /* KPI hover — lift + indigo glow, smooth transitions */
          .cf-page .cf-kpi-tile {
            transition: transform 180ms ease, box-shadow 200ms ease, border-color 180ms ease;
          }
          .cf-page .cf-kpi-tile:hover {
            transform: translateY(-3px);
            box-shadow: 0 12px 26px rgba(99, 102, 241, 0.20), 0 4px 10px rgba(15, 23, 42, 0.06);
            border-color: rgba(99, 102, 241, 0.45) !important;
          }
          .cf-page .cf-back-btn { transition: background 150ms ease, color 150ms ease, border-color 150ms ease; }
          .cf-page .cf-back-btn:hover { background: #eef2ff !important; border-color: #c7d2fe !important; }

          /* â”€â”€ Dark mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
          [data-bs-theme="dark"] .cf-page .cf-header-card,
          [data-layout-mode="dark"] .cf-page .cf-header-card,
          [data-bs-theme="dark"] .cf-page .cf-filter-card,
          [data-layout-mode="dark"] .cf-page .cf-filter-card,
          [data-bs-theme="dark"] .cf-page .cf-table-card,
          [data-layout-mode="dark"] .cf-page .cf-table-card,
          [data-bs-theme="dark"] .cf-page .cf-kpi-tile,
          [data-layout-mode="dark"] .cf-page .cf-kpi-tile {
            background: #1f2937 !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
          }
          [data-bs-theme="dark"] .cf-page .cf-kpi-tile:hover,
          [data-layout-mode="dark"] .cf-page .cf-kpi-tile:hover {
            box-shadow: 0 12px 28px rgba(99, 102, 241, 0.45), 0 4px 10px rgba(0, 0, 0, 0.3);
            border-color: rgba(139, 92, 246, 0.55) !important;
          }
          [data-bs-theme="dark"] .cf-page .cf-kpi-value,
          [data-layout-mode="dark"] .cf-page .cf-kpi-value { color: #f8fafc !important; }
          [data-bs-theme="dark"] .cf-page .cf-kpi-label,
          [data-layout-mode="dark"] .cf-page .cf-kpi-label { color: rgba(255, 255, 255, 0.65) !important; }

          [data-bs-theme="dark"] .cf-page .cf-back-btn,
          [data-layout-mode="dark"] .cf-page .cf-back-btn {
            background: rgba(255, 255, 255, 0.06) !important;
            border-color: rgba(255, 255, 255, 0.1) !important;
            color: #c7d2fe !important;
          }
          [data-bs-theme="dark"] .cf-page .cf-back-btn:hover,
          [data-layout-mode="dark"] .cf-page .cf-back-btn:hover {
            background: rgba(99, 102, 241, 0.18) !important;
            border-color: rgba(99, 102, 241, 0.45) !important;
          }

          [data-bs-theme="dark"] .cf-page .cf-title,
          [data-layout-mode="dark"] .cf-page .cf-title { color: #f1f5f9 !important; }
          [data-bs-theme="dark"] .cf-page .cf-subtle,
          [data-layout-mode="dark"] .cf-page .cf-subtle { color: rgba(255, 255, 255, 0.62) !important; }

          [data-bs-theme="dark"] .cf-page .cf-info-banner,
          [data-layout-mode="dark"] .cf-page .cf-info-banner {
            background: rgba(139, 92, 246, 0.10) !important;
            border-color: rgba(139, 92, 246, 0.30) !important;
            color: #ddd6fe !important;
          }
          [data-bs-theme="dark"] .cf-page .cf-info-banner strong,
          [data-layout-mode="dark"] .cf-page .cf-info-banner strong { color: #f5f3ff !important; }

          [data-bs-theme="dark"] .cf-page .cf-table thead,
          [data-layout-mode="dark"] .cf-page .cf-table thead {
            background: rgba(99, 102, 241, 0.12) !important;
          }
          [data-bs-theme="dark"] .cf-page .cf-table thead tr,
          [data-layout-mode="dark"] .cf-page .cf-table thead tr { color: rgba(255, 255, 255, 0.65) !important; }
          [data-bs-theme="dark"] .cf-page .cf-table tbody tr,
          [data-layout-mode="dark"] .cf-page .cf-table tbody tr { border-color: rgba(255, 255, 255, 0.06); }
          [data-bs-theme="dark"] .cf-page .cf-row-name,
          [data-layout-mode="dark"] .cf-page .cf-row-name { color: #f1f5f9 !important; }
          [data-bs-theme="dark"] .cf-page .cf-row-desc,
          [data-layout-mode="dark"] .cf-page .cf-row-desc { color: #cbd5e1 !important; }
          [data-bs-theme="dark"] .cf-page .cf-row-used,
          [data-layout-mode="dark"] .cf-page .cf-row-used { color: #cbd5e1 !important; }
          [data-bs-theme="dark"] .cf-page .cf-row-used.is-all,
          [data-layout-mode="dark"] .cf-page .cf-row-used.is-all { color: #93c5fd !important; }
          [data-bs-theme="dark"] .cf-page .cf-row-num,
          [data-layout-mode="dark"] .cf-page .cf-row-num { color: rgba(255, 255, 255, 0.55) !important; }

          /* Chips — translucent fills + bright fg so they read natively on dark rows */
          [data-bs-theme="dark"] .cf-page .cf-var-chip,
          [data-layout-mode="dark"] .cf-page .cf-var-chip {
            background: rgba(139, 92, 246, 0.16) !important;
            color: #c4b5fd !important;
            border: 1px solid rgba(139, 92, 246, 0.35);
          }
          [data-bs-theme="dark"] .cf-page .cf-type-chip,
          [data-layout-mode="dark"] .cf-page .cf-type-chip { background: transparent !important; }
          [data-bs-theme="dark"] .cf-page .cf-type-text,
          [data-layout-mode="dark"] .cf-page .cf-type-text {
            background: rgba(20, 184, 166, 0.18) !important;
            color: #5eead4 !important;
            border-color: rgba(20, 184, 166, 0.45) !important;
          }
          [data-bs-theme="dark"] .cf-page .cf-type-date,
          [data-layout-mode="dark"] .cf-page .cf-type-date {
            background: rgba(139, 92, 246, 0.20) !important;
            color: #c4b5fd !important;
            border-color: rgba(139, 92, 246, 0.45) !important;
          }
          [data-bs-theme="dark"] .cf-page .cf-type-number,
          [data-layout-mode="dark"] .cf-page .cf-type-number {
            background: rgba(16, 185, 129, 0.18) !important;
            color: #86efac !important;
            border-color: rgba(16, 185, 129, 0.45) !important;
          }
          [data-bs-theme="dark"] .cf-page .cf-type-textarea,
          [data-layout-mode="dark"] .cf-page .cf-type-textarea {
            background: rgba(249, 115, 22, 0.18) !important;
            color: #fdba74 !important;
            border-color: rgba(249, 115, 22, 0.45) !important;
          }

          /* Master Data badge in dark mode */
          [data-bs-theme="dark"] .cf-page .cf-title span,
          [data-layout-mode="dark"] .cf-page .cf-title span {
            background: rgba(139, 92, 246, 0.18) !important;
            color: #c4b5fd !important;
          }
        `}</style>
        <div className="rec-page cf-page">
          {/* Header */}
          <Card className="mb-3 cf-header-card" style={{ borderRadius: 14 }}>
            <CardBody className="d-flex align-items-center gap-3 flex-wrap">
              <button type="button" onClick={() => navigate('/hr/doc-templates')}
                title="Back to Document Templates"
                className="cf-back-btn"
                style={{ width: 36, height: 36, borderRadius: 10, background: '#f3f4f6', border: '1px solid #e5e7eb', color: '#4338ca', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ri-arrow-left-line" style={{ fontSize: 18 }} />
              </button>
              <span style={{ width: 44, height: 44, borderRadius: 10, background: 'linear-gradient(135deg,#eef2ff,#e0e7ff)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ri-star-fill" style={{ fontSize: 22, color: '#6366f1' }} />
              </span>
              <div className="me-auto">
                <h4 className="mb-0 fw-bold d-flex align-items-center gap-2 cf-title">
                  Custom Fields
                  <span style={{ fontSize: 11.5, color: '#6d28d9', background: '#ede9fe', padding: '3px 10px', borderRadius: 999, fontWeight: 700 }}>
                    Master Data
                  </span>
                </h4>
                <div className="text-muted cf-subtle" style={{ fontSize: 12.5 }}>
                  Define custom variables used in document templates — filled manually at document generation time
                </div>
              </div>
            </CardBody>
          </Card>

          {/* KPI strip */}
          <div className="row g-2 mb-3">
            {KPI.map(k => (
              <div key={k.label} className="col-md-3 col-sm-6">
                <div className="cf-kpi-tile" style={{ borderRadius: 12, border: '1px solid #e5e7eb', background: '#fff', overflow: 'hidden', cursor: 'default' }}>
                  <div style={{ height: 4, background: k.gradient }} />
                  <div className="d-flex align-items-center justify-content-between" style={{ padding: '12px 14px' }}>
                    <span style={{ width: 42, height: 42, borderRadius: 10, background: k.gradient, display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                      <i className={k.icon} style={{ fontSize: 18, color: '#fff' }} />
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <div className="cf-kpi-value" style={{ fontSize: 26, fontWeight: 800, color: k.deep, lineHeight: 1 }}>{k.value}</div>
                      <div className="cf-kpi-label" style={{ fontSize: 10.5, fontWeight: 700, color: '#6b7280', letterSpacing: 0.4, textTransform: 'uppercase', marginTop: 4 }}>{k.label}</div>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>

          {/* Filters + Add button */}
          <Card className="mb-3 cf-filter-card" style={{ borderRadius: 12 }}>
            <CardBody className="d-flex flex-wrap gap-3 align-items-center" style={{ padding: 12 }}>
              <div style={{ position: 'relative', minWidth: 260 }}>
                <i className="ri-search-line" style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#9ca3af' }} />
                <Input type="text" placeholder="Search fields…" value={search} onChange={e => setSearch(e.target.value)}
                  style={{ paddingLeft: 30, height: 36 }} />
              </div>
              <div className="d-flex align-items-center gap-2">
                <span style={{ fontSize: 10.5, fontWeight: 800, color: '#9ca3af', letterSpacing: 0.4, textTransform: 'uppercase' }}>Type</span>
                <div style={{ minWidth: 160 }}>
                  <MasterSelect
                    value={typeFilter}
                    onChange={setTypeFilter}
                    options={[
                      { value: '',         label: 'All Types' },
                      { value: 'text',     label: 'Text' },
                      { value: 'date',     label: 'Date' },
                      { value: 'number',   label: 'Number' },
                      { value: 'textarea', label: 'Textarea' },
                    ]}
                    placeholder="All Types"
                  />
                </div>
              </div>
              <button type="button"
                onClick={() => { setEditing(null); setPrefillName(''); setModalOpen(true); }}
                className="ms-auto"
                style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.3)' }}>
                <i className="ri-add-line me-1" /> Add Custom Field
              </button>
            </CardBody>
          </Card>

          {/* Info banner */}
          <div className="cf-info-banner" style={{ borderRadius: 10, background: '#f5f3ff', border: '1px solid #ddd6fe', padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'flex-start', gap: 10 }}>
            <i className="ri-information-line" style={{ fontSize: 18, color: '#7c3aed', marginTop: 1 }} />
            <div style={{ fontSize: 12.5, color: '#4c1d95', lineHeight: 1.5 }}>
              Custom Fields are variables you define here that <strong>are not available in employee data</strong>. When a document template includes <code style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{'{{YourField}}'}</code>, the system will ask you to fill this value manually at generation time.
            </div>
          </div>

          {/* Table */}
          <Card className="cf-table-card" style={{ borderRadius: 12 }}>
            <CardBody style={{ padding: 0 }}>
              <div className="table-responsive">
                <table className="table align-middle mb-0 cf-table" style={{ fontSize: 13 }}>
                  <thead style={{ background: '#f5f3ff' }}>
                    <tr style={{ fontSize: 11, letterSpacing: 0.4, textTransform: 'uppercase', color: '#6b7280', fontWeight: 800 }}>
                      <th style={{ padding: '10px 12px', width: 40 }}>#</th>
                      <th>Field Name</th>
                      <th>Variable</th>
                      <th>Type</th>
                      <th>Description</th>
                      <th>Used In</th>
                      <th style={{ width: 100 }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {loading ? (
                      <ShimmerTableRows rows={5} cols={7} />
                    ) : filtered.length === 0 ? (
                      <tr><td colSpan={7} style={{ padding: 32, textAlign: 'center', color: '#9ca3af' }}>
                        <i className="ri-inbox-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                        No custom fields match these filters. Click <strong>+ Add Custom Field</strong> to create one.
                      </td></tr>
                    ) : (
                      filtered.map((r, i) => {
                        const tone = TYPE_TONES[r.type];
                        const used = r.used_in || [];
                        // Prefer real scan results; fall back to the user's
                        // free-text hint so newly-created fields aren't blank.
                        const usedLabel = used.length > 0
                          ? used.map(t => t.name || t.code || `#${t.id}`).slice(0, 3).join(', ')
                            + (used.length > 3 ? ` +${used.length - 3}` : '')
                          : (r.used_in_hint || '—');
                        const usedFromHint = used.length === 0 && !!r.used_in_hint;
                        return (
                          <tr key={r.id}>
                            <td className="cf-row-num" style={{ padding: '10px 12px', color: '#6b7280' }}>{i + 1}</td>
                            <td className="cf-row-name" style={{ fontWeight: 700, color: '#1f2937' }}>{r.name}</td>
                            <td>
                              <span className="cf-var-chip" style={{ display: 'inline-block', padding: '3px 9px', borderRadius: 6, fontFamily: 'monospace', fontSize: 11.5, fontWeight: 700, background: '#ede9fe', color: '#6d28d9' }}>
                                {`{{${r.name}}}`}
                              </span>
                            </td>
                            <td>
                              <span className={`cf-type-chip cf-type-${r.type}`} style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, background: tone.bg, color: tone.fg, fontSize: 11.5, fontWeight: 700, border: `1px solid ${tone.border}` }}>
                                {tone.label}
                              </span>
                            </td>
                            <td className="cf-row-desc" style={{ color: '#374151' }}>{r.description || '—'}</td>
                            <td>
                              <span className={`cf-row-used${used.length === 0 ? '' : ' is-all'}`}
                                title={
                                  used.length > 0 ? used.map(t => t.name || t.code).join(', ')
                                  : usedFromHint ? `Hint — no template references {{${r.name}}} yet`
                                  : ''
                                }
                                style={{
                                  color: used.length > 0 ? '#1d4ed8' : (usedFromHint ? '#6b7280' : '#9ca3af'),
                                  fontSize: 12.5,
                                  fontWeight: used.length > 0 ? 700 : 500,
                                  fontStyle: usedFromHint ? 'italic' : 'normal',
                                }}>
                                {usedLabel}
                              </span>
                            </td>
                            <td>
                              <div className="d-flex gap-1">
                                <ActionBtn icon="ri-pencil-line" tone="info"
                                  onClick={() => { setPrefillName(''); setEditing(r); setModalOpen(true); }} title="Edit" />
                                <ActionBtn icon="ri-delete-bin-line" tone="danger"
                                  onClick={() => setDeleteTarget(r)} title="Delete" />
                              </div>
                            </td>
                          </tr>
                        );
                      })
                    )}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </div>

        {modalOpen && (
          <CustomFieldModal
            initial={editing}
            prefillName={prefillName}
            onClose={() => { setModalOpen(false); setEditing(null); setPrefillName(''); }}
            onSave={handleSave}
          />
        )}

        <DeleteConfirmModal
          open={!!deleteTarget}
          title="Delete Custom Field"
          itemName={deleteTarget ? `{{${deleteTarget.name}}}` : undefined}
          subMessage="This action cannot be undone. Document templates referencing this variable will need to be updated."
          loading={deleting}
          onClose={() => { if (!deleting) setDeleteTarget(null); }}
          onConfirm={confirmDelete}
        />
      </Col>
    </Row>
  );
}


// ── Small bits ──────────────────────────────────────────────────────────────
function ActionBtn({ icon, tone, onClick, title }: { icon: string; tone: 'info' | 'danger'; onClick: () => void; title: string }) {
  const palette: Record<string, { bg: string; fg: string }> = {
    info:   { bg: '#dbeafe', fg: '#1d4ed8' },
    danger: { bg: '#fee2e2', fg: '#b91c1c' },
  };
  const c = palette[tone];
  return (
    <button type="button" onClick={onClick} title={title}
      style={{ width: 30, height: 30, borderRadius: 8, border: 0, background: c.bg, color: c.fg, cursor: 'pointer', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
      <i className={icon} />
    </button>
  );
}
