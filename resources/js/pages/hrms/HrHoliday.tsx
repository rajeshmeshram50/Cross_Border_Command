import { useEffect, useMemo, useRef, useState } from 'react';
import { Card, CardBody, Col, Row, Modal, ModalBody, Spinner, Input } from 'reactstrap';
import * as XLSX from 'xlsx';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api from '../../api';
import { ShimmerTableRows } from '../../components/ui/Shimmer';
import Tooltip from '../../components/ui/Tooltip';
import WorklistPager from '../../components/ui/WorklistPager';
import '../../../css/recruitment.css';

type HolidayType = 'Public' | 'Restricted' | 'Company' | 'Regional' | 'Optional';

interface HolidayGroup {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  status: string;
  holidays_count?: number;
}

interface HolidayRow {
  id: number;
  code: string | null;
  name: string;
  date: string;
  type: HolidayType;
  is_recurring: boolean;
  description: string | null;
  holiday_group_id: number | null;
  group?: { id: number; name: string } | null;
  created_at?: string;
}

const TYPE_OPTIONS: { value: HolidayType; label: string }[] = [
  { value: 'Public',     label: 'Public Holiday' },
  { value: 'Restricted', label: 'Restricted Holiday' },
  { value: 'Company',    label: 'Company Closure' },
  { value: 'Regional',   label: 'Regional Holiday' },
  { value: 'Optional',   label: 'Optional Holiday' },
];

const TYPE_TONES: Record<string, { bg: string; fg: string }> = {
  Public:     { bg: '#dceefe', fg: '#0c63b0' },
  Restricted: { bg: '#fff1d6', fg: '#b66a00' },
  Company:    { bg: '#e6e0fd', fg: '#5b3ed6' },
  Regional:   { bg: '#d8f5e6', fg: '#0f8a4d' },
  Optional:   { bg: '#f1f1f4', fg: '#5b6270' },
};

const MONTH_ABBR =['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
const WEEKDAYS = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];

function formatDate(raw: any): string {
  if (raw == null || raw === '') return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return String(raw);
  const dd = String(d.getDate()).padStart(2, '0');
  return `${dd} ${MONTH_ABBR[d.getMonth()]} ${d.getFullYear()}`;
}
function weekdayName(raw: any): string {
  if (!raw) return '—';
  const d = new Date(String(raw));
  if (isNaN(d.getTime())) return '—';
  return WEEKDAYS[d.getDay()];
}

// A holiday is "past" (frozen / read-only) once its date is before today.
// Recurring (yearly) holidays are never frozen — their next occurrence is
// always upcoming. Mirrors the backend guard in HolidayController.
function isPastHoliday(row: HolidayRow): boolean {
  if (row.is_recurring) return false;
  const raw = String(row.date || '').slice(0, 10);
  if (!raw) return false;
  const todayStr = new Date().toLocaleDateString('en-CA'); // local YYYY-MM-DD
  return raw < todayStr;
}

