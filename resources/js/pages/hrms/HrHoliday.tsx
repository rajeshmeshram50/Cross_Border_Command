import { useEffect, useMemo, useRef, useState } from 'react';
import { Col, Row, Modal, ModalBody, Spinner, Input } from 'reactstrap';
import * as XLSX from 'xlsx';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from '../master/masterFormKit';
import { useToast } from '../../contexts/ToastContext';
import { useConfirm } from '../../contexts/ConfirmContext';
import api from '../../api';
import Tooltip from '../../components/ui/Tooltip';
import DataTable, { type DataTableColumn } from '../../components/ui/DataTable';
import '../../../css/recruitment.css';

type HolidayType = 'Public' | 'Restricted' | 'Company' | 'Regional' | 'Optional';

interface HolidayGroup {
  id: number;
  code: string | null;
  name: string;
  description: string | null;
  status: string;
  holidays_count?: number;
  employees_count?: number;
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
  return `${dd}-${MONTH_ABBR[d.getMonth()]}-${d.getFullYear()}`;
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

  /* Paging lives in <DataTable> now. */

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

  const years = useMemo(() => {
    const set = new Set<string>();
    rows.forEach(r => { const y = String(r.date || '').slice(0, 4); if (y) set.add(y); });
    return Array.from(set).sort((a, b) => Number(b) - Number(a));
  }, [rows]);

  const groupName = (id: number | null | undefined) =>
    id ? (groups.find(g => g.id === id)?.name || '—') : '—';

  // Groups assigned to ≥1 employee. A holiday in such a group can still be
  // EDITED (auto-propagates), but it can't be DELETED — employees depend on it.
  const inUseGroupIds = useMemo(
    () => new Set(groups.filter(g => (g.employees_count ?? 0) > 0).map(g => g.id)),
    [groups],
  );

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

