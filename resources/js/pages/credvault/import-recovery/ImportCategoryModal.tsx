import { useEffect, useRef, useState, type DragEvent } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { CvPortal, Svg } from '../shared';
import CrdSelect from '../form/CrdSelect';
import { IR_I } from './irShared';
import { IMPORT_CATEGORIES, sampleReview, type ImportReview } from './irSample';

const FMTS: [string, string, string][] = [['Excel', '.xlsx', IR_I.sheet], ['CSV', '.csv', IR_I.file]];
const EXTS = ['xlsx', 'csv'];
const READ_MS = 900;

export default function ImportCategoryModal({ initialFile, onClose, onReviewed }: {
  initialFile?: File | null; onClose: () => void; onReviewed: (review: ImportReview) => void;
}) {
  const toast = useToast();
  const [type, setType] = useState('');
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const timer = useRef<number | null>(null);
  const category = IMPORT_CATEGORIES.find(c => c.key === type) ?? null;

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const read = (f: File, cat = category) => {
    if (!EXTS.includes((f.name.split('.').pop() ?? '').toLowerCase())) {
      toast.error(`“${f.name}” is not a supported file`, 'Use Excel (.xlsx) or CSV (.csv).');
      return;
    }
    setFile(f);
    if (!cat) return;
    setBusy(true);
    timer.current = window.setTimeout(() => {
      setBusy(false);
      onReviewed(sampleReview(cat, f.name));
    }, READ_MS);
  };

  const pick = (key: string) => {
    setType(key);
    const cat = IMPORT_CATEGORIES.find(c => c.key === key) ?? null;
    if (file && cat && !busy) read(file, cat);
  };

  const onDrop = (e: DragEvent<HTMLLabelElement>) => {
    e.preventDefault(); setOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && !busy && category) read(f);
  };

  const close = () => { if (!busy) onClose(); };
  const locked = !category || busy;

  return (
    <CvPortal onClose={close}>
      <div id="crd-host">
        <div className="mapsup-overlay">
          <div className="mapsup-box crd-box gp-box ir-cat-box" role="dialog" aria-modal="true" aria-label="Select the category to import">
            <div className="mapsup-header gp-hd">
              <div className="mapsup-hrow">
                <div className="mapsup-title-wrap">
                  <div className="mapsup-hicon crd-hicon"><Svg d={IR_I.sheet} size={22} sw={2.1} /></div>
                  <div className="mapsup-title-block">
                    <h3 className="mapsup-title">Import by category</h3>
                    <p className="mapsup-sub">Pick the category of the credentials in your file, then upload its Excel or CSV sheet.</p>
                  </div>
                </div>
                <div className="crd-hbtns">
                  <button type="button" className="mapsup-close" onClick={close} disabled={busy} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
                </div>
              </div>
            </div>

            <div className="mapsup-body gp-body ir-imp-body">
              <div className="ir-cat-f">
                <label htmlFor="ir-cat">Category <i>*</i></label>
                <CrdSelect id="ir-cat" value={type} placeholder="Select the category you want to import"
                  options={IMPORT_CATEGORIES.map(c => ({ value: c.key, label: `${c.label} — ${c.group}` }))} onChange={pick} disabled={busy} />
                <small>The same 25 categories as the Add credential form. Every row in the file is checked as that category's form checks it.</small>
              </div>

              <label className={`ix-drop${busy ? ' is-busy' : ''}${over ? ' is-over' : ''}${!category ? ' is-off' : ''}`}
                onDragOver={e => { e.preventDefault(); if (category) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
                <input type="file" accept=".xlsx,.csv" disabled={locked}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
                <span className="ix-drop__ico">{busy ? <span className="cp-spin" /> : <Svg d={IR_I.up} size={26} />}</span>
                <b>{busy ? `Checking your ${category?.label ?? ''} sheet…` : category ? `Import the ${category.label} Excel or CSV file` : 'Select a category first'}</b>
                <small>{category ? <>Drag &amp; drop it here, or <u>browse your computer</u></> : 'The upload opens once a category is picked'}</small>
                {file && !busy && <span className="ir-cat-file"><Svg d={IR_I.file} size={11} />{file.name}</span>}
                <div className="ix-fmts">{FMTS.map(([l, x, ic]) => <span key={l}><Svg d={ic} size={11} />{l} <em>{x}</em></span>)}</div>
              </label>
            </div>

            <div className="mapsup-footer">
              <div className="mapsup-footer__info"><Svg d={IR_I.lock} size={12} /> Nothing is saved until you review the rows and press Save</div>
              <div className="mapsup-footer__actions">
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={close} disabled={busy}>Cancel</button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CvPortal>
  );
}
