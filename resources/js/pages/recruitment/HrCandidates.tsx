import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Col, Row, Modal, ModalBody, Spinner } from 'reactstrap';
import { MasterSelect, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { useTheme } from '../../contexts/ThemeContext';
import { useModulePermission } from '../../hooks/useModulePermission';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import DataTable, { TruncCell, type DataTableColumn } from '../../components/ui/DataTable';
import '../../../css/recruitment.css';

type CandidateStatus =
  | 'Applied' | 'Shortlisted' | 'In Interview' | 'Final Interview'
  | 'Selected' | 'Offered' | 'Rejected' | 'On Hold';

interface CandidateRow {
  id: number;
  recruitment_id: number;
  recruitment_code: string | null;
  recruitment_title: string | null;
  name: string;
  initials: string;
  accent: string;
  email: string | null;
  mobile: string | null;
  current_address: string | null;
  qualification: string | null;
  experience_years: number;
  mode_of_transport: string | null;
  distance_km: number | null;
  current_salary_lpa: number | null;
  expected_salary_lpa: number | null;
  notice_period: string | null;
  source: string | null;
  referred_by_id: number | null;
  referred_by_name: string | null;
  cv_path: string | null;
  cv_url: string | null;
  cv_original_name?: string | null;
  status: CandidateStatus;
  created_at: string | null;
}

interface RecruitmentInfo {
  id: string;
  code: string;
  jobTitle: string;
  department: string | null;
  designation: string | null;
  employmentType: string | null;
  openings: number;
  experience: string | null;
  workMode: string | null;
  priority: string | null;
  hiringManagerRaw: string | null;
  assignedHrName: string | null;
  startDate: string | null;
  deadline: string | null;
  status: string;
}

const SOURCES = ['LinkedIn', 'Naukri', 'Indeed', 'Referral', 'Company Website', 'Walk-in', 'Recruitment Agency', 'Internal', 'Other'];
const NOTICE_PERIODS = ['Immediate', '15 Days', '30 Days', '45 Days', '60 Days', '90 Days'];
const TRANSPORT_MODES = ['Walk', 'Bicycle', 'Two-wheeler', 'Four-wheeler', 'Public Transport', 'Other'];

const MONTH_ABBR = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
function formatDate(raw: any): string {
  if (raw == null || raw === '') return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd}-${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
}

const CANDIDATE_STATUS_COLOR: Record<CandidateStatus, 'success' | 'danger' | 'warning' | 'info' | 'primary' | 'secondary'> = {
  'Applied':         'warning',
  'Shortlisted':     'info',
  'In Interview':    'info',
  'Final Interview': 'primary',
  'Selected':        'success',
  'Offered':         'success',
  'Rejected':        'danger',
  'On Hold':         'secondary',
};

/* Greying for a control the user lacks the grant for. No `pointer-events:
   none` — the click still has to reach the handler that raises the toast. */
const LOCKED_STYLE = { opacity: .5, cursor: 'not-allowed', filter: 'grayscale(0.7)' } as const;

export default function HrCandidates() {
  const { id: recruitmentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  /* Candidates have no module of their own — the pipeline belongs to the
     recruitment it hangs off, so Add/Edit on `hr.recruitment` is what unlocks
     adding, importing, editing and selecting/rejecting candidates. View-only
     reads the whole pipeline and changes none of it. */
  const perm = useModulePermission('hr.recruitment', 'candidates');
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const [recruitment, setRecruitment] = useState<RecruitmentInfo | null>(null);
  const [candidates, setCandidates]   = useState<CandidateRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState<'all' | 'final' | 'selected' | 'rejected'>('final');
  const [search, setSearch]           = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing]     = useState<CandidateRow | null>(null);
  /* Rejected candidates open the same form in read-only mode — the profile is
     still worth reading (why they applied, salary, CV) but nothing is editable
     once the candidate is out of the pipeline. */
  const [viewOnly, setViewOnly]   = useState(false);
  const [sampleOpen, setSampleOpen] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);

  const [confirming, setConfirming] = useState<{ row: CandidateRow; mode: 'select' | 'reject' } | null>(null);

  const fetchAll = async () => {
    if (!recruitmentId) return;
    try {
      setLoading(true);
      const [sumRes, listRes] = await Promise.all([
        api.get(`/recruitments/${recruitmentId}/candidates/summary`),
        api.get(`/candidates?recruitment_id=${recruitmentId}`),
      ]);
      setRecruitment(sumRes.data?.recruitment || null);
      setCandidates(Array.isArray(listRes.data) ? listRes.data : []);
    } catch (err: any) {
      toast.error('Could not load candidates', err?.response?.data?.message || 'Please try again.');
      setRecruitment(null);
      setCandidates([]);
    } finally {
      setLoading(false);
    }
  };
  useEffect(() => { fetchAll();  }, [recruitmentId]);

  const totals = useMemo(() => {
    const t = candidates.length;
    const applied = candidates.filter(c => c.status === 'Applied' || c.status === 'Shortlisted').length;
    const inInterview = candidates.filter(c => c.status === 'In Interview' || c.status === 'Final Interview').length;
    const selected = candidates.filter(c => c.status === 'Selected').length;
    const rejected = candidates.filter(c => c.status === 'Rejected').length;
    const offered = candidates.filter(c => c.status === 'Offered').length;
    const active = candidates.filter(c =>
      c.status !== 'Selected' && c.status !== 'Offered' && c.status !== 'Rejected'
    ).length;
    const finalRound = candidates.filter(c => c.status === 'Final Interview').length;
    return { total: t, applied, inInterview, selected, rejected, offered, active, finalRound };
  }, [candidates]);

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return candidates
      .filter(c => {
        if (tab === 'all')      return c.status !== 'Selected' && c.status !== 'Offered' && c.status !== 'Rejected';
        if (tab === 'final')    return c.status === 'Final Interview';
        if (tab === 'selected') return c.status === 'Selected' || c.status === 'Offered';
        if (tab === 'rejected') return c.status === 'Rejected';
        return true;
      })
      .filter(c => {
        if (!needle) return true;
        return (
          c.name.toLowerCase().includes(needle) ||
          (c.email || '').toLowerCase().includes(needle) ||
          (c.mobile || '').toLowerCase().includes(needle) ||
          (c.recruitment_code || '').toLowerCase().includes(needle)
        );
      });
  }, [candidates, tab, search]);

  const recClosed = ['Cancelled', 'Completed', 'Expired'].includes(recruitment?.status || '');
  const recClosedMsg = `Cannot add candidates — this recruitment is ${(recruitment?.status || '').toLowerCase()}`;

  /* Columns for the shared <DataTable>. Widths sum to 100 (fixed layout):
     16+13+9+5+8+8+7+8+7+9+10. */
  const columns = useMemo<DataTableColumn<CandidateRow>[]>(() => [
    {
      header: 'Name',
      accessorKey: 'name',
      meta: { width: '16%' },
      cell: info => {
        const c = info.row.original;
        return (
          <div className="d-flex align-items-center gap-2">
            <span className="fw-bold fs-13 text-truncate" title={c.name}>{c.name}</span>
            {c.recruitment_code && <span className="rec-id-pill flex-shrink-0" style={{ fontSize: 10, padding: '2px 7px' }}>{c.recruitment_code}</span>}
          </div>
        );
      },
    },
    {
      header: 'Email',
      accessorKey: 'email',
      meta: { width: '13%' },
      cell: info => <TruncCell value={info.getValue() as string} caseSensitive className="text-muted" />,
    },
    {
      header: 'Mobile',
      accessorKey: 'mobile',
      meta: { width: '9%', align: 'center' },
      cell: info => <TruncCell value={info.getValue() as string} caseSensitive />,
    },
    {
      header: 'Exp (Y)',
      accessorKey: 'experience_years',
      meta: { width: '5%', align: 'center' },
      cell: info => <span className="fs-13">{(info.getValue() as number) ?? 0}</span>,
    },
    {
      header: 'Current Sal',
      accessorKey: 'current_salary_lpa',
      meta: { width: '8%', align: 'center' },
      cell: info => {
        const v = info.getValue() as number | null;
        return v != null ? <span className="fs-13 fw-semibold">{v} L</span> : <span className="dt-dash">—</span>;
      },
    },
    {
      header: 'Expected',
      accessorKey: 'expected_salary_lpa',
      meta: { width: '8%', align: 'center' },
      cell: info => {
        const v = info.getValue() as number | null;
        return v != null ? <span className="fs-13 fw-semibold">{v} L</span> : <span className="dt-dash">—</span>;
      },
    },
    {
      header: 'Notice',
      accessorKey: 'notice_period',
      meta: { width: '7%' },
      cell: info => <TruncCell value={info.getValue() as string} caseSensitive />,
    },
    {
      header: 'Source',
      accessorKey: 'source',
      meta: { width: '8%', align: 'center' },
      cell: info => <TruncCell value={info.getValue() as string} caseSensitive />,
    },
    {
      header: 'CV',
      id: '__cv',
      enableSorting: false,
      /* wrap: the Upload / Download chip is wider than the column, and a
         clipped cell renders the td's own text-overflow ellipsis next to it. */
      meta: { width: '7%', align: 'center', wrap: true },
      cell: info => (
        <CvCell
          candidate={info.row.original}
          onUploaded={(updated) => setCandidates(prev => prev.map(r => r.id === updated.id ? updated : r))}
        />
      ),
    },
    {
      header: 'Status',
      accessorKey: 'status',
      meta: { width: '9%', align: 'center' },
      cell: info => {
        const c = info.row.original;
        const statusColor = CANDIDATE_STATUS_COLOR[c.status];
        return (
          <span className={`badge rounded-pill rec-status-pill bg-${statusColor}-subtle text-${statusColor} fw-semibold px-3 py-2 fs-13`}>
            {c.status}
          </span>
        );
      },
    },
    {
      header: 'Actions',
      id: '__actions',
      enableSorting: false,
      meta: { width: '10%', align: 'center', wrap: true },
      cell: info => {
        const c = info.row.original;
        return (
          <div className="rec-row-actions justify-content-center">
            {c.status === 'Rejected' && (
              <Tooltip label="View Candidate">
                <button
                  type="button"
                  className="rec-act rec-act-view rec-act--icon"
                  aria-label="View Candidate"
                  onClick={() => { setEditing(c); setViewOnly(true); setModalOpen(true); }}
                >
                  <i className="ri-eye-line" />
                </button>
              </Tooltip>
            )}
            {/* Without Edit this becomes a VIEW button rather than a locked
                one — the profile is still readable, which is exactly the
                "can see candidates, can't modify them" rule. The form already
                has a read-only mode (rejected candidates use it). */}
            {c.status !== 'Rejected' && (
              <Tooltip label={perm.canEdit ? 'Edit Candidate' : 'View Candidate (no edit permission)'}>
                <button
                  type="button"
                  className="rec-act rec-act-view rec-act--icon"
                  aria-label={perm.canEdit ? 'Edit Candidate' : 'View Candidate'}
                  onClick={() => { setEditing(c); setViewOnly(!perm.canEdit); setModalOpen(true); }}
                >
                  <i className={perm.canEdit ? 'ri-pencil-line' : 'ri-eye-line'} />
                </button>
              </Tooltip>
            )}
            {c.status !== 'Selected' && c.status !== 'Offered' && c.status !== 'Rejected' && (
              <Tooltip label={perm.lockedTitle('edit') ?? 'Mark Selected'}>
                <button
                  type="button"
                  className="rec-act rec-act-approve rec-act--icon"
                  aria-label="Mark Selected"
                  aria-disabled={!perm.canEdit || undefined}
                  style={perm.canEdit ? undefined : LOCKED_STYLE}
                  onClick={() => perm.guard('edit', () => setConfirming({ row: c, mode: 'select' }))}
                >
                  <i className="ri-check-line" />
                </button>
              </Tooltip>
            )}
            {c.status !== 'Rejected' && (
              <Tooltip label={perm.lockedTitle('edit') ?? 'Mark Rejected'}>
                <button
                  type="button"
                  className="rec-act rec-act-reject rec-act--icon"
                  aria-label="Mark Rejected"
                  aria-disabled={!perm.canEdit || undefined}
                  style={perm.canEdit ? undefined : LOCKED_STYLE}
                  onClick={() => perm.guard('edit', () => setConfirming({ row: c, mode: 'reject' }))}
                >
                  <i className="ri-close-line" />
                </button>
              </Tooltip>
            )}
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    // Grants can arrive after mount (auth refresh), and they decide whether the
    // row shows an Edit or a View button — so the cells must re-render on change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [perm.canEdit]);

  const KPI_CARDS = [
    { key: 'total',       label: 'Total',        value: totals.total,        icon: 'ri-team-line',            gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
    { key: 'inInterview', label: 'In Interview', value: totals.inInterview,  icon: 'ri-file-text-line',       gradient: 'linear-gradient(135deg, #4338ca 0%, #6366f1 60%, #818cf8 100%)', deep: '#4338ca' },
    { key: 'selected',    label: 'Selected',     value: totals.selected,     icon: 'ri-checkbox-circle-line', gradient: 'linear-gradient(135deg, #047857 0%, #10b981 60%, #34d399 100%)', deep: '#047857' },
    { key: 'rejected',    label: 'Rejected',     value: totals.rejected,     icon: 'ri-close-circle-line',    gradient: 'linear-gradient(135deg, #be123c 0%, #ef4444 60%, #fb7185 100%)', deep: '#be123c' },
  ];

  const handleStatusUpdate = async (c: CandidateRow, next: CandidateStatus, reasonOrNote?: string) => {
    const payload: Record<string, any> = { status: next };
    if (reasonOrNote) {
      if (next === 'Rejected') {
        const [reason, ...rest] = reasonOrNote.split(' — ');
        if (reason) payload.rejection_reason = reason.trim();
        const notes = rest.join(' — ').trim();
        if (notes) payload.status_notes = notes;
      } else {
        payload.status_notes = reasonOrNote;
      }
    }

    try {
      const { data } = await api.patch(`/candidates/${c.id}/status`, payload);
      setCandidates(prev => prev.map(r => r.id === c.id ? data : r));
      toast.success(next, `${data.name} → ${next}`);
    } catch (err: any) {
      const fieldErr = err?.response?.data?.errors?.status?.[0];
      const message  = fieldErr || err?.response?.data?.message || 'Please try again.';
      toast.error(next === 'Selected' ? 'Cannot mark as Selected' : 'Could not update', message);
    }
  };

  return (
    <>
      <MasterFormStyles />
      <Row>
        <Col xs={12}>
          <div className="rec-page cand-page">
            {/* Header — the shared .frm-cstrip strip used by Recruitment (and
                Payroll / Attendance), rather than a bare flex row: bordered
                white card, violet accent rail, 46px icon tile, and every page
                action carried inside the strip on the right. */}
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-group-line" /></div>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="frm-cstrip-title">Candidate Management</span>
                  </div>
                  <div className="frm-cstrip-sub">
                    Track candidate profiles, experience, CVs, and selection status
                  </div>
                </div>
              </div>
              <div className="cand-actions d-flex align-items-center gap-2 flex-wrap flex-shrink-0">
                <button type="button" className="cand-pill-btn cand-pill-btn--blue" title="Download a sample CSV" onClick={() => setSampleOpen(true)}>
                  <i className="ri-download-line" />Sample
                </button>
                {/* Import is a bulk ADD of candidates, so it rides on can_add
                    — the same grant the Add button needs. */}
                <button type="button" className="cand-pill-btn cand-pill-btn--violet" disabled={recClosed} aria-disabled={!perm.canAdd || undefined} style={perm.canAdd ? undefined : LOCKED_STYLE} title={recClosed ? recClosedMsg : (perm.lockedTitle('add') ?? 'Import candidates from CSV')} onClick={() => perm.guard('add', () => setImportOpen(true))}>
                  <i className="ri-upload-2-line" />Import
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--green" title="Export candidates" onClick={() => setExportOpen(true)}>
                  <i className="ri-external-link-line" />Export
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--primary" disabled={recClosed} aria-disabled={!perm.canAdd || undefined} style={perm.canAdd ? undefined : LOCKED_STYLE} title={recClosed ? recClosedMsg : (perm.lockedTitle('add') ?? 'Add a candidate')} onClick={() => perm.guard('add', () => { setEditing(null); setViewOnly(false); setModalOpen(true); })}>
                  <i className="ri-add-line" />Add Candidate
                </button>
                {/* Back nav sits at the far-right corner, after the action buttons. */}
                <button type="button" className="cand-pill-btn cand-pill-btn--violet" style={{ marginLeft: 'auto' }} onClick={() => navigate('/hr/recruitment')}>
                  <i className="ri-arrow-left-line" />Back to Recruitment List
                </button>
              </div>
            </div>

            {recruitment && (
              <div className="cand-rec-card mb-2">
                <div className="cand-rec-head">
                  <span className="cand-rec-icon">
                    <i className="ri-briefcase-4-line" />
                  </span>
                  <div className="cand-rec-titlewrap">
                    <span className="rec-id-pill">{recruitment.code}</span>
                    <h6 className="cand-rec-title">{recruitment.jobTitle}</h6>
                  </div>
                  <div className="cand-rec-pills">
                    {recruitment.priority && (
                      <span
                        className="rec-pill"
                        style={{
                          background: dark
                            ? (recruitment.priority === 'High' ? 'rgba(239,68,68,.18)' : recruitment.priority === 'Medium' ? 'rgba(245,158,11,.18)' : 'rgba(59,130,246,.18)')
                            : (recruitment.priority === 'High' ? '#ffe4e1' : recruitment.priority === 'Medium' ? '#fef3c7' : '#dbeafe'),
                          color: dark
                            ? (recruitment.priority === 'High' ? '#fca5a5' : recruitment.priority === 'Medium' ? '#fcd34d' : '#93c5fd')
                            : (recruitment.priority === 'High' ? '#b91c1c' : recruitment.priority === 'Medium' ? '#92400e' : '#1d4ed8'),
                        }}
                      >
                        <i className="ri-alarm-warning-line" style={{ fontSize: 11, marginRight: 3 }} />
                        {recruitment.priority}
                      </span>
                    )}
                    <span className="rec-pill" style={{ background: dark ? 'rgba(34,197,94,.18)' : '#dcfce7', color: dark ? '#86efac' : '#15803d' }}>
                      <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', marginRight: 4 }} />
                      {recruitment.status}
                    </span>
                    
                  </div>
                </div>
                <div className="cand-rec-divider" />
                <div className="cand-rec-grid cand-rec-grid--top">
                  <Field label="Department"      value={recruitment.department} />
                  <Field label="Designation"     value={recruitment.designation} />
                  <Field label="Employment Type" value={recruitment.employmentType} />
                  <Field label="Openings"        value={recruitment.openings ? `${recruitment.openings} positions` : null} />
                  <Field label="Experience Req"  value={recruitment.experience} />
                </div>
                <div className="cand-rec-grid">
                  <Field label="Work Mode" value={recruitment.workMode} />
                  <div className="cand-field">
                    <div className="cand-field-label">Priority</div>
                    <div className="cand-field-value">
                      {recruitment.priority ? (
                        <span
                          className="rec-pill"
                          style={{
                            background: dark
                              ? (recruitment.priority === 'High' ? 'rgba(239,68,68,.18)' : recruitment.priority === 'Medium' ? 'rgba(245,158,11,.18)' : 'rgba(59,130,246,.18)')
                              : (recruitment.priority === 'High' ? '#ffe4e1' : recruitment.priority === 'Medium' ? '#fef3c7' : '#dbeafe'),
                            color: dark
                              ? (recruitment.priority === 'High' ? '#fca5a5' : recruitment.priority === 'Medium' ? '#fcd34d' : '#93c5fd')
                              : (recruitment.priority === 'High' ? '#b91c1c' : recruitment.priority === 'Medium' ? '#92400e' : '#1d4ed8'),
                          }}
                        >
                          {recruitment.priority}
                        </span>
                      ) : <span className="text-muted">—</span>}
                    </div>
                  </div>
                  <div className="cand-field">
                    <div className="cand-field-label">Start · TAT</div>
                    <div className="cand-field-value" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {formatDate(recruitment.startDate)} <span style={{ color: '#f59e0b' }}>→</span> <span style={{ color: '#f59e0b', fontWeight: 700 }}>{formatDate(recruitment.deadline)}</span>
                    </div>
                  </div>
                  <Field label="Hiring Manager" value={recruitment.hiringManagerRaw} />
                  <Field label="Assigned HR"    value={recruitment.assignedHrName} />
                </div>
              </div>
            )}

            <Row className="g-1 mb-3 align-items-stretch rec-page-kpis">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl={3} md={6} sm={6} xs={12}>
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
                </Col>
              ))}
            </Row>

            {/* Shared list table (components/ui/DataTable) — tabs, search,
                sortable headers, the rows-per-page pager and the fit-to-viewport
                sizing all live in the component now. */}
            <DataTable<CandidateRow>
              data={filtered}
              columns={columns}
              serial
              accent="violet"
              minWidth={1500}
              fitToViewport
              autoFitRows
              loading={loading}
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search name, email, mobile…"
              tabs={[
                { key: 'final',    label: 'Final Round Selected', icon: 'ri-user-search-line',     count: totals.finalRound },
                { key: 'selected', label: 'Selected Candidates',  icon: 'ri-checkbox-circle-line', count: totals.selected + totals.offered },
                { key: 'rejected', label: 'Rejected Candidates',  icon: 'ri-close-circle-line',    count: totals.rejected },
              ]}
              activeTab={tab}
              onTabChange={k => setTab(k as typeof tab)}
              emptyMessage={
                <>
                  <i className="ri-user-search-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  No candidates match your filters
                </>
              }
            />
          </div>
        </Col>
      </Row>

      <CandidateFormModal
        open={modalOpen}
        editing={editing}
        readOnly={viewOnly}
        recruitmentId={recruitmentId ? Number(recruitmentId) : null}
        onClose={() => { setModalOpen(false); setEditing(null); setViewOnly(false); }}
        onSaved={(row) => {
          setCandidates(prev => {
            const idx = prev.findIndex(r => r.id === row.id);
            if (idx >= 0) {
              const next = [...prev];
              next[idx] = row;
              return next;
            }
            return [row, ...prev];
          });
          setModalOpen(false);
          setEditing(null);
        }}
      />

      <SampleImportFormatModal open={sampleOpen} onClose={() => setSampleOpen(false)} />
      <ImportCandidatesModal
        open={importOpen}
        recruitment={recruitment}
        onClose={() => setImportOpen(false)}
        onImport={async (file) => {
          if (!recruitmentId) {
            toast.error('Cannot import', 'No recruitment selected.');
            return;
          }
          const fd = new FormData();
          fd.append('file', file);
          fd.append('recruitment_id', String(recruitmentId));

          try {
            const { data } = await api.post('/candidates/import', fd, {
              headers: { 'Content-Type': 'multipart/form-data' },
            });
            const created = Number(data?.created || 0);
            const skipped = Number(data?.skipped || 0);
            const errors  = Array.isArray(data?.errors) ? data.errors : [];

            if (created > 0) {
              toast.success('Import complete', `${created} candidate${created === 1 ? '' : 's'} added${skipped ? ` · ${skipped} skipped` : ''}.`);
              fetchAll();
            } else {
              toast.error('Nothing imported', skipped > 0 ? `${skipped} row${skipped === 1 ? '' : 's'} skipped — see errors below.` : 'No valid rows found in the file.');
            }
            if (errors.length > 0) {
              const sample = errors.slice(0, 3).map((e: any) => `Row ${e.row}: ${e.message}`).join('\n');
              console.warn('[Candidate import] errors:\n' + errors.map((e: any) => `Row ${e.row}: ${e.message}`).join('\n'));
              toast.error('Some rows skipped', sample + (errors.length > 3 ? `\n…and ${errors.length - 3} more.` : ''));
            }
            setImportOpen(false);
          } catch (err: any) {
            toast.error('Import failed', err?.response?.data?.message
              || err?.response?.data?.errors?.file?.[0]
              || 'Please upload a CSV that matches the Sample template.');
          }
        }}
      />

      <ExportCandidatesModal
        open={exportOpen}
        totalCount={candidates.length}
        filteredCount={filtered.length}
        onClose={() => setExportOpen(false)}
        onExport={async (scope: 'all' | 'view') => {
          const params: Record<string, string> = {};
          if (recruitmentId) params.recruitment_id = String(recruitmentId);
          if (scope === 'view') {
            params.ids = filtered.map(c => c.id).join(',');
          }
          try {
            const res = await api.get('/candidates/export', { params, responseType: 'blob' });
            triggerBlobDownload(res.data, 'candidates_export.csv');
            const count = scope === 'view' ? filtered.length : candidates.length;
            toast.success('Export ready', `${count} candidate${count === 1 ? '' : 's'} downloaded`);
            setExportOpen(false);
          } catch (err: any) {
            toast.error('Could not export', err?.response?.data?.message || 'Please try again.');
          }
        }}
      />

      <CandidateConfirmModal
        target={confirming}
        rec={recruitment}
        onClose={() => setConfirming(null)}
        onConfirm={async (reasonOrNote: string) => {
          if (!confirming) return;
          const next: CandidateStatus = confirming.mode === 'select' ? 'Selected' : 'Rejected';
          try {
            await handleStatusUpdate(confirming.row, next, reasonOrNote);
            setConfirming(null);
          } catch {
          }
        }}
      />
    </>
  );
}

function ExportCandidatesModal({
  open, totalCount, filteredCount, onClose, onExport,
}: {
  open: boolean;
  totalCount: number;
  filteredCount: number;
  onClose: () => void;
  onExport: (scope: 'all' | 'view') => Promise<void> | void;
}) {
  const [scope, setScope]         = useState<'all' | 'view'>('all');
  const [exporting, setExporting] = useState(false);

  useEffect(() => { if (open) { setScope('all'); setExporting(false); } }, [open]);

  const handleExport = async () => {
    if (exporting) return;
    setExporting(true);
    try {
      await onExport(scope);
    } finally {
      setExporting(false);
    }
  };

  return (
    <Modal isOpen={open} toggle={onClose} centered size="md" backdrop="static" contentClassName="border-0 cand-export-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="cand-export-head">
          <span className="cand-export-head-icon">
            <i className="ri-external-link-line" />
          </span>
          <div className="cand-export-head-text">
            <h5 className="mb-0">Export Candidates</h5>
            <div className="cand-export-head-sub">Download candidate data as an Excel file</div>
          </div>
        </div>

        <div className="cand-export-body">
          <div className="cand-export-section-label">Scope</div>

          <label className={`cand-export-option${scope === 'all' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="cand-export-scope"
              checked={scope === 'all'}
              onChange={() => setScope('all')}
            />
            <span className="cand-export-option-radio" />
            <div className="cand-export-option-text">
              <div className="cand-export-option-title">All Candidates</div>
              <div className="cand-export-option-sub">{totalCount} record{totalCount === 1 ? '' : 's'}</div>
            </div>
          </label>

          <label className={`cand-export-option${scope === 'view' ? ' is-selected' : ''}`}>
            <input
              type="radio"
              name="cand-export-scope"
              checked={scope === 'view'}
              onChange={() => setScope('view')}
            />
            <span className="cand-export-option-radio" />
            <div className="cand-export-option-text">
              <div className="cand-export-option-title">
                Current View Only <span className="cand-export-option-tag">(filtered)</span>
              </div>
              <div className="cand-export-option-sub">
                Only the {filteredCount} candidate{filteredCount === 1 ? '' : 's'} currently shown (after tab, search &amp; filters).
              </div>
            </div>
          </label>

          <div className="cand-export-info">
            <i className="ri-file-excel-2-line" />
            <div>
              <div><strong>File format: Excel (.xlsx)</strong></div>
              <div>Columns: Name, Email, Mobile, Experience, Current Salary, Expected Salary, Notice Period, Source, Status, Recruitment ID</div>
            </div>
          </div>
        </div>

        <div className="cand-export-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={exporting}>Close</button>
          <button
            type="button"
            className="cand-export-submit"
            onClick={handleExport}
            disabled={exporting}
            style={{ opacity: exporting ? 0.75 : 1 }}
          >
            {exporting
              ? <Spinner size="sm" style={{ width: 14, height: 14, marginRight: 6 }} />
              : <i className="ri-download-line" />}
            {exporting ? 'Exporting…' : 'Export Candidates'}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

function triggerBlobDownload(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a   = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function ImportCandidatesModal({
  open, recruitment, onClose, onImport,
}: {
  open: boolean;
  recruitment: RecruitmentInfo | null;
  onClose: () => void;
  onImport: (file: File) => Promise<void> | void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [linkedCode, setLinkedCode] = useState<string>('');
  const [importing, setImporting]   = useState(false);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setFile(null);
      setLinkedCode(recruitment?.code || '');
      setImporting(false);
    }
  }, [open, recruitment]);

  const handlePick = (f: File | null | undefined) => {
    if (!f) return;
    const okExt = /\.(xlsx|xls|csv)$/i.test(f.name);
    if (!okExt) { alert('Please choose an .xlsx, .xls, or .csv file.'); return; }
    if (f.size > 10 * 1024 * 1024) { alert('File is larger than 10 MB.'); return; }
    setFile(f);
  };

  const handleSubmit = async () => {
    if (!file) { alert('Please choose a file to import.'); return; }
    setImporting(true);
    try {
      await onImport(file);
    } finally {
      setImporting(false);
    }
  };

  const recruitmentOptions = recruitment
    ? [{ value: recruitment.code, label: `${recruitment.code} — ${recruitment.jobTitle}` }]
    : [];

  return (
    <Modal isOpen={open} toggle={onClose} centered size="md" backdrop="static" modalClassName="cand-form-clientstyle" contentClassName="border-0 cand-import-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="cand-import-head">
          <span className="cand-import-head-icon">
            <i className="ri-upload-cloud-2-line" />
          </span>
          <div className="cand-import-head-text">
            <h5 className="mb-0">Import Candidates</h5>
            <div className="cand-import-head-sub">Upload an Excel or CSV file to bulk-add candidates</div>
          </div>
        </div>

        <div className="cand-import-body">
          <div className="cand-import-field">
            <label className="cand-import-label">
              Link Imported Candidates to Recruitment<span className="req">*</span>
            </label>
            <MasterSelect
              value={linkedCode}
              onChange={setLinkedCode}
              options={recruitmentOptions}
              placeholder="— Select —"
            />
            <div className="cand-import-help">
              If a row contains a "Recruitment ID" column, that value overrides this default.
            </div>
          </div>

          <div className="cand-import-field">
            <label className="cand-import-label">
              Select Excel / CSV File<span className="req">*</span>
            </label>
            <div
              className={`cand-import-drop${file ? ' has-file' : ''}`}
              onClick={() => inputRef.current?.click()}
              onDragOver={e => { e.preventDefault(); }}
              onDrop={e => { e.preventDefault(); handlePick(e.dataTransfer.files?.[0]); }}
              role="button"
              tabIndex={0}
              onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') inputRef.current?.click(); }}
            >
              <span className="cand-import-drop-icon">
                <i className="ri-file-excel-2-line" />
              </span>
              <div className="cand-import-drop-text">
                <div className="cand-import-drop-title">
                  {file ? file.name : 'Click to choose Excel / CSV file'}
                </div>
                <div className="cand-import-drop-sub">
                  {file ? `${(file.size / 1024).toFixed(1)} KB` : 'Supports .xlsx, .xls, .csv · Max 10 MB'}
                </div>
              </div>
              <input
                ref={inputRef}
                type="file"
                accept=".xlsx,.xls,.csv"
                style={{ display: 'none' }}
                onChange={e => handlePick(e.target.files?.[0])}
              />
            </div>
            <div className="cand-import-help">
              Only rows with <strong>Status = "Final Round Selected" or "Selected"</strong> are imported;
              rows with any other status are skipped.
            </div>
          </div>
        </div>

        <div className="cand-import-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose}>Close</button>
          <button type="button" className="cand-import-submit" onClick={handleSubmit} disabled={!file || !linkedCode || importing}>
            {importing ? <Spinner size="sm" style={{ width: 14, height: 14 }} /> : <i className="ri-upload-2-line" />}
            {importing ? 'Importing…' : 'Import'}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

function SampleImportFormatModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const toast = useToast();
  const [downloading, setDownloading] = useState(false);
  useEffect(() => { if (!open) setDownloading(false); }, [open]);

  const COLUMNS = [
    'Name', 'Email', 'Mobile', 'Experience', 'Qualification',
    'Current Salary', 'Expected Salary', 'Notice Period', 'Source', 'Status',
  ];
  const SAMPLE_ROWS: string[][] = [
    ['Priya Sharma', 'priya.s@example.com', '+91 9812345678', '5', 'B.Tech', '15', '22', '30 Days',  'LinkedIn', 'Final Round Selected'],
  ];

  const handleDownload = async () => {
    if (downloading) return;
    setDownloading(true);
    try {
      const res = await api.get('/candidates/sample', { responseType: 'blob' });
      triggerBlobDownload(res.data, 'candidates_sample.csv');
      toast.success('Sample downloaded', 'Open it in Excel / Sheets to fill in candidate rows.');
      onClose();
    } catch (err: any) {
      toast.error('Could not download sample', err?.response?.data?.message || 'Please try again.');
    } finally {
      setDownloading(false);
    }
  };

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static" modalClassName="cand-sample-dialog" contentClassName="border-0 cand-sample-modal">
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="cand-sample-head">
          <span className="cand-sample-head-icon">
            <i className="ri-download-cloud-2-line" />
          </span>
          <div className="cand-sample-head-text">
            <h5 className="mb-0">Sample Import Format</h5>
            <div className="cand-sample-head-sub">Download an Excel template to bulk-upload candidates</div>
          </div>
        </div>

        <div className="cand-sample-body">
          <p className="cand-sample-desc">
            The template contains the following columns. Fill each row with one candidate's
            information. Use the exact header names to avoid import errors.
          </p>

          <div className="cand-sample-table-wrap">
            <table className="cand-sample-table">
              <thead>
                <tr>{COLUMNS.map(c => <th key={c}>{c}</th>)}</tr>
              </thead>
              <tbody>
                {SAMPLE_ROWS.map((row, i) => (
                  <tr key={i}>{row.map((cell, j) => <td key={j}>{cell}</td>)}</tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="cand-sample-note">
            <i className="ri-information-line" />
            <div>
              <strong>Notes:</strong> Experience / Current Salary / Expected Salary are numeric
              (years / LPA). <strong>Status must be "Final Round Selected" or "Selected"</strong> —
              rows with any other status are skipped and not imported. Source must be one of: LinkedIn,
              Naukri, Indeed, Referral, Company Website, Walk-in, Job Fair, Other.
            </div>
          </div>
        </div>

        <div className="cand-sample-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={downloading}>Close</button>
          <button
            type="button"
            className="cand-sample-download"
            onClick={handleDownload}
            disabled={downloading}
            style={{ opacity: downloading ? 0.75 : 1 }}
          >
            {downloading
              ? <Spinner size="sm" style={{ width: 14, height: 14, marginRight: 6 }} />
              : <i className="ri-download-line" />}
            {downloading ? 'Downloading…' : 'Download Sample'}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

function CvCell({
  candidate, onUploaded,
}: {
  candidate: CandidateRow;
  onUploaded: (updated: CandidateRow) => void;
}) {
  const toast = useToast();
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [uploading, setUploading] = useState(false);
  const [downloading, setDownloading] = useState(false);

  if (candidate.cv_url) {
    const handleDownload = async () => {
      if (downloading) return;
      setDownloading(true);
      try {
        const resp = await api.get(`/candidates/${candidate.id}/cv`, { responseType: 'blob' });
        const blob = resp.data as Blob;
        const cd: string = String(resp.headers?.['content-disposition'] || '');
        const m  = /filename\*?=(?:UTF-8'')?["']?([^"';]+)/i.exec(cd);
        const fallbackExt = (blob.type === 'application/pdf') ? 'pdf'
          : (blob.type === 'application/msword') ? 'doc'
          : (blob.type === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document') ? 'docx'
          : 'pdf';
        const filename = m?.[1]
          || `${(candidate.name || 'candidate').replace(/\s+/g, '-')}-cv.${fallbackExt}`;
        triggerBlobDownload(blob, filename);
      } catch (err: any) {
        toast.error('Could not download CV', err?.response?.data?.message || 'Please try again.');
      } finally {
        setDownloading(false);
      }
    };
    return (
      <button
        type="button"
        onClick={handleDownload}
        className="cand-cv-chip"
        disabled={downloading}
        title={downloading ? 'Downloading…' : 'Download CV'}
        style={{
          cursor: downloading ? 'progress' : 'pointer',
          opacity: downloading ? 0.75 : 1,
          border: 'none',
        }}
      >
        {downloading
          ? <Spinner size="sm" style={{ width: 12, height: 12, marginRight: 2 }} />
          : <i className="ri-download-line" />}
        <span>{downloading ? 'Downloading…' : 'CV'}</span>
      </button>
    );
  }

  const handleFile = async (file: File | null | undefined) => {
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error('File too large', 'CV must be under 2 MB.');
      return;
    }
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('_method', 'PUT');
      fd.append('cv', file);
      const { data } = await api.post(`/candidates/${candidate.id}`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded(data);
      toast.success('CV uploaded', `${candidate.name}'s CV saved.`);
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message
        || err?.response?.data?.errors?.cv?.[0]
        || 'Please try a PDF/DOC/DOCX under 10 MB.');
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <label
      className={`cand-cv-chip cand-cv-chip--upload${uploading ? ' is-uploading' : ''}`}
      style={{ cursor: uploading ? 'progress' : 'pointer' }}
      title="Upload CV"
    >
      {uploading
        ? <Spinner size="sm" style={{ width: 12, height: 12 }} />
        : <i className="ri-upload-2-line" />}
      <span>{uploading ? 'Uploading…' : 'Upload'}</span>
      <input
        ref={inputRef}
        type="file"
        accept=".pdf,.doc,.docx"
        style={{ display: 'none' }}
        disabled={uploading}
        onChange={e => handleFile(e.target.files?.[0])}
      />
    </label>
  );
}

function Field({ label, value }: { label: string; value: any }) {
  return (
    <div className="cand-field">
      <div className="cand-field-label">{label}</div>
      <div className="cand-field-value">{value || <span className="text-muted">—</span>}</div>
    </div>
  );
}

function CandidateFormModal({
  open, editing, recruitmentId, onClose, onSaved, readOnly = false,
}: {
  open: boolean;
  editing: CandidateRow | null;
  recruitmentId: number | null;
  onClose: () => void;
  onSaved: (row: CandidateRow) => void;
  /** Read-only profile view (rejected candidates): every field is locked, the
   *  CV picker is replaced by a download link and Submit is not rendered. */
  readOnly?: boolean;
}) {
  const toast = useToast();

  const [name, setName]                       = useState('');
  const [email, setEmail]                     = useState('');
  const [mobile, setMobile]                   = useState('');
  const [address, setAddress]                 = useState('');
  const [qualification, setQualification]     = useState('');
  const [experience, setExperience]           = useState('0');
  const [transport, setTransport]             = useState('');
  const [distance, setDistance]               = useState('');
  const [currentSalary, setCurrentSalary]     = useState('');
  const [expectedSalary, setExpectedSalary]   = useState('');
  const [noticePeriod, setNoticePeriod]       = useState('');
  const [source, setSource]                   = useState('');
  const [referredById, setReferredById]       = useState('');
  const [employeeOpts, setEmployeeOpts]       = useState<{ value: string; label: string }[]>([]);
  const [status, setStatus]                   = useState<CandidateStatus | ''>('');
  const [cvFile, setCvFile]                   = useState<File | null>(null);
  const [existingCvUrl, setExistingCvUrl]     = useState<string | null>(null);
  const [errors, setErrors]                   = useState<Record<string, string>>({});
  const [saving, setSaving]                   = useState(false);

  const validateSalaryLpa = (raw: string, label: string): string | null => {
    if (!raw.trim()) return null;
    const n = Number(raw);
    if (!Number.isFinite(n)) return `${label} must be a number`;
    if (n < 0)               return `${label} cannot be negative`;
    if (n > 9999.99)         return `${label} cannot exceed 9999.99 LPA`;
    return null;
  };

  const setFieldError = (key: string, msg: string | null) => {
    setErrors(prev => {
      if (msg) {
        if (prev[key] === msg) return prev;
        return { ...prev, [key]: msg };
      }
      if (!prev[key]) return prev;
      const next = { ...prev };
      delete next[key];
      return next;
    });
  };

  useEffect(() => {
    if (!open) return;
    if (editing) {
      setName(editing.name);
      setEmail(editing.email || '');
      setMobile(editing.mobile || '');
      setAddress(editing.current_address || '');
      setQualification(editing.qualification || '');
      setExperience(String(editing.experience_years ?? 0));
      setTransport(editing.mode_of_transport || '');
      setDistance(editing.distance_km != null ? String(editing.distance_km) : '');
      setCurrentSalary(editing.current_salary_lpa != null ? String(editing.current_salary_lpa) : '');
      setExpectedSalary(editing.expected_salary_lpa != null ? String(editing.expected_salary_lpa) : '');
      setNoticePeriod(editing.notice_period || '');
      setSource(editing.source || '');
      setReferredById(editing.referred_by_id != null ? String(editing.referred_by_id) : '');
      setStatus(editing.status);
      setExistingCvUrl(editing.cv_url || editing.cv_path || null);
    } else {
      setName(''); setEmail(''); setMobile(''); setAddress(''); setQualification('');
      setExperience('0'); setTransport(''); setDistance('');
      setCurrentSalary(''); setExpectedSalary(''); setNoticePeriod('');
      setSource(''); setReferredById(''); setStatus('');
      setExistingCvUrl(null);
    }
    setCvFile(null);
    setErrors({});
  }, [open, editing]);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    (async () => {
      try {
        const { data } = await api.get('/employees', { params: { onboarded_only: 1 } });
        if (cancelled) return;
        const rows: any[] = Array.isArray(data) ? data : [];
        setEmployeeOpts(
          rows.map(e => {
            const name = e.display_name
              || [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ')
              || `Employee #${e.id}`;
            const code = e.emp_code ? ` (${e.emp_code})` : '';
            return { value: String(e.id), label: `${name}${code}` };
          }).sort((a, b) => a.label.localeCompare(b.label)),
        );
      } catch {
        if (!cancelled) setEmployeeOpts([]);
      }
    })();
    return () => { cancelled = true; };
  }, [open]);

  const handleSubmit = async () => {
    const errs: Record<string, string> = {};

    if (!name.trim()) errs.name = 'Name is required';
    else if (name.trim().length < 2) errs.name = 'Name must be at least 2 characters';
    else if (name.trim().length > 100) errs.name = 'Name cannot exceed 100 characters';

    if (!recruitmentId) errs.recruitment_id = 'Recruitment is required';

    if (!email.trim()) {
      errs.email = 'Email is required';
    } else {
      const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRe.test(email.trim())) errs.email = 'Enter a valid email address';
    }

    if (!mobile.trim()) {
      errs.mobile = 'Mobile number is required';
    } else {
      const digitsOnly = mobile.replace(/\D/g, '');
      if (digitsOnly.length < 7 || digitsOnly.length > 15) {
        errs.mobile = 'Enter a valid mobile number (7–15 digits)';
      }
    }

    if (!qualification.trim()) {
      errs.qualification = 'Qualification is required';
    } else {
      const qual = qualification.trim();
      if (!/[A-Za-z]/.test(qual)) {
        errs.qualification = 'Qualification must contain letters';
      } else if (!/^[A-Za-z0-9 .,/&()+-]+$/.test(qual)) {
        errs.qualification = 'Qualification can only contain letters, numbers, spaces and . , / & ( ) + -';
      }
    }

    const expNum = Number(experience);
    if (experience.trim() === '') {
      errs.experience_years = 'Experience is required';
    } else if (!Number.isFinite(expNum) || expNum < 0) {
      errs.experience_years = 'Experience cannot be negative';
    } else if (expNum > 50) {
      errs.experience_years = 'Experience cannot exceed 50 years';
    }

    if (!distance.trim()) {
      errs.distance_km = 'Distance is required';
    } else {
      const dNum = Number(distance);
      if (!Number.isFinite(dNum) || dNum < 0) errs.distance_km = 'Distance cannot be negative';
      else if (dNum > 9999) errs.distance_km = 'Distance cannot exceed 9999 KM';
    }

    const curErr = validateSalaryLpa(currentSalary, 'Current salary');
    if (curErr) errs.current_salary_lpa = curErr;
    const expErr = validateSalaryLpa(expectedSalary, 'Expected salary');
    if (expErr) errs.expected_salary_lpa = expErr;

    if (!source.trim()) errs.source = 'Source is required';
    if (source === 'Referral' && !referredById) {
      errs.referred_by_id = 'Please select the referring employee';
    }
    if (!status) errs.status = 'Status is required';

    if (!editing && !cvFile) errs.cv = 'Please attach a CV';
    if (cvFile) {
      const okExt = /\.(pdf|doc|docx)$/i.test(cvFile.name);
      if (!okExt) errs.cv = 'CV must be a PDF, DOC, or DOCX file';
      else if (cvFile.size > 2 * 1024 * 1024) errs.cv = 'CV must be under 2 MB';
    }

    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      const first = Object.values(errs)[0];
      toast.error('Please fix the highlighted fields', String(first));
      return;
    }
    setErrors({});

    const fd = new FormData();
    fd.append('recruitment_id', String(recruitmentId));
    fd.append('name', name.trim());
    if (email)          fd.append('email', email.trim());
    if (mobile)         fd.append('mobile', mobile.trim());
    if (address)        fd.append('current_address', address.trim());
    if (qualification)  fd.append('qualification', qualification.trim());
    fd.append('experience_years', experience || '0');
    if (transport)      fd.append('mode_of_transport', transport);
    if (distance)       fd.append('distance_km', distance);
    if (currentSalary)  fd.append('current_salary_lpa', currentSalary);
    if (expectedSalary) fd.append('expected_salary_lpa', expectedSalary);
    if (noticePeriod)   fd.append('notice_period', noticePeriod);
    if (source)         fd.append('source', source);
    if (source === 'Referral' && referredById) {
      fd.append('referred_by_id', referredById);
      const refLabel = employeeOpts.find(o => o.value === referredById)?.label || '';
      if (refLabel) fd.append('referred_by_name', refLabel.replace(/\s*\([^)]*\)\s*$/, '').trim());
    }
    fd.append('status', status);
    if (cvFile)         fd.append('cv', cvFile);

    setSaving(true);
    try {
      const isEdit = editing != null;
      const url = isEdit ? `/candidates/${editing!.id}` : '/candidates';
      if (isEdit) fd.append('_method', 'PUT');
      const { data } = await api.post(url, fd, { headers: { 'Content-Type': 'multipart/form-data' } });
      toast.success(isEdit ? 'Candidate updated' : 'Candidate added', `${data.name} saved successfully.`);
      onSaved(data);
    } catch (err: any) {
      if (err?.response?.status === 422 && err?.response?.data?.errors) {
        const serverErrs = err.response.data.errors as Record<string, string | string[]>;
        const mapped: Record<string, string> = {};
        for (const k of Object.keys(serverErrs)) {
          const v = serverErrs[k];
          mapped[k] = Array.isArray(v) ? String(v[0]) : String(v);
        }
        setErrors(mapped);
        toast.error('Validation failed', 'Please fix the highlighted fields.');
      } else {
        toast.error('Could not save', err?.response?.data?.message || 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  /* CV pick + validate — shared by the initial dropzone and the Reupload icon. */
  const handleCvPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0] ?? null;
    e.target.value = '';
    if (!f) { setCvFile(null); return; }
    const okExt = /\.(pdf|doc|docx)$/i.test(f.name);
    if (!okExt) {
      setErrors(prev => ({ ...prev, cv: 'CV must be a PDF, DOC, or DOCX file' }));
      toast.error('Unsupported file type', 'Please pick a PDF, DOC, or DOCX file.');
      return;
    }
    if (f.size > 2 * 1024 * 1024) {
      setErrors(prev => ({ ...prev, cv: 'CV must be under 2 MB' }));
      toast.error('File too large', 'CV must be under 2 MB.');
      return;
    }
    setErrors(prev => { const n = { ...prev }; delete n.cv; return n; });
    setCvFile(f);
  };

  /* toggle/keyboard guards: the overlay swallows clicks, but ESC is handled at
     the document level and would still close the popup mid-submit. The two
     recruitment modals already set keyboard={false}; this one did not. */
  return (
    <Modal isOpen={open} toggle={saving ? undefined : onClose} keyboard={!saving} centered size="lg" backdrop="static" modalClassName="rec-form-modal cand-form-clientstyle" contentClassName="rec-form-content border-0">
      <ModalBody className="p-0">
        <div className="rec-form-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className={readOnly ? 'ri-eye-line' : 'ri-user-add-line'} style={{ fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>Candidate Details</h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>{readOnly ? 'View applicant profile — read only' : editing ? 'Update applicant profile' : 'Register a new applicant profile in the pipeline'}</div>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              className="cand-head-close"
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32, display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, cursor: 'pointer' }}
            >
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <div className="rec-form-body">
         

          <div className="rec-form-card">
            <div className="rec-form-section">
              <div className="rec-form-section-head">
                <span className="cand-step">1</span>
                <p className="rec-form-section-title">Candidate Basic Details</p>
              </div>
              <Row className="g-2">
                <Col md={4}>
                  <label className="rec-form-label">Name<span className="req">*</span></label>
                  <input type="text" className={`rec-input${errors.name ? ' is-invalid' : ''}`} placeholder="Full name" value={name} disabled={readOnly} onChange={e => setName(e.target.value.replace(/[^a-zA-Z .'\-]/g, ''))} />
                  {errors.name && <div className="rec-error"><i className="ri-error-warning-line" />{errors.name}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Email<span className="req">*</span></label>
                  <input type="email" className={`rec-input${errors.email ? ' is-invalid' : ''}`} placeholder="name@email.com" value={email} disabled={readOnly} onChange={e => setEmail(e.target.value)} />
                  {errors.email && <div className="rec-error"><i className="ri-error-warning-line" />{errors.email}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Mobile Number<span className="req">*</span></label>
                  <input
                    type="text"
                    className={`rec-input${errors.mobile ? ' is-invalid' : ''}`}
                    placeholder="9XXXXXXXXX"
                    value={mobile}
                    inputMode="numeric"
                    maxLength={15}
                    disabled={readOnly}
                    onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  />
                  {errors.mobile && <div className="rec-error"><i className="ri-error-warning-line" />{errors.mobile}</div>}
                </Col>
                <Col md={6}>
                  <label className="rec-form-label">Current Address</label>
                  <input type="text" className="rec-input" placeholder="Full residential address" value={address} disabled={readOnly} onChange={e => setAddress(e.target.value)} />
                </Col>
                <Col md={6}>
                  <label className="rec-form-label">Qualification<span className="req">*</span></label>
                  <input type="text" className={`rec-input${errors.qualification ? ' is-invalid' : ''}`} placeholder="e.g. B.Tech Computer Science" value={qualification} disabled={readOnly} onChange={e => setQualification(e.target.value)} />
                  {errors.qualification && <div className="rec-error"><i className="ri-error-warning-line" />{errors.qualification}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Experience (Years)<span className="req">*</span></label>
                  <input type="number" min={0} step={0.5} className={`rec-input${errors.experience_years ? ' is-invalid' : ''}`} value={experience} disabled={readOnly} onChange={e => setExperience(e.target.value)} />
                  {errors.experience_years && <div className="rec-error"><i className="ri-error-warning-line" />{errors.experience_years}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Mode of Transport</label>
                  <MasterSelect value={transport} onChange={setTransport} options={TRANSPORT_MODES.map(m => ({ value: m, label: m }))} placeholder="— Select —" disabled={readOnly} />
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Distance (KM)<span className="req">*</span></label>
                  <input type="number" min={0} step={0.1} className={`rec-input${errors.distance_km ? ' is-invalid' : ''}`} placeholder="e.g. 12" value={distance} disabled={readOnly} onChange={e => setDistance(e.target.value)} />
                  {errors.distance_km && <div className="rec-error"><i className="ri-error-warning-line" />{errors.distance_km}</div>}
                </Col>
              </Row>
            </div>

            <div className="rec-form-section">
              <div className="rec-form-section-head">
                <span className="cand-step cand-step-2">2</span>
                <p className="rec-form-section-title">Compensation Details</p>
              </div>
              <Row className="g-2">
                <Col md={4}>
                  <label className="rec-form-label">Current Salary (LPA)</label>
                  <input
                    type="number" min={0} max={9999.99} step={0.5}
                    className={`rec-input${errors.current_salary_lpa ? ' is-invalid' : ''}`}
                    placeholder="e.g. 10"
                    value={currentSalary}
                    disabled={readOnly}
                    onChange={e => {
                      let v = e.target.value;
                      if (v && Number(v) < 0) v = '';
                      if (v && Number(v) > 9999.99) v = '9999.99';
                      setCurrentSalary(v);
                      if (errors.current_salary_lpa) setFieldError('current_salary_lpa', null);
                    }}
                    onBlur={e => setFieldError('current_salary_lpa', validateSalaryLpa(e.target.value, 'Current salary'))}
                  />
                  {errors.current_salary_lpa && <div className="rec-error"><i className="ri-error-warning-line" />{errors.current_salary_lpa}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Expected Salary (LPA)</label>
                  <input
                    type="number" min={0} max={9999.99} step={0.5}
                    className={`rec-input${errors.expected_salary_lpa ? ' is-invalid' : ''}`}
                    placeholder="e.g. 15"
                    value={expectedSalary}
                    disabled={readOnly}
                    onChange={e => {
                      let v = e.target.value;
                      if (v && Number(v) < 0) v = '';
                      if (v && Number(v) > 9999.99) v = '9999.99';
                      setExpectedSalary(v);
                      if (errors.expected_salary_lpa) setFieldError('expected_salary_lpa', null);
                    }}
                    onBlur={e => setFieldError('expected_salary_lpa', validateSalaryLpa(e.target.value, 'Expected salary'))}
                  />
                  {errors.expected_salary_lpa && <div className="rec-error"><i className="ri-error-warning-line" />{errors.expected_salary_lpa}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Notice Period</label>
                  <MasterSelect value={noticePeriod} onChange={setNoticePeriod} options={NOTICE_PERIODS.map(m => ({ value: m, label: m }))} placeholder="— Select —" disabled={readOnly} />
                </Col>
              </Row>
            </div>

            <Row className="g-2 mt-1">
              <Col md={4}>
                <div className="rec-form-section h-100" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                  <div className="rec-form-section-head">
                    <span className="cand-step cand-step-3">3</span>
                    <p className="rec-form-section-title">Source of Application</p>
                  </div>
                  <label className="rec-form-label">Source<span className="req">*</span></label>
                  <MasterSelect
                    value={source}
                    onChange={(v) => {
                      setSource(v);
                      if (v !== 'Referral') { setReferredById(''); }
                      if (errors.source) setFieldError('source', null);
                      if (errors.referred_by_id) setFieldError('referred_by_id', null);
                    }}
                    options={SOURCES.map(s => ({ value: s, label: s }))}
                    placeholder="— Select —"
                    disabled={readOnly}
                  />
                  {errors.source && <div className="rec-error"><i className="ri-error-warning-line" />{errors.source}</div>}
                  {source === 'Referral' && (
                    <div className="mt-2">
                      <label className="rec-form-label">Referred By<span className="req">*</span></label>
                      <MasterSelect
                        value={referredById}
                        onChange={(v) => { setReferredById(v); if (errors.referred_by_id) setFieldError('referred_by_id', null); }}
                        options={employeeOpts}
                        placeholder={employeeOpts.length === 0 ? 'Loading employees…' : '— Select employee —'}
                        invalid={!!errors.referred_by_id}
                        disabled={readOnly}
                      />
                      {errors.referred_by_id && <div className="rec-error"><i className="ri-error-warning-line" />{errors.referred_by_id}</div>}
                    </div>
                  )}
                </div>
              </Col>
              <Col md={4}>
                <div className="rec-form-section h-100" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                  <div className="rec-form-section-head">
                    <span className="cand-step cand-step-4">4</span>
                    <p className="rec-form-section-title">Attachment Details</p>
                  </div>
                  <label className="rec-form-label">{readOnly ? 'CV' : <>Attach CV<span className="req">*</span></>}</label>

                  {/* No CV yet (and editable) → the attach dropzone. */}
                  {!cvFile && !existingCvUrl && !readOnly && (
                    <label className="cand-cv-drop" style={errors.cv ? { borderColor: '#f06548' } : undefined}>
                      <input
                        type="file"
                        accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                        style={{ display: 'none' }}
                        onChange={handleCvPick}
                      />
                      <i className="ri-attachment-2" />
                      <span className="cand-cv-text">
                        <strong>Attach CV</strong>
                        <span>PDF, DOC, DOCX · Max 2 MB</span>
                      </span>
                    </label>
                  )}

                  {/* A CV is present (new upload or already on file) → file card:
                      truncated name + Download and Reupload icon actions. */}
                  {(cvFile || existingCvUrl) && (
                    <div className="cand-cv-file">
                      <span className="cand-cv-file-icon">
                        <i className="ri-file-text-line" />
                        <span className="cand-cv-file-check" title="File attached"><i className="ri-check-line" /></span>
                      </span>
                      <div className="cand-cv-file-info">
                        <span className="cand-cv-file-name" title={cvFile ? cvFile.name : (editing?.cv_original_name || 'Current CV')}>
                          {cvFile ? cvFile.name : (editing?.cv_original_name || 'Current CV')}
                        </span>
                        <span className="cand-cv-file-sub">{cvFile ? 'Newly attached — not saved yet' : 'PDF, DOC, DOCX · Max 2 MB'}</span>
                      </div>
                      <div className="cand-cv-file-actions">
                        {/* Download — the locally-attached file if one was just
                            picked, otherwise the CV saved on the server. Always
                            shown, before Reupload. */}
                        <button
                          type="button"
                          className="cand-cv-file-act"
                          title="Download CV"
                          aria-label="Download CV"
                          onClick={async () => {
                            try {
                              if (cvFile) {
                                const url = URL.createObjectURL(cvFile);
                                const a = document.createElement('a');
                                a.href = url; a.download = cvFile.name;
                                document.body.appendChild(a); a.click(); a.remove();
                                setTimeout(() => URL.revokeObjectURL(url), 60_000);
                              } else if (editing) {
                                const resp = await api.get(`/candidates/${editing.id}/cv`, { responseType: 'blob' });
                                const url = URL.createObjectURL(resp.data as Blob);
                                const a = document.createElement('a');
                                a.href = url;
                                a.download = `${(editing.name || 'candidate').replace(/\s+/g, '-')}-cv`;
                                document.body.appendChild(a); a.click(); a.remove();
                                setTimeout(() => URL.revokeObjectURL(url), 60_000);
                              }
                            } catch {
                              toast.error('Could not download CV', 'Please try again.');
                            }
                          }}
                        >
                          <i className="ri-download-2-line" />
                        </button>
                        {/* Reupload — swap the file (hidden in read-only view). */}
                        {!readOnly && (
                          <label className="cand-cv-file-act" title="Reupload CV" aria-label="Reupload CV">
                            <i className="ri-refresh-line" />
                            <input
                              type="file"
                              accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                              style={{ display: 'none' }}
                              onChange={handleCvPick}
                            />
                          </label>
                        )}
                      </div>
                    </div>
                  )}

                  {readOnly && !cvFile && !existingCvUrl && (
                    <div className="text-muted fs-13">No CV on file</div>
                  )}
                  {errors.cv && <div className="rec-error"><i className="ri-error-warning-line" />{errors.cv}</div>}
                </div>
              </Col>
              <Col md={4}>
                <div className="rec-form-section h-100" style={{ marginTop: 0, paddingTop: 0, borderTop: 0 }}>
                  <div className="rec-form-section-head">
                    <span className="cand-step cand-step-5">5</span>
                    <p className="rec-form-section-title">Recruitment Status</p>
                  </div>
                  <label className="rec-form-label">Candidate Status{!readOnly && <span className="req">*</span>}</label>
                  {/* The picker only offers the two forward stages, so a
                      Rejected / On Hold row would fall back to the placeholder —
                      show the stored status as a pill in read-only mode. */}
                  {readOnly ? (
                    <div>
                      <span className={`badge rounded-pill rec-status-pill bg-${CANDIDATE_STATUS_COLOR[(status || 'Applied') as CandidateStatus]}-subtle text-${CANDIDATE_STATUS_COLOR[(status || 'Applied') as CandidateStatus]} fw-semibold px-3 py-2 fs-13`}>
                        {status || '—'}
                      </span>
                    </div>
                  ) : (
                    <MasterSelect
                      value={status}
                      onChange={(v) => setStatus(v as CandidateStatus)}
                      options={[
                        { value: 'Final Interview', label: 'Final Round Selected' },
                        { value: 'Selected',        label: 'Selected' },
                      ]}
                      placeholder="— Select —"
                    />
                  )}
                  {errors.status && <div className="rec-error"><i className="ri-error-warning-line" />{errors.status}</div>}
                </div>
              </Col>
            </Row>
          </div>
        </div>

        <div className="rec-form-footer">
          <span className="hint">
            {readOnly
              ? <><i className="ri-lock-line align-bottom" /> Read-only — this candidate is out of the pipeline</>
              : <><i className="ri-information-line align-bottom" /> All fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required</>}
          </span>
          {/* Read-only has nothing to submit, so the header ✕ is the only close
              affordance — a footer Close next to it would be a second one. */}
          {!readOnly && (
            <div className="d-flex gap-2">
              <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={saving}>
                <i className="ri-close-line" />Close
              </button>
              <button type="button" className="rec-btn-primary" onClick={handleSubmit} disabled={saving}>
                {saving ? (<><Spinner size="sm" style={{ width: 14, height: 14 }} /><span>Saving…</span></>) : (<><i className="ri-check-line" />Submit</>)}
              </button>
            </div>
          )}
        </div>
        {/* Locks the WHOLE popup after Submit (#50) — previously only the two
            footer buttons went disabled, so every field stayed editable while
            the request was in flight. Absolute inset:0 resolves against
            .modal-content, covering the header and footer too. Same pattern as
            the CLM trade-document / agreement wizards. */}
        {saving && (
          <div className="rec-save-lock">
            <div className="rec-save-lock-box">
              <Spinner size="sm" style={{ width: 18, height: 18 }} />
              <span>Saving candidate…</span>
            </div>
          </div>
        )}
      </ModalBody>
    </Modal>
  );
}

const REJECTION_REASONS = [
  { value: 'Not a culture fit',                  label: 'Not a culture fit' },
  { value: 'Skills mismatch',                    label: 'Skills mismatch' },
  { value: 'Insufficient experience',            label: 'Insufficient experience' },
  { value: 'Salary expectations out of range',   label: 'Salary expectations out of range' },
  { value: 'Notice period too long',             label: 'Notice period too long' },
  { value: 'Withdrew from process',              label: 'Withdrew from process' },
  { value: 'Position filled internally',         label: 'Position filled internally' },
  { value: 'Other',                              label: 'Other (add notes below)' },
];

/** Title-case a name so "meera chopra" / "MEERA CHOPRA" render as "Meera Chopra". */
function titleCaseName(s: string): string {
  return (s || '')
    .toLowerCase()
    .replace(/\b([a-z])/g, (_, c: string) => c.toUpperCase());
}

function CandidateConfirmModal({
  target, rec, onClose, onConfirm,
}: {
  target: { row: CandidateRow; mode: 'select' | 'reject' } | null;
  rec: RecruitmentInfo | null;
  onClose: () => void;
  onConfirm: (reasonOrNote: string) => Promise<void> | void;
}) {
  const [notes, setNotes] = useState('');
  const [reason, setReason] = useState('');
  const [reasonErr, setReasonErr] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (target) { setNotes(''); setReason(''); setReasonErr(false); setSubmitting(false); }
  }, [target]);

  if (!target) return null;
  const { row, mode } = target;
  const isReject = mode === 'reject';
  const stageColor = CANDIDATE_STATUS_COLOR[row.status];

  const handleConfirm = async () => {
    if (submitting) return;
    if (isReject && !reason) { setReasonErr(true); return; }
    const payload = isReject ? [reason, notes].filter(Boolean).join(' — ') : notes;
    setSubmitting(true);
    try {
      await onConfirm(payload);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal isOpen={!!target} toggle={submitting ? undefined : onClose} centered size="lg" backdrop="static" contentClassName={`border-0 cand-confirm-modal cand-confirm-modal--${isReject ? 'reject' : 'select'}`}>
      <ModalBody className="p-0" style={{ borderRadius: 16, overflow: 'hidden' }}>
        <div className="cand-confirm-head">
          <span className="cand-confirm-head-icon">
            <i className={isReject ? 'ri-close-line' : 'ri-check-line'} />
          </span>
          <div className="cand-confirm-head-text">
            <h5 className="mb-0">{isReject ? 'Confirm Rejection' : 'Confirm Selection'}</h5>
            <div className="cand-confirm-head-sub">
              {isReject
                ? 'This will mark the candidate as Rejected — moves to Rejected tab'
                : 'This will mark the candidate as Selected'}
            </div>
          </div>
        </div>

        <div className="cand-confirm-body">
          <div className={`cand-confirm-summary${submitting ? ' is-loading' : ''}`}>
            <div
              className="cand-confirm-avatar"
              style={{ background: `linear-gradient(135deg, ${row.accent}, ${row.accent}cc)` }}
            >
              {row.initials}
            </div>
            <div className="cand-confirm-summary-text">
              <div className="cand-confirm-name">{titleCaseName(row.name)}</div>
              <div className="cand-confirm-meta">
                <span><i className="ri-mail-line" /> {row.email || '—'}</span>
                {row.recruitment_code && (
                  <>
                    <span className="dot">·</span>
                    <span className="rec-id-pill">{row.recruitment_code}</span>
                  </>
                )}
              </div>
            </div>
            <div className="cand-confirm-stage">
              <div className="cand-confirm-stage-label">Current Stage</div>
              <span className={`badge rounded-pill rec-status-pill bg-${stageColor}-subtle text-${stageColor} fw-semibold px-3 py-2 fs-13`}>{row.status}</span>
            </div>
          </div>

          {/* #31 — informative context so the approver sees WHAT they're
              selecting/rejecting for: the recruitment + the position. */}
          {rec && (
            <div className="cand-confirm-details">
              <div className="cand-confirm-details-sec">
                <div className="cand-confirm-details-title"><i className="ri-briefcase-4-line" /> Recruitment Details</div>
                <div className="cand-confirm-details-grid">
                  <div className="ccd-item"><span className="ccd-k">Code</span><span className="ccd-v">{rec.code || '—'}</span></div>
                  <div className="ccd-item"><span className="ccd-k">Job Title</span><span className="ccd-v">{rec.jobTitle || '—'}</span></div>
                  <div className="ccd-item"><span className="ccd-k">Priority</span><span className="ccd-v">{rec.priority || '—'}</span></div>
                  <div className="ccd-item"><span className="ccd-k">Status</span><span className="ccd-v">{rec.status || '—'}</span></div>
                </div>
              </div>
              <div className="cand-confirm-details-sec">
                <div className="cand-confirm-details-title"><i className="ri-map-pin-user-line" /> Position Details</div>
                <div className="cand-confirm-details-grid">
                  <div className="ccd-item"><span className="ccd-k">Department</span><span className="ccd-v">{rec.department || '—'}</span></div>
                  <div className="ccd-item"><span className="ccd-k">Designation</span><span className="ccd-v">{rec.designation || '—'}</span></div>
                  <div className="ccd-item"><span className="ccd-k">Employment</span><span className="ccd-v">{rec.employmentType || '—'}</span></div>
                  <div className="ccd-item"><span className="ccd-k">Work Mode</span><span className="ccd-v">{rec.workMode || '—'}</span></div>
                  <div className="ccd-item"><span className="ccd-k">Experience</span><span className="ccd-v">{rec.experience || '—'}</span></div>
                  <div className="ccd-item"><span className="ccd-k">Openings</span><span className="ccd-v">{rec.openings ?? '—'}</span></div>
                </div>
              </div>
            </div>
          )}

          {isReject && (
            <div className="cand-confirm-field">
              <label className="cand-confirm-label">
                Reason for Rejection<span className="req">*</span>
              </label>
              <MasterSelect
                value={reason}
                onChange={v => { setReason(v); if (v) setReasonErr(false); }}
                options={REJECTION_REASONS}
                placeholder="— Select a reason —"
                disabled={submitting}
                invalid={reasonErr}
              />
              {reasonErr && (
                <div className="cand-confirm-error">
                  <i className="ri-error-warning-line" />Please select a reason before confirming
                </div>
              )}
            </div>
          )}

          <div className="cand-confirm-field">
            <label className="cand-confirm-label">
              Notes <span className="opt">(OPTIONAL)</span>
            </label>
            <textarea
              className="cand-confirm-textarea"
              rows={2}
              placeholder="Add context for the audit trail"
              value={notes}
              onChange={e => setNotes(e.target.value)}
              disabled={submitting}
            />
          </div>
        </div>

        <div className="cand-confirm-footer">
          <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={submitting}>Cancel</button>
          <button
            type="button"
            className="cand-confirm-submit"
            onClick={handleConfirm}
            disabled={submitting}
            style={{ opacity: submitting ? 0.75 : 1 }}
          >
            {submitting
              ? <Spinner size="sm" style={{ width: 14, height: 14, marginRight: 6 }} />
              : <i className={isReject ? 'ri-close-line' : 'ri-check-line'} />}
            {submitting
              ? (isReject ? 'Rejecting…' : 'Selecting…')
              : (isReject ? 'Confirm Rejection' : 'Confirm Selection')}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

