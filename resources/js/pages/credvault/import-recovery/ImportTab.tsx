import { useState, type DragEvent } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError } from '../cvApi';
import { Svg, errMsg } from '../shared';
import { IR_I, IrCard } from './irShared';

const COLS = ['name', 'url', 'username', 'password', 'category', 'notes'];
const FMTS: [string, string, string][] = [['Excel', '.xlsx', IR_I.sheet], ['CSV', '.csv', IR_I.file]];
const EXTS = ['xlsx', 'csv'];

export default function ImportTab() {
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);

  const sample = async (fmt: 'xlsx' | 'csv') => {
    try {
      await cvApi.importSample(fmt);
      toast.success('Sample file downloaded', 'Fill it in and upload it here');
    } catch (e) { toast.error('Could not download the sample', errMsg(e)); }
  };

  const load = async (src: File) => {
    const name = src.name;
    if (!EXTS.includes((name.split('.').pop() ?? '').toLowerCase())) {
      toast.error(`“${name}” is not a supported file`, 'Use Excel (.xlsx) or CSV (.csv).');
      return;
    }
    setBusy(true);
    try {
      const data = await cvApi.importPreview(src);
      const s = data.stats;
      toast.success(`${name} · ${s.rows} ${s.rows === 1 ? 'row' : 'rows'} checked`,
        `${s.ready} ready · ${s.duplicates} duplicates · ${s.weak} weak · ${s.cannot} can’t import`);
    } catch (e) {
      toast.error(`We couldn’t read “${name}”`, e instanceof CvApiError ? (e.field('file') ?? e.message) : errMsg(e));
    } finally { setBusy(false); }
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !busy) load(f);
  };

  return (
    <>
      <div className="ix-guide">
        <div className="ix-g">
          <span className="ix-g__n">1</span>
          <div className="ix-g__t">
            <b>Download the sample file</b><small>It already has the right columns and two example rows.</small>
            <div className="ix-smp">
              {([['xlsx', 'Excel', IR_I.sheet], ['csv', 'CSV', IR_I.file]] as const).map(([k, l, ic]) => (
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

      <div className="ix-grid ix-grid--one">
        <IrCard icon={IR_I.up} title="Upload file" sub="Excel or CSV — up to 2,000 rows">
          <label className={`ix-drop${busy ? ' is-busy' : ''}${over ? ' is-over' : ''}`}
            onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
            <input type="file" accept=".xlsx,.csv" disabled={busy}
              onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) load(f); }} />
            <span className="ix-drop__ico">{busy ? <span className="cp-spin" /> : <Svg d={IR_I.up} size={26} />}</span>
            <b>{busy ? 'Reading your file…' : 'Drag & drop your file here'}</b>
            <small>or <u>browse your computer</u></small>
            <div className="ix-fmts">{FMTS.map(([l, x, ic]) => <span key={l}><Svg d={ic} size={11} />{l} <em>{x}</em></span>)}</div>
          </label>
          <div className="ix-also">
            <Svg d={IR_I.globe} size={13} />
            <span>Moving from a browser or password manager? Upload its CSV export as it is — <b>Chrome, Edge, Firefox, LastPass, 1Password, Bitwarden</b> and <b>KeePass</b> are recognised automatically.</span>
          </div>        </IrCard>
      </div>
    </>
  );
}
