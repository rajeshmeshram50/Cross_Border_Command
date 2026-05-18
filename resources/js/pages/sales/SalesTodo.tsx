import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';
import Tooltip from '../../components/ui/Tooltip';

/* ────────────────────────────────────────────────────────────────────────────
 * Sales Matrix → To-Do (Productivity Tracker)
 *
 * Faithful port of the prototype's `#todoPage` (SalesMatrix_v4_9, line 9633) —
 * a teal-palette productivity page with two top tabs (Reminder, Meeting),
 * sub-status filters, search, add/edit modal, and a table per tab.
 *
 * Calendar view is scaffolded but defers to a "coming next" toast — the
 * prototype's calendar is rendered via a full-overlay component that's
 * non-trivial to port and not on the QA-critical path.
 *
 * Data is mock for now (seeded from prototype `TD_DATA`, line 22914).
 * Permission-gated on `sales.todo` — super_admin bypasses.
 * ──────────────────────────────────────────────────────────────────────── */

type TopTab = 'reminder' | 'meeting';
type MeetingSub = 'virtual' | 'physical';
type ReminderFilter = 'today' | 'all' | 'In Progress' | 'Done';
type MeetingStatus = 'In Progress' | 'Done' | 'Postponed' | 'Cancelled';

type Reminder = {
  id: number;
  oppId: string;
  oppDate: string;     // dd/mm/yyyy
  subject: string;
  setDate: string;     // dd/mm/yyyy
  tat: string;         // '24 Hours', '48 Hours', '72 Hours', '1 Week'
  remark: string;
  status: 'In Progress' | 'Done';
};

type Meeting = {
  id: number;
  code: string;        // M-001 / P-001
  oppId: string;
  customer: string;
  email: string;
  contact: string;
  platform: string;    // Zoom, Google Meet, Teams, Office Visit, Trade Fair, Client Site, Phone Call
  date: string;        // dd/mm/yyyy
  startTime: string;   // HH:mm
  endTime: string;
  link: string;
  venue: string;
  agenda: string;
  status: MeetingStatus;
  type: MeetingSub;
};

/* ── Mock seed (matches prototype window.TD_DATA, abridged) ── */
const TODAY_STR = '15/05/2026'; // matches the prototype's "Today's Priority" anchor

const SEED_REMINDERS: Reminder[] = [
  { id:1,  oppId:'OPP-028', oppDate:'14/05/2026', subject:'Follow up for quotation — Shree Exports',         setDate:'15/05/2026', tat:'24 Hours', remark:'Awaiting revised pricing confirmation',           status:'In Progress' },
  { id:2,  oppId:'OPP-001', oppDate:'13/05/2026', subject:'Send product catalogue to GreenHarvest',           setDate:'15/05/2026', tat:'48 Hours', remark:'Include latest cashew & sesame SKUs',             status:'In Progress' },
  { id:3,  oppId:'OPP-004', oppDate:'13/05/2026', subject:'Check PI acceptance from Mujahed Al-Rashid',       setDate:'15/05/2026', tat:'24 Hours', remark:'PI sent on 12/05 — awaiting sign-off',            status:'In Progress' },
  { id:4,  oppId:'OPP-007', oppDate:'14/05/2026', subject:'Delivery timeline confirmation — Dubai port',      setDate:'15/05/2026', tat:'72 Hours', remark:'Coordinate with logistics team',                  status:'In Progress' },
  { id:5,  oppId:'OPP-008', oppDate:'14/05/2026', subject:'Supplier rate comparison — sesame oil',            setDate:'15/05/2026', tat:'48 Hours', remark:'Compare 3 supplier quotes before EOD',            status:'In Progress' },
  { id:6,  oppId:'OPP-009', oppDate:'14/05/2026', subject:'Grade & quantity confirmation from James Okoye',   setDate:'15/05/2026', tat:'24 Hours', remark:'Grade W320 — 20MT order pending',                 status:'In Progress' },
  { id:7,  oppId:'OPP-011', oppDate:'13/05/2026', subject:'LC amendment follow-up — Fatima Al-Hassan',        setDate:'15/05/2026', tat:'24 Hours', remark:'Bank ref #LC-2026-0421 needs extension',          status:'In Progress' },
  { id:8,  oppId:'OPP-013', oppDate:'12/05/2026', subject:'Phytosanitary certificate renewal check',          setDate:'15/05/2026', tat:'48 Hours', remark:'Validity expires 30/05 — urgent action',          status:'In Progress' },
  { id:9,  oppId:'OPP-017', oppDate:'14/05/2026', subject:'Proforma invoice revision for Luca Bianchi',       setDate:'15/05/2026', tat:'24 Hours', remark:'Update unit price as per latest costing',         status:'In Progress' },
  { id:10, oppId:'OPP-022', oppDate:'13/05/2026', subject:'Shipping marks approval — Nairobi consignee',      setDate:'15/05/2026', tat:'24 Hours', remark:'Design team to confirm mark layout',              status:'In Progress' },
  { id:11, oppId:'OPP-031', oppDate:'10/05/2026', subject:'Container booking confirmation — COSCO',           setDate:'16/05/2026', tat:'48 Hours', remark:'20ft FCL — Nhava Sheva to Rotterdam',             status:'In Progress' },
  { id:12, oppId:'OPP-033', oppDate:'11/05/2026', subject:'Buyer credit limit approval follow-up',            setDate:'17/05/2026', tat:'72 Hours', remark:'Submitted to credit team on 10/05',               status:'In Progress' },
  { id:13, oppId:'OPP-035', oppDate:'12/05/2026', subject:'BL draft review with Priya Exports',               setDate:'18/05/2026', tat:'48 Hours', remark:'Check consignee details and notify party',        status:'In Progress' },
  { id:14, oppId:'OPP-036', oppDate:'12/05/2026', subject:'Insurance certificate issuance reminder',          setDate:'19/05/2026', tat:'1 Week',   remark:'Open cover policy — endorse shipment',            status:'In Progress' },
  { id:15, oppId:'OPP-038', oppDate:'13/05/2026', subject:'Sampling dispatch to SunFood Germany',             setDate:'20/05/2026', tat:'48 Hours', remark:'500g each SKU via DHL Express',                   status:'In Progress' },
  { id:16, oppId:'OPP-039', oppDate:'13/05/2026', subject:'Re-quote request from Ahmed Al-Farsi',             setDate:'20/05/2026', tat:'24 Hours', remark:'Customer asked for CIF Dubai pricing',            status:'In Progress' },
  { id:17, oppId:'OPP-041', oppDate:'14/05/2026', subject:'Export declaration filing — custom agent',         setDate:'21/05/2026', tat:'72 Hours', remark:'SB filing due before vessel cut-off',             status:'In Progress' },
  { id:18, oppId:'OPP-042', oppDate:'14/05/2026', subject:'Quality inspection scheduling — FSSAI lab',        setDate:'22/05/2026', tat:'1 Week',   remark:'Batch #2026-B44 ready for inspection',            status:'In Progress' },
  { id:19, oppId:'OPP-044', oppDate:'14/05/2026', subject:'Fumigation certificate follow-up',                 setDate:'23/05/2026', tat:'48 Hours', remark:'Required for US-bound shipment',                  status:'In Progress' },
  { id:20, oppId:'OPP-045', oppDate:'15/05/2026', subject:'Final packing list confirmation — Maroc Trader',   setDate:'24/05/2026', tat:'24 Hours', remark:'Gross/net weight to be verified',                 status:'In Progress' },
  { id:21, oppId:'OPP-005', oppDate:'01/05/2026', subject:'Demo session follow-up — Horizon Agro',            setDate:'02/05/2026', tat:'24 Hours', remark:'Demo completed; proposal sent',                   status:'Done' },
  { id:22, oppId:'OPP-006', oppDate:'02/05/2026', subject:'PI approval reminder — Zahra Trading',             setDate:'03/05/2026', tat:'48 Hours', remark:'PI signed and returned on 03/05',                 status:'Done' },
  { id:23, oppId:'OPP-010', oppDate:'03/05/2026', subject:'PO issuance follow-up — K.K. Brothers',            setDate:'04/05/2026', tat:'24 Hours', remark:'PO #KKB-2026-112 received',                       status:'Done' },
  { id:24, oppId:'OPP-015', oppDate:'04/05/2026', subject:'Re-engagement follow-up — Pacific Commodities',    setDate:'05/05/2026', tat:'1 Week',   remark:'New enquiry initiated by buyer',                  status:'Done' },
  { id:25, oppId:'OPP-016', oppDate:'05/05/2026', subject:'Payment receipt confirmation — TFC Nigeria',       setDate:'06/05/2026', tat:'24 Hours', remark:'SWIFT copy received and reconciled',              status:'Done' },
  { id:26, oppId:'OPP-018', oppDate:'06/05/2026', subject:'COA document sharing with buyer',                  setDate:'07/05/2026', tat:'48 Hours', remark:'PDF shared via email on 07/05',                   status:'Done' },
  { id:27, oppId:'OPP-019', oppDate:'07/05/2026', subject:'Credit note issuance — short shipment claim',      setDate:'08/05/2026', tat:'72 Hours', remark:'CN #2026-087 issued and accepted',                status:'Done' },
  { id:28, oppId:'OPP-020', oppDate:'08/05/2026', subject:'Stock availability check — Rajesh Oils',           setDate:'09/05/2026', tat:'24 Hours', remark:'Confirmed 50MT available in warehouse',           status:'Done' },
  { id:29, oppId:'OPP-021', oppDate:'09/05/2026', subject:'Advance payment follow-up — Casablanca Foods',     setDate:'10/05/2026', tat:'48 Hours', remark:'30% TT received on 10/05',                        status:'Done' },
  { id:30, oppId:'OPP-023', oppDate:'10/05/2026', subject:'Order confirmation acknowledgement',               setDate:'11/05/2026', tat:'24 Hours', remark:'Buyer acknowledged via email',                    status:'Done' },
];

