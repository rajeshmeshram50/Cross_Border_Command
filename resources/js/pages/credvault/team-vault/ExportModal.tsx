import { useEffect, useMemo, useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError } from '../cvApi';
import { CvPortal, errMsg, Svg } from '../shared';
import { TV_IC } from './tvShared';

/**
 * Team Vault · "Export Credentials" popup: categories to include (counts from
 * /exports/preview), CSV / JSON, notes and passwords. Readable passwords take
 * the risk acknowledgement and the account password; the server builds the
 * file and logs the export.
 */

const FOLDER = '<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/>';
const SUM = '<path d="M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11"/>';
const FILE = '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6"/>';
const CSV = '<path d="M3 3h18v18H3zM3 9h18M3 15h18M9 3v18"/>';
const JSON_ICO = '<path d="M8 3H7a2 2 0 0 0-2 2v5a2 2 0 0 1-2 2 2 2 0 0 1 2 2v5a2 2 0 0 0 2 2h1M16 3h1a2 2 0 0 1 2 2v5a2 2 0 0 0 2 2 2 2 0 0 0-2 2v5a2 2 0 0 1-2 2h-1"/>';
const WARN = '<path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0zM12 9v4M12 17h.01"/>';

interface Group { group: string; count: number }

function Toggle({ on, set, label, sub }: { on: boolean; set: (v: boolean) => void; label: string; sub: string }) {
  return (
    <label className={`crd-tg gp-tg${on ? ' is-on' : ''}`}>
      <input type="checkbox" checked={on} onChange={e => set(e.target.checked)} />
      <span className="crd-tg__sw"><i /></span>
      <span className="gp-tg__t"><b>{label}</b><small>{sub}</small></span>
    </label>
  );
}

export default function ExportModal({ scope = 'team', onClose }: { scope?: 'team' | 'personal'; onClose: () => void }) {
  const toast = useToast();
  const [groups, setGroups] = useState<Group[] | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [cats, setCats] = useState<Record<string, boolean>>({});
  const [fmt, setFmt] = useState<'csv' | 'json'>('csv');
  const [notes, setNotes] = useState(true);
  const [pw, setPw] = useState(false);
  const [ack, setAck] = useState(false);
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<CvApiError | null>(null);

  useEffect(() => {
    let on = true;
    cvApi.exportPreview(scope).then(d => {
      if (!on) return;
      const g: Group[] = (d.groups ?? []).filter((x: Group) => x.count > 0);
      setGroups(g);
      setCats(Object.fromEntries(g.map(x => [x.group, true])));
    }).catch(e => { if (on) setLoadErr(errMsg(e)); });
    return () => { on = false; };
  }, [scope]);

  const all = useMemo(() => (groups ?? []).reduce((a, g) => a + g.count, 0), [groups]);
  const sel = useMemo(() => (groups ?? []).reduce((a, g) => a + (cats[g.group] ? g.count : 0), 0), [groups, cats]);
  const allOn = (groups ?? []).every(g => cats[g.group]);
  const ok = sel > 0 && (!pw || (ack && password.length > 0)) && !busy;

  const setAll = (on: boolean) => setCats(Object.fromEntries((groups ?? []).map(g => [g.group, on])));

  const run = async () => {
    if (!ok) return;
    setBusy(true); setErr(null);
    try {
      const f = await cvApi.exportRun({
        scope,
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
  const otherErr = err && err.status === 422 ? (fieldErr('groups') || fieldErr('format') || fieldErr('scope')) : undefined;


  return (
    <CvPortal onClose={onClose}>
      <div id="crd-host">
        <div className="mapsup-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="mapsup-box crd-box gp-box ex-box" role="dialog" aria-modal="true" aria-label="Export Credentials">
            <div className="mapsup-header gp-hd">
              <div className="mapsup-hrow">
                <div className="mapsup-title-wrap">
                  <div className="mapsup-hicon crd-hicon"><Svg d={TV_IC.download} size={22} sw={2.1} /></div>
                  <div className="mapsup-title-block">
                    <h3 className="mapsup-title">Export Credentials</h3>
                    <p className="mapsup-sub">Download {scope === 'team' ? 'Team Vault' : 'your'} credentials as a file.</p>
                  </div>
                </div>
                <div className="crd-hbtns">
                  <button type="button" className="mapsup-close" onClick={onClose} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
                </div>
              </div>
            </div>

            <div className="mapsup-body gp-body ex-body">
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
                {loadErr ? (
                  <div className="ex-sum"><Svg d={WARN} size={14} sw={2.1} /><span>{loadErr}</span></div>
                ) : !groups ? (
                  <div className="ex-cats">
                    {[0, 1, 2, 3].map(i => <span key={i} className="cv-shimrow" style={{ display: 'block' }}><i style={{ display: 'block', width: 120, height: 34, borderRadius: 10 }} /></span>)}
                  </div>
                ) : groups.length === 0 ? (
                  <div className="ex-sum"><Svg d={SUM} size={14} sw={2.1} /><span>There are no {scope === 'team' ? 'Team Vault' : ''} credentials to export yet.</span></div>
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
                    <span className="mapsup-sechead__sub">Pick a format and what each row contains</span>
                  </div>
                </div>
                <div className="gp-modes">
                  <button type="button" data-h40="skip" className={fmt === 'csv' ? 'is-on' : ''} onClick={() => setFmt('csv')}>
                    <Svg d={CSV} size={14} sw={2.1} /><span><b>CSV</b><small>Opens in Excel or Sheets</small></span>
                  </button>
                  <button type="button" data-h40="skip" className={fmt === 'json' ? 'is-on' : ''} onClick={() => setFmt('json')}>
                    <Svg d={JSON_ICO} size={14} sw={2.1} /><span><b>JSON</b><small>For import into other tools</small></span>
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
                      <div><b>Passwords will be readable by anyone with the file</b><span>Store it safely and delete it once you are done. Protected credentials are written as a placeholder.</span></div>
                    </div>
                    <label className="dl-ack ex-ack">
                      <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
                      <span className="dl-ack__box"><Svg icon="check" size={11} sw={3.2} /></span>
                      <span>I understand the risk and want to export passwords.</span>
                    </label>
                    {fieldErr('acknowledge') && <span className="cv-ferr">{fieldErr('acknowledge')}</span>}
                    <div className="mapsup-ffield" style={{ marginTop: 10 }}>
                      <label className="mapsup-flabel" htmlFor="tv-ex-pw">Account password<span className="req">*</span></label>
                      <div className="mapsup-inputwrap">
                        <input id="tv-ex-pw" type="password" className="mapsup-finput" autoComplete="current-password"
                          placeholder="Enter your login password to confirm" value={password}
                          onChange={e => setPassword(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') run(); }} />
                      </div>
                      {fieldErr('account_password') && <span className="cv-ferr">{fieldErr('account_password')}</span>}
                    </div>
                  </>
                )}
              </div>
            </div>

            <div className="mapsup-footer">
              <div className="mapsup-footer__info"><Svg icon="lock" size={12} /> Every export is recorded in the audit log</div>
              <div className="mapsup-footer__actions">
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={onClose}>Cancel</button>
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--primary ex-go" disabled={!ok} onClick={run}>
                  <Svg d={TV_IC.download} size={13} sw={2.1} />
                  {busy ? 'Exporting…' : `Export ${sel} Credential${sel === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CvPortal>
  );
}
