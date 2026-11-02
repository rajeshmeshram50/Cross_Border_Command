import { useState, type DragEvent, type ReactNode } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type ImportPreview, type ImportPreviewRow } from '../cvApi';
import { Svg, errMsg, initials } from '../shared';
import { IR_I, IrCard } from './irShared';

/* Import tab — the prototype's irImportHtml / irReviewHtml; parsing and checks run on the API. */

const COLS = ['name', 'url', 'username', 'password', 'category', 'notes'];
const FMTS: [string, string, string][] = [['Excel', '.xlsx', IR_I.sheet], ['Excel 2003', '.xls', IR_I.sheet], ['CSV', '.csv', IR_I.file], ['Tab-separated', '.tsv / .txt', IR_I.file], ['JSON', '.json', IR_I.code]];
const EXTS = ['csv', 'tsv', 'txt', 'json', 'xlsx', 'xls', 'xml'];
const FLAG: Record<ImportPreviewRow['flags'][number], [string, string]> = {
  dup: ['Already in vault', 'warn'], dupfile: ['Repeated in file', 'warn'], weak: ['Weak password', 'bad'], invalid: ['No name', 'bad'], nopw: ['No password', 'bad'],
};
const LV = ['', 'weak', 'fair', 'good', 'strong'];
const isDup = (r: ImportPreviewRow) => r.flags.includes('dup') || r.flags.includes('dupfile');

