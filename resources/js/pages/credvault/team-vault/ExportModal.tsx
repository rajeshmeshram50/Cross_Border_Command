import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type ExportSelection } from '../cvApi';
import { CvPortal, errMsg, Svg } from '../shared';
import { TV_IC } from './tvShared';

/**
 * Team Vault · "Export Credentials" popup: exports what the table lists (its tab,
 * department and search), narrowed to the ticked categories (counts from
 * /exports/preview), as CSV, with or without notes and passwords. Readable passwords take
 * the risk acknowledgement and the account password; the server builds the
 * file and logs the export.
 */

const FOLDER = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>';
const SUM = '<path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>';
const FILE = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"/>';
const CSV = '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18"/>';
const WARN = '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>';

interface Group { group: string; count: number }

function Bone({ w = '100%', h = 12, r = 6 }: { w?: number | string; h?: number; r?: number }) {
  return <span className="cv-shimrow" style={{ display: 'block' }}><i style={{ width: w, height: h, borderRadius: r }} /></span>;
}

function SecShim({ children }: { children: ReactNode }) {
  return (
    <div className="mapsup-seccard gp-card" aria-hidden="true">
      <div className="mapsup-sechead">
        <Bone w={34} h={34} r={10} />
        <div className="mapsup-sechead__txt" style={{ gap: 6 }}><Bone w={130} h={13} /><Bone w={200} h={10} /></div>
      </div>
      {children}
    </div>
  );
}

function ExportShimmer() {
  return (
    <>
      <SecShim>
        <div className="ex-cats">{[110, 96, 124, 88].map((w, i) => <Bone key={i} w={w} h={34} r={10} />)}</div>
        <div style={{ marginTop: 12 }}><Bone h={40} r={10} /></div>
      </SecShim>
      <SecShim>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
          {[0, 1, 2, 3].map(i => <Bone key={i} h={60} r={12} />)}
        </div>
      </SecShim>
    </>
  );
}

function Toggle({ on, set, label, sub }: { on: boolean; set: (v: boolean) => void; label: string; sub: string }) {
  return (
    <label className={`crd-tg gp-tg${on ? ' is-on' : ''}`}>
      <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} />
      <span className="crd-tg__sw"><i /></span>
      <span className="gp-tg__t"><b>{label}</b><small>{sub}</small></span>
    </label>
  );
}