  /* Columns for the shared <DataTable>. The hand-rolled Holiday-ID sort header
     is gone — every column sorts from its own header arrow now.

     PIXEL widths, not percentages (#60). The table runs `table-layout: fixed`
     with `minWidth={1250}`, and DataTable prepends a 56px serial column — a
     fixed value. Mixing that with percentages made the two sizing systems
     fight: the percentages resolve against the table's own width, which the
     56px then pushes past, so the browser redistributed the shortfall across
     every column and the widths on screen were never the widths declared here.
     They also summed to 95, not 100, which left 5% to be handed out by the
     same redistribution — worst on first paint, while the shimmer rows are up
     and the table is at its minimum width, which is when the misalignment was
     reported.

     Pixels remove the negotiation: each column gets exactly what it asks for
     and .dt-scroll scrolls when the viewport cannot fit the total. Same
     convention (and same reasoning) as Exit Management's column block.

     Sum MUST stay in step with minWidth below:
       56 serial + 138+365+176+138+113+151+113 = 1250. */
  const columns = useMemo<DataTableColumn<HolidayRow>[]>(() => [
    {
      header: 'Holiday ID',
      id: 'code',
      accessorFn: (r: HolidayRow) => r.code || `HOL-${r.id}`,
      // Natural alphanumeric so HOL-2 sorts before HOL-10.
      sortingFn: (a, b, id) => String(a.getValue(id)).localeCompare(String(b.getValue(id)), undefined, { numeric: true, sensitivity: 'base' }),
      meta: { width: 138 },
      cell: info => <span className="rec-id-pill">{String(info.getValue() ?? '')}</span>,
    },
    {
      header: 'Holiday Name',
      accessorKey: 'name',
      // wrap: the description rides on a second line under the name.
      meta: { width: 365, wrap: true },
      cell: info => {
        const r = info.row.original;
        /* Truncation is done in CSS, not by slicing the string. A 50-char cut
           still overflowed when the text had no spaces to break on (e.g. a
           pasted "wwwww…" run): `fit-content` then sized the div past the
           column and the text painted over the Group cell. `textOverflow`
           handles any content, whatever it contains.

           The NAME clips on one line now, exactly like the description under
           it. It used to `overflowWrap: anywhere` instead, which kept a long
           name inside the column but paid for it in HEIGHT — a pasted title ran
           to three lines and dragged the whole row with it, so four holidays
           filled the screen (CBC #54). One line each keeps every row the same
           height whatever is in it, and the full text is one hover away on both
           lines rather than only on the description. */
        const clip = {
          maxWidth: '100%',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap' as const,
        };
        return (
          <>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
              <Tooltip label={r.name}>
                <div className="fw-bold fs-13" style={clip}>{r.name}</div>
              </Tooltip>
            </div>
            {r.description && (
              <Tooltip label={r.description}>
                <div className="text-muted" style={{ fontSize: 11.5, ...clip }}>
                  {r.description}
                </div>
              </Tooltip>
            )}
          </>
        );
      },
    },
    {
      header: 'Group',
      id: 'group',
      accessorFn: (r: HolidayRow) => (r.holiday_group_id ? (r.group?.name || groupName(r.holiday_group_id)) : ''),
      meta: { width: 176, align: 'center' },
      cell: info => {
        const r = info.row.original;
        return r.holiday_group_id
          ? <span className="rec-pill" style={{ background: 'rgba(56,189,248,0.16)', color: '#0284c7' }}>{r.group?.name || groupName(r.holiday_group_id)}</span>
          : <span className="text-muted">Ungrouped</span>;
      },
    },
    {
      /* Sorts on the ISO date string (already sortable as text) rather than the
         dd-Mon-yyyy label. */
      header: 'Date',
      accessorKey: 'date',
      meta: { width: 138, align: 'center' },
      cell: info => <span className="rec-date">{formatDate(info.row.original.date)}</span>,
    },
    {
      header: 'Day',
      id: 'day',
      accessorFn: (r: HolidayRow) => weekdayName(r.date),
      meta: { width: 113, align: 'center' },
      cell: info => <span className="text-muted">{weekdayName(info.row.original.date)}</span>,
    },
    {
      header: 'Type',
      accessorKey: 'type',
      meta: { width: 151, align: 'center' },
      cell: info => {
        const t = info.row.original.type;
        const tone = TYPE_TONES[t] || TYPE_TONES.Public;
        return <span className="rec-pill" style={{ background: tone.bg, color: tone.fg, ['--pill-fg' as any]: tone.fg }}>{t}</span>;
      },
    },
    {
      header: () => <div className="text-center">Actions</div>,
      id: '__actions',
      enableSorting: false,
      meta: { width: 113, align: 'center' },
      cell: info => {
        const r = info.row.original;
        /* Edit always allowed (the change auto-propagates to the group's
           employees). Delete is blocked while the holiday's group is assigned
           to employees — they depend on this date. */
        const delLocked = r.holiday_group_id != null && inUseGroupIds.has(r.holiday_group_id);
        return (
          <div className="rec-row-actions justify-content-center">
            <Tooltip label="Edit">
              <button type="button" className="rec-act rec-act-view rec-act--icon" aria-label="Edit"
                onClick={() => { setEditingRow(r); setCreateOpen(true); }}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
              </button>
            </Tooltip>
            <Tooltip label={delLocked ? 'Group is assigned to employees — can’t delete' : 'Delete'}>
              <button type="button" className="rec-act rec-act-reject rec-act--icon" aria-label="Delete" aria-disabled={delLocked}
                onClick={() => { if (delLocked) return; handleDelete(r); }}
                style={delLocked ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
              </button>
            </Tooltip>
          </div>
        );
      },
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [inUseGroupIds, groups]);

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
      const data = err?.response?.data;
      const msg = data?.errors?.holiday_group_id?.[0] || data?.message || 'Please try again.';
      toast.error('Could not delete', msg);
    }
  };

  const downloadTemplate = () => {
    // Use real group names from this tenant in the sample so the Group column
    // is self-explanatory; fall back to a generic example when none exist.
    const sampleGroup = groups[0]?.name || 'Indian Employees';
    const sample = [
      { Name: 'Republic Day',           Date: '2026-01-26', Type: 'Public',   Recurring: 'Yes', Group: sampleGroup, Description: 'National holiday' },
      { Name: 'Holi',                   Date: '2026-03-04', Type: 'Regional',  Recurring: 'No',  Group: sampleGroup, Description: '' },
      { Name: 'Company Foundation Day', Date: '2026-08-12', Type: 'Company',   Recurring: 'Yes', Group: sampleGroup, Description: 'Office closed' },
    ];
    const ws = XLSX.utils.json_to_sheet(sample);
    ws['!cols'] = [{ wch: 26 }, { wch: 14 }, { wch: 14 }, { wch: 12 }, { wch: 22 }, { wch: 30 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Holidays');
    XLSX.writeFile(wb, 'Holiday_Import_Template.xlsx');
    toast.success('Template downloaded', 'Fill in the Holidays sheet and import it.');
  };

  const handleFilePicked = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (fileRef.current) fileRef.current.value = '';
    if (!file) return;

    // No hard "pick a group first" gate — each Excel row carries its own Group
    // column now. Rows with a blank/unknown Group fall back to the group
    // selected in the filter above (if any).
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
        group: String(pick(r, ['group', 'holiday group', 'group name']) || '').trim(),
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
            <style>{`
              /* ── Holiday Calendar — visual polish (scoped to this page only) ── */
              .holiday-page .rec-list-frame{
                background: linear-gradient(180deg,#ffffff 0%, #fcfbff 100%);
                border: 1px solid #efeafd;
                border-radius: 18px;
                box-shadow: 0 12px 32px rgba(124,58,237,.08), 0 2px 6px rgba(17,24,39,.04);
                overflow: hidden;
              }
              .holiday-page .rec-req-filter-row{
                padding: 16px 16px 14px;
                border-bottom: 1px solid #f1ecfb;
                margin-bottom: 0;
                background: linear-gradient(180deg,#faf8ff, #ffffff);
              }
              .holiday-page .rec-list-scroll{ overflow-x: auto; }

              /* Table header: NO overrides on purpose. It is inherited wholesale
                 from .rec-list-table thead th (13px x 12px padding, 10.5px / 700
                 micro-caps at 0.08em, soft grey gradient bar, 1px divider) so
                 Holiday, Recruitment, Employee Onboarding and HR Employees all
                 present an identical header. This page used to paint a lavender
                 band with heavier, tighter type, which read as a different table
                 system. Body cells keep the violet identity below. */

              /* rows — zebra + smooth violet hover with accent rail. Padding is
                 inherited (14px x 12px) so the cells line up with the header. */
              .holiday-page .rec-list-table tbody td{
                border-bottom: 1px solid #f4f0fc;
                vertical-align: middle;
              }
              .holiday-page .rec-list-table tbody tr{ transition: background .16s ease, box-shadow .16s ease; }
              .holiday-page .rec-list-table tbody tr:nth-child(even){ background: #fcfaff; }
              .holiday-page .rec-list-table tbody tr:hover{
                background: linear-gradient(90deg,#f6f1ff,#fbf9ff);
                box-shadow: inset 3px 0 0 #7c3aed;
              }

              /* Holiday ID pill — gradient chip */
              .holiday-page .rec-id-pill{
                background: linear-gradient(135deg,#efe9fe,#e6ddfc);
                color: #6d28d9;
                border: 1px solid #ddd0f7;
                font-weight: 800;
                letter-spacing: .02em;
                border-radius: 8px;
                padding: 4px 10px;
                font-size: 11.5px;
              }

              /* action icons — subtle lift on hover */
              .holiday-page .rec-act{ transition: transform .12s ease, background .15s ease; }
              .holiday-page .rec-act:hover{ transform: translateY(-1px); }

              /* responsive — toolbar wraps cleanly, table scrolls instead of squashing */
              @media (max-width: 992px){
                .holiday-page .rec-req-filter-row{ gap: 8px; }
                .holiday-page .hol-actions{ margin-left: 0 !important; width: 100%; justify-content: flex-start; flex-wrap: wrap; }
              }
              @media (max-width: 640px){
                .holiday-page .hol-filter{ flex: 1 1 calc(50% - 8px); }
                .holiday-page .hol-filter .hol-filter-sel{ min-width: 0 !important; width: 100%; flex: 1; }
              }

              /* ── dark mode — translucent violet, no harsh light panels ── */
              [data-bs-theme="dark"] .holiday-page .rec-list-frame{
                background: linear-gradient(180deg, rgba(124,58,237,.07), rgba(124,58,237,.02));
                border-color: rgba(167,139,250,.18);
                box-shadow: 0 12px 32px rgba(0,0,0,.38);
              }
              [data-bs-theme="dark"] .holiday-page .rec-req-filter-row{
                background: linear-gradient(180deg, rgba(124,58,237,.06), transparent);
                border-bottom-color: rgba(167,139,250,.16);
              }
              /* Dark header is inherited too — see the light-mode note above. */
              [data-bs-theme="dark"] .holiday-page .rec-list-table tbody td{ border-bottom-color: rgba(255,255,255,.05); }
              [data-bs-theme="dark"] .holiday-page .rec-list-table tbody tr:nth-child(even){ background: rgba(255,255,255,.02); }
              [data-bs-theme="dark"] .holiday-page .rec-list-table tbody tr:hover{
                background: rgba(124,58,237,.13);
                box-shadow: inset 3px 0 0 #a78bfa;
              }
              [data-bs-theme="dark"] .holiday-page .rec-id-pill{
                background: rgba(124,58,237,.18);
                color: #c4b5fd;
                border-color: rgba(167,139,250,.28);
              }
            `}</style>
            <div className="frm-cstrip mb-3">
              <span className="frm-cstrip-accent" />
              <div className="frm-cstrip-left">
                <div className="frm-cstrip-icon"><i className="ri-calendar-event-line" /></div>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <span className="frm-cstrip-title">Holiday Calendar</span>
                  </div>
                  <div className="frm-cstrip-sub">
                    Create holiday groups (e.g. “Indian Employees”), add holidays to them, then assign a group to each employee
                  </div>
                </div>
              </div>
            </div>

            {/* Shared list table (components/ui/DataTable) — search, sortable
                headers and the rows-per-page pager live in the component; the
                Group/Type/Year pickers and the Template / Import / Groups / Add
                buttons ride in its toolbar. */}
            <DataTable<HolidayRow>
              data={filtered}
              columns={columns}
              serial
              accent="violet"
              /* fitToViewport + autoFitRows together: the card stretches to the
                 bottom of the window and the page size is measured from the
                 space that leaves, so the pager sits pinned at the bottom
                 instead of floating under a short list. Same pairing as the
                 Employee Onboarding hub. */
              fitToViewport
              autoFitRows
              minWidth={1250}
              loading={loading}
              searchValue={search}
              onSearchChange={setSearch}
              searchPlaceholder="Search holidays…"
              emptyMessage={
                <>
                  <i className="ri-calendar-2-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                  {rows.length === 0 ? 'No holidays yet — click Add Holiday or Import Excel to get started' : 'No holidays match your filters'}
                </>
              }
              toolbarActions={
                <>
                  <div className="hol-filter d-flex align-items-center gap-2">
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Group</span>
                    <div className="hol-filter-sel" style={{ minWidth: 160 }}>
                      <MasterSelect value={groupFilter} onChange={setGroupFilter}
                        options={[{ value: 'All', label: 'All Groups' }, ...groups.map(g => ({ value: String(g.id), label: g.name }))]} placeholder="All Groups" />
                    </div>
                  </div>
                  <div className="hol-filter d-flex align-items-center gap-2">
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Type</span>
                    <div className="hol-filter-sel" style={{ minWidth: 130 }}>
                      <MasterSelect value={typeFilter} onChange={setTypeFilter}
                        options={[{ value: 'All', label: 'All Types' }, ...TYPE_OPTIONS]} placeholder="All Types" />
                    </div>
                  </div>
                  <div className="hol-filter d-flex align-items-center gap-2">
                    <span className="text-uppercase fw-semibold" style={{ fontSize: 10.5, letterSpacing: '0.06em', color: 'var(--vz-secondary-color)' }}>Year</span>
                    <div className="hol-filter-sel" style={{ minWidth: 95 }}>
                      <MasterSelect value={yearFilter} onChange={setYearFilter}
                        options={[{ value: 'All', label: 'All Years' }, ...years.map(y => ({ value: y, label: y }))]} placeholder="All Years" />
                    </div>
                  </div>
                  <Tooltip label="Download Excel template">
                    <button type="button" className="rec-btn-ghost" onClick={downloadTemplate}>
                      <i className="ri-download-2-line" />Template
                    </button>
                  </Tooltip>
                  <button type="button" className="rec-btn-ghost" onClick={() => fileRef.current?.click()} disabled={importing}>
                    {importing ? <Spinner size="sm" /> : <i className="ri-file-excel-2-line" />}Import Excel
                  </button>
                  {/* Groups sits beside "Add Holiday" and is highlighted so it's
                      clear this is where you create groups first. */}
                  <Tooltip label="Create & manage holiday groups — add a group here first, then assign holidays to it">
                    <button type="button" className="rec-btn-ghost hol-groups-btn" onClick={() => setManageGroupsOpen(true)}
                      style={{ background: 'linear-gradient(135deg,#ede9fe,#ddd6fe)', border: '1px solid #c4b5fd', color: '#6d28d9', fontWeight: 700 }}>
                      <i className="ri-folder-add-line" />Groups
                    </button>
                  </Tooltip>
                  <button type="button" className="rec-btn-primary" onClick={() => { setEditingRow(null); setCreateOpen(true); }}>
                    <i className="ri-add-line" />Add Holiday
                  </button>
                </>
              }
            />
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
  const [type, setType] = useState<HolidayType | ''>('');
  const [groupId, setGroupId] = useState('');
  /* No control for this any more — the "Repeat every year" checkbox was
     removed. The state stays only so an EDIT round-trips whatever is already
     stored: it hydrates from the record below and goes back out unchanged, so
     saving a holiday that was already flagged recurring (they can still arrive
     through the Excel import) does not silently turn the flag off. A new
     holiday starts false and there is no longer any way to make it true. */
  const [isRecurring, setIsRecurring] = useState(false);
  const [description, setDescription] = useState('');

  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // TOMORROW (browser-local) as YYYY-MM-DD — the earliest selectable holiday
  // date. A holiday must be planned at least a day ahead, so today and all
  // past dates are disabled (setDate(+1) rolls month/year over correctly).
  const minDateStr = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }, []);

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
      setType(editing.type || '');
      setGroupId(editing.holiday_group_id ? String(editing.holiday_group_id) : '');
      setIsRecurring(!!editing.is_recurring);
      setDescription(editing.description || '');
    } else {
      setName(''); setDate(''); setType('');
      setGroupId(defaultGroupId ? String(defaultGroupId) : '');
      setIsRecurring(false); setDescription('');
    }
  }, [isOpen, editing?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSubmit = async () => {
    const local: Record<string, string> = {};
    if (!name.trim()) local.name = 'Holiday name is required';
    /* A holiday name is a label, not a number. The input already strips special
       characters, but a purely numeric value ("2026", "12345") still cleared the
       required check and saved as a holiday name (CBC #59). Digits stay allowed
       INSIDE a name ("Diwali 2026", "2nd October"), so the rule only demands at
       least one letter. Mirrored server-side in HolidayController. */
    else if (!/^(?=.*\p{L})[\p{L}\p{N} .'\-]+$/u.test(name.trim()))
      local.name = 'Holiday name must include at least one letter — numbers alone are not a valid name';
    if (!groupId) local.group = 'Holiday group is required';
    if (!type) local.type = 'Type is required';
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
      modalClassName="rec-form-modal master-modal" contentClassName="rec-form-content border-0">
      <ModalBody className="p-0" >
        <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 60%, #a78bfa 100%)' }}>
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
            <button type="button" onClick={onClose} disabled={saving}
              style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32, opacity: saving ? 0.5 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
              <i className="ri-close-line" style={{ fontSize: 18 }} />
            </button>
          </div>
        </div>

        <div style={{ padding: '18px 20px', maxHeight: '70vh', overflowY: 'auto' }}>
          <Row className="g-3">
            <Col md={6}>
              <label className="rec-form-label">Holiday Name<span className="req">*</span></label>
              {/* Letters, numbers, spaces and basic name punctuation only — strips
                  special chars (@, #, $, …) as the user types/pastes. */}
              {/* Every control on this form freezes while the save is in
                  flight, matching the buttons below. They all stayed live, so a
                  second click could fire another submit and anything changed
                  after the first one was never in the request — the form showed
                  one holiday and the server stored another (CBC #53). */}
              <input type="text" className={`rec-input${errors.name ? ' is-invalid' : ''}`} placeholder="e.g. Republic Day"
                value={name} onChange={e => setName(e.target.value.replace(/[^a-zA-Z0-9 .'\-]/g, ''))} maxLength={191}
                disabled={saving} />
              {errors.name && <div className="rec-error"><i className="ri-error-warning-line" />{errors.name}</div>}
            </Col>

            <Col md={6}>
              <label className="rec-form-label">
                Holiday Group<span className="req">*</span>
                <span className="text-muted" style={{ fontWeight: 400, fontSize: 10.5, marginLeft: 6, textTransform: 'none', letterSpacing: 0 }}>(The group decides which employees get this holiday.)</span>
              </label>
              <MasterSelect value={groupId} onChange={(v) => { setGroupId(v); setErrors(e => ({ ...e, group: '' })); }}
                options={groupOptions} invalid={!!errors.group} disabled={saving}
                placeholder={groupOptions.length ? 'Select group' : 'No active groups — create one via Groups'} />
              {errors.group && <div className="rec-error"><i className="ri-error-warning-line" />{errors.group}</div>}
            </Col>

            <Col md={6}>
              <label className="rec-form-label">Type<span className="req">*</span></label>
              <MasterSelect value={type} onChange={(v) => { setType(v as HolidayType); setErrors(e => ({ ...e, type: '' })); }}
                options={TYPE_OPTIONS} invalid={!!errors.type} disabled={saving} placeholder="Select type" />
              {errors.type && <div className="rec-error"><i className="ri-error-warning-line" />{errors.type}</div>}
            </Col>

            <Col md={6}>
              <label className="rec-form-label">Date<span className="req">*</span></label>
              <MasterDatePicker value={date} onChange={setDate} invalid={!!errors.date} minDate={minDateStr} disabled={saving} />
              {date && <div className="text-muted mt-1" style={{ fontSize: 11.5 }}>{weekdayName(date)}</div>}
              {errors.date && <div className="rec-error"><i className="ri-error-warning-line" />{errors.date}</div>}
            </Col>

            <Col md={12}>
              <label className="rec-form-label">Description</label>
              <textarea className="rec-input" rows={2} placeholder="Optional note shown to employees"
                value={description} onChange={e => setDescription(e.target.value)} maxLength={1000} style={{ resize: 'vertical' }}
                disabled={saving} />
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
  // The add/edit form is now hidden until the user clicks "Add Group" (header)
  // or the Edit icon — keeps the popup clean instead of an always-open form.
  const [formOpen, setFormOpen] = useState(false);

  useEffect(() => {
    if (!isOpen) { setEditing(null); setName(''); setDescription(''); setStatus('Active'); setNameErr(''); setFormOpen(false); }
  }, [isOpen]);

  const startEdit = (g: HolidayGroup) => {
    setEditing(g); setName(g.name); setDescription(g.description || ''); setStatus(g.status || 'Active'); setNameErr('');
    setFormOpen(true);
  };
  const resetForm = () => { setEditing(null); setName(''); setDescription(''); setStatus('Active'); setNameErr(''); };
  const openAdd = () => { resetForm(); setFormOpen(true); };
  const closeForm = () => { resetForm(); setFormOpen(false); };

  const save = async () => {
    if (!name.trim()) { setNameErr('Group name is required'); return; }
    /* Group names are labels — letters, numbers, spaces and hyphens only, and
       they must contain at least one LETTER. (#58) Without the lookahead a
       purely numeric "12345" passed both here and the API. Digits stay legal
       inside a name so "Diwali 2026" and "Group 1" still save; only a name made
       entirely of digits/spaces/hyphens is refused. Kept identical to the rule
       in HolidayGroupController so the form and the API agree. */
    if (!/^(?=.*\p{L})[\p{L}\p{N} \-]+$/u.test(name.trim())) {
      setNameErr('Group name must include at least one letter — numbers alone are not a valid name');
      return;
    }
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
      setFormOpen(false);
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
      message: <>Delete group <strong>{g.name}</strong>? Its holidays are kept but become ungrouped. A group that is still assigned to employees can’t be deleted — reassign them first.</>,
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
      const data = err?.response?.data;
      const msg = data?.errors?.group?.[0] || data?.message || 'Please try again.';
      toast.error('Could not delete', msg);
    }
  };

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered size="lg" backdrop="static" keyboard={false}
      modalClassName="rec-form-modal master-modal" contentClassName="rec-form-content border-0">
      <ModalBody className="p-0" >
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
            <div className="d-flex align-items-center gap-2">
              <button
                type="button"
                onClick={openAdd}
                style={{ background: 'rgba(255,255,255,0.92)', border: 0, color: '#6d28d9', borderRadius: 8, padding: '5px 11px', fontWeight: 700, fontSize: 11.5, display: 'inline-flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}
              >
                <i className="ri-add-line" style={{ fontSize: 14 }} /> Add Group
              </button>
              <button type="button" onClick={onClose} style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 32, height: 32 }}>
                <i className="ri-close-line" style={{ fontSize: 18 }} />
              </button>
            </div>
          </div>
        </div>

        <div style={{ padding: '16px 20px', maxHeight: '70vh', overflowY: 'auto' }}>

          <div className="rec-list-scroll" style={{ maxHeight: 320 }}>
            <table className="rec-list-table align-middle table-nowrap mb-0">
              <thead>
                <tr>
                  <th className="text-center" style={{ width: 64 }}>Sr No</th>
                  <th style={{ width: 110 }}>Code</th>
                  <th>Group Name</th>
                  <th style={{ width: 90 }}>Holidays</th>
                  <th className="text-center" style={{ width: 100 }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {groups.length === 0 ? (
                  <tr><td colSpan={5} className="text-center py-4 text-muted">No groups yet — click “Add Group” to create one.</td></tr>
                ) : groups.map((g, idx) => (
                  <tr key={g.id}>
                    <td className="text-center text-muted fs-13">{idx + 1}</td>
                    <td><span className="rec-id-pill">{g.code || `HGRP-${g.id}`}</span></td>
                    {/* whiteSpace:'normal' is load-bearing. The table carries
                        Velzon's `table-nowrap`, which sets `white-space: nowrap`
                        on EVERY cell — that silently defeated the wrap + clamp
                        below, so a long description rendered as one endless
                        line and stretched the column until the whole modal
                        scrolled sideways (#49). Overridden here only, so the
                        Code / Holidays / Actions cells keep their nowrap.

                        Same overflow guard as the holiday list, but this table
                        is hand-rolled (table-layout: auto), where
                        nowrap+ellipsis would just widen the column instead of
                        truncating. Wrap mid-word and clamp to 2 lines — that
                        holds regardless of layout mode. `overflow-wrap: anywhere`
                        (not `break-word`) is what lets an unbroken 200-char
                        string shrink the column in auto layout. */}
                    <td style={{ whiteSpace: 'normal' }}>
                      {/* The NAME gets the same clamp as the description. It
                          already wrapped, so it never broke the layout — but an
                          unbroken 200-char name still grew the row to a dozen
                          lines, which is the same problem one step quieter. */}
                      <Tooltip label={g.name}>
                        <div
                          className="fw-bold fs-13"
                          style={{
                            overflowWrap: 'anywhere',
                            display: '-webkit-box',
                            WebkitLineClamp: 2,
                            WebkitBoxOrient: 'vertical',
                            overflow: 'hidden',
                          }}
                        >
                          {g.name}
                        </div>
                      </Tooltip>
                      {g.description && (
                        <Tooltip label={g.description}>
                          <div
                            className="text-muted"
                            style={{
                              fontSize: 11.5,
                              overflowWrap: 'anywhere',
                              display: '-webkit-box',
                              WebkitLineClamp: 2,
                              WebkitBoxOrient: 'vertical',
                              overflow: 'hidden',
                            }}
                          >
                            {g.description}
                          </div>
                        </Tooltip>
                      )}
                    </td>
                    <td className="fs-13">{g.holidays_count ?? 0}</td>
                    <td className="text-center">
                      <div className="rec-row-actions justify-content-center">
                        <Tooltip label="Edit"><button type="button" className="rec-act rec-act-view rec-act--icon" onClick={() => startEdit(g)}>
                          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.12 2.12 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>
                        </button></Tooltip>
                        {(() => {
                          const inUse = (g.employees_count ?? 0) > 0;
                          return (
                            <Tooltip label={inUse ? `Assigned to ${g.employees_count} employee${g.employees_count === 1 ? '' : 's'} — reassign them first` : 'Delete'}>
                              <button type="button" className="rec-act rec-act-reject rec-act--icon" aria-disabled={inUse}
                                onClick={() => { if (inUse) return; remove(g); }}
                                style={inUse ? { opacity: 0.4, cursor: 'not-allowed' } : undefined}>
                                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6M14 11v6" /><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2" /></svg>
                              </button>
                            </Tooltip>
                          );
                        })()}
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

        {/* Add / Edit Group — a separate popup over the groups list (opened from
            the header "Add Group" button or a row's Edit icon). */}
        <Modal isOpen={formOpen} toggle={closeForm} centered backdrop="static" keyboard={false}
          zIndex={1060} modalClassName="rec-form-modal master-modal" contentClassName="rec-form-content border-0"
          style={{ maxWidth: 540, width: '94vw' }}>
          <ModalBody className="p-0" >
            <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg, #6d28d9 0%, #8b5cf6 60%, #a78bfa 100%)' }}>
              <div className="d-flex align-items-center justify-content-between">
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 15 }}>{editing ? 'Edit Group' : 'Add Group'}</h5>
                {/* Guarded like Cancel below. The backdrop and Esc are already
                    disabled for this dialog, which left this ✕ as the only way
                    to walk out mid-save. */}
                <button type="button" onClick={closeForm} disabled={saving}
                  style={{ background: 'rgba(255,255,255,0.18)', border: 0, color: '#fff', borderRadius: 8, width: 30, height: 30, opacity: saving ? 0.5 : 1, cursor: saving ? 'not-allowed' : 'pointer' }}>
                  <i className="ri-close-line" style={{ fontSize: 18 }} />
                </button>
              </div>
            </div>
            <div style={{ padding: '18px 20px' }}>
              <Row className="g-3">
                {/* Frozen while the save is in flight, like the buttons below.
                    Both stayed editable, so anything typed after clicking Save
                    was never in the request — the field showed one value and the
                    server stored another, with nothing on screen to say so
                    (CBC #50). */}
                <Col md={12}>
                  <label className="rec-form-label">Group Name<span className="req">*</span></label>
                  <input type="text" className={`rec-input${nameErr ? ' is-invalid' : ''}`} placeholder="e.g. Indian Employees"
                    value={name} onChange={e => { setName(e.target.value); setNameErr(''); }} maxLength={191} autoFocus
                    disabled={saving} />
                  {nameErr && <div className="rec-error"><i className="ri-error-warning-line" />{nameErr}</div>}
                </Col>
                <Col md={12}>
                  <label className="rec-form-label">Description</label>
                  <input type="text" className="rec-input" placeholder="Optional" value={description} onChange={e => setDescription(e.target.value)} maxLength={1000}
                    disabled={saving} />
                </Col>
              </Row>
            </div>
            <div style={{ padding: '12px 16px', borderTop: '1px solid var(--vz-border-color, #e5e7eb)', background: 'var(--vz-secondary-bg, #fafafa)', display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button type="button" className="rec-btn-ghost" onClick={closeForm} disabled={saving}>Cancel</button>
              <button type="button" className="rec-btn-primary" onClick={save} disabled={saving}>
                {saving ? <Spinner size="sm" /> : <i className={editing ? 'ri-save-line' : 'ri-add-line'} />}{editing ? 'Update Group' : 'Save Group'}
              </button>
            </div>
          </ModalBody>
        </Modal>
      </ModalBody>
    </Modal>
  );
}
