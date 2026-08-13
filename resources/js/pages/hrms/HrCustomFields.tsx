import { useEffect, useMemo, useState } from 'react';
import { Col, Row } from 'reactstrap';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useToast } from '../../contexts/ToastContext';
import api from '../../api';
import { MasterSelect } from '../../components/ui/MasterSelect';
import Tooltip from '../../components/ui/Tooltip';
import DataTable, { TruncCell, type DataTableColumn } from '../../components/ui/DataTable';
import DeleteConfirmModal from '../../components/ui/DeleteConfirmModal';
import CustomFieldModal, { CustomFieldFormPayload } from './doc-templates/CustomFieldModal';
import '../../../css/recruitment.css';

// Truncate to N chars (default 30) with an ellipsis. The full value is shown
// via the app's <Tooltip> on hover.
const truncate = (s: string, n = 30) => (s.length > n ? s.slice(0, n) + '…' : s);

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

  // Back button — always return to the parent Document Templates page (Custom
  // Fields belong to the doc-template system). Using navigate(-1) followed
  // browser history, which wrongly dropped users onto whatever page they came
  // from (e.g. Broadcast) instead of the correct parent.
  const goBack = () => {
    navigate('/hr/doc-templates');
  };

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

  /* Paging lives in <DataTable> now (components/ui/DataTable). */

  const columns = useMemo<DataTableColumn<CustomFieldRow>[]>(() => [
    {
      header: 'Field Name',
      accessorKey: 'name',
      meta: { width: '19%' },
      cell: info => (
        <Tooltip label={info.row.original.name} disabled={info.row.original.name.length <= 30}>
          <span style={{ fontWeight: 700, cursor: 'default' }}>{truncate(info.row.original.name)}</span>
        </Tooltip>
      ),
    },
    {
      header: 'Variable',
      id: 'variable',
      accessorFn: (r: CustomFieldRow) => `{{${r.name}}}`,
      meta: { width: '17%' },
      cell: info => (
        <Tooltip label={`{{${info.row.original.name}}}`} disabled={info.row.original.name.length <= 30}>
          <span className="cf-var-chip" style={{ display: 'inline-block', cursor: 'default', padding: '3px 9px', borderRadius: 6, fontFamily: 'monospace', fontSize: 11.5, fontWeight: 700, background: '#ede9fe', color: '#6d28d9' }}>
            {`{{${truncate(info.row.original.name)}}}`}
          </span>
        </Tooltip>
      ),
    },
    {
      header: 'Type',
      accessorKey: 'type',
      meta: { width: '10%' },
      cell: info => {
        const t = info.row.original.type;
        const tn = TYPE_TONES[t];
        return (
          <span className={`cf-type-chip cf-type-${t}`} style={{ display: 'inline-block', padding: '2px 10px', borderRadius: 999, background: tn.bg, color: tn.fg, fontSize: 11.5, fontWeight: 700, border: `1px solid ${tn.border}` }}>
            {tn.label}
          </span>
        );
      },
    },
    {
      header: 'Description',
      accessorKey: 'description',
      meta: { width: '23%' },
      cell: info => <TruncCell value={info.getValue() as string} caseSensitive max={80} className="cf-row-desc" />,
    },
    {
      /* Sorts on the real reference COUNT, not the rendered label — sorting the
         text would order "+3 more" strings alphabetically, which tells the user
         nothing about how widely a field is used. */
      header: 'Used In',
      id: 'used_in',
      accessorFn: (r: CustomFieldRow) => (r.used_in?.length ?? 0),
      meta: { width: '17%' },
      cell: info => {
        const r = info.row.original;
        const used = r.used_in || [];
        // Prefer real scan results; fall back to the user's free-text hint so
        // newly-created fields aren't blank.
        const usedLabel = used.length > 0
          ? used.map(t => t.name || t.code || `#${t.id}`).slice(0, 3).join(', ')
            + (used.length > 3 ? ` +${used.length - 3}` : '')
          : (r.used_in_hint || '—');
        const usedFromHint = used.length === 0 && !!r.used_in_hint;
        return (
          <span
            className={`cf-row-used${used.length === 0 ? '' : ' is-all'}`}
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
            }}
          >
            {usedLabel}
          </span>
        );
      },
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      enableSorting: false,
      meta: { align: 'center', width: '10%' },
      cell: info => (
        <div className="d-flex gap-1 justify-content-center">
          <ActionBtn icon="ri-pencil-line" tone="info"
            onClick={() => { setPrefillName(''); setEditing(info.row.original); setModalOpen(true); }} title="Edit" />
          <ActionBtn icon="ri-delete-bin-line" tone="danger"
            onClick={() => setDeleteTarget(info.row.original)} title="Delete" />
        </div>
      ),
    },
  ], []);

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
      // A duplicate-name / validation error on `name` is thrown back to the
      // modal so it renders inline under the Field Name input. Only genuinely
      // unexpected failures fall through to the top toast.
      const nameErr = err?.response?.status === 422 ? err?.response?.data?.errors?.name?.[0] : null;
      if (nameErr) throw new Error(nameErr);
      toast.error('Could not save', err?.response?.data?.message || 'Please try again.');
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
    { label: 'Total Fields',    value: stats.total,    icon: 'ri-star-fill',     deep: '#4338ca', gradient: 'linear-gradient(135deg,#6366f1 0%,#8b5cf6 100%)' },
    { label: 'Text Fields',     value: stats.text,     icon: 'ri-text',          deep: '#0e7490', gradient: 'linear-gradient(135deg,#06b6d4 0%,#0ea5e9 100%)' },
    { label: 'Date Fields',     value: stats.date,     icon: 'ri-calendar-line', deep: '#a21caf', gradient: 'linear-gradient(135deg,#d946ef 0%,#ec4899 100%)' },
    { label: 'Number Fields',   value: stats.number,   icon: 'ri-hashtag',       deep: '#047857', gradient: 'linear-gradient(135deg,#10b981 0%,#14b8a6 100%)' },
    { label: 'Textarea Fields', value: stats.textarea, icon: 'ri-chat-1-line',   deep: '#9a3412', gradient: 'linear-gradient(135deg,#f59e0b 0%,#f97316 100%)' },
  ];

  return (
    <Row>
      <Col xs={12} className="cf-page">
        <style>{`
          /* KPI tiles are the shared .rec-kpi-card component now — their
             surface, hover lift and dark-mode treatment all live in
             recruitment.css, so no page-local overrides here. */
          .cf-page .cf-back-btn { transition: background 150ms ease, color 150ms ease, border-color 150ms ease; }
          .cf-page .cf-back-btn:hover { background: #eef2ff !important; border-color: #c7d2fe !important; }

          /* â”€â”€ Dark mode â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ */
          [data-bs-theme="dark"] .cf-page .cf-header-card,
          [data-layout-mode="dark"] .cf-page .cf-header-card,
          [data-bs-theme="dark"] .cf-page .cf-filter-card,
          [data-layout-mode="dark"] .cf-page .cf-filter-card,
          [data-bs-theme="dark"] .cf-page .cf-table-card,
          [data-layout-mode="dark"] .cf-page .cf-table-card {
            background: #1f2937 !important;
            border-color: rgba(255, 255, 255, 0.08) !important;
          }

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
          [data-bs-theme="dark"] .cf-page .cf-info-icon,
          [data-layout-mode="dark"] .cf-page .cf-info-icon { color: #c4b5fd !important; }
          [data-bs-theme="dark"] .cf-page .cf-info-code,
          [data-layout-mode="dark"] .cf-page .cf-info-code { background: rgba(139,92,246,0.22) !important; color: #c4b5fd !important; }

          /* Uniform body-cell padding + middle-align so the header columns line
             up exactly with the body columns (some cells had ad-hoc inline
             padding). Header padding is set with the header recipe below. */
          .cf-page .cf-table td { padding: 11px 14px !important; vertical-align: middle; }

          /* Header — an exact copy of the Recruitment list header
             (.rec-list-table thead th): 10.5px / 700 micro-caps at 0.08em,
             soft vertical gradient bar, 13px x 12px padding and a 1px divider.
             Replaces the inline 11px / 800 / letterSpacing 0.4 styling that
             used to sit on the thead and tr, which made this the only HRMS
             table with its own header typography. */
          .cf-page .cf-table thead th {
            padding: 13px 12px !important;
            vertical-align: middle;
            background: linear-gradient(180deg, #fafbfc 0%, #f4f5f8 100%);
            color: var(--vz-secondary-color);
            font-size: 10.5px;
            font-weight: 700;
            letter-spacing: 0.08em;
            text-transform: uppercase;
            border-bottom: 1px solid #ececf2;
          }
          /* With table-layout: fixed, wrap long content (descriptions, variable
             tokens) inside the column instead of letting it overflow and break
             the header alignment. */
          .cf-page .cf-table td { overflow-wrap: anywhere; word-break: break-word; }

          /* Search input — default form-control blended into the dark card.
             Give it a distinct surface + visible border in both themes. */
          .cf-page .cf-search-input { background: var(--vz-secondary-bg); border: 1px solid var(--vz-border-color); color: var(--vz-body-color); }
          .cf-page .cf-search-input:focus { border-color: #7c5cfc; box-shadow: 0 0 0 3px rgba(124,92,252,0.16); background: var(--vz-secondary-bg); color: var(--vz-body-color); }
          [data-bs-theme="dark"] .cf-page .cf-search-input::placeholder,
          [data-layout-mode="dark"] .cf-page .cf-search-input::placeholder { color: #8a909c; }

          /* Pagination buttons — identical to the Employee list (square 32×32). */
          .cf-page .cf-pag-btn {
            height: 32px; min-width: 32px; padding: 0;
            border-radius: 8px; border: 1px solid #e0d9f7;
            background: #fff; color: #6d28d9;
            font-size: 12.5px; font-weight: 700; font-family: inherit;
            display: inline-flex; align-items: center; justify-content: center;
            cursor: pointer;
            transition: background .15s ease, border-color .15s ease, color .15s ease, box-shadow .22s ease;
          }
          .cf-page .cf-pag-btn:hover:not(:disabled):not(.is-active) { background: #f5f3ff; border-color: #c4b5fd; color: #5b21b6; }
          .cf-page .cf-pag-btn.is-active { background: linear-gradient(135deg, #7c3aed, #6d28d9); border-color: #7c3aed; color: #fff; box-shadow: 0 2px 6px rgba(109,40,217,.30); cursor: default; }
          .cf-page .cf-pag-btn:disabled { opacity: .4; cursor: not-allowed; }
          [data-bs-theme="dark"] .cf-page .cf-pag-btn,
          [data-layout-mode="dark"] .cf-page .cf-pag-btn { background: rgba(255,255,255,0.04); border-color: rgba(167,139,250,0.30); color: #c4b5fd; }
          [data-bs-theme="dark"] .cf-page .cf-pag-btn:hover:not(:disabled):not(.is-active),
          [data-layout-mode="dark"] .cf-page .cf-pag-btn:hover:not(:disabled):not(.is-active) { background: rgba(124,58,237,0.20); border-color: rgba(167,139,250,0.50); color: #ede9fe; }
          [data-bs-theme="dark"] .cf-page .cf-pag-btn.is-active,
          [data-layout-mode="dark"] .cf-page .cf-pag-btn.is-active { background: linear-gradient(135deg, #6d28d9, #4c1d95); border-color: #7c3aed; color: #fff; }
          /* Single rotating current-page indicator (no full 1·2·3 list). */
          .cf-page .cf-pag-current { height: 32px; min-width: 38px; padding: 0 10px; border-radius: 8px; background: linear-gradient(135deg,#7c3aed,#6d28d9); color: #fff; font-size: 12.5px; font-weight: 700; display: inline-flex; align-items: center; justify-content: center; box-shadow: 0 2px 6px rgba(109,40,217,.30); }
          .cf-page .cf-pag-total { font-weight: 600; opacity: 0.75; margin-left: 2px; }
          [data-bs-theme="dark"] .cf-page .cf-pag-current,
          [data-layout-mode="dark"] .cf-page .cf-pag-current { background: linear-gradient(135deg, #6d28d9, #4c1d95); }

          /* Dark header — same recipe as the Recruitment list header. */
          [data-bs-theme="dark"] .cf-page .cf-table thead th,
          [data-layout-mode="dark"] .cf-page .cf-table thead th {
            background: linear-gradient(180deg,
              color-mix(in srgb, var(--vz-card-bg, #1a1d29) 88%, #ffffff) 0%,
              var(--vz-card-bg, #1a1d29) 100%);
            color: rgba(255, 255, 255, 0.70);
            border-bottom-color: var(--vz-border-color, #2c3242);
          }
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
        `}</style>
        <div className="rec-page cf-page">
          {/* Header strip — same shape as the Clients / Branches headers. */}
          <div className="frm-cstrip mb-3">
            <span className="frm-cstrip-accent" />
            <div className="frm-cstrip-left">
              <div className="frm-cstrip-icon"><i className="ri-star-fill" /></div>
              <div className="min-w-0">
                <div className="d-flex align-items-center gap-2 flex-wrap">
                  <span className="frm-cstrip-title">Custom Fields</span>
                </div>
                <div className="frm-cstrip-sub">
                  Define custom variables used in document templates — filled manually at document generation time
                </div>
              </div>
            </div>
            <button type="button" className="frm-cstrip-back flex-shrink-0" onClick={goBack}>
              <i className="ri-arrow-left-line" />
              Back
            </button>
          </div>

          {/* KPI strip — uses the shared .rec-page-kpis / .rec-kpi-card
              component from recruitment.css so the tiles are identical to the
              Employee master: label top-left, value directly under it, and the
              gradient icon tile on the RIGHT. The old layout mirrored this
              (icon left, right-aligned value) which broke module consistency. */}
          <div className="row g-1 mb-3 align-items-stretch rec-page-kpis">
            {KPI.map(k => (
              <div key={k.label} className="col-xl col-md-4 col-sm-6">
                <div className="rec-kpi-card h-100">
                  <span className="rec-kpi-strip" style={{ background: k.gradient }} />
                  <div className="rec-kpi-text">
                    <span className="rec-kpi-label">{k.label}</span>
                    <span className="rec-kpi-num">{k.value}</span>
                  </div>
                  <span className="rec-kpi-icon" style={{ background: k.gradient }}>
                    <i className={k.icon} />
                  </span>
                </div>
              </div>
            ))}
          </div>

          {/* Info banner */}
          <div className="cf-info-banner" style={{ borderRadius: 10, background: '#f5f3ff', border: '1px solid #ddd6fe', padding: '10px 14px', marginBottom: 12, display: 'flex', alignItems: 'center', gap: 10, color: '#4c1d95' }}>
            <i className="ri-information-line cf-info-icon" style={{ fontSize: 18, color: '#7c3aed', flexShrink: 0 }} />
            <div style={{ fontSize: 12.5, lineHeight: 1.5 }}>
              Custom Fields are variables you define here that <strong>are not available in employee data</strong>. When a document template includes <code className="cf-info-code" style={{ background: '#ede9fe', color: '#6d28d9', padding: '1px 6px', borderRadius: 4, fontWeight: 700 }}>{'{{YourField}}'}</code>, the system will ask you to fill this value manually at generation time.
            </div>
          </div>

          {/* Shared list table — search, sortable headers and the dynamic
              rows-per-page pager come from components/ui/DataTable. The Type
              filter and the Add button ride in its toolbar, which is why the
              separate filter card above is gone. */}
          <DataTable<CustomFieldRow>
            data={filtered}
            columns={columns}
            serial
            accent="violet"
            autoFitRows
            minWidth={1100}
            loading={loading}
            searchValue={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search fields…"
            emptyMessage={
              <>
                <i className="ri-inbox-line" style={{ fontSize: 32, display: 'block', marginBottom: 8 }} />
                No custom fields match these filters. Click <strong>+ Add Custom Field</strong> to create one.
              </>
            }
            toolbarActions={
              <>
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
                <button type="button"
                  onClick={() => { setEditing(null); setPrefillName(''); setModalOpen(true); }}
                  style={{ padding: '8px 16px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', border: 0, borderRadius: 10, fontWeight: 700, fontSize: 13.5, cursor: 'pointer', boxShadow: '0 4px 12px rgba(99,102,241,0.3)', whiteSpace: 'nowrap' }}>
                  <i className="ri-add-line me-1" /> Add Custom Field
                </button>
              </>
            }
          />
        </div>

        {modalOpen && (
          <CustomFieldModal
            initial={editing}
            prefillName={prefillName}
            existingNames={rows.map(r => r.name)}
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
  // Matches the shared row-action icon style (HrEmployees): theme-aware subtle
  // square + border, muted icon, tinting to the tone colour on hover. Works in
  // both light and dark mode via Velzon CSS variables.
  return (
    <Tooltip label={title}>
      <button type="button" onClick={onClick} aria-label={title}
        className="btn p-0 d-inline-flex align-items-center justify-content-center"
        style={{ width: 30, height: 30, borderRadius: 8, background: 'var(--vz-secondary-bg)', border: '1px solid var(--vz-border-color)', color: 'var(--vz-secondary-color)', transition: 'all .15s ease' }}
        onMouseEnter={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = `var(--vz-${tone})`; el.style.color = `var(--vz-${tone})`; }}
        onMouseLeave={e => { const el = e.currentTarget as HTMLButtonElement; el.style.borderColor = 'var(--vz-border-color)'; el.style.color = 'var(--vz-secondary-color)'; }}>
        <i className={`${icon} fs-14`} />
      </button>
    </Tooltip>
  );
}