export default function ExportModal({ selection, teamName, onClose, preview = false, loadPreview = cvApi.exportPreview }: {
  /** The table's tab and filters: the export holds exactly what the table lists. */
  selection: ExportSelection;
  /** The open department, for the subtitle. */
  teamName?: string;
  onClose: () => void;
  /** Design preview (dummy data): the popup works, Export downloads nothing. */
  preview?: boolean;
  /** Where the category counts come from (Team Vault passes its tvData). */
  loadPreview?: (sel: ExportSelection) => Promise<{ groups?: Group[] }>;
}) {
  const { tab, department_id, q } = selection;
  const toast = useToast();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [cats, setCats] = useState<Record<string, boolean>>({});
  const fmt = 'csv';
  const [notes, setNotes] = useState(true);
  const [pw, setPw] = useState(false);
  const [ack, setAck] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<CvApiError | null>(null);

  useEffect(() => {
    let on = true;
    loadPreview({ tab, department_id, q }).then(d => {
      if (!on) return;
      const g: Group[] = (d.groups ?? []).filter((x: Group) => x.count > 0);
      setGroups(g);
      setCats(Object.fromEntries(g.map(x => [x.group, true])));
    }).catch(e => { if (on) setLoadErr(errMsg(e)); });
    return () => { on = false; };
  // loadPreview is fixed for the popup's life.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, department_id, q]);

  const all = useMemo(() => (groups ?? []).reduce((a, g) => a + g.count, 0), [groups]);
  const sel = useMemo(() => (groups ?? []).reduce((a, g) => a + (cats[g.group] ? g.count : 0), 0), [groups, cats]);
  const allOn = (groups ?? []).every(g => cats[g.group]);
  // Readable passwords need the risk tick and, on live data, the account password (the server checks it).
  const ok = sel > 0 && (!pw || (ack && (preview || password.length > 0))) && !busy;

  const setAll = (on: boolean) => setCats(Object.fromEntries((groups ?? []).map(g => [g.group, on])));

  const run = async () => {
    if (!ok) return;
    if (preview) {
      toast.info('Design preview', `Team Vault is on dummy data - ${sel} credential${sel === 1 ? '' : 's'} would be exported as ${fmt.toUpperCase()}; nothing was downloaded.`);
      onClose();
      return;
    }
    setBusy(true); setErr(null);
    try {
      const f = await cvApi.exportRun({
        tab,
        ...(department_id ? { department_id } : {}),
        ...(q ? { q } : {}),
        groups: (groups ?? []).filter(g => cats[g.group]).map(g => g.group),
        format: fmt,
        include_notes: notes,
        include_passwords: pw,
        ...(pw ? { acknowledge: ack, account_password: password } : {}),
      });
      const n = Number(f.headers['x-credvault-count'] ?? sel);
      const withheld = Number(f.headers['x-credvault-withheld'] ?? 0);
      toast.success(`${n} credential${n === 1 ? '' : 's'} exported as ${fmt.toUpperCase()}`, f.name);
      if (pw && withheld > 0) {
        toast.info('Protected secrets withheld', `${withheld} protected credential${withheld === 1 ? '' : 's'} open only through an unlock, so the file shows a placeholder.`);
      }
      onClose();
    } catch (e) {
      const ce = e instanceof CvApiError ? e : new CvApiError(errMsg(e));
      setErr(ce);
      if (!Object.keys(ce.errors).length || ce.status !== 422) toast.error('Export failed', ce.message);
    } finally { setBusy(false); }
  };

  const fieldErr = (k: string) => err?.field(k);
  const otherErr = err && err.status === 422 ? (fieldErr('groups') || fieldErr('format') || fieldErr('tab')) : undefined;


  return (
    <CvPortal onClose={onClose}>
      <div id="crd-host">
        <div className="mapsup-overlay">
          <div className="mapsup-box crd-box gp-box ex-box" role="dialog" aria-modal="true" aria-label="Export Credentials">
            <div className="mapsup-header gp-hd">
              <div className="mapsup-hrow">
                <div className="mapsup-title-wrap">
                  <div className="mapsup-hicon crd-hicon"><Svg d={TV_IC.download} size={22} sw={2.1} /></div>
                  <div className="mapsup-title-block">
                    <h3 className="mapsup-title">Export Credentials</h3>
                    <p className="mapsup-sub">
                      Download {tab === 'mine' ? 'your credentials' : `${teamName ? `${teamName} ` : ''}team credentials`}{q ? ` matching “${q}”` : ''} as a file.
                    </p>
                  </div>
                </div>
                <div className="crd-hbtns">
                  <button type="button" className="mapsup-close" onClick={onClose} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
                </div>
              </div>
            </div>

            <div className="mapsup-body gp-body ex-body">
              {!groups && !loadErr ? <ExportShimmer /> : <>
              <div className="mapsup-seccard gp-card">
                <div className="mapsup-sechead">
                  <span className="mapsup-sechead__ico"><Svg d={FOLDER} size={14} sw={2.1} /></span>
                  <div className="mapsup-sechead__txt">
                    <span className="mapsup-sechead__title">What to export</span>
                    <span className="mapsup-sechead__sub">Choose the categories to include</span>
                  </div>
                  {groups && groups.length > 0 && (
                    <button type="button" data-h40="skip" className="ex-all" onClick={() => setAll(!allOn)}>{allOn ? 'Clear all' : 'Select all'}</button>
                  )}
                </div>
                {loadErr || !groups ? (
                  <div className="ex-sum"><Svg d={WARN} size={14} sw={2.1} /><span>{loadErr}</span></div>
                ) : groups.length === 0 ? (
                  <div className="ex-sum"><Svg d={SUM} size={14} sw={2.1} /><span>{q ? `No credentials match “${q}”.` : tab === 'mine' ? 'You have no credentials to export yet.' : 'There are no team credentials to export yet.'}</span></div>
                ) : (
                  <>
                    <div className="ex-cats">
                      {groups.map(g => (
                        <button key={g.group} type="button" data-h40="skip" className={`ex-cat${cats[g.group] ? ' is-on' : ''}`}
                          onClick={() => setCats(c => ({ ...c, [g.group]: !c[g.group] }))}>
                          <span className="ex-cat__box"><Svg icon="check" size={10} sw={3.2} /></span><b>{g.group}</b><i>{g.count}</i>
                        </button>
                      ))}
                    </div>
                    <div className="ex-sum"><Svg d={SUM} size={14} sw={2.1} /><span><b>{sel}</b> of {all} credentials selected</span></div>
                    {otherErr && <span className="cv-ferr">{otherErr}</span>}
                  </>
                )}
              </div>

              <div className="mapsup-seccard gp-card">
                <div className="mapsup-sechead">
                  <span className="mapsup-sechead__ico"><Svg d={FILE} size={14} sw={2.1} /></span>
                  <div className="mapsup-sechead__txt">
                    <span className="mapsup-sechead__title">File format &amp; contents</span>
                    <span className="mapsup-sechead__sub">A CSV file · choose what each row contains</span>
                  </div>
                </div>
                {/* CSV only (JSON removed on request); the one option spans the row. */}
                <div className="gp-modes" style={{ gridTemplateColumns: '1fr' }}>
                  <button type="button" data-h40="skip" className="is-on">
                    <Svg d={CSV} size={14} sw={2.1} /><span><b>CSV</b><small>Opens in Excel or Sheets</small></span>
                  </button>
                </div>
                <div className="gp-opts">
                  <Toggle on={notes} set={setNotes} label="Include notes" sub="Remarks saved with each credential" />
                  <Toggle on={pw} set={v => { setPw(v); setAck(false); setPassword(''); setErr(null); }} label="Include passwords" sub="Exported as plain, readable text" />
                </div>
                {pw && (
                  <>
                    <div className="ex-warn">
                      <span className="ex-warn__ico"><Svg d={WARN} size={15} sw={2.1} /></span>
                      <div><b>Passwords will be readable by anyone with the file</b><span>Store it safely and delete it once you are done.{!preview && ' Protected credentials are written as a placeholder.'}</span></div>
                    </div>
                    <label className="dl-ack ex-ack">
                      <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                      <span className="dl-ack__box"><Svg icon="check" size={11} sw={3.2} /></span>
                      <span>I understand the risk and want to export passwords.</span>
                    </label>
                    {fieldErr('acknowledge') && <span className="cv-ferr">{fieldErr('acknowledge')}</span>}
                    {!preview && <div className="mapsup-ffield" style={{ marginTop: 10 }}>
                      <label className="mapsup-flabel" htmlFor="tv-ex-pw">Account password<span className="req">*</span></label>
                      <div className="mapsup-inputwrap">
                        <input id="tv-ex-pw" type="password" className="mapsup-finput" autoComplete="current-password"
                          placeholder="Enter your login password to confirm" value={password}
                          onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} />
                      </div>
                      {fieldErr('account_password') && <span className="cv-ferr">{fieldErr('account_password')}</span>}
                    </div>}
                  </>
                )}
              </div>
              </>}
            </div>

            <div className="mapsup-footer">
              <div className="mapsup-footer__info"><Svg icon="lock" size={12} /> Every export is recorded in the audit log</div>
              <div className="mapsup-footer__actions">
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={onClose}>Cancel</button>
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--primary ex-go" disabled={!ok} onClick={run}>
                  <Svg d={TV_IC.download} size={13} sw={2.1} />
                  {busy ? 'Exporting…' : !groups && !loadErr ? 'Loading…' : `Export ${sel} Credential${sel === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CvPortal>
  );
}