const SEED_MEETINGS: Meeting[] = [
  { id:1,  code:'M-001', oppId:'OPP-028', customer:'Shree Exports',        email:'shreeyashmote.ai@gmail.com', contact:'9011033445',       platform:'Zoom',            date:'02/05/2026', startTime:'10:00', endTime:'11:00', link:'https://zoom.us/j/123456789',           venue:'', agenda:'Product requirement and quotation discussion',       status:'In Progress', type:'virtual' },
  { id:2,  code:'M-002', oppId:'OPP-001', customer:'GreenHarvest Global',  email:'r.vardhan@gmail.com',        contact:'+91 91234 56789',  platform:'Google Meet',     date:'05/05/2026', startTime:'10:00', endTime:'11:00', link:'https://meet.google.com/abc-defg-hij',  venue:'', agenda:'Catalogue review and pricing discussion',            status:'In Progress', type:'virtual' },
  { id:3,  code:'M-003', oppId:'OPP-004', customer:'Mujahed Al-Rashid',    email:'aboodmujahed6@gmail.com',    contact:'+962-786919870',   platform:'Zoom',            date:'07/05/2026', startTime:'14:00', endTime:'15:00', link:'https://zoom.us/j/987654321',           venue:'', agenda:'Price negotiation for Turkish Dry Fig',              status:'Done',        type:'virtual' },
  { id:4,  code:'M-004', oppId:'OPP-008', customer:'Zhang Wei',            email:'zhangwei@example.com',       contact:'+86-13812345678',  platform:'Microsoft Teams', date:'08/05/2026', startTime:'09:00', endTime:'10:30', link:'https://teams.microsoft.com/meet/abc',  venue:'', agenda:'Basmati rice specification review',                  status:'Done',        type:'virtual' },
  { id:5,  code:'M-005', oppId:'OPP-009', customer:'James Okoye',          email:'james.okoye@mail.com',       contact:'+234-8012345678',  platform:'Zoom',            date:'10/05/2026', startTime:'15:00', endTime:'16:00', link:'https://zoom.us/j/111222333',           venue:'', agenda:'Cashew quality and grade requirements',              status:'In Progress', type:'virtual' },
  { id:6,  code:'M-006', oppId:'OPP-010', customer:'Ayesha Raza',          email:'ayesha.raza@pk.com',         contact:'+92-3012345678',   platform:'Google Meet',     date:'12/05/2026', startTime:'11:00', endTime:'12:00', link:'https://meet.google.com/xyz-abcd-efg',  venue:'', agenda:'Final order confirmation call',                      status:'Done',        type:'virtual' },
  { id:7,  code:'M-007', oppId:'OPP-016', customer:'Sarah Patel',          email:'sarah.patel@us.com',         contact:'+1-4155551234',    platform:'Zoom',            date:'15/05/2026', startTime:'18:00', endTime:'19:00', link:'https://zoom.us/j/444555666',           venue:'', agenda:'Turmeric powder export requirements',                status:'Postponed',   type:'virtual' },
  { id:8,  code:'M-008', oppId:'OPP-017', customer:'Mohamed Aziz',         email:'m.aziz@eg.net',              contact:'+20-1012345678',   platform:'Phone Call',      date:'17/05/2026', startTime:'10:00', endTime:'10:30', link:'tel:+201012345678',                     venue:'', agenda:'Cotton yarn specifications call',                    status:'Cancelled',   type:'virtual' },
  { id:9,  code:'M-009', oppId:'OPP-011', customer:'Fatima Al-Hassan',     email:'fatima.hassan@sa.com',       contact:'+966-512345678',   platform:'Microsoft Teams', date:'19/05/2026', startTime:'13:00', endTime:'14:00', link:'https://teams.microsoft.com/meet/def',  venue:'', agenda:'Brown rice export and certification',                status:'In Progress', type:'virtual' },
  { id:10, code:'M-010', oppId:'OPP-012', customer:'Luca Bianchi',         email:'luca.bianchi@it.com',        contact:'+39-3456789012',   platform:'Zoom',            date:'21/05/2026', startTime:'16:00', endTime:'17:00', link:'https://zoom.us/j/777888999',           venue:'', agenda:'Organic turmeric bulk order review',                 status:'In Progress', type:'virtual' },
  { id:11, code:'M-011', oppId:'OPP-013', customer:'Hana Kim',             email:'hana.kim@koreafood.kr',      contact:'+82-1012345678',   platform:'Zoom',            date:'23/05/2026', startTime:'09:00', endTime:'10:00', link:'https://zoom.us/j/888999000',           venue:'', agenda:'Korean market entry for sesame oil',                 status:'In Progress', type:'virtual' },
  { id:12, code:'M-012', oppId:'OPP-014', customer:'Tariq Al-Mansoori',    email:'tariq@mansoorigroup.ae',     contact:'+971-561234567',   platform:'Google Meet',     date:'27/05/2026', startTime:'11:00', endTime:'12:30', link:'https://meet.google.com/pqr-stuv-wxy',  venue:'', agenda:'Dates and dry fruit export volume discussion',       status:'Done',        type:'virtual' },
  { id:13, code:'P-001', oppId:'OPP-030', customer:'Raj Commodities',      email:'raj@rajcommodities.com',     contact:'+91-9876543210',   platform:'Office Visit',    date:'02/05/2026', startTime:'10:00', endTime:'11:30', link:'', venue:'Mumbai Head Office, 4th Floor, BKC',     agenda:'Annual trade review and contract renewal',            status:'In Progress', type:'physical' },
  { id:14, code:'P-002', oppId:'OPP-031', customer:'Ahmed Al-Farsi',       email:'ahmed@alfarsi.ae',           contact:'+971-501234567',   platform:'Client Site',     date:'05/05/2026', startTime:'14:00', endTime:'15:30', link:'', venue:'Al Farsi Trading, Dubai, UAE',           agenda:'Spice export contract discussion',                    status:'Done',        type:'physical' },
  { id:15, code:'P-003', oppId:'OPP-033', customer:'Priya Exports Ltd',    email:'priya@priyaexports.in',      contact:'+91-8765432109',   platform:'Office Visit',    date:'08/05/2026', startTime:'09:30', endTime:'11:00', link:'', venue:'Priya Exports, MIDC Pune',               agenda:'Bulk cashew order negotiation',                       status:'In Progress', type:'physical' },
  { id:16, code:'P-004', oppId:'OPP-034', customer:'Carlos Mendez',        email:'carlos@agromex.mx',          contact:'+52-5512345678',   platform:'Trade Fair',      date:'10/05/2026', startTime:'11:00', endTime:'12:00', link:'', venue:'Agrofood Mexico Expo, CDMX',             agenda:'Sesame and groundnut product showcase',               status:'Done',        type:'physical' },
  { id:17, code:'P-005', oppId:'OPP-035', customer:'Kofi Boateng',         email:'kofi@boatengtraders.gh',     contact:'+233-244123456',   platform:'Client Site',     date:'13/05/2026', startTime:'15:00', endTime:'16:30', link:'', venue:'Boateng Traders, Accra, Ghana',          agenda:'Soybean and corn import requirements',                status:'In Progress', type:'physical' },
  { id:18, code:'P-006', oppId:'OPP-036', customer:'Mei Lin Trading',      email:'mei@meilintrading.cn',       contact:'+86-2112345678',   platform:'Office Visit',    date:'16/05/2026', startTime:'13:00', endTime:'14:30', link:'', venue:'Mei Lin Trading, Shanghai',              agenda:'Rice specification and quality audit',                status:'Postponed',   type:'physical' },
  { id:19, code:'P-007', oppId:'OPP-037', customer:'Hans Gruber GmbH',     email:'hans@gruberfood.de',         contact:'+49-3012345678',   platform:'Trade Fair',      date:'20/05/2026', startTime:'10:30', endTime:'12:00', link:'', venue:'Anuga Trade Fair, Cologne, Germany',     agenda:'Organic spice range presentation',                    status:'In Progress', type:'physical' },
  { id:20, code:'P-008', oppId:'OPP-038', customer:'Nadia Khoury',         email:'nadia@khouryfood.lb',        contact:'+961-71123456',    platform:'Client Site',     date:'22/05/2026', startTime:'09:00', endTime:'10:00', link:'', venue:'Khoury Food, Beirut, Lebanon',           agenda:'Dried fruit and nut bulk order',                      status:'Cancelled',   type:'physical' },
  { id:21, code:'P-009', oppId:'OPP-039', customer:'Sunita Agrotech',      email:'sunita@sunita.in',           contact:'+91-7654321098',   platform:'Office Visit',    date:'24/05/2026', startTime:'11:00', endTime:'12:30', link:'', venue:'Sunita Agrotech, Nasik, Maharashtra',    agenda:'Grape and pomegranate export discussion',             status:'Done',        type:'physical' },
  { id:22, code:'P-010', oppId:'OPP-040', customer:'Ibrahim Diallo',       email:'ibrahim@diallogroup.sn',     contact:'+221-771234567',   platform:'Client Site',     date:'27/05/2026', startTime:'14:00', endTime:'15:00', link:'', venue:'Diallo Group Office, Dakar, Senegal',    agenda:'Millet and sorghum export inquiry',                   status:'In Progress', type:'physical' },
  { id:23, code:'P-011', oppId:'OPP-041', customer:'Elena Vasquez',        email:'elena@vasquezfood.es',       contact:'+34-6112345678',   platform:'Trade Fair',      date:'29/05/2026', startTime:'10:00', endTime:'11:30', link:'', venue:'Alimentaria Barcelona, Spain',           agenda:'Olive oil and paprika bulk enquiry',                  status:'In Progress', type:'physical' },
  { id:24, code:'P-012', oppId:'OPP-042', customer:'Ravi Shankar Foods',   email:'ravi@ravishankar.in',        contact:'+91-9123456789',   platform:'Office Visit',    date:'30/05/2026', startTime:'15:00', endTime:'16:30', link:'', venue:'Ravi Shankar Foods, Indore, MP',         agenda:'New season groundnut contract signing',               status:'Done',        type:'physical' },
];

const REMINDER_FILTERS: { key: ReminderFilter; label: string; icon: React.ReactNode }[] = [
  { key: 'today',       label: "Today's Priority", icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg> },
  { key: 'all',         label: 'All Reminders',    icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg> },
  { key: 'In Progress', label: 'In Progress',      icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> },
  { key: 'Done',        label: 'Completed',        icon: <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> },
];

