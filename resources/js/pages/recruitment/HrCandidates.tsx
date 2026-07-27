import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Card, CardBody, Col, Row, Modal, ModalBody, Spinner, Input } from 'reactstrap';
import { MasterSelect, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { useTheme } from '../../contexts/ThemeContext';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import WorklistPager from '../../components/ui/WorklistPager';
import { ShimmerTableRows } from '../../components/ui/Shimmer';
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

export default function HrCandidates() {
  const { id: recruitmentId } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const toast = useToast();
  const { theme } = useTheme();
  const dark = theme === 'dark';

  const [recruitment, setRecruitment] = useState<RecruitmentInfo | null>(null);
  const [candidates, setCandidates]   = useState<CandidateRow[]>([]);
  const [loading, setLoading]         = useState(true);
  const [tab, setTab]                 = useState<'all' | 'final' | 'selected' | 'rejected'>('final');
  const [search, setSearch]           = useState('');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing]     = useState<CandidateRow | null>(null);
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

  useEffect(() => { setPage(1); }, [tab, search]);

  const recClosed = ['Cancelled', 'Completed', 'Expired'].includes(recruitment?.status || '');
  const recClosedMsg = `Cannot add candidates — this recruitment is ${(recruitment?.status || '').toLowerCase()}`;

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const goto = (p: number) => setPage(Math.max(1, Math.min(pageCount, p)));

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
          <div className="rec-page">
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-2">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 46, height: 46,
                    background: 'linear-gradient(135deg, #7c5cfc 0%, #a78bfa 100%)',
                    boxShadow: '0 4px 10px rgba(124,92,252,0.30)',
                  }}
                >
                  <i className="ri-group-line" style={{ color: '#fff', fontSize: 21 }} />
                </span>
                <div className="min-w-0">
                  <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Candidate Management</h5>
                  <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                    Track candidate profiles, experience, CVs, and selection status
                  </div>
                </div>
              </div>
              <div className="cand-actions d-flex align-items-center gap-2 flex-wrap">
                <button type="button" className="cand-pill-btn cand-pill-btn--violet" onClick={() => navigate('/hr/recruitment')}>
                  <i className="ri-arrow-left-line" />Back to Recruitment List
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--blue" title="Download a sample CSV" onClick={() => setSampleOpen(true)}>
                  <i className="ri-download-line" />Sample
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--violet" disabled={recClosed} title={recClosed ? recClosedMsg : 'Import candidates from CSV'} onClick={() => setImportOpen(true)}>
                  <i className="ri-upload-2-line" />Import
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--green" title="Export candidates" onClick={() => setExportOpen(true)}>
                  <i className="ri-external-link-line" />Export
                </button>
                <button type="button" className="cand-pill-btn cand-pill-btn--primary" disabled={recClosed} title={recClosed ? recClosedMsg : 'Add a candidate'} onClick={() => { setEditing(null); setModalOpen(true); }}>
                  <i className="ri-add-line" />Add Candidate
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

            <Row className="g-3 mb-3 align-items-stretch rec-page-kpis">
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

            <Card className="border-0 shadow-none mb-0 bg-transparent">
              <CardBody className="p-0">
                <div className="rec-list-frame">
                  <div className="cand-toolbar d-flex align-items-center gap-2 flex-wrap p-2 border-bottom">
                    <div className="rec-tab-track">
                      {([
                        { key: 'final' as const,    label: 'Final Round Selected', count: totals.finalRound,                icon: 'ri-user-search-line',     variant: 'in-progress' },
                        { key: 'selected' as const, label: 'Selected Candidates',  count: totals.selected + totals.offered, icon: 'ri-checkbox-circle-line', variant: 'completed' },
                        { key: 'rejected' as const, label: 'Rejected Candidates',  count: totals.rejected,                  icon: 'ri-close-circle-line',    variant: 'cancelled' },
                      ]).map(t => (
                        <button
                          key={t.key}
                          type="button"
                          onClick={() => setTab(t.key)}
                          className={`rec-tab ${tab === t.key ? `is-active ${t.variant}` : ''}`}
                        >
                          <i className={t.icon} />
                          {t.label}
                          <span className="badge">{t.count}</span>
                        </button>
                      ))}
                    </div>
                    <div className="rec-req-search search-box" style={{ flex: 1, minWidth: 220 }}>
                      <Input type="text" className="form-control" placeholder="Search name, email, mobile…" value={search} onChange={e => setSearch(e.target.value)} />
                      <i className="ri-search-line search-icon"></i>
                    </div>
                    <span className="cand-result-chip">
                      <i className="ri-filter-3-line" />
                      {filtered.length} result{filtered.length === 1 ? '' : 's'}
                    </span>
                  </div>
                  <div className="p-2 rec-list-scroll">
                  <table className="rec-list-table cand-page-table align-middle table-nowrap mb-0">
                    <thead>
                      <tr>
                        <th className="ps-3 text-center" style={{ width: 56 }}>Sr No</th>
                        <th>Name</th>
                        <th>Email</th>
                        <th>Mobile</th>
                        <th className="text-center">Exp (Y)</th>
                        <th className="text-center">Current Sal</th>
                        <th className="text-center">Expected</th>
                        <th>Notice</th>
                        <th>Source</th>
                        <th className="text-center">CV</th>
                        <th>Status</th>
                        <th className="text-center pe-3" style={{ width: 130 }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {loading ? (
                        <ShimmerTableRows rows={6} cols={12} />
                      ) : filtered.length === 0 ? (
                        <tr>
                          <td colSpan={12} className="text-center py-5 text-muted">
                            <i className="ri-user-search-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            No candidates match your filters
                          </td>
                        </tr>
                      ) : visible.map((c, idx) => {
                        const statusColor = CANDIDATE_STATUS_COLOR[c.status];
                        return (
                          <tr key={c.id}>
                            <td className="ps-3 text-center text-muted fs-13">{sliceFrom + idx + 1}</td>
                            <td>
                              <div className="d-flex align-items-center gap-2" style={{ maxWidth: 240 }}>
                                <div className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                  style={{ width: 26, height: 26, fontSize: 10.5, background: `linear-gradient(135deg, ${c.accent}, ${c.accent}cc)` }}>
                                  {c.initials}
                                </div>
                                <span className="fw-bold fs-13" style={{ whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', minWidth: 0 }} title={c.name}>{c.name}</span>
                                {c.recruitment_code && <span className="rec-id-pill flex-shrink-0" style={{ fontSize: 10, padding: '2px 7px' }}>{c.recruitment_code}</span>}
                              </div>
                            </td>
                            <td className="fs-13 text-muted">{c.email || '—'}</td>
                            <td className="fs-13">{c.mobile || '—'}</td>
                            <td className="text-center fs-13">{c.experience_years ?? 0}</td>
                            <td className="text-center fs-13"><span className="fw-semibold">{c.current_salary_lpa != null ? `${c.current_salary_lpa} L` : '—'}</span></td>
                            <td className="text-center fs-13"><span className="fw-semibold">{c.expected_salary_lpa != null ? `${c.expected_salary_lpa} L` : '—'}</span></td>
                            <td className="fs-13">{c.notice_period || '—'}</td>
                            <td className="fs-13">{c.source || '—'}</td>
                            <td className="text-center">
                              <CvCell
                                candidate={c}
                                onUploaded={(updated) => setCandidates(prev => prev.map(r => r.id === updated.id ? updated : r))}
                              />
                            </td>
                            <td>
                              <span className={`badge rounded-pill rec-status-pill bg-${statusColor}-subtle text-${statusColor} fw-semibold px-3 py-2 fs-13`}>
                                {c.status}
                              </span>
                            </td>
                            <td className="pe-3">
                              <div className="rec-row-actions justify-content-center">
                                {c.status !== 'Rejected' && (
                                  <Tooltip label="Edit Candidate">
                                    <button
                                      type="button"
                                      className="rec-act rec-act-view rec-act--icon"
                                      aria-label="Edit Candidate"
                                      onClick={() => { setEditing(c); setModalOpen(true); }}
                                    >
                                      <i className="ri-pencil-line" />
                                    </button>
                                  </Tooltip>
                                )}
                                {c.status !== 'Selected' && c.status !== 'Offered' && c.status !== 'Rejected' && (
                                  <Tooltip label="Mark Selected">
                                    <button
                                      type="button"
                                      className="rec-act rec-act-approve rec-act--icon"
                                      aria-label="Mark Selected"
                                      onClick={() => setConfirming({ row: c, mode: 'select' })}
                                    >
                                      <i className="ri-check-line" />
                                    </button>
                                  </Tooltip>
                                )}
                                {c.status !== 'Rejected' && (
                                  <Tooltip label="Mark Rejected">
                                    <button
                                      type="button"
                                      className="rec-act rec-act-reject rec-act--icon"
                                      aria-label="Mark Rejected"
                                      onClick={() => setConfirming({ row: c, mode: 'reject' })}
                                    >
                                      <i className="ri-close-line" />
                                    </button>
                                  </Tooltip>
                                )}
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
                  <WorklistPager
                    total={filtered.length}
                    page={safePage}
                    pageSize={pageSize}
                    onPage={goto}
                    onPageSize={(n) => { setPageSize(n); setPage(1); }}
                  />
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      <CandidateFormModal
        open={modalOpen}
        editing={editing}
        recruitmentId={recruitmentId ? Number(recruitmentId) : null}
        onClose={() => { setModalOpen(false); setEditing(null); }}
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
                {filteredCount} record{filteredCount === 1 ? '' : 's'} matching current tab + filters
              </div>
            </div>
          </label>

          <div className="cand-export-info">
            <i className="ri-file-excel-2-line" />
            <div>
              <strong>File format: Excel (.xlsx)</strong> · Columns: Name, Email, Mobile,
              Experience, Current Salary, Expected Salary, Notice Period, Source, Status,
              Recruitment ID
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
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static" contentClassName="border-0 cand-sample-modal">
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
  open, editing, recruitmentId, onClose, onSaved,
}: {
  open: boolean;
  editing: CandidateRow | null;
  recruitmentId: number | null;
  onClose: () => void;
  onSaved: (row: CandidateRow) => void;
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

  return (
    <Modal isOpen={open} toggle={onClose} centered size="lg" backdrop="static" modalClassName="rec-form-modal cand-form-clientstyle" contentClassName="rec-form-content border-0">
      <ModalBody className="p-0">
        <div className="rec-form-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 32, height: 32, borderRadius: 8, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="ri-user-add-line" style={{ fontSize: 16 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15, lineHeight: 1.2 }}>Candidate Details</h5>
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.85)', marginTop: 1 }}>{editing ? 'Update applicant profile' : 'Register a new applicant profile in the pipeline'}</div>
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
                  <input type="text" className={`rec-input${errors.name ? ' is-invalid' : ''}`} placeholder="Full name" value={name} onChange={e => setName(e.target.value.replace(/[^a-zA-Z .'\-]/g, ''))} />
                  {errors.name && <div className="rec-error"><i className="ri-error-warning-line" />{errors.name}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Email<span className="req">*</span></label>
                  <input type="email" className={`rec-input${errors.email ? ' is-invalid' : ''}`} placeholder="name@email.com" value={email} onChange={e => setEmail(e.target.value)} />
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
                    onChange={e => setMobile(e.target.value.replace(/\D/g, '').slice(0, 15))}
                  />
                  {errors.mobile && <div className="rec-error"><i className="ri-error-warning-line" />{errors.mobile}</div>}
                </Col>
                <Col md={6}>
                  <label className="rec-form-label">Current Address</label>
                  <input type="text" className="rec-input" placeholder="Full residential address" value={address} onChange={e => setAddress(e.target.value)} />
                </Col>
                <Col md={6}>
                  <label className="rec-form-label">Qualification<span className="req">*</span></label>
                  <input type="text" className={`rec-input${errors.qualification ? ' is-invalid' : ''}`} placeholder="e.g. B.Tech Computer Science" value={qualification} onChange={e => setQualification(e.target.value)} />
                  {errors.qualification && <div className="rec-error"><i className="ri-error-warning-line" />{errors.qualification}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Experience (Years)<span className="req">*</span></label>
                  <input type="number" min={0} step={0.5} className={`rec-input${errors.experience_years ? ' is-invalid' : ''}`} value={experience} onChange={e => setExperience(e.target.value)} />
                  {errors.experience_years && <div className="rec-error"><i className="ri-error-warning-line" />{errors.experience_years}</div>}
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Mode of Transport</label>
                  <MasterSelect value={transport} onChange={setTransport} options={TRANSPORT_MODES.map(m => ({ value: m, label: m }))} placeholder="— Select —" />
                </Col>
                <Col md={4}>
                  <label className="rec-form-label">Distance (KM)<span className="req">*</span></label>
                  <input type="number" min={0} step={0.1} className={`rec-input${errors.distance_km ? ' is-invalid' : ''}`} placeholder="e.g. 12" value={distance} onChange={e => setDistance(e.target.value)} />
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
                  <MasterSelect value={noticePeriod} onChange={setNoticePeriod} options={NOTICE_PERIODS.map(m => ({ value: m, label: m }))} placeholder="— Select —" />
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
                  <label className="rec-form-label">Attach CV<span className="req">*</span></label>
                  <label className="cand-cv-drop" style={errors.cv ? { borderColor: '#f06548' } : undefined}>
                    <input
                      type="file"
                      accept=".pdf,.doc,.docx,application/pdf,application/msword,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
                      style={{ display: 'none' }}
                      onChange={e => {
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
                      }}
                    />
                    <i className="ri-attachment-2" />
                    <span className="cand-cv-text">
                      <strong>{cvFile ? cvFile.name : (existingCvUrl ? 'Replace CV' : 'Attach CV')}</strong>
                      <span>PDF, DOC, DOCX · Max 2 MB</span>
                    </span>
                  </label>
                  {!cvFile && existingCvUrl && editing && (
                    <button
                      type="button"
                      className="btn btn-link p-0 d-inline-flex align-items-center gap-1 mt-1 fs-13"
                      style={{ color: 'var(--vz-link-color, #4458fe)', textDecoration: 'none' }}
                      onClick={async () => {
                        try {
                          const resp = await api.get(`/candidates/${editing.id}/cv`, { responseType: 'blob' });
                          const url = URL.createObjectURL(resp.data as Blob);
                          window.open(url, '_blank', 'noopener');
                          setTimeout(() => URL.revokeObjectURL(url), 60_000);
                        } catch {
                          toast.error('Could not open CV', 'Please try again.');
                        }
                      }}
                    >
                      <i className="ri-file-text-line" />View current CV
                    </button>
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
                  <label className="rec-form-label">Candidate Status<span className="req">*</span></label>
                  <MasterSelect
                    value={status}
                    onChange={(v) => setStatus(v as CandidateStatus)}
                    options={[
                      { value: 'Final Interview', label: 'Final Round Selected' },
                      { value: 'Selected',        label: 'Selected' },
                    ]}
                    placeholder="— Select —"
                  />
                  {errors.status && <div className="rec-error"><i className="ri-error-warning-line" />{errors.status}</div>}
                </div>
              </Col>
            </Row>
          </div>
        </div>

        <div className="rec-form-footer">
          <span className="hint"><i className="ri-information-line align-bottom" /> All fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={saving}>
              <i className="ri-close-line" />Close
            </button>
            <button type="button" className="rec-btn-primary" onClick={handleSubmit} disabled={saving}>
              {saving ? (<><Spinner size="sm" style={{ width: 14, height: 14 }} /><span>Saving…</span></>) : (<><i className="ri-check-line" />Submit</>)}
            </button>
          </div>
        </div>
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

function CandidateConfirmModal({
  target, onClose, onConfirm,
}: {
  target: { row: CandidateRow; mode: 'select' | 'reject' } | null;
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
              <div className="cand-confirm-name">{row.name}</div>
              <div className="cand-confirm-meta">
                <span>{row.email || '—'}</span>
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