function host(u: string): string {
  try { return new URL(/^[a-z]+:\/\//i.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, ''); } catch { return u.replace(/^https?:\/\/(www\.)?/, '').split('/')[0]; }
}

type Prev = { data: ImportPreview } | { err: string; file: string } | null;

export default function ImportTab({ onImported }: { onImported: () => void }) {
  const toast = useToast();
  const [prev, setPrev] = useState<Prev>(null);
  const [sel, setSel] = useState<Set<number>>(new Set());
  const [dup, setDup] = useState<'skip' | 'copy'>('skip');
  const [busy, setBusy] = useState(false);
  const [running, setRunning] = useState(false);
  const [over, setOver] = useState(false);

  const sample = async (fmt: 'xlsx' | 'csv' | 'json') => {
    try {
      await cvApi.importSample(fmt);
      toast.success('Sample file downloaded', 'Fill it in and upload it here');
    } catch (e) { toast.error('Could not download the sample', errMsg(e)); }
  };

  const load = async (src: File | 'sample') => {
    const name = src === 'sample' ? 'Sample data' : src.name;
    if (src !== 'sample' && !EXTS.includes((name.split('.').pop() ?? '').toLowerCase())) {
      setPrev({ err: `“${name}” is not a supported file. Use Excel (.xlsx, .xls), CSV, TSV or JSON.`, file: name });
      return;
    }
    setBusy(true);
    try {
      const data = await cvApi.importPreview(src);
      setPrev({ data });
      setSel(new Set(data.rows.filter(r => r.selected).map(r => r.index)));
      setDup('skip');
    } catch (e) {
      setPrev({ err: e instanceof CvApiError ? (e.field('file') ?? e.message) : errMsg(e), file: name });
    } finally { setBusy(false); }
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !busy) load(f);
  };

  const data = prev && 'data' in prev ? prev.data : null;
  const rows = data?.rows ?? [];
  // In "Skip" mode the server drops duplicate rows, so they can't be ticked and never count towards the import.
  const pickable = (r: ImportPreviewRow) => r.ok && !(dup === 'skip' && isDup(r));
  const okRows = rows.filter(pickable);
  const picked = okRows.filter(r => sel.has(r.index)).map(r => r.index);
  const allOn = picked.length > 0 && picked.length === okRows.length;

  const toggle = (r: ImportPreviewRow) => {
    if (!r.ok) return;
    if (!pickable(r)) { toast.info('Duplicates are skipped', 'Choose “Import as copy” below to include rows already in your vault.'); return; }
    setSel(s => { const n = new Set(s); if (n.has(r.index)) n.delete(r.index); else n.add(r.index); return n; });
  };
  const toggleAll = () => setSel(allOn ? new Set() : new Set(okRows.map(r => r.index)));
  const chooseDup = (m: 'skip' | 'copy') => {
    setDup(m);
    setSel(s => {
      const n = new Set(s);
      rows.forEach(r => { if (r.ok && isDup(r)) { if (m === 'copy') n.add(r.index); else n.delete(r.index); } });
      return n;
    });
  };

  const run = async () => {
    if (!data || !picked.length) return;
    setRunning(true);
    try {
      const r = await cvApi.importRun({ token: data.token, rows: picked, duplicates: dup });
      toast.success(r.message);
      setPrev(null); setSel(new Set());
      onImported();
    } catch (e) {
      toast.error('Import failed', errMsg(e));
      // An expired or used preview can't be retried — upload again.
      if (e instanceof CvApiError && e.status === 410) setPrev(null);
    } finally { setRunning(false); }
  };

  const st = (v: number, l: string, cls = '') => <div className={`ix-st ${cls}`}><b>{v}</b><small>{l}</small></div>;

  let right: ReactNode;
  if (!prev) {
    right = (
      <div className="ix-empty">
        <div className="ix-empty__art"><span><Svg d={IR_I.sheet} size={22} /></span><span><Svg d={IR_I.check} size={22} /></span><span><Svg d={IR_I.shield} size={22} /></span></div>
        <b>Your review will appear here</b>
        <small>After you upload a file, every row is listed with its checks. You choose exactly what to import — nothing is saved until you confirm.</small>
        <div className="ix-empty__k">
          {[['Ready', 'ok'], ['Already in vault', 'warn'], ['Weak password', 'bad'], ['Missing password', 'bad']].map(([l, c]) => <span key={l} className={`ir-flag ir-flag--${c}`}>{l}</span>)}
        </div>
      </div>
    );
  } else if (!data) {
    const p = prev as { err: string; file: string };
    right = (
      <div className="ix-empty is-err">
        <div className="ix-empty__art"><span><Svg d={IR_I.warn} size={22} /></span></div>
        <b>We couldn’t import “{p.file || 'this file'}”</b>
        <small>{p.err}</small>
        <div className="ix-smp">
          {([['xlsx', 'Excel sample', IR_I.sheet], ['csv', 'CSV sample', IR_I.file]] as const).map(([k, l, ic]) => (
            <button key={k} type="button" data-h40="skip" onClick={() => sample(k)}><Svg d={ic} size={13} />{l}<Svg d={IR_I.down} size={11} /></button>
          ))}
        </div>
      </div>
    );
  } else {
    right = (
      <>
        <div className="ix-sts">
          {st(data.stats.rows, 'Rows')}
          {st(data.stats.ready, 'Ready', 'is-ok')}
          {st(data.stats.duplicates, 'Duplicates', 'is-warn')}
          {st(data.stats.weak, 'Weak', 'is-bad')}
          {st(data.stats.cannot, 'Can’t import', 'is-mute')}
        </div>
        <div className="ix-tblw">
          <table className="ix-tbl">
            <thead>
              <tr>
                <th><span className={`ir-ck${allOn ? ' is-on' : ''}`} role="checkbox" aria-checked={allOn} aria-label="Select all" onClick={toggleAll}><Svg d={IR_I.tick} size={10} /></span></th>
                <th>Credential</th><th>Username</th><th>Strength</th><th>Check</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(r => {
                const can = pickable(r);
                const on = can && sel.has(r.index);
                const lv = LV[r.strength] || 'weak';
                return (
                  <tr key={r.index} className={`${r.ok ? '' : 'is-off'}${on ? ' is-sel' : ''}`}>
                    <td><span className={`ir-ck${on ? ' is-on' : ''}${can ? '' : ' is-dis'}`} role="checkbox" aria-checked={on} aria-disabled={!can}
                      title={r.ok && !can ? 'Skipped — choose “Import as copy” to include duplicates' : undefined} onClick={() => toggle(r)}><Svg d={IR_I.tick} size={10} /></span></td>
                    <td>
                      <div className="ix-cr">
                        <span>{initials(r.name || '?')}</span>
                        <div><b>{r.name ? r.name : <i>Untitled</i>}</b><small>{r.url ? host(r.url) : 'No URL'}{r.category ? ` · ${r.category}` : ''}</small></div>
                      </div>
                    </td>
                    <td>{r.username ? r.username : <span className="mv-str--na">—</span>}</td>
                    <td>{r.has_password
                      ? <div className={`ix-pw ix-pw--${lv}`}><div><i style={{ width: `${r.strength * 25}%` }} /></div><span>{r.strength_label}</span></div>
                      : <span className="mv-str--na">None</span>}</td>
                    <td>
                      <div className="ir-flags">
                        {r.flags.length ? r.flags.map(f => (
                          <span key={f} className={`ir-flag ir-flag--${FLAG[f][1]}`} title={f === 'dup' && r.dup_of ? `Matches ${r.dup_of.code} · ${r.dup_of.name}` : undefined}>{FLAG[f][0]}</span>
                        )) : <span className="ir-flag ir-flag--ok"><Svg d={IR_I.tick} size={10} />Ready</span>}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <div className="ix-foot">
          <div className="ix-dup">
            <small>Already in My Vault?</small>
            <div className="ir-seg">
              <button type="button" data-h40="skip" className={dup === 'skip' ? 'is-on' : ''} onClick={() => chooseDup('skip')}>Skip</button>
              <button type="button" data-h40="skip" className={dup === 'copy' ? 'is-on' : ''} onClick={() => chooseDup('copy')}>Import as copy</button>
            </div>
          </div>
          <button type="button" data-h40="skip" className="ir-btn ir-btn--pri" onClick={run} disabled={!picked.length || running}>
            <Svg d={IR_I.up} size={14} />{running ? 'Importing…' : `Import ${picked.length} Credential${picked.length === 1 ? '' : 's'}`}
          </button>
        </div>
      </>
    );
  }

  return (
    <>
      <div className="ix-guide">
        <div className="ix-g">
          <span className="ix-g__n">1</span>
          <div className="ix-g__t">
            <b>Download the sample file</b><small>It already has the right columns and two example rows.</small>
            <div className="ix-smp">
              {([['xlsx', 'Excel', IR_I.sheet], ['csv', 'CSV', IR_I.file], ['json', 'JSON', IR_I.code]] as const).map(([k, l, ic]) => (
                <button key={k} type="button" data-h40="skip" onClick={() => sample(k)}><Svg d={ic} size={13} />{l}<Svg d={IR_I.down} size={11} /></button>
              ))}
            </div>
          </div>
        </div>
        <span className="ix-g__arr"><Svg d={IR_I.chev} size={14} /></span>
        <div className="ix-g">
          <span className="ix-g__n">2</span>
          <div className="ix-g__t">
            <b>Fill in your credentials</b><small>One credential per row. Keep the first row (column names) as it is.</small>
            <div className="ix-cols">{COLS.map(c => <code key={c} className={c === 'name' || c === 'password' ? 'is-req' : ''}>{c}</code>)}</div>
          </div>
        </div>
        <span className="ix-g__arr"><Svg d={IR_I.chev} size={14} /></span>
        <div className="ix-g">
          <span className="ix-g__n">3</span>
          <div className="ix-g__t">
            <b>Upload &amp; review</b><small>Every row is checked for duplicates and weak passwords before anything is saved.</small>
            <div className="ix-dest"><Svg d={IR_I.lock} size={12} />Imports go to <b>My Vault</b> · Personal</div>
          </div>
        </div>
      </div>

      <div className="ix-grid">
        <IrCard icon={IR_I.up} title="Upload file" sub="Excel, CSV, TSV or JSON — up to 2,000 rows">
          <label className={`ix-drop${busy ? ' is-busy' : ''}${over ? ' is-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
            <input type="file" accept=".xlsx,.xls,.csv,.tsv,.txt,.json,.xml" disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f); }} />
            <span className="ix-drop__ico">{busy ? <span className="cp-spin" /> : <Svg d={IR_I.up} size={26} />}</span>
            <b>{busy ? 'Reading your file…' : 'Drag & drop your file here'}</b>
            <small>or <u>browse your computer</u></small>
            <div className="ix-fmts">{FMTS.map(([l, x, ic]) => <span key={l}><Svg d={ic} size={11} />{l} <em>{x}</em></span>)}</div>
          </label>
          <div className="ix-also">
            <Svg d={IR_I.globe} size={13} />
            <span>Moving from a browser or password manager? Upload its export as it is — <b>Chrome, Edge, Firefox, LastPass, 1Password, Bitwarden</b> and <b>KeePass</b> are recognised automatically.</span>
          </div>
          <button type="button" data-h40="skip" className="ix-try" disabled={busy} onClick={() => load('sample')}><Svg d={IR_I.eye} size={13} />No file yet? Try it with sample data</button>
        </IrCard>

        <IrCard icon={IR_I.check} title="Review & import" className="ix-review"
          sub={data ? `${data.file_name}${data.source ? ` · recognised as ${data.source}` : ''}` : 'Duplicates and weak passwords are flagged before saving'}
          extra={data ? <button type="button" data-h40="skip" className="ix-x" onClick={() => { setPrev(null); setSel(new Set()); }}><Svg d={IR_I.x} size={12} />Clear</button> : undefined}>
          {right}
        </IrCard>
      </div>
    </>
  );
}