const MEETING_FILTERS: { key: MeetingStatus; label: string; icon: React.ReactNode }[] = [
  { key: 'In Progress', label: 'In Progress', icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg> },
  { key: 'Done',        label: 'Done',        icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12"/></svg> },
  { key: 'Postponed',   label: 'Postponed',   icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg> },
  { key: 'Cancelled',   label: 'Cancelled',   icon: <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg> },
];

const TAT_OPTIONS  = ['24 Hours', '48 Hours', '72 Hours', '1 Week', '2 Weeks'];
const VIRTUAL_PLATFORMS  = ['Zoom', 'Google Meet', 'Microsoft Teams', 'Webex', 'Phone Call'];
const PHYSICAL_PLATFORMS = ['Office Visit', 'Client Site', 'Trade Fair', 'Conference', 'Factory Visit', 'Port Visit'];
const ROWS_OPTIONS = [10, 25];

/* Loose shape — the modal renders one of two field-sets at a time, so the
 * union of every possible field is the simplest accurate type. Using
 * Partial<Reminder & Meeting> would over-constrain `status` (the intersection
 * of the two literal-string unions). */
type FormShape = {
  editId?: number | null;
  // common
  oppId?: string;
  status?: string;
  // reminder-only
  oppDate?: string;
  subject?: string;
  setDate?: string;
  tat?: string;
  remark?: string;
  attachmentName?: string;
  // meeting-only
  code?: string;
  customer?: string;
  email?: string;
  contact?: string;
  platform?: string;
  date?: string;
  startTime?: string;
  endTime?: string;
  link?: string;
  venue?: string;
  agenda?: string;
  type?: MeetingSub;
};

export default function SalesTodo() {
  const toast = useToast();
  const { user } = useAuth();
  const isSuperAdmin = user?.user_type === 'super_admin';
  const perm = user?.permissions?.['sales.todo'];
  const canView = isSuperAdmin || perm?.can_view !== false;
  const canAdd  = isSuperAdmin || !!perm?.can_add;
  const canEdit = isSuperAdmin || !!perm?.can_edit;
  const canDel  = isSuperAdmin || !!perm?.can_delete;

  const [reminders, setReminders] = useState<Reminder[]>(SEED_REMINDERS);
  const [meetings,  setMeetings]  = useState<Meeting[]>(SEED_MEETINGS);

  const [tab, setTab]             = useState<TopTab>('reminder');
  const [meetingSub, setMeetingSub] = useState<MeetingSub>('virtual');
  const [reminderFilter, setReminderFilter] = useState<ReminderFilter>('today');
  const [meetingFilter, setMeetingFilter]   = useState<MeetingStatus>('In Progress');
  const [q, setQ]                 = useState('');
  const [page, setPage]           = useState(1);
  const [rpp, setRpp]             = useState(10);

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm]           = useState<FormShape>({});
  const [formError, setFormError] = useState('');

  // Calendar view state
  const [view, setView] = useState<'list' | 'calendar'>('list');
  const todayDate = useMemo(() => {
    const [d, m, y] = TODAY_STR.split('/').map(n => parseInt(n, 10));
    return { d, m: m - 1, y };
  }, []);
  const [calYear,  setCalYear]  = useState(todayDate.y);
  const [calMonth, setCalMonth] = useState(todayDate.m);
  const [popover, setPopover]   = useState<{ dateKey: string; x: number; y: number } | null>(null);

  // Inject Google Fonts (DM Sans + Inter) once on mount.
  useEffect(() => {
    const id = 'sm-td-fonts';
    if (document.getElementById(id)) return;
    const link = document.createElement('link');
    link.id = id; link.rel = 'stylesheet';
    link.href = 'https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600;700;800&family=Inter:wght@400;500;600;700;800&display=swap';
    document.head.appendChild(link);
  }, []);

  /* ── Reminder filtering ── */
  const filteredReminders = useMemo(() => {
    let rows = reminders;
    if (reminderFilter === 'today')         rows = rows.filter(r => r.setDate === TODAY_STR && r.status === 'In Progress');
    else if (reminderFilter === 'all')      rows = rows;
    else                                    rows = rows.filter(r => r.status === reminderFilter);
    if (q) {
      const lo = q.toLowerCase();
      rows = rows.filter(r =>
        r.subject.toLowerCase().includes(lo) ||
        r.oppId.toLowerCase().includes(lo) ||
        r.setDate.includes(lo) ||
        r.remark.toLowerCase().includes(lo)
      );
    }
    return rows;
  }, [reminders, reminderFilter, q]);

  /* ── Meeting filtering ── */
  const filteredMeetings = useMemo(() => {
    let rows = meetings.filter(m => m.type === meetingSub && m.status === meetingFilter);
    if (q) {
      const lo = q.toLowerCase();
      rows = rows.filter(m =>
        m.customer.toLowerCase().includes(lo) ||
        m.oppId.toLowerCase().includes(lo) ||
        m.code.toLowerCase().includes(lo) ||
        m.date.includes(lo) ||
        m.agenda.toLowerCase().includes(lo)
      );
    }
    return rows;
  }, [meetings, meetingSub, meetingFilter, q]);

  /* ── Calendar pipeline (uses current top-tab + meeting sub-tab) ── */
  type CalItem = { key: string; date: string; title: string; status: string; ref: Reminder | Meeting };
  const calendarItems: CalItem[] = useMemo(() => {
    if (tab === 'reminder') {
      return reminders.map(r => ({ key: `r-${r.id}`, date: r.setDate, title: r.subject, status: r.status, ref: r }));
    }
    return meetings
      .filter(m => m.type === meetingSub)
      .map(m => ({ key: `m-${m.id}`, date: m.date, title: m.customer, status: m.status, ref: m }));
  }, [tab, reminders, meetings, meetingSub]);

  const calendarMap = useMemo(() => {
    const map: Record<string, CalItem[]> = {};
    calendarItems.forEach(it => {
      if (!it.date) return;
      (map[it.date] ||= []).push(it);
    });
    return map;
  }, [calendarItems]);

  const monthStats = useMemo(() => {
    const mk = `${String(calMonth + 1).padStart(2, '0')}/${calYear}`;
    const inMonth = calendarItems.filter(it => it.date && it.date.slice(3) === mk);
    return {
      total: inMonth.length,
      inProgress: inMonth.filter(it => it.status === 'In Progress').length,
      done: inMonth.filter(it => it.status === 'Done').length,
    };
  }, [calendarItems, calYear, calMonth]);

  /* ── Counts for filter chip badges ── */
  const reminderCounts = useMemo(() => ({
    today:        reminders.filter(r => r.setDate === TODAY_STR && r.status === 'In Progress').length,
    all:          reminders.length,
    'In Progress': reminders.filter(r => r.status === 'In Progress').length,
    Done:         reminders.filter(r => r.status === 'Done').length,
  }), [reminders]);

  const meetingTypeCounts = useMemo(() => ({
    virtual:  meetings.filter(m => m.type === 'virtual').length,
    physical: meetings.filter(m => m.type === 'physical').length,
  }), [meetings]);

  const meetingStatusCounts = useMemo(() => {
    const subset = meetings.filter(m => m.type === meetingSub);
    return {
      'In Progress': subset.filter(m => m.status === 'In Progress').length,
      Done:          subset.filter(m => m.status === 'Done').length,
      Postponed:     subset.filter(m => m.status === 'Postponed').length,
      Cancelled:     subset.filter(m => m.status === 'Cancelled').length,
    };
  }, [meetings, meetingSub]);

  const filtered = tab === 'reminder' ? filteredReminders : filteredMeetings;
  const total = filtered.length;
  const pages = Math.max(1, Math.ceil(total / rpp));
  const safePage = Math.min(page, pages);
  const startIdx = (safePage - 1) * rpp;
  const rows = filtered.slice(startIdx, startIdx + rpp);

  /* ── Actions ── */
  const switchTab = (next: TopTab) => {
    setTab(next);
    setPage(1);
    setQ('');
    if (next === 'meeting') {
      setMeetingSub('virtual');
      setMeetingFilter('In Progress');
    } else {
      setReminderFilter('today');
    }
  };

  const openAdd = () => {
    if (!canAdd) return;
    setForm(tab === 'reminder'
      ? { editId: null, oppId:'', oppDate: TODAY_STR, subject:'', setDate: TODAY_STR, tat:'24 Hours', remark:'', status:'In Progress' }
      : { editId: null, code:'', oppId:'', customer:'', email:'', contact:'', platform:'Zoom', date: TODAY_STR, startTime:'10:00', endTime:'11:00', link:'', venue:'', agenda:'', status:'In Progress', type: meetingSub });
    setFormError('');
    setModalOpen(true);
  };

  const openEdit = (record: Reminder | Meeting) => {
    if (!canEdit) return;
    setForm({ ...record, editId: record.id });
    setFormError('');
    setModalOpen(true);
  };

  const close = () => { setModalOpen(false); setForm({}); };

  const setMark = (record: Reminder | Meeting, status: string) => {
    if (tab === 'reminder') {
      setReminders(prev => prev.map(r => r.id === record.id ? { ...r, status: status as Reminder['status'] } : r));
    } else {
      setMeetings(prev => prev.map(m => m.id === record.id ? { ...m, status: status as MeetingStatus } : m));
    }
    toast.success('Updated', `Marked as ${status}`);
  };

  const del = (record: Reminder | Meeting) => {
    if (!canDel) return;
    if (tab === 'reminder') setReminders(prev => prev.filter(r => r.id !== record.id));
    else                    setMeetings(prev => prev.filter(m => m.id !== record.id));
    toast.info('Deleted', tab === 'reminder' ? (record as Reminder).subject : (record as Meeting).code);
  };

  const save = () => {
    setFormError('');
    if (tab === 'reminder') {
      if (!form.subject || !form.subject.trim()) { setFormError('Subject is required.'); return; }
      if (!form.setDate)                          { setFormError('Set date is required.'); return; }
      if (form.editId) {
        setReminders(prev => prev.map(r => r.id === form.editId
          ? { ...r, oppId: form.oppId || '', oppDate: form.oppDate || '', subject: form.subject!, setDate: form.setDate!, tat: form.tat || '24 Hours', remark: form.remark || '', status: (form.status as Reminder['status']) || 'In Progress' }
          : r));
        toast.success('Saved', 'Reminder updated');
      } else {
        const nextId = (reminders[reminders.length - 1]?.id ?? 0) + 1;
        const rec: Reminder = {
          id: nextId, oppId: form.oppId || '', oppDate: form.oppDate || '', subject: form.subject!,
          setDate: form.setDate!, tat: form.tat || '24 Hours', remark: form.remark || '',
          status: (form.status as Reminder['status']) || 'In Progress',
        };
        setReminders(prev => [...prev, rec]);
        toast.success('Added', 'Reminder created');
      }
    } else {
      if (!form.customer || !form.customer.trim()) { setFormError('Customer is required.'); return; }
      if (!form.date)                              { setFormError('Date is required.'); return; }
      if (form.editId) {
        setMeetings(prev => prev.map(m => m.id === form.editId
          ? { ...m,
              code: form.code || m.code, oppId: form.oppId || '', customer: form.customer!, email: form.email || '',
              contact: form.contact || '', platform: form.platform || 'Zoom', date: form.date!,
              startTime: form.startTime || '10:00', endTime: form.endTime || '11:00',
              link: form.link || '', venue: form.venue || '', agenda: form.agenda || '',
              status: (form.status as MeetingStatus) || 'In Progress',
              type: (form.type as MeetingSub) || meetingSub }
          : m));
        toast.success('Saved', 'Meeting updated');
      } else {
        const nextId = (meetings[meetings.length - 1]?.id ?? 0) + 1;
        const prefix = meetingSub === 'virtual' ? 'M' : 'P';
        const num = String(nextId).padStart(3, '0');
        const rec: Meeting = {
          id: nextId, code: form.code || `${prefix}-${num}`, oppId: form.oppId || '', customer: form.customer!,
          email: form.email || '', contact: form.contact || '', platform: form.platform || 'Zoom',
          date: form.date!, startTime: form.startTime || '10:00', endTime: form.endTime || '11:00',
          link: form.link || '', venue: form.venue || '', agenda: form.agenda || '',
          status: (form.status as MeetingStatus) || 'In Progress', type: meetingSub,
        };
        setMeetings(prev => [...prev, rec]);
        toast.success('Added', 'Meeting created');
      }
    }
    close();
  };

  /* ── No-access ── */
  if (!canView) {
    return (
      <div className="td-root">
        <style>{SCOPED_CSS}</style>
        <div className="td-no-access">
          <div className="td-no-access-title">No access</div>
          <div className="td-no-access-sub">You don't have permission to view the To-Do board. Ask your branch admin to grant <strong>can_view</strong> on Sales Matrix → To-Do.</div>
        </div>
      </div>
    );
  }

  const isToday = (d: string) => d === TODAY_STR;

  return (
    <div className="td-root">
      <style>{SCOPED_CSS}</style>

      {/* ── Header with tabs ── */}
      <div className="td-header">
        <span className="td-header-glow" />
        <div className="td-header-icon">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
            <path d="M9 11l3 3L22 4" /><path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
          </svg>
        </div>
        <div className="td-header-text">
          <div className="td-header-title">Productivity Tracker</div>
          <div className="td-header-sub">Manage your tasks, meetings and daily reminders</div>
        </div>
        <div className="td-tabs">
          <button
            className={`td-tab ${tab === 'reminder' ? 'td-tab-active' : ''}`}
            onClick={() => switchTab('reminder')}
          >Reminder</button>
          <button
            className={`td-tab ${tab === 'meeting' ? 'td-tab-active' : ''}`}
            onClick={() => switchTab('meeting')}
          >Meeting</button>
        </div>
      </div>

      {/* ── Toolbar ── */}
      <div className="td-toolbar">
        <div className="td-toolbar-row">
          <div className="td-filters">
            {tab === 'reminder' ? (
              REMINDER_FILTERS.map(f => {
                const active = reminderFilter === f.key;
                return (
                  <button
                    key={f.key}
                    className={`td-sf ${active ? 'active' : ''}`}
                    onClick={() => { setReminderFilter(f.key); setPage(1); }}
                  >
                    {f.icon}
                    {f.label}
                    <span className={`td-sf-count ${active ? 'td-sf-count-active' : ''}`}>{reminderCounts[f.key]}</span>
                  </button>
                );
              })
            ) : (
              <>
                <button
                  className={`td-meeting-pill ${meetingSub === 'virtual' ? 'active' : ''}`}
                  onClick={() => { setMeetingSub('virtual'); setMeetingFilter('In Progress'); setPage(1); }}
                >
                  <IconCam />
                  Virtual Meetings
                  <span className={`td-pill-count ${meetingSub === 'virtual' ? 'td-pill-count-active' : ''}`}>{meetingTypeCounts.virtual}</span>
                </button>
                <button
                  className={`td-meeting-pill ${meetingSub === 'physical' ? 'active' : ''}`}
                  onClick={() => { setMeetingSub('physical'); setMeetingFilter('In Progress'); setPage(1); }}
                >
                  <IconPin />
                  Physical Meetings
                  <span className={`td-pill-count ${meetingSub === 'physical' ? 'td-pill-count-active' : ''}`}>{meetingTypeCounts.physical}</span>
                </button>
              </>
            )}
            <div className="td-view-toggle">
              <button
                className={`td-view-btn ${view === 'list' ? 'active' : ''}`}
                title="List View"
                onClick={() => setView('list')}
              >
                <IconList />
                List
              </button>
              <button
                className={`td-view-btn ${view === 'calendar' ? 'active' : ''}`}
                title="Calendar View"
                onClick={() => { setView('calendar'); setPopover(null); }}
              >
                <IconCal />
                Calendar
              </button>
            </div>
          </div>
          <div className="td-toolbar-right">
            <div className="td-search-wrap">
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#99c9c4" strokeWidth="2.3">
                <circle cx="11" cy="11" r="8" /><path d="m21 21-4.35-4.35" />
              </svg>
              <input
                type="text"
                placeholder="Search..."
                value={q}
                onChange={e => { setQ(e.target.value); setPage(1); }}
              />
            </div>
            <div className="td-rows-sel">
              Rows:
              <select value={rpp} onChange={e => { setRpp(parseInt(e.target.value, 10)); setPage(1); }}>
                {ROWS_OPTIONS.map(n => <option key={n} value={n}>{n}</option>)}
              </select>
            </div>
            {canAdd && (
              <button className="td-add-btn" onClick={openAdd}>
                <IconPlus />
                {tab === 'reminder' ? 'Add Reminder' : 'Add Meeting'}
              </button>
            )}
          </div>
        </div>

        {/* Meeting status sub-filter row (only shown for Meeting tab) */}
        {tab === 'meeting' && (
          <div className="td-meeting-status-row">
            <span className="td-meeting-status-label">
              {meetingSub === 'virtual' ? '💻 VIRTUAL —' : '🏢 PHYSICAL —'}
            </span>
            {MEETING_FILTERS.map(f => {
              const active = meetingFilter === f.key;
              return (
                <button
                  key={f.key}
                  className={`td-sf ${active ? 'active' : ''}`}
                  style={{ height: 34 }}
                  onClick={() => { setMeetingFilter(f.key); setPage(1); }}
                >
                  {f.icon}
                  {f.label}
                  <span className={`td-sf-count td-sf-count-sm ${active ? 'td-sf-count-active' : ''}`}>{meetingStatusCounts[f.key]}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* ── Calendar View ── */}
      {view === 'calendar' && (
        <CalendarSection
          tab={tab}
          meetingSub={meetingSub}
          calYear={calYear}
          calMonth={calMonth}
          calendarMap={calendarMap}
          monthStats={monthStats}
          todayDate={todayDate}
          onPrev={() => {
            setCalMonth(m => {
              if (m === 0) { setCalYear(y => y - 1); return 11; }
              return m - 1;
            });
            setPopover(null);
          }}
          onNext={() => {
            setCalMonth(m => {
              if (m === 11) { setCalYear(y => y + 1); return 0; }
              return m + 1;
            });
            setPopover(null);
          }}
          onToday={() => { setCalYear(todayDate.y); setCalMonth(todayDate.m); setPopover(null); }}
          popover={popover}
          setPopover={setPopover}
          onItemClick={(item) => {
            setPopover(null);
            openEdit(item.ref);
          }}
        />
      )}

      {/* ── Table ── */}
      {view === 'list' && (
      <div className="td-table-card">
        <div className="td-table-wrap">
          {tab === 'reminder' ? (
            <table className="td-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Sr No</th>
                  <th style={{ width: 110 }}>Opportunity ID</th>
                  <th>Reminder Subject</th>
                  <th style={{ width: 150 }}>Reminder Set Date</th>
                  <th style={{ width: 90 }}>TAT</th>
                  <th style={{ width: 120 }}>Status</th>
                  <th style={{ width: 120, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={7} className="td-empty">No reminders found</td></tr>
                )}
                {(rows as Reminder[]).map((r, i) => {
                  const today = isToday(r.setDate) && r.status === 'In Progress';
                  return (
                    <tr key={r.id} className={today ? 'td-today-row' : ''}>
                      <td><span className="td-sr-pill">{startIdx + i + 1}</span></td>
                      <td><span className="td-opp-id">{r.oppId}</span></td>
                      <td style={{ fontWeight: 500 }}>
                        {today && <span title="Today's Priority" style={{ color: '#0d9488', marginRight: 4 }}>🔔</span>}
                        {r.subject}
                      </td>
                      <td style={{ color: '#64748b' }}>
                        {r.setDate}
                        {today && <span className="td-today-pill">TODAY</span>}
                      </td>
                      <td style={{ color: '#64748b' }}>{r.tat}</td>
                      <td><StatusBadge status={r.status} /></td>
                      <td>
                        <div className="td-actions">
                          {canEdit && (
                            <Tooltip label="Edit">
                              <button className="td-ab td-ab-edit" aria-label="Edit" onClick={() => openEdit(r)}><IconEdit /></button>
                            </Tooltip>
                          )}
                          {r.status !== 'Done' && canEdit && (
                            <Tooltip label="Mark Done">
                              <button className="td-ab td-ab-done" aria-label="Mark Done" onClick={() => setMark(r, 'Done')}><IconCheck /></button>
                            </Tooltip>
                          )}
                          {canDel && (
                            <Tooltip label="Delete">
                              <button className="td-ab td-ab-del" aria-label="Delete" onClick={() => del(r)}><IconTrash /></button>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          ) : (
            <table className="td-table">
              <thead>
                <tr>
                  <th style={{ width: 60 }}>Sr No</th>
                  <th style={{ width: 110 }}>Meeting Code</th>
                  <th style={{ width: 110 }}>Opportunity ID</th>
                  <th>Customer Name</th>
                  <th>Customer Email</th>
                  <th style={{ width: 130 }}>Contact No</th>
                  <th style={{ width: 130 }}>{meetingSub === 'physical' ? 'Meeting Type' : 'Platform'}</th>
                  <th style={{ width: 110 }}>Meeting Date</th>
                  <th style={{ width: 110 }}>Time</th>
                  <th>{meetingSub === 'physical' ? 'Venue' : 'Meeting Link'}</th>
                  <th style={{ width: 120 }}>Status</th>
                  <th style={{ width: 170, textAlign: 'center' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.length === 0 && (
                  <tr><td colSpan={12} className="td-empty">No meetings found</td></tr>
                )}
                {(rows as Meeting[]).map((m, i) => {
                  const isPhys = m.type === 'physical';
                  return (
                    <tr key={m.id}>
                      <td><span className="td-sr-pill">{startIdx + i + 1}</span></td>
                      <td>
                        <span className="td-opp-id">{m.code}</span>
                        <span className={`td-mtg-type ${isPhys ? 'td-mtg-type-phys' : 'td-mtg-type-virt'}`}>
                          {isPhys ? '🏢 Physical' : '💻 Virtual'}
                        </span>
                      </td>
                      <td><span className="td-opp-id">{m.oppId}</span></td>
                      <td style={{ fontWeight: 600, color: '#1e293b' }}>{m.customer}</td>
                      <td style={{ color: '#64748b', fontSize: 11 }}>{m.email}</td>
                      <td style={{ color: '#64748b' }}>{m.contact}</td>
                      <td style={{ fontWeight: 500 }}>{m.platform}</td>
                      <td style={{ color: '#64748b' }}>{m.date}</td>
                      <td style={{ color: '#64748b' }}>{m.startTime}–{m.endTime}</td>
                      <td style={{ maxWidth: 200, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={isPhys ? (m.venue || '') : (m.link || '')}>
                        {isPhys
                          ? <span style={{ color: '#64748b', fontSize: 11 }}>{m.venue || '—'}</span>
                          : (m.link
                              ? <a href={m.link} target="_blank" rel="noreferrer" style={{ color: '#0d9488', fontSize: 11, textDecoration: 'none' }}>{m.link.length > 25 ? m.link.slice(0, 25) + '…' : m.link}</a>
                              : <span style={{ color: '#94a3b8' }}>—</span>)}
                      </td>
                      <td><StatusBadge status={m.status} /></td>
                      <td>
                        <div className="td-actions">
                          {isPhys ? (
                            <Tooltip label="View Location">
                              <button
                                className="td-ab td-ab-loc"
                                aria-label="View Location"
                                onClick={() => alert('Venue: ' + (m.venue || '—'))}
                              ><IconLocation /></button>
                            </Tooltip>
                          ) : (m.link && (
                            <Tooltip label="Join Meeting">
                              <a href={m.link} target="_blank" rel="noreferrer" className="td-ab td-ab-join" aria-label="Join Meeting"><IconVideo /></a>
                            </Tooltip>
                          ))}
                          {canEdit && (
                            <Tooltip label="Edit">
                              <button className="td-ab td-ab-edit" aria-label="Edit" onClick={() => openEdit(m)}><IconEdit /></button>
                            </Tooltip>
                          )}
                          {m.status === 'In Progress' && canEdit && (
                            <>
                              <Tooltip label="Mark Done">
                                <button className="td-ab td-ab-done" aria-label="Mark Done" onClick={() => setMark(m, 'Done')}><IconCheck /></button>
                              </Tooltip>
                              <Tooltip label="Postpone">
                                <button className="td-ab td-ab-post" aria-label="Postpone" onClick={() => setMark(m, 'Postponed')}><IconClock /></button>
                              </Tooltip>
                              <Tooltip label="Cancel">
                                <button className="td-ab td-ab-del" aria-label="Cancel" onClick={() => setMark(m, 'Cancelled')}><IconX /></button>
                              </Tooltip>
                            </>
                          )}
                          {canDel && (
                            <Tooltip label="Delete">
                              <button className="td-ab td-ab-del" aria-label="Delete" onClick={() => del(m)}><IconTrash /></button>
                            </Tooltip>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* Pagination */}
        <div className="td-pagination">
          <span className="td-pag-info">
            {total === 0
              ? 'Showing 0 of 0'
              : <>Showing <strong>{startIdx + 1}–{Math.min(startIdx + rpp, total)}</strong> of <strong>{total}</strong></>}
          </span>
          <div className="td-pag-btns">
            <button className="td-pg-btn" disabled={safePage <= 1} onClick={() => setPage(p => Math.max(1, p - 1))}>
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="15 18 9 12 15 6" /></svg>
              Prev
            </button>
            <span className="td-pag-range">{safePage} / {pages}</span>
            <button className="td-pg-btn" disabled={safePage >= pages || total === 0} onClick={() => setPage(p => Math.min(pages, p + 1))}>
              Next
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
        </div>
      </div>
      )}

      {/* ── Add / Edit Modal ── */}
      {modalOpen && (
        <div className="td-overlay" onMouseDown={close}>
          <div className="td-modal" onMouseDown={e => e.stopPropagation()}>
            <div className="td-modal-header">
              <div className="td-modal-header-left">
                <div className="td-modal-header-icon">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2">
                    <path d="M9 11l3 3L22 4" />
                    <path d="M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11" />
                  </svg>
                </div>
                <div>
                  <div className="td-modal-title">{form.editId ? 'Edit Task' : 'Add Task'}</div>
                  <div className="td-modal-sub">{tab === 'reminder' ? 'Reminder' : `${meetingSub === 'virtual' ? 'Virtual' : 'Physical'} Meeting`}</div>
                </div>
              </div>
              <button className="td-modal-close" onClick={close}>
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
            <div className="td-modal-body">
              {tab === 'reminder' ? (
                <>
                  {/* Reminder form — matches prototype layout */}
                  <div className="td-form-row">
                    <Field label="Opportunity ID" required>
                      <input className="td-inp" value={form.oppId || ''} onChange={e => setForm(p => ({ ...p, oppId: e.target.value }))} placeholder="e.g. OPP-028" />
                    </Field>
                    <Field label="Opportunity Date">
                      <input className="td-inp" type="date" value={toInputDate(form.oppDate)} onChange={e => setForm(p => ({ ...p, oppDate: fromInputDate(e.target.value) }))} />
                    </Field>
                  </div>
                  <div className="td-form-row">
                    <Field label="Status">
                      <select className="td-inp td-sel" value={form.status || 'In Progress'} onChange={e => setForm(p => ({ ...p, status: e.target.value as Reminder['status'] }))}>
                        <option value="In Progress">In Progress</option>
                        <option value="Done">Done</option>
                      </select>
                    </Field>
                    <Field label="Reminder Subject" required>
                      <input className="td-inp" value={form.subject || ''} onChange={e => setForm(p => ({ ...p, subject: e.target.value }))} placeholder="Subject" />
                    </Field>
                  </div>
                  <div className="td-form-row">
                    <Field label="Reminder Set Date" required>
                      <input className="td-inp" type="date" value={toInputDate(form.setDate)} onChange={e => setForm(p => ({ ...p, setDate: fromInputDate(e.target.value) }))} />
                    </Field>
                    <Field label="TAT" required>
                      <select className="td-inp td-sel" value={form.tat || ''} onChange={e => setForm(p => ({ ...p, tat: e.target.value }))}>
                        <option value="">Select TAT</option>
                        {TAT_OPTIONS.map(t => <option key={t} value={t}>{t}</option>)}
                      </select>
                    </Field>
                  </div>
                  <div className="td-form-row">
                    <div className="td-field">
                      <label className="td-label">Attachment</label>
                      <label htmlFor="tdF_attachment" className="td-file-drop">
                        <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#14b8a6" strokeWidth="2.2" style={{ flexShrink: 0 }}>
                          <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
                        </svg>
                        <span className="td-file-label">{form.attachmentName || 'Choose file…'}</span>
                      </label>
                      <input
                        type="file" id="tdF_attachment" style={{ display: 'none' }}
                        onChange={e => {
                          const f = e.target.files?.[0];
                          setForm(p => ({ ...p, attachmentName: f ? f.name : '' }));
                        }}
                      />
                    </div>
                    <Field label="Remark">
                      <textarea className="td-inp" rows={3} value={form.remark || ''} onChange={e => setForm(p => ({ ...p, remark: e.target.value }))} placeholder="Add a remark…" style={{ resize: 'none', minHeight: 72 }} />
                    </Field>
                  </div>
                </>
              ) : (
                <>
                  {/* Virtual/Physical toggle at top */}
                  <div className="td-mtg-toggle">
                    <button
                      type="button"
                      className={`td-mtg-toggle-btn ${meetingSub === 'virtual' ? 'active' : ''}`}
                      onClick={() => { setMeetingSub('virtual'); setForm(p => ({ ...p, type: 'virtual', platform: '' })); }}
                    >
                      <IconCam /> 💻 Virtual Meeting
                    </button>
                    <button
                      type="button"
                      className={`td-mtg-toggle-btn ${meetingSub === 'physical' ? 'active' : ''}`}
                      onClick={() => { setMeetingSub('physical'); setForm(p => ({ ...p, type: 'physical', platform: '' })); }}
                    >
                      <IconPin /> 🏢 Physical Meeting
                    </button>
                  </div>

                  <div className="td-form-row">
                    <Field label="Customer Name" required>
                      <input className="td-inp" value={form.customer || ''} onChange={e => setForm(p => ({ ...p, customer: e.target.value }))} placeholder="Customer name" />
                    </Field>
                    <Field label="Customer Email">
                      <input className="td-inp" type="email" value={form.email || ''} onChange={e => setForm(p => ({ ...p, email: e.target.value }))} placeholder="Email address" />
                    </Field>
                  </div>
                  <div className="td-form-row">
                    <Field label="Contact No" required>
                      <input className="td-inp" value={form.contact || ''} onChange={e => setForm(p => ({ ...p, contact: e.target.value }))} placeholder="Contact number" />
                    </Field>
                    <Field label={meetingSub === 'physical' ? 'Meeting Type' : 'Platform'} required>
                      <select className="td-inp td-sel" value={form.platform || ''} onChange={e => setForm(p => ({ ...p, platform: e.target.value }))}>
                        <option value="">{meetingSub === 'physical' ? 'Select type' : 'Select platform'}</option>
                        {(meetingSub === 'physical' ? PHYSICAL_PLATFORMS : VIRTUAL_PLATFORMS).map(p => <option key={p} value={p}>{p}</option>)}
                      </select>
                    </Field>
                  </div>
                  {meetingSub === 'virtual' ? (
                    <Field label="Meeting Link" required colSpan={2}>
                      <input className="td-inp" value={form.link || ''} onChange={e => setForm(p => ({ ...p, link: e.target.value }))} placeholder="https://..." />
                    </Field>
                  ) : (
                    <Field label="Place / Venue" required colSpan={2}>
                      <input className="td-inp" value={form.venue || ''} onChange={e => setForm(p => ({ ...p, venue: e.target.value }))} placeholder="e.g. Mumbai Head Office, BKC" />
                    </Field>
                  )}
                  <div className="td-form-row td-form-row-3">
                    <Field label="Meeting Date" required>
                      <input className="td-inp" type="date" value={toInputDate(form.date)} onChange={e => setForm(p => ({ ...p, date: fromInputDate(e.target.value) }))} />
                    </Field>
                    <Field label="Start Time" required>
                      <input className="td-inp" type="time" value={form.startTime || ''} onChange={e => setForm(p => ({ ...p, startTime: e.target.value }))} />
                    </Field>
                    <Field label="End Time" required>
                      <input className="td-inp" type="time" value={form.endTime || ''} onChange={e => setForm(p => ({ ...p, endTime: e.target.value }))} />
                    </Field>
                  </div>
                  <Field label="Meeting Agenda" required colSpan={2}>
                    <textarea className="td-inp" rows={2} value={form.agenda || ''} onChange={e => setForm(p => ({ ...p, agenda: e.target.value }))} placeholder="Meeting agenda..." style={{ resize: 'none', minHeight: 52 }} />
                  </Field>
                </>
              )}
              {formError && <div className="td-form-error">{formError}</div>}
            </div>
            <div className="td-modal-footer">
              <div className="td-footer-hint">
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><line x1="12" y1="8" x2="12" y2="12" /><line x1="12" y1="16" x2="12.01" y2="16" /></svg>
                Fields marked <span className="td-req">*</span> are required
              </div>
              <div className="td-footer-actions">
                <button className="td-btn-cancel" onClick={close}>Cancel</button>
                <button className="td-btn-save" onClick={save}>
                  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z" /></svg>
                  Save
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─────────────────────────────────────────────────────────────────────
 * Calendar view section.
 * Shown when `view === 'calendar'` in place of the list table.
 * Cell click opens a popover; pill click opens the edit modal.
 * ──────────────────────────────────────────────────────────────────── */
type CalItemForSection = { key: string; date: string; title: string; status: string; ref: Reminder | Meeting };
const CAL_MONTH_NAMES = ['January','February','March','April','May','June','July','August','September','October','November','December'];
const CAL_DAY_NAMES   = ['SUN','MON','TUE','WED','THU','FRI','SAT'];
const CAL_COLORS = [
  { bg:'#eff6ff', br:'#bfdbfe', bar:'#3b82f6', clr:'#1e40af' },
  { bg:'#f5f3ff', br:'#ddd6fe', bar:'#8b5cf6', clr:'#5b21b6' },
  { bg:'#fff7ed', br:'#fed7aa', bar:'#f97316', clr:'#9a3412' },
  { bg:'#fdf2f8', br:'#fbcfe8', bar:'#ec4899', clr:'#9d174d' },
  { bg:'#f0fdf4', br:'#bbf7d0', bar:'#22c55e', clr:'#166534' },
  { bg:'#fefce8', br:'#fef08a', bar:'#eab308', clr:'#854d0e' },
];
function calColor(s: string) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 37 + s.charCodeAt(i)) & 0xffff;
  return CAL_COLORS[h % CAL_COLORS.length];
}

function CalendarSection(props: {
  tab: TopTab;
  meetingSub: MeetingSub;
  calYear: number;
  calMonth: number;
  calendarMap: Record<string, CalItemForSection[]>;
  monthStats: { total: number; inProgress: number; done: number };
  todayDate: { d: number; m: number; y: number };
  onPrev: () => void;
  onNext: () => void;
  onToday: () => void;
  popover: { dateKey: string; x: number; y: number } | null;
  setPopover: (p: { dateKey: string; x: number; y: number } | null) => void;
  onItemClick: (item: CalItemForSection) => void;
}) {
  const { tab, meetingSub, calYear, calMonth, calendarMap, monthStats, todayDate,
          onPrev, onNext, onToday, popover, setPopover, onItemClick } = props;

  const firstDay  = new Date(calYear, calMonth, 1).getDay();          // 0 = Sun
  const daysIn    = new Date(calYear, calMonth + 1, 0).getDate();
  const prevDaysIn = new Date(calYear, calMonth, 0).getDate();
  const trailing = (7 - ((firstDay + daysIn) % 7)) % 7;

  const headerTitle = tab === 'meeting'
    ? (meetingSub === 'virtual' ? 'Virtual Meetings' : 'Physical Meetings')
    : 'Reminder Calendar';
  const headerSub = tab === 'meeting' ? 'Meeting Calendar' : 'Productivity Tracker';

  const onPillClick = (e: React.MouseEvent, dateKey: string) => {
    e.stopPropagation();
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    setPopover({ dateKey, x: rect.left + 8, y: rect.bottom + 8 });
  };

  // Close popover on outside click
  useEffect(() => {
    if (!popover) return;
    const handler = (ev: MouseEvent) => {
      const pop = document.getElementById('td-cal-popover');
      if (pop && !pop.contains(ev.target as Node)) setPopover(null);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popover, setPopover]);

  const cells: React.ReactNode[] = [];

  // Leading blanks (prev month)
  for (let b = 0; b < firstDay; b++) {
    const pD = prevDaysIn - firstDay + b + 1;
    cells.push(
      <div key={`p-${b}`} className="td-cal-cell td-cal-cell-out">
        <div className="td-cal-cell-out-num">{pD}</div>
      </div>
    );
  }

  // Current month
  for (let d = 1; d <= daysIn; d++) {
    const dd = String(d).padStart(2, '0');
    const mm = String(calMonth + 1).padStart(2, '0');
    const key = `${dd}/${mm}/${calYear}`;
    const items = calendarMap[key] || [];
    const dow = (firstDay + d - 1) % 7;
    const isToday = (d === todayDate.d && calMonth === todayDate.m && calYear === todayDate.y);
    const isWE = (dow === 0 || dow === 6);
    const cellCls = `td-cal-cell ${isToday ? 'td-cal-cell-today' : isWE ? 'td-cal-cell-weekend' : ''}`;
    const pills = items.slice(0, 3).map(it => {
      const c = calColor(it.ref.id + ':' + it.title);
      const short = it.title.length > 21 ? it.title.slice(0, 21) + '…' : it.title;
      return (
        <div
          key={it.key}
          className="td-cal-pill"
          style={{ background: c.bg, color: c.clr, borderLeft: `3px solid ${c.bar}` }}
          title={it.title}
          onClick={(e) => onPillClick(e, key)}
        >
          {short}
        </div>
      );
    });
    const more = items.length > 3 ? (
      <div className="td-cal-more" onClick={(e) => onPillClick(e, key)}>+{items.length - 3} more</div>
    ) : null;

    cells.push(
      <div key={`d-${d}`} className={cellCls}>
        {isWE && !isToday && <div className="td-cal-weekend-stripe" />}
        <div className="td-cal-cell-head">
          {isToday
            ? <div className="td-cal-today-num">{d}</div>
            : <div className={`td-cal-num ${isWE ? 'td-cal-num-we' : ''}`}>{d}</div>}
          {items.length > 0 && (
            <span className="td-cal-count">{items.length}</span>
          )}
        </div>
        {pills}
        {more}
      </div>
    );
  }

  // Trailing blanks
  for (let t = 0; t < trailing; t++) {
    cells.push(
      <div key={`t-${t}`} className="td-cal-cell td-cal-cell-out">
        <div className="td-cal-cell-out-num">{t + 1}</div>
      </div>
    );
  }

  // Popover content
  let popoverEl: React.ReactNode = null;
  if (popover) {
    const list = calendarMap[popover.dateKey] || [];
    const parts = popover.dateKey.split('/');
    const label = `${parts[0]} ${CAL_MONTH_NAMES[parseInt(parts[1], 10) - 1]} ${parts[2]}`;
    const inN = list.filter(i => i.status === 'In Progress').length;
    const dnN = list.filter(i => i.status === 'Done').length;
    popoverEl = (
      <div
        id="td-cal-popover"
        className="td-cal-popover"
        style={{
          left: Math.max(8, Math.min(popover.x, window.innerWidth - 360)),
          top:  Math.max(60, Math.min(popover.y, window.innerHeight - 340)),
        }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="td-cal-popover-hdr">
          <div>
            <div className="td-cal-popover-title">{label}</div>
            <div className="td-cal-popover-meta">
              <span className="td-cal-popover-chip">{list.length} {tab === 'meeting' ? 'Meeting' : 'Reminder'}{list.length !== 1 ? 's' : ''}</span>
              {inN > 0 && <span className="td-cal-popover-chip">{inN} In Progress</span>}
              {dnN > 0 && <span className="td-cal-popover-chip">{dnN} Done</span>}
            </div>
          </div>
          <button className="td-cal-popover-close" onClick={() => setPopover(null)} aria-label="Close">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>
        </div>
        <div className="td-cal-popover-list">
          {list.map(it => {
            const c = calColor(it.ref.id + ':' + it.title);
            const isDone = it.status === 'Done';
            return (
              <div key={it.key} className="td-cal-popover-row" onClick={() => onItemClick(it)}>
                <div className="td-cal-popover-bar" style={{ background: c.bar }} />
                <div className="td-cal-popover-body">
                  <div className="td-cal-popover-row-title">{it.title}</div>
                  <div className="td-cal-popover-row-meta">
                    {tab === 'meeting' ? (
                      <>
                        <span className="td-cal-popover-pill" style={{ color: c.clr, background: c.bg, border: `1px solid ${c.br}` }}>
                          {(it.ref as Meeting).code}
                        </span>
                        <span className="td-cal-popover-pill td-cal-popover-pill-muted">{(it.ref as Meeting).platform}</span>
                        <span className="td-cal-popover-pill td-cal-popover-pill-muted">
                          {(it.ref as Meeting).startTime}–{(it.ref as Meeting).endTime}
                        </span>
                      </>
                    ) : (
                      <>
                        <span className="td-cal-popover-pill" style={{ color: c.clr, background: c.bg, border: `1px solid ${c.br}` }}>
                          {(it.ref as Reminder).oppId}
                        </span>
                        <span className="td-cal-popover-pill td-cal-popover-pill-muted">{(it.ref as Reminder).tat}</span>
                      </>
                    )}
                    <span className={`td-cal-popover-status ${isDone ? 'td-cal-popover-status-done' : 'td-cal-popover-status-inprog'}`}>
                      {it.status}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="td-cal-topbar">
        <div className="td-cal-topbar-left">
          <div className="td-cal-topbar-icon">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2">
              <rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" />
              <line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" />
            </svg>
          </div>
          <div>
            <div className="td-cal-topbar-title">{headerTitle}</div>
            <div className="td-cal-topbar-sub">{headerSub}</div>
          </div>
          <div className="td-cal-topbar-divider" />
          <button className="td-cal-today-btn" onClick={onToday}>Today</button>
          <div className="td-cal-nav">
            <button onClick={onPrev} aria-label="Previous month">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><polyline points="15 18 9 12 15 6" /></svg>
            </button>
            <button onClick={onNext} aria-label="Next month">
              <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8"><polyline points="9 18 15 12 9 6" /></svg>
            </button>
          </div>
          <span className="td-cal-month-label">{CAL_MONTH_NAMES[calMonth]} {calYear}</span>
        </div>
        <div className="td-cal-topbar-right">
          <span className="td-cal-stat">{monthStats.total} this month</span>
          <span className="td-cal-stat td-cal-stat-inprog">{monthStats.inProgress} In Progress</span>
          <span className="td-cal-stat td-cal-stat-done">{monthStats.done} Done</span>
        </div>
      </div>

      <div className="td-cal-card">
        <div className="td-cal-day-hdr">
          {CAL_DAY_NAMES.map((d, i) => {
            const isTdHdr = (i === new Date().getDay() && calMonth === todayDate.m && calYear === todayDate.y);
            return <div key={d} className={`td-cal-day-hdr-cell ${isTdHdr ? 'td-cal-day-hdr-today' : ''} ${(i===0||i===6) ? 'td-cal-day-hdr-we' : ''}`}>{d}</div>;
          })}
        </div>
        <div className="td-cal-grid">{cells}</div>
      </div>

      {popoverEl}
    </>
  );
}

/* ── Form field helper ── */
function Field({ label, required, colSpan, children }: { label: string; required?: boolean; colSpan?: 1 | 2; children: React.ReactNode }) {
  return (
    <div className="td-field" style={colSpan === 2 ? { gridColumn: 'span 2' } : undefined}>
      <label className="td-label">{label} {required && <span className="td-req">*</span>}</label>
      {children}
    </div>
  );
}

/* ─── Date helpers: bridge dd/mm/yyyy ↔ HTML5 date input (yyyy-mm-dd) ─── */
function toInputDate(d?: string) {
  if (!d) return '';
  const p = d.split('/');
  if (p.length !== 3) return '';
  return `${p[2]}-${p[1]}-${p[0]}`;
}
function fromInputDate(d?: string) {
  if (!d) return '';
  const p = d.split('-');
  if (p.length !== 3) return '';
  return `${p[2]}/${p[1]}/${p[0]}`;
}

/* ─── Status badge (colored dot + text) ─── */
function StatusBadge({ status }: { status: string }) {
  const cls =
    status === 'Done' ? 'td-done' :
    status === 'In Progress' ? 'td-inprog' :
    status === 'Postponed' ? 'td-post' : 'td-cancel';
  return (
    <span className={`td-badge ${cls}`}>
      <span className="td-badge-dot" />
      {status}
    </span>
  );
}

/* ─── Icons ─── */
const IconPlus = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" /></svg>;
const IconX        = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>;
const IconLocation = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>;
const IconList = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><line x1="3" y1="6" x2="3.01" y2="6" /><line x1="3" y1="12" x2="3.01" y2="12" /><line x1="3" y1="18" x2="3.01" y2="18" /></svg>;
const IconCal  = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><rect x="3" y="4" width="18" height="18" rx="2" /><line x1="16" y1="2" x2="16" y2="6" /><line x1="8" y1="2" x2="8" y2="6" /><line x1="3" y1="10" x2="21" y2="10" /></svg>;
const IconCheck = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><polyline points="20 6 9 17 4 12" /></svg>;
const IconEdit  = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4z" /></svg>;
const IconTrash = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polyline points="3 6 5 6 21 6" /><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" /><path d="M10 11v6" /><path d="M14 11v6" /></svg>;
const IconVideo = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>;
const IconClock = () => <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.3"><circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" /></svg>;
const IconCam   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" ry="2" /></svg>;
const IconPin   = () => <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" /><circle cx="12" cy="10" r="3" /></svg>;

/* ─── Scoped CSS ─── */
const SCOPED_CSS = `
.td-root {
  font-family: 'DM Sans', 'Inter', system-ui, -apple-system, sans-serif;
  background: linear-gradient(160deg, #f0fdfa 0%, #ecfdf5 50%, #ffffff 100%);
  padding: 14px 18px 20px;
  margin: -1rem -0.75rem;
  min-height: calc(100vh - 70px);
  color: #111827;
  font-size: 13.5px;
  display: flex; flex-direction: column; gap: 0;
}
.td-root *, .td-root *::before, .td-root *::after { box-sizing: border-box; }

.td-no-access { background:#fff; border:1.5px solid #99f6e4; border-radius:14px; padding:28px; text-align:center; box-shadow:0 2px 10px rgba(20,184,166,.08); }
.td-no-access-title { font-size:16px; font-weight:800; color:#0d9488; }
.td-no-access-sub   { font-size:12px; color:#64748b; margin-top:8px; max-width:540px; margin-left:auto; margin-right:auto; line-height:1.55; }

/* Header */
.td-root .td-header {
  background: linear-gradient(100deg, #f0fdfa 0%, #ccfbf1 60%, #99f6e4 100%);
  border: 1px solid #5eead4; border-radius: 12px;
  padding: 0 16px 0 20px;
  display: flex; align-items: center; gap: 14px;
  margin-bottom: 10px; min-height: 58px;
  position: relative; overflow: hidden;
  box-shadow: 0 2px 12px rgba(20,184,166,.15);
}
.td-root .td-header-glow {
  position: absolute; right: -20px; top: -20px;
  width: 100px; height: 100px; border-radius: 50%;
  background: rgba(20,184,166,.08); pointer-events: none;
}
.td-root .td-header-icon {
  width: 40px; height: 40px; border-radius: 11px;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  display: flex; align-items: center; justify-content: center; flex-shrink: 0;
  box-shadow: 0 3px 10px rgba(13,148,136,.35);
}
.td-root .td-header-title { font-size:15px; font-weight:800; color:#3b0764; letter-spacing:-.3px; line-height:1.2; }
.td-root .td-header-sub   { font-size:11px; color:#0d9488; margin-top:2px; font-weight:500; opacity:.85; }
.td-root .td-header-text  { flex: 1; }
.td-root .td-tabs {
  margin-left:auto; display:flex; align-items:center; gap:3px;
  background: rgba(255,255,255,.55); padding: 3px;
  border-radius: 9px; border: 1px solid rgba(20,184,166,.3); z-index: 1;
}
.td-root .td-tab {
  padding: 9px 20px; border-radius: 8px; font-size:12.5px; font-weight:600;
  cursor: pointer; background: transparent; color: #0f766e;
  border: none; transition: all .15s; white-space: nowrap; font-family: inherit;
}
.td-root .td-tab:hover { color:#0d9488; background: rgba(20,184,166,.1); }
.td-root .td-tab-active { background: linear-gradient(135deg, #14b8a6, #0d9488); color: #fff; box-shadow: 0 2px 8px rgba(13,148,136,.35); }

/* Toolbar */
.td-root .td-toolbar { display:flex; flex-direction:column; gap:8px; margin-bottom:10px; }
.td-root .td-toolbar-row { display:flex; align-items:center; justify-content:space-between; gap:10px; flex-wrap: wrap; }
.td-root .td-filters { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
.td-root .td-sf {
  padding:5px 14px; border-radius:20px; font-size:11.5px; font-weight:600;
  cursor:pointer; border:1.5px solid #99f6e4; background:#f0fdfa; color:#0d9488;
  font-family:inherit; transition:all .15s;
  display:inline-flex; align-items:center; gap:5px;
}
.td-root .td-sf:hover { border-color:#14b8a6; background:#ccfbf1; color:#065f46; }
.td-root .td-sf.active { background: linear-gradient(135deg, #0d9488, #065f46); color:#fff; border-color:#065f46; box-shadow: 0 2px 8px rgba(13,148,136,.3); }

/* Filter chip count badge */
.td-root .td-sf-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 18px; height: 18px; padding: 0 5px;
  border-radius: 20px; font-size: 9.5px; font-weight: 800;
  background: #ccfbf1; color: #0d9488;
  margin-left: 2px;
}
.td-root .td-sf-count-sm { min-width: 16px; height: 16px; padding: 0 4px; font-size: 9px; background: rgba(13,148,136,.12); }
.td-root .td-sf-count-active { background: rgba(255,255,255,.25); color: #fff; }

/* Big Virtual/Physical pill buttons (primary filter for Meeting tab) */
.td-root .td-meeting-pill {
  display: inline-flex; align-items: center; gap: 7px;
  padding: 9px 20px; border-radius: 8px; border: 1.5px solid #99f6e4;
  font-family: inherit; font-size: 12.5px; font-weight: 700;
  background: #fff; color: #0d9488;
  cursor: pointer; transition: all .18s;
  height: 40px;
}
.td-root .td-meeting-pill:hover { background: #f0fdfa; }
.td-root .td-meeting-pill.active {
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff; border-color: #065f46;
  box-shadow: 0 2px 10px rgba(13,148,136,.3);
}
.td-root .td-pill-count {
  display: inline-flex; align-items: center; justify-content: center;
  min-width: 20px; height: 20px; padding: 0 5px;
  border-radius: 20px; font-size: 10px; font-weight: 800;
  background: #f0fdfa; color: #0d9488;
  margin-left: 2px;
}
.td-root .td-pill-count-active { background: rgba(255,255,255,.25); color: #fff; }

/* Meeting status sub-filter row (under primary pills) */
.td-root .td-meeting-status-row {
  display: flex; align-items: center; gap: 6px; flex-wrap: wrap;
  padding: 8px 14px;
  background: linear-gradient(90deg, #f0fdfa, #f8fffe);
  border-radius: 10px; border: 1.5px solid #e0f2f1;
}
.td-root .td-meeting-status-label {
  font-size: 10.5px; font-weight: 700; color: #0d9488;
  text-transform: uppercase; letter-spacing: .08em;
  margin-right: 4px; white-space: nowrap;
}

.td-root .td-view-toggle {
  display:flex; align-items:center; gap:2px;
  background: rgba(255,255,255,.7); padding:3px;
  border-radius: 8px; border: 1.5px solid #99f6e4; flex-shrink: 0;
}
.td-root .td-view-btn {
  display:inline-flex; align-items:center; gap:5px;
  padding:6px 12px; border-radius:6px; border:none;
  font-family:inherit; font-size:11.5px; font-weight:600;
  cursor:pointer; transition: all .15s;
  background: transparent; color: #0d9488;
}
.td-root .td-view-btn.active {
  background: linear-gradient(135deg, #0d9488, #065f46); color:#fff;
  box-shadow: 0 1px 4px rgba(13,148,136,.3);
}

.td-root .td-toolbar-right { display:flex; align-items:center; gap:8px; flex-shrink:0; flex-wrap: wrap; }
.td-root .td-search-wrap {
  display: flex; align-items: center;
  background: #fff;
  border: 1.5px solid #99f6e4;
  border-radius: 9px; padding: 7px 12px;
  gap: 7px; max-width: 280px; width: 100%;
  box-shadow: 0 1px 4px rgba(20,184,166,.07);
  transition: border-color .15s, box-shadow .15s;
}
.td-root .td-search-wrap:focus-within {
  border-color: #14b8a6;
  box-shadow: 0 0 0 3px rgba(20,184,166,.1);
}
.td-root .td-search-wrap svg { flex-shrink: 0; }
.td-root .td-search-wrap input {
  border: none; background: transparent;
  font-family: inherit; font-size: 11.5px;
  color: #1e293b; outline: none; width: 100%;
}
.td-root .td-search-wrap input::placeholder { color:#99c9c4; }
.td-root .td-add-btn {
  display:inline-flex; align-items:center; gap:6px;
  padding:11px 20px; border-radius:8px; border:none;
  background: linear-gradient(135deg, #14b8a6, #0d9488); color:#fff;
  font-family:inherit; font-size:12.5px; font-weight:700;
  cursor:pointer; box-shadow: 0 2px 8px rgba(13,148,136,.35);
  flex-shrink:0; transition: all .15s;
}
.td-root .td-add-btn:hover { transform: translateY(-1px); box-shadow: 0 4px 12px rgba(13,148,136,.45); }

/* Meeting sub-tab */
.td-root .td-meeting-sub {
  display: flex; gap: 6px;
  padding: 4px;
  background: rgba(255,255,255,.6);
  border: 1px solid #5eead4;
  border-radius: 10px;
  align-self: flex-start;
}
.td-root .td-sub-btn {
  display: inline-flex; align-items: center; gap: 6px;
  padding: 7px 16px; border-radius: 7px; border: none;
  background: transparent; color: #0d9488;
  font-family: inherit; font-size: 12px; font-weight: 600;
  cursor: pointer; transition: all .15s;
}
.td-root .td-sub-btn:hover { background: rgba(20,184,166,.1); }
.td-root .td-sub-btn.active {
  background: linear-gradient(135deg, #0d9488, #0f766e); color: #fff;
  box-shadow: 0 2px 6px rgba(13,148,136,.3);
}

/* Table card */
.td-root .td-table-card {
  background: #fff;
  border: 1.5px solid #99f6e4;
  border-radius: 14px;
  box-shadow: 0 4px 20px rgba(20,184,166,.1), 0 1px 4px rgba(0,0,0,.04);
  overflow: hidden;
  display: flex; flex-direction: column;
}
.td-root .td-table-wrap { overflow-x: auto; }
.td-root .td-table { width:100%; border-collapse: collapse; font-size: 11.5px; }
.td-root .td-table thead tr {
  background: linear-gradient(90deg, #14b8a6 0%, #0d9488 55%, #0f766e 100%);
  box-shadow: 0 2px 8px rgba(20,184,166,.2);
}
.td-root .td-table thead th {
  color: rgba(255,255,255,.95);
  font-size: 9.5px; font-weight: 700;
  padding: 10px 10px; letter-spacing: .06em; text-transform: uppercase;
  text-align: left; white-space: nowrap;
}
.td-root .td-table thead th:first-child { padding-left: 14px; }
.td-root .td-table tbody tr { border-bottom: 1px solid #f0fdfa; }
.td-root .td-table tbody tr:hover { background: #f0fdfa; }
.td-root .td-table tbody td { padding: 8px 10px; vertical-align: middle; color: #1e293b; }
.td-root .td-table tbody td:first-child { padding-left: 14px; }
.td-root .td-empty { text-align: center !important; padding: 36px !important; color: #94a3b8; font-style: italic; }

.td-root .td-today-row td { background: linear-gradient(90deg, #f0fdfa, #ecfdf5); }

.td-root .td-mono { font-family: 'JetBrains Mono', ui-monospace, monospace; color: #0d9488; font-weight: 600; font-size: 10.5px; }
.td-root .td-cust-sub { color: #94a3b8; font-size: 10px; margin-top: 2px; }

/* Sr No pill (rounded teal square) */
.td-root .td-sr-pill {
  display: inline-flex; align-items: center; justify-content: center;
  width: 22px; height: 22px; border-radius: 6px;
  background: #ccfbf1; color: #0d9488;
  font-size: 10.5px; font-weight: 700;
}
.td-root .td-today-row .td-sr-pill { color: #065f46; }

/* Opportunity / Meeting code label */
.td-root .td-opp-id {
  color: #0d9488; font-weight: 600;
}

/* TODAY indicator pill in Set Date column */
.td-root .td-today-pill {
  display: inline-block; margin-left: 4px;
  font-size: 9.5px; font-weight: 700;
  background: #ccfbf1; color: #065f46;
  padding: 1px 6px; border-radius: 8px;
  border: 1px solid #99f6e4;
}

/* Virtual/Physical type badge next to meeting code */
.td-root .td-mtg-type {
  display: inline-flex; align-items: center; gap: 3px;
  font-size: 9px; font-weight: 700;
  padding: 1px 6px; border-radius: 20px;
  margin-left: 4px;
}
.td-root .td-mtg-type-virt { background: #eff6ff; color: #1d4ed8; border: 1px solid #bfdbfe; }
.td-root .td-mtg-type-phys { background: #fef3c7; color: #d97706; border: 1px solid #fde68a; }

.td-root .td-tat-pill {
  display:inline-flex; align-items:center;
  padding: 2px 9px; border-radius: 20px;
  font-size: 10px; font-weight: 700;
  background: #ecfdf5; color: #047857; border: 1px solid #a7f3d0;
}
.td-root .td-platform-pill {
  display:inline-flex; align-items:center;
  padding: 2px 9px; border-radius: 20px;
  font-size: 10px; font-weight: 700;
  background: #f0f9ff; color: #0369a1; border: 1px solid #bae6fd;
}

.td-root .td-badge { display:inline-flex; align-items:center; gap:4px; padding:2px 9px; border-radius:20px; font-size:10.5px; font-weight:700; }
.td-root .td-badge-dot { width: 5px; height: 5px; border-radius: 50%; background: currentColor; }
.td-root .td-inprog { background:#dbeafe; color:#1d4ed8; border:1px solid #bfdbfe; }
.td-root .td-done   { background:#dcfce7; color:#15803d; border:1px solid #bbf7d0; }
.td-root .td-post   { background:#fef3c7; color:#92400e; border:1px solid #fde68a; }
.td-root .td-cancel { background:#fee2e2; color:#dc2626; border:1px solid #fecaca; }

.td-root .td-actions { display:flex; gap:5px; justify-content:center; align-items: center; }
.td-root .td-ab {
  width:26px; height:26px; border-radius:6px; border:none;
  cursor:pointer; display:inline-flex; align-items:center; justify-content:center;
  transition: all .15s; text-decoration: none;
}
.td-root .td-ab-edit { background:#ccfbf1; color:#0d9488; }
.td-root .td-ab-edit:hover { background:#0d9488; color:#fff; }
.td-root .td-ab-del  { background:#fff1f2; color:#f43f5e; }
.td-root .td-ab-del:hover { background:#f43f5e; color:#fff; }
.td-root .td-ab-join { background:#dcfce7; color:#15803d; }
.td-root .td-ab-join:hover { background:#15803d; color:#fff; }
.td-root .td-ab-done { background:#d1fae5; color:#059669; }
.td-root .td-ab-done:hover { background:#059669; color:#fff; }
.td-root .td-ab-post { background:#fef3c7; color:#d97706; }
.td-root .td-ab-post:hover { background:#d97706; color:#fff; }
.td-root .td-ab-loc  { background:#fef3c7; color:#d97706; }
.td-root .td-ab-loc:hover  { background:#d97706; color:#fff; }

/* Pagination */
.td-root .td-pagination {
  display:flex; align-items:center; justify-content:space-between;
  padding:10px 16px; border-top:1px solid #f0fdfa;
  background: #f8fffe;
  font-size: 11.5px; color: #64748b;
  flex-wrap: wrap; gap: 8px;
}
.td-root .td-pag-info {
  font-size: 11.5px; color: #64748b;
}
.td-root .td-pag-info strong { color: #0d9488; font-weight: 800; font-size: 12px; }
.td-root .td-pag-btns { display:flex; align-items:center; gap:6px; }
.td-root .td-pg-btn {
  display: inline-flex; align-items: center; gap: 4px;
  padding: 4px 12px; border-radius: 6px;
  border: 1.5px solid #99f6e4; background: #fff;
  color: #0d9488; font-family: inherit;
  font-size: 11.5px; font-weight: 600;
  cursor: pointer; transition: all .15s;
}
.td-root .td-pg-btn:hover:not(:disabled) { background:#f0fdfa; border-color:#14b8a6; }
.td-root .td-pg-btn:disabled { opacity:.4; cursor:not-allowed; }
.td-root .td-pag-range {
  padding: 4px 12px; border-radius: 6px;
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff; font-weight: 700; font-size: 11.5px;
  white-space: nowrap;
}

/* Rows-per-page selector (lives in the toolbar) */
.td-root .td-rows-sel {
  display: flex; align-items: center; gap: 5px;
  font-size: 11.5px; color: #0d9488; font-weight: 500;
  background: #fff; border: 1.5px solid #99f6e4;
  padding: 4px 12px; border-radius: 20px;
  box-shadow: 0 1px 4px rgba(20,184,166,.08);
  flex-shrink: 0;
}
.td-root .td-rows-sel select {
  border: none; background: transparent;
  font-family: inherit; font-size: 11.5px;
  color: #0d9488; font-weight: 700;
  cursor: pointer; outline: none;
}

/* Modal */
.td-overlay {
  position: fixed; inset: 0; z-index: 9500;
  background: rgba(15,23,42,.45);
  backdrop-filter: blur(4px);
  display: flex; align-items: center; justify-content: center;
  font-family: 'DM Sans', 'Inter', sans-serif;
}
.td-modal {
  background:#fff; border-radius:14px;
  width: min(94vw, 620px); max-height: 92vh;
  display: flex; flex-direction: column;
  box-shadow: 0 24px 60px rgba(13,148,136,.25), 0 8px 24px rgba(0,0,0,.1);
  overflow: hidden;
}
.td-modal-header {
  background: linear-gradient(135deg, #14b8a6 0%, #0d9488 60%, #0f766e 100%);
  padding: 14px 18px;
  display:flex; align-items:center; justify-content:space-between;
  flex-shrink: 0;
}
.td-modal-header-left { display:flex; align-items:center; gap:11px; }
.td-modal-header-icon {
  width:36px; height:36px; border-radius:9px;
  background: rgba(255,255,255,.2); border: 1px solid rgba(255,255,255,.3);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.td-modal-title { font-size:14px; font-weight:800; color:#fff; letter-spacing:-.2px; }
.td-modal-sub   { font-size:10.5px; color:rgba(255,255,255,.75); margin-top:2px; }
.td-modal-close {
  width:26px; height:26px; border-radius:7px; border:none;
  background: rgba(255,255,255,.2); color:#fff; cursor:pointer;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.td-modal-body {
  padding: 18px 22px 14px; background: #f0fdfa;
  overflow-y: auto; flex: 1;
}
.td-form-grid {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 12px;
}
.td-form-row {
  display: grid; grid-template-columns: 1fr 1fr;
  gap: 8px 14px; margin-bottom: 10px;
  align-items: start;
}
.td-form-row-3 { grid-template-columns: 1fr 1fr 1fr; }
.td-field { display: flex; flex-direction: column; gap: 4px; }
.td-label {
  font-size: 10.5px; font-weight: 600;
  color: #475569; letter-spacing: .04em;
  text-transform: uppercase;
}

/* Virtual / Physical toggle at top of meeting modal */
.td-mtg-toggle {
  display: flex; margin-bottom: 14px;
  border-radius: 10px; overflow: hidden;
  border: 1.5px solid #99f6e4;
}
.td-mtg-toggle-btn {
  flex: 1; display: flex; align-items: center; justify-content: center; gap: 7px;
  padding: 10px 0; border: none;
  font-family: inherit; font-size: 12px; font-weight: 700;
  cursor: pointer; transition: all .18s;
  background: #f0fdfa; color: #0d9488;
}
.td-mtg-toggle-btn + .td-mtg-toggle-btn { border-left: 1.5px solid #99f6e4; }
.td-mtg-toggle-btn.active {
  background: linear-gradient(135deg, #0d9488, #065f46);
  color: #fff;
}

/* Attachment dropzone */
.td-file-drop {
  display: flex; align-items: center; gap: 9px;
  cursor: pointer;
  border: 1.5px dashed #99f6e4; border-radius: 8px;
  padding: 9px 12px; background: #f0fdfa;
  height: 36px; transition: all .15s;
}
.td-file-drop:hover { border-color: #14b8a6; background: #ccfbf1; }
.td-file-label {
  font-size: 11.5px; color: #64748b;
  white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
  max-width: 180px;
}
.td-req { color: #e11d48; font-weight: 700; }
.td-inp {
  width:100%; box-sizing:border-box;
  border:1.5px solid #99f6e4; border-radius:8px;
  padding:7px 11px; font-family:inherit; font-size:12px;
  color:#1e293b; background:#fff; outline:none;
  transition: all .15s; line-height:1.4;
}
.td-inp:focus { border-color:#14b8a6; box-shadow:0 0 0 3px rgba(20,184,166,.1); }
.td-inp::placeholder { color:#94a3b8; font-size:11.5px; }
.td-sel {
  appearance:none; -webkit-appearance:none; cursor:pointer;
  background-image: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='10' height='10' viewBox='0 0 24 24' fill='none' stroke='%230d9488' stroke-width='2.5'%3E%3Cpolyline points='6 9 12 15 18 9'/%3E%3C/svg%3E");
  background-repeat: no-repeat;
  background-position: right 10px center;
  padding-right: 28px;
}
.td-form-error { font-size:11.5px; color:#e11d48; margin-top:10px; }

.td-modal-footer {
  display:flex; align-items:center; justify-content:space-between;
  padding: 12px 20px;
  border-top: 1px solid #ccfbf1; background:#fff;
  flex-shrink: 0;
}
.td-footer-hint {
  font-size:11px; color:#94a3b8;
  display:flex; align-items:center; gap:5px;
}
.td-footer-actions { display:flex; gap:8px; }
.td-btn-cancel {
  padding:7px 18px; border:1.5px solid #e2e8f0;
  border-radius:8px; background:#fff; color:#64748b;
  font-family:inherit; font-size:12px; font-weight:600;
  cursor:pointer;
}
.td-btn-save {
  display:inline-flex; align-items:center; gap:6px;
  padding:7px 18px; border:none; border-radius:8px;
  background: linear-gradient(135deg, #14b8a6, #0d9488);
  color:#fff; font-family:inherit;
  font-size:12px; font-weight:700; cursor:pointer;
  box-shadow: 0 2px 8px rgba(20,184,166,.4);
}

/* ── Calendar view ── */
.td-root .td-cal-topbar {
  background: linear-gradient(135deg, #134e4a 0%, #0d9488 55%, #2dd4bf 100%);
  border-radius: 14px; padding: 12px 20px;
  display: flex; align-items: center; justify-content: space-between;
  gap: 14px; flex-wrap: wrap;
  box-shadow: 0 4px 20px rgba(13,148,136,.28), 0 1px 4px rgba(0,0,0,.08);
  margin-bottom: 10px;
}
.td-root .td-cal-topbar-left { display:flex; align-items:center; gap:12px; flex-wrap:wrap; }
.td-root .td-cal-topbar-icon {
  width:34px; height:34px; border-radius:10px;
  background: rgba(255,255,255,.16); border:1.5px solid rgba(255,255,255,.28);
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
}
.td-root .td-cal-topbar-title { font-size:13.5px; font-weight:800; color:#fff; letter-spacing:-.2px; }
.td-root .td-cal-topbar-sub   { font-size:9.5px; color:rgba(255,255,255,.65); font-weight:500; margin-top:1px; }
.td-root .td-cal-topbar-divider { width:1px; height:28px; background:rgba(255,255,255,.2); }
.td-root .td-cal-today-btn {
  padding:5px 14px; border-radius:20px;
  border:1.5px solid rgba(255,255,255,.35); background:rgba(255,255,255,.14);
  color:#fff; font-family:inherit; font-size:11.5px; font-weight:700;
  cursor:pointer; transition:all .15s;
}
.td-root .td-cal-today-btn:hover { background: rgba(255,255,255,.26); }
.td-root .td-cal-nav { display:flex; gap:3px; }
.td-root .td-cal-nav button {
  width:28px; height:28px; border-radius:50%;
  border:1.5px solid rgba(255,255,255,.28); background:rgba(255,255,255,.1);
  color:#fff; cursor:pointer; display:flex; align-items:center; justify-content:center;
  transition: all .15s;
}
.td-root .td-cal-nav button:hover { background: rgba(255,255,255,.22); }
.td-root .td-cal-month-label {
  font-size:18px; font-weight:800; color:#fff;
  letter-spacing:-.3px; min-width:130px;
}
.td-root .td-cal-topbar-right { display:flex; align-items:center; gap:6px; flex-wrap:wrap; }
.td-root .td-cal-stat {
  display:inline-flex; align-items:center; gap:4px;
  background: rgba(255,255,255,.14); border:1px solid rgba(255,255,255,.22);
  padding:4px 10px; border-radius:20px;
  font-size:10px; font-weight:700; color:#fff; white-space:nowrap;
}
.td-root .td-cal-stat::before {
  content:''; width:6px; height:6px; border-radius:50%; background:#fff;
}
.td-root .td-cal-stat-inprog::before { background:#6ee7b7; }
.td-root .td-cal-stat-done::before   { background:#a7f3d0; }

.td-root .td-cal-card {
  background:#fff;
  border-radius:14px;
  box-shadow: 0 2px 16px rgba(0,0,0,.07), 0 1px 4px rgba(0,0,0,.04);
  overflow:hidden;
  border:1px solid #e2e8e7;
  display:flex; flex-direction:column;
  min-height: 540px;
}
.td-root .td-cal-day-hdr {
  display:grid; grid-template-columns:repeat(7,1fr);
  border-bottom: 1.5px solid #f0f0f0;
  flex-shrink:0;
}
.td-root .td-cal-day-hdr-cell {
  padding:11px 12px 10px;
  font-size:10px; font-weight:800; color:#8899a6;
  text-transform:uppercase; letter-spacing:.1em;
  background:#fff; border-right:1px solid #eef0ef;
  border-bottom:2px solid #eef0ef;
}
.td-root .td-cal-day-hdr-cell:last-child { border-right:none; }
.td-root .td-cal-day-hdr-we    { background:#fafcfb; color:#9db4ae; }
.td-root .td-cal-day-hdr-today { background: linear-gradient(90deg,#f0fdfa,#ccfbf1); color:#0d9488; border-bottom-color:#14b8a6; }

.td-root .td-cal-grid {
  flex:1; display:grid; grid-template-columns:repeat(7,1fr);
  grid-auto-rows: minmax(108px, 1fr);
}
.td-root .td-cal-cell {
  background:#fff;
  border-right:1px solid #eef0ef;
  border-bottom:1px solid #eef0ef;
  padding:10px 12px;
  min-height:108px;
  position:relative;
  transition: background .14s;
}
.td-root .td-cal-cell:hover { background:#f5fffe; }
.td-root .td-cal-cell-weekend { background: linear-gradient(160deg,#f8fffe 0%,#f4faf8 100%); }
.td-root .td-cal-cell-weekend:hover { background:#ecfdf8; }
.td-root .td-cal-cell-today {
  background: linear-gradient(160deg,#f0fdf9 0%,#e0f7f3 100%);
  box-shadow: inset 0 0 0 2px #14b8a6, inset 2px 0 0 #14b8a6;
}
.td-root .td-cal-cell-today:hover { background: linear-gradient(160deg,#e0f8f2,#ccf7ed); }
.td-root .td-cal-cell-out {
  background: repeating-linear-gradient(135deg,#f9fafb 0px,#f9fafb 10px,#f5f6f5 10px,#f5f6f5 20px);
  cursor: default;
}
.td-root .td-cal-cell-out:hover { background: repeating-linear-gradient(135deg,#f9fafb 0px,#f9fafb 10px,#f5f6f5 10px,#f5f6f5 20px); }
.td-root .td-cal-cell-out-num { font-size:11.5px; color:#d1d5db; font-weight:500; }
.td-root .td-cal-weekend-stripe {
  position:absolute; top:0; left:0; width:100%; height:3px;
  background: linear-gradient(90deg,#99f6e4,#5eead4); opacity:.4;
}
.td-root .td-cal-cell-head {
  display:flex; align-items:center; margin-bottom:5px;
}
.td-root .td-cal-num     { font-size:13px; font-weight:400; color:#1e293b; }
.td-root .td-cal-num-we  { font-weight:700; color:#0f766e; }
.td-root .td-cal-today-num {
  display:inline-flex; align-items:center; justify-content:center;
  width:28px; height:28px; border-radius:50%;
  background: linear-gradient(135deg,#0d9488,#065f46); color:#fff;
  font-size:12.5px; font-weight:800;
  box-shadow: 0 3px 10px rgba(13,148,136,.45);
}
.td-root .td-cal-count {
  display:inline-flex; align-items:center; justify-content:center;
  min-width:16px; height:16px; padding:0 4px;
  border-radius:8px; background:#f0f4f3; color:#64748b;
  font-size:8px; font-weight:800; margin-left:5px;
  border:1px solid #e2e8e6;
}
.td-root .td-cal-cell-today .td-cal-count {
  background: rgba(13,148,136,.18); color:#0d9488;
  border-color: rgba(20,184,166,.4);
}
.td-root .td-cal-pill {
  border-radius:6px; padding:3px 8px 3px 7px;
  font-size:9.5px; font-weight:600;
  margin-bottom:3px; cursor:pointer;
  white-space:nowrap; overflow:hidden; text-overflow:ellipsis;
  max-width:100%; box-shadow: 0 1px 2px rgba(0,0,0,.06);
  transition: all .13s;
}
.td-root .td-cal-pill:hover { transform: translateX(2px); box-shadow: 0 2px 6px rgba(0,0,0,.1); filter: brightness(.97); }
.td-root .td-cal-more {
  font-size:9px; color:#0d9488; font-weight:800;
  padding:2px 6px; cursor:pointer;
  background: linear-gradient(90deg,#f0fdfa,#e6faf7);
  border-radius:4px; display:inline-flex; align-items:center; gap:3px;
  margin-top:2px; border:1px solid #99f6e4;
  transition: all .12s;
}
.td-root .td-cal-more:hover { background:#ccfbf1; }

/* Popover */
.td-cal-popover {
  position: fixed; z-index: 10500;
  background:#fff; border-radius:14px;
  box-shadow: 0 20px 60px rgba(0,0,0,.15), 0 4px 20px rgba(0,0,0,.08);
  min-width:320px; max-width:360px;
  overflow:hidden; border:1px solid #e2e8f0;
  font-family: 'DM Sans','Inter',sans-serif;
}
.td-cal-popover-hdr {
  background: linear-gradient(135deg, #134e4a 0%, #0d9488 100%);
  padding:13px 16px;
  display:flex; align-items:flex-start; justify-content:space-between;
}
.td-cal-popover-title {
  font-size:13px; font-weight:800; color:#fff;
  letter-spacing:-.15px; margin-bottom:5px;
}
.td-cal-popover-meta { display:flex; gap:5px; flex-wrap:wrap; }
.td-cal-popover-chip {
  font-size:10px; background: rgba(255,255,255,.18); color:#fff;
  padding:2px 9px; border-radius:20px; font-weight:700;
}
.td-cal-popover-close {
  width:24px; height:24px; border-radius:7px; border:none;
  background: rgba(255,255,255,.18); color:#fff; cursor:pointer;
  display:flex; align-items:center; justify-content:center; flex-shrink:0;
  transition: background .12s;
}
.td-cal-popover-close:hover { background: rgba(255,255,255,.3); }
.td-cal-popover-list { max-height:300px; overflow-y:auto; }
.td-cal-popover-row {
  padding:10px 14px;
  display:flex; gap:10px; align-items:flex-start;
  cursor:pointer; transition: background .12s;
  border-bottom: 1px solid #f8fafc;
}
.td-cal-popover-row:last-child { border-bottom:none; }
.td-cal-popover-row:hover { background:#f8fafc; }
.td-cal-popover-bar {
  width:3px; border-radius:2px; align-self:stretch;
  flex-shrink:0; min-height:44px;
}
.td-cal-popover-body { flex:1; min-width:0; }
.td-cal-popover-row-title {
  font-size:12px; font-weight:700; color:#0f172a;
  line-height:1.4; margin-bottom:5px;
}
.td-cal-popover-row-meta {
  display:flex; align-items:center; gap:5px; flex-wrap:wrap;
}
.td-cal-popover-pill {
  font-size:9.5px; font-weight:700;
  padding:2px 7px; border-radius:20px;
}
.td-cal-popover-pill-muted {
  color:#64748b; background:#f8fafc; border:1px solid #e2e8f0; font-weight:500;
}
.td-cal-popover-status {
  font-size:9.5px; font-weight:700;
  padding:2px 8px; border-radius:20px;
}
.td-cal-popover-status-inprog { background:#dbeafe; color:#1d4ed8; }
.td-cal-popover-status-done   { background:#dcfce7; color:#166534; }
`;