export default function HrHoliday() {
  const toast = useToast();
  const confirmDialog = useConfirm();

  const [rows, setRows] = useState<HolidayRow[]>([]);
  const [groups, setGroups] = useState<HolidayGroup[]>([]);
  const [loading, setLoading] = useState(true);

  const [search, setSearch] = useState('');
  const [typeFilter, setTypeFilter] = useState('All');
  const [yearFilter, setYearFilter] = useState('All');
  const [groupFilter, setGroupFilter] = useState('All');

  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [createOpen, setCreateOpen] = useState(false);
  const [editingRow, setEditingRow] = useState<HolidayRow | null>(null);
  const [manageGroupsOpen, setManageGroupsOpen] = useState(false);

  const fileRef = useRef<HTMLInputElement | null>(null);
  const [importing, setImporting] = useState(false);

  const fetchGroups = async () => {
    try {
      const res = await api.get('/holiday-groups');
      setGroups(Array.isArray(res.data) ? res.data : []);
    } catch { setGroups([]); }
  };

  const fetchHolidays = async () => {
    try {
      setLoading(true);
      const res = await api.get('/holidays');
      setRows(Array.isArray(res.data) ? res.data : []);
    } catch (err: any) {
      toast.error('Could not load holidays', err?.response?.data?.message || 'Please try again.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  };

  const refreshAll = () => { fetchGroups(); fetchHolidays(); };

  useEffect(() => { refreshAll(); }, []);
  useEffect(() => { setPage(1); }, [search, typeFilter, yearFilter, groupFilter]);

  const years = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { const y = String(r.date || '').slice(0, 4); if (y) set.add(y); });
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [rows]);

  const groupName = (id: number | null | undefined) =>
    id ? (groups.find(g => g.id === id)?.name || '—') : '—';

  const filtered = useMemo(() => {
    const needle = search.trim().toLowerCase();
    return rows.filter(r => {
      if (typeFilter !== 'All' && r.type !== typeFilter) return false;
      if (yearFilter !== 'All' && String(r.date || '').slice(0, 4) !== yearFilter) return false;
      if (groupFilter !== 'All' && String(r.holiday_group_id ?? '') !== groupFilter) return false;
      if (!needle) return true;
      return (
        r.name.toLowerCase().includes(needle) ||
        (r.code || '').toLowerCase().includes(needle) ||
        (r.description || '').toLowerCase().includes(needle)
      );
    });
  }, [rows, search, typeFilter, yearFilter, groupFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);
  const goto = (p: number) => setPage(Math.max(1, Math.min(pageCount, p)));

  const targetGroupId =groupFilter !== 'All' ? Number(groupFilter) : null;

  const handleDelete = async (row: HolidayRow) => {
    const ok = await confirmDialog({
      title: 'Delete holiday?',
      message: <>Delete <strong>{row.name}</strong> ({formatDate(row.date)})? This cannot be undone.</>,
      tone: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    try {
      await api.delete(`/holidays/${row.id}`);
      toast.success('Deleted', `${row.name} removed.`);
      refreshAll();
    } catch (err: any) {
      toast.error('Could not delete', err?.response?.data?.message || 'Please try again.');
    }
  };

  const downloadTemplate = () => {
    const sample = [
      { Name: 'Republic Day',           Date: '2026-01-26', Type: 'Public',   Recurring: 'Yes', Description: 'National holiday' },
      { Name: 'Holi',                   Date: '2026-03-04', Type: 'Regional',  Recurring: 'No',  Description: '' },
      { Name: 'Company Foundation Day', Date: '2026-08-12', Type: 'Company',   Recurring: 'Yes', Description: 'Office closed' },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Holidays');
    XLSX.writeFile(wb, 'Holiday_Import_Template.xlsx');
    toast.success('Template downloaded', 'Fill in the Holidays sheet and import it.');
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;

    if (groups.length > 0 && !targetGroupId) {
      toast.error('Pick a holiday group first', 'Select a group above so imported holidays are filed under it.');
      return;
    }

    setImporting(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      const json: any[] = XLSX.utils.sheet_to_json(sheet, { defval: '' });

      if (!json.length) {
        toast.error('Empty file', 'No rows found in the first sheet.');
        return;
      }

      const pick = (obj: any, keys: string[]) => {
        for (const k of Object.keys(obj)) {
          if (keys.includes(k.trim().toLowerCase())) return obj[k];
        }
        return '';
      };
      const rowsToSend = json.map(r => ({
        name: String(pick(r, ['name', 'holiday', 'holiday name', 'title']) || '').trim(),
        date: typeof pick(r, ['date', 'holiday date']) === 'number'
          ? pick(r, ['date', 'holiday date'])
          : String(pick(r, ['date', 'holiday date']) || '').trim(),
        type: String(pick(r, ['type', 'category']) || 'Public').trim(),
        is_recurring: /^(y|yes|true|1)$/i.test(String(pick(r, ['recurring', 'is_recurring', 'repeats']) || '').trim()),
        description: String(pick(r, ['description', 'note', 'notes', 'remark', 'remarks']) || '').trim(),
      }));

      const { data } = await api.post('/holidays/import', { rows: rowsToSend, holiday_group_id: targetGroupId });
      const errCount = Array.isArray(data?.errors) ? data.errors.length : 0;
      if (errCount > 0) {
        const first = data.errors.slice(0, 3).map((x: any) => `Row ${x.row}: ${x.message}`).join('  •  ');
        toast.error(`Imported ${data.created}, ${errCount} row(s) skipped`, first);
      } else {
        toast.success('Import complete', data?.message || `${data?.created || 0} holiday(s) added.`);
      }
      refreshAll();
    } catch (err: any) {
      toast.error('Import failed', err?.response?.data?.message || 'Could not read or upload the file.');
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <MasterFormStyles />
      <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv" style={{ display: 'none' }} onChange={handleFilePicked} />
      <Row>
        <Col xs={12}>
          <div className="rec-page holiday-page">
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-calendar-event-line" /></div>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="frm-cstrip-title">Holiday Calendar</span>
                    <span className="rec-pill" style={{ background: 'rgba(56,189,248,0.16)', color: '#0284c7', fontSize: 11 }}>Time Off</span>
                  </div>
                  <div className="frm-cstrip-sub">
                    Create holiday groups (e.g. “Indian Employees”), add holidays to them, then assign a group to each employee
                  </div>
                </div>
              </div>
            </div>

            <Card className="border-0 shadow-none mb-0 bg-transparent">
              <CardBody className="p-0">
                <div className="rec-list-frame">
                  <div className="rec-req-filter-row d-flex align-items-center gap-2 flex-wrap">
                    <div className="rec-req-search search-box" style={{ flex: 1, minWidth: 200 }}>
                      <Input type="text" className="form-control" placeholder="Search holidays…" value={search} onChange={e => setSearch(e.target.value)} />
                      <i className="ri-search-line search-icon"></i>
                    </div>
                    <div className="hol-filter d-flex align-items-center gap-2">
                      <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Group</span>
                      <div className="hol-filter-sel" style={{ minWidth: 170 }}>
                        <MasterSelect value={groupFilter} onChange={setGroupFilter}
                          options={[{ value: 'All', label: 'All Groups' }, ...groups.map(g => ({ value: String(g.id), label: g.name }))]} placeholder="All Groups" />
                      </div>
                    </div>
                    <div className="hol-filter d-flex align-items-center gap-2">
                      <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Type</span>
                      <div className="hol-filter-sel" style={{ minWidth: 140 }}>
                        <MasterSelect value={typeFilter} onChange={setTypeFilter}
                          options={[{ value: 'All', label: 'All Types' }, ...TYPE_OPTIONS]} placeholder="All Types" />
                      </div>
                    </div>
                    <div className="hol-filter d-flex align-items-center gap-2">
                      <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Year</span>
                      <div className="hol-filter-sel" style={{ minWidth: 100 }}>
                        <MasterSelect value={yearFilter} onChange={setYearFilter}
                          options={[{ value: 'All', label: 'All Years' }, ...years.map(y => ({ value: y, label: y }))]} placeholder="All Years" />
                      </div>
                    </div>

                    <div className="hol-actions d-flex align-items-center gap-2 ms-auto">
                      <Tooltip label="Create & manage holiday groups (types)">
                        <button type="button" className="rec-btn-ghost" onClick={() => setManageGroupsOpen(true)}>
                          <i className="ri-folder-settings-line" />Groups
                        </button>
                      </Tooltip>
                      <Tooltip label="Download Excel template">
                        <button type="button" className="rec-btn-ghost" onClick={downloadTemplate}>
                          <i className="ri-download-2-line" />Template
                        </button>
                      </Tooltip>
                      <button type="button" className="rec-btn-ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
                        {importing ? <Spinner size="sm" /> : <i className="ri-file-excel-2-line" />}Import Excel
                      </button>
                      <button type="button" className="rec-btn-primary" onClick={() => { setEditingRow(null); setCreateOpen(true); }}>
                        <i className="ri-add-line" />Add Holiday
                      </button>
                    </div>
                  </div>

                  {groups.length === 0 && (
                    <div className="px-3 pt-2" style={{ fontSize: 12 }}>
                      <span className="rec-pill holiday-tip-pill" style={{ background: '#fff1d6', color: '#b66a00' }}>
                        <i className="ri-information-line me-1" />Tip: create a Holiday Group first (e.g. “Indian Employees”), then add holidays into it.
                      </span>
                    </div>
                  )}

                  <div className="rec-list-scroll">
                    <table className="rec-list-table align-middle table-nowrap mb-0">
                      <thead>
                        <tr>
                          <th className="ps-3 text-center" style={{ width: 60 }}>Sr No</th>
                          <th style={{ width: 110 }}>Holiday ID</th>
                          <th>Holiday Name</th>
                          <th style={{ width: 160 }}>Group</th>
                          <th style={{ width: 125 }}>Date</th>
                          <th style={{ width: 100 }}>Day</th>
                          <th style={{ width: 130 }}>Type</th>
                          <th style={{ width: 90 }}>Recurring</th>
                          <th className="text-center pe-3" style={{ width: 110 }}>Actions</th>
                        </tr>
                      </thead>
                      <tbody>
                        {loading ? (
                          <ShimmerTableRows rows={5} cols={9} />
                        ) : visible.length === 0 ? (
                          <tr><td colSpan={9} className="text-center py-5 text-muted">
                            <i className="ri-calendar-2-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            {rows.length === 0 ? 'No holidays yet — click Add Holiday or Import Excel to get started' : 'No holidays match your filters'}
                          </td></tr>
                        ) : visible.map((r, idx) => {
                          const tone = TYPE_TONES[r.type] || TYPE_TONES.Public;
                          const frozen = isPastHoliday(r);
                          return (
                            <tr key={r.id}>
                              <td className="ps-3 text-center text-muted fs-13">{sliceFrom + idx + 1}</td>
                              <td><span className="rec-id-pill">{r.code || `HOL-${r.id}`}</span></td>
                              <td>
                                <div className="fw-bold fs-13">{r.name}</div>
                                {r.description && <div className="text-muted" style={{ fontSize: 11.5 }}>{r.description}</div>}
                              </td>
                              <td className="fs-13">
                                {r.holiday_group_id
                                  ? <span className="rec-pill" style={{ background: 'rgba(56,189,248,0.16)', color: '#0284c7' }}>{r.group?.name || groupName(r.holiday_group_id)}</span>
                                  : <span className="text-muted">Ungrouped</span>}
                              </td>
                              <td className="fs-13"><span className="rec-date">{formatDate(r.date)}</span></td>
                              <td className="fs-13 text-muted">{weekdayName(r.date)}</td>
                              <td><span className="rec-pill" style={{ background: tone.bg, color: tone.fg, ['--pill-fg' as any]: tone.fg }}>{r.type}</span></td>
                              <td className="fs-13">
                                {r.is_recurring
                                  ? <span className="rec-pill" style={{ background: '#d8f5e6', color: '#0f8a4d', ['--pill-fg' as any]: '#0f8a4d' }}>Yearly</span>
                                  : <span className="text-muted">—</span>}
                              </td>
                              <td className="pe-3 text-center">
                                {frozen ? (
                                  <Tooltip label="Past holiday — locked">
                                    <span className="rec-pill" style={{ background: '#f1f1f4', color: '#5b6270' }}>
                                      <i className="ri-lock-line me-1" />Locked
                                    </span>
                                  </Tooltip>
                                ) : (
                                  <div className="rec-row-actions justify-content-center">
                                    <Tooltip label="Edit">
                                      <button type="button" className="rec-act rec-act-view rec-act--icon" aria-label="Edit" onClick={() => { setEditingRow(r); setCreateOpen(true); }}>
                                        <i className="ri-pencil-line" />
                                      </button>
                                    </Tooltip>
                                    <Tooltip label="Delete">
                                      <button type="button" className="rec-act rec-act-reject rec-act--icon" aria-label="Delete" onClick={() => handleDelete(r)}>
                                        <i className="ri-delete-bin-line" />
                                      </button>
                                    </Tooltip>
                                  </div>
                                )}
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

      <HolidayModal
        isOpen={createOpen}
        editing={editingRow}
        groups={groups}
        defaultGroupId={targetGroupId}
        onClose={() => { setCreateOpen(false); setEditingRow(null); }}
        onSaved={() => { setCreateOpen(false); setEditingRow(null); refreshAll(); }}
      />

      <ManageGroupsModal
        isOpen={manageGroupsOpen}
        groups={groups}
        onClose={() => setManageGroupsOpen(false)}
        onChanged={refreshAll}
      />
    </>
  );
}

function HolidayModal({
  isOpen, editing, groups, defaultGroupId, onClose, onSaved,
}: {
  isOpen: boolean;
  editing: HolidayRow | null;
  groups: HolidayGroup[];
  defaultGroupId: number | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();

  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState<HolidayType>('Public');
  const [groupId, setGroupId] = useState('');
  const [isRecurring, setIsRecurring] = useState(false);
  const [description, setDescription] = useState('');

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  const groupOptions = useMemo(
    () => groups
      .filter(g => g.status === 'Active' || String(g.id) === groupId)
      .map(g => ({ value: String(g.id), label: g.name })),
    [groups, groupId],
  );

  useEffect(() => {
    if (!isOpen) return;
    setErrors({});
    setSaving(false);
    if (editing) {
      setName(editing.name || '');
      setDate((editing.date || '').slice(0, 10));
      setType(editing.type || 'Public');
      setGroupId(editing.holiday_group_id ? String(editing.holiday_group_id) : '');
      setIsRecurring(!!editing.is_recurring);
      setDescription(editing.description || '');
    } else {
      setName(''); setDate(''); setType('Public');
      setGroupId(defaultGroupId ? String(defaultGroupId) : '');
      setIsRecurring(false); setDescription('');
    }
  }, [isOpen, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = 'Holiday name is required';
    if (!date) local.date = 'Date is required';
    if (Object.keys(local).length) { setErrors(local); return; }

    setSaving(true);
    try {
      const payload = {
        name: name.trim(), date, type,
        holiday_group_id: groupId ? Number(groupId) : null,
        is_recurring: isRecurring,
        description: description.trim() || null,
      };
      if (editing) {
        await api.put(`/holidays/${editing.id}`, payload);
        toast.success('Holiday updated', `${name.trim()} saved.`);
      } else {
        await api.post('/holidays', payload);
        toast.success('Holiday added', `${name.trim()} saved.`);
      }
      onSaved();
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
    <Modal isOpen={isOpen} toggle={onClose} centered size="lg" backdrop="static" keyboard={false}
      modalClassName="rec-form-modal" contentClassName="rec-form-content border-0">
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
        <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #0ea5e9 0%, #38bdf8 60%, #7dd3fc 100%)' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                <i className="ri-calendar-event-line" style={{ fontSize: 18, color: '#fff' }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 16, lineHeight: 1.2 }}>{editing ? 'Edit Holiday' : 'Add Holiday'}</h5>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>Manage a company holiday date</div>
              </div>
            </div>
            <button type="button" onClick={onClose} style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32 }}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <div style={{ padding: '18px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
          <Row className="g-3">
            <Col md={12}>
              <label className="rec-form-label">Holiday Name<span className="req">*</span></label>
              <input type="text" className={`rec-input${errors.name ? ' is-invalid' : ''}`} placeholder="e.g. Republic Day"
                value={name} onChange={e => setName(e.target.value)} maxLength={191} />
              {errors.name && <div className="rec-error"><i className="ri-error-warning-line" />{errors.name}</div>}
            </Col>

            <Col md={6}>
              <label className="rec-form-label">Holiday Group</label>
              <MasterSelect value={groupId} onChange={setGroupId}
                options={[{ value: '', label: 'Ungrouped' }, ...groupOptions]}
                placeholder={groupOptions.length ? 'Select group' : 'No active groups — create one via Groups'} />
              <div className="text-muted mt-1" style={{ fontSize: 11.5 }}>The group decides which employees get this holiday.</div>
            </Col>

            <Col md={6}>
              <label className="rec-form-label">Type</label>
              <MasterSelect value={type} onChange={(v) => setType(v as HolidayType)} options={TYPE_OPTIONS} placeholder="Select type" />
            </Col>

            <Col md={6}>
              <label className="rec-form-label">Date<span className="req">*</span></label>
              <MasterDatePicker value={date} onChange={setDate} invalid={!!errors.date} />
              {date && <div className="text-muted mt-1" style={{ fontSize: 11.5 }}>{weekdayName(date)}</div>}
              {errors.date && <div className="rec-error"><i className="ri-error-warning-line" />{errors.date}</div>}
            </Col>

            <Col md={6} className="d-flex align-items-end">
              <label className="d-inline-flex align-items-center gap-2 mb-2" style={{ cursor: 'pointer', fontSize: 13 }}>
                <input type="checkbox" className="form-check-input mt-0" checked={isRecurring} onChange={e => setIsRecurring(e.target.checked)} />
                <span>Repeats every year on this date</span>
              </label>
            </Col>

            <Col md={12}>
              <label className="rec-form-label">Description</label>
              <textarea className="rec-input" rows={2} placeholder="Optional note shown to employees"
                value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} style={{ resize: 'vertical' }} />
            </Col>
          </Row>
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--vz-border-color, #e5e7eb)', background: 'var(--vz-secondary-bg, #fafafa)', display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8 }}>
          <button type="button" className="rec-btn-ghost" onClick={onClose} disabled={saving}>Cancel</button>
          <button type="button" className="rec-btn-primary" onClick={handleSubmit} disabled={saving}>
            {saving ? <Spinner size="sm" /> : <i className="ri-save-line" />}{editing ? 'Update Holiday' : 'Save Holiday'}
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

function ManageGroupsModal({
  isOpen, groups, onClose, onChanged,
}: {
  isOpen: boolean;
  groups: HolidayGroup[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const confirmDialog = useConfirm();
  const [editing, setEditing] = useState<HolidayGroup | null>(null);
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('Active');
  const [saving, setSaving] = useState(false);
  const [nameErr, setNameErr] = useState('');

  useEffect(() => {
    if (!isOpen) { setEditing(null); setName(''); setDescription(''); setStatus('Active'); setNameErr(''); }
  }, [isOpen]);

  const startEdit = (g: HolidayGroup) => {
    setEditing(g); setName(g.name); setDescription(g.description || ''); setStatus(g.status || 'Active'); setNameErr('');
  };
  const resetForm = () => { setEditing(null); setName(''); setDescription(''); setStatus('Active'); setNameErr(''); };

  const save = async () => {
    if (!name.trim()) { setNameErr('Group name is required'); return; }
    setSaving(true);
    try {
      const payload = { name: name.trim(), description: description.trim() || null, status };
      if (editing) {
        await api.put(`/holiday-groups/${editing.id}`, payload);
        toast.success('Group updated', `${name.trim()} saved.`);
      } else {
        await api.post('/holiday-groups', payload);
        toast.success('Group created', `${name.trim()} added.`);
      }
      resetForm();
      onChanged();
    } catch (err: any) {
      if (err?.response?.status === 422 && err?.response?.data?.errors?.name) {
        setNameErr(String(err.response.data.errors.name[0]));
      } else {
        toast.error('Could not save group', err?.response?.data?.message || 'Please try again.');
      }
    } finally {
      setSaving(false);
    }
  };

  const remove = async (g: HolidayGroup) => {
    const ok = await confirmDialog({
      title: 'Delete group?',
      message: <>Delete group <strong>{g.name}</strong>? Its holidays are kept but become ungrouped, and any employee on this group is unassigned.</>,
      tone: 'danger',
      confirmLabel: 'Delete',
      cancelLabel: 'Cancel',
      icon: 'delete-bin-line',
    });
    if (!ok) return;
    try {
      await api.delete(`/holiday-groups/${g.id}`);
      toast.success('Group deleted', `${g.name} removed.`);
      if (editing?.id === g.id) resetForm();
      onChanged();
    } catch (err: any) {
      toast.error('Could not delete', err?.response?.data?.message || 'Please try again.');
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered size="lg" backdrop="static" keyboard={false}
      modalClassName="rec-form-modal" contentClassName="rec-form-content border-0">
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)' }}>
        <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 60%, #a78bfa 100%)' }}>
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-2">
              <span style={{ width: 36, height: 36, borderRadius: 10, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center' }}>
                <i className="ri-folder-settings-line" style={{ fontSize: 18, color: '#fff' }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 16 }}>Holiday Groups</h5>
                <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.85)' }}>Holiday lists you assign to employees</div>
              </div>
            </div>
            <button type="button" onClick={onClose} style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32 }}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <div style={{ padding: '16px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
          <Row className="g-2 align-items-end mb-3">
            <Col md={4}>
              <label className="rec-form-label">Group Name<span className="req">*</span></label>
              <input type="text" className={`rec-input${nameErr ? ' is-invalid' : ''}`} placeholder="e.g. Indian Employees"
                value={name} onChange={e => { setName(e.target.value); setNameErr(''); }} maxLength={191} />
              {nameErr && <div className="rec-error"><i className="ri-error-warning-line" />{nameErr}</div>}
            </Col>
            <Col md={4}>
              <label className="rec-form-label">Description</label>
              <input type="text" className="rec-input" placeholder="Optional" value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} />
            </Col>
            <Col md={2}>
              <label className="rec-form-label">Status</label>
              <MasterSelect value={status} onChange={setStatus} options={[{ value: 'Active', label: 'Active' }, { value: 'Inactive', label: 'Inactive' }]} placeholder="Status" />
            </Col>
            <Col md={2} className="d-flex gap-2">
              <button type="button" className="rec-btn-primary w-100" onClick={save} disabled={saving}>
                {saving ? <Spinner size="sm" /> : <i className={editing ? 'ri-save-line' : 'ri-add-line'} />}{editing ? 'Update' : 'Add'}
              </button>
              {editing && <button type="button" className="rec-btn-ghost" onClick={resetForm} disabled={saving}>Cancel</button>}
            </Col>
          </Row>

          <div className="rec-list-scroll" style={{ maxHeight: 320 }}>
            <table className="rec-list-table align-middle table-nowrap mb-0">
              <thead>
                <tr>
                  <th className="text-center" style={{ width: 56 }}>#</th>
                  <th style={{ width: 110 }}>Code</th>
                  <th>Group Name</th>
                  <th style={{ width: 90 }}>Holidays</th>
                  <th style={{ width: 90 }}>Status</th>
                  <th className="text-center" style={{ width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr><td colSpan={6} className="text-center py-4 text-muted">No groups yet — add one above.</td></tr>
                ) : groups.map((g, idx) => (
                  <tr key={g.id}>
                    <td className="text-center text-muted fs-13">{idx + 1}</td>
                    <td><span className="rec-id-pill">{g.code || `HGRP-${g.id}`}</span></td>
                    <td>
                      <div className="fw-bold fs-13">{g.name}</div>
                      {g.description && <div className="text-muted" style={{ fontSize: 11.5 }}>{g.description}</div>}
                    </td>
                    <td className="fs-13">{g.holidays_count ?? 0}</td>
                    <td>
                      <span className="rec-pill holiday-status-pill" data-status={g.status} style={g.status === 'Active' ? { background: '#d8f5e6', color: '#0f8a4d' } : { background: '#f1f1f4', color: '#5b6270' }}>{g.status}</span>
                    </td>
                    <td className="text-center">
                      <div className="rec-row-actions justify-content-center">
                        <Tooltip label="Edit"><button type="button" className="rec-act rec-act-view rec-act--icon" onClick={() => startEdit(g)}><i className="ri-pencil-line" /></button></Tooltip>
                        <Tooltip label="Delete"><button type="button" className="rec-act rec-act-reject rec-act--icon" onClick={() => remove(g)}><i className="ri-delete-bin-line" /></button></Tooltip>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        <div style={{ padding: '12px 16px', borderTop: '1px solid var(--vz-border-color, #e5e7eb)', background: 'var(--vz-secondary-bg, #fafafa)', display: 'flex', justifyContent: 'flex-end' }}>
          <button type="button" className="rec-btn-ghost" onClick={onClose}>Done</button>
        </div>
      </ModalBody>
    </Modal>
  );
}
