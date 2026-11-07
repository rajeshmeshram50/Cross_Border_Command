import { useEffect, useState, type DragEvent } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError, type ImportType } from '../cvApi';
import { CvPortal, Svg, errMsg } from '../shared';
import CrdSelect from '../form/CrdSelect';
import { IR_I, ImportVeil } from './irShared';
import { buildReview, type ImportReview } from './irReview';

const FMTS: [string, string, string][] = [['Excel', '.xlsx', IR_I.sheet], ['CSV', '.csv', IR_I.file]];
const EXTS = ['xlsx', 'csv'];

/**
 * Import by category: GET /imports/types fills the dropdown; the chosen category's sheet goes to
 * POST /imports/preview { type, file }, which checks every row as that category's Add form does.
 */
export default function ImportCategoryModal({ initialFile, onClose, onReviewed }: {
  initialFile?: File | null; onClose: () => void; onReviewed: (review: ImportReview) => void;
}) {
  const toast = useToast();
  const [types, setTypes] = useState<ImportType[] | null>(null);
  const [maxRows, setMaxRows] = useState(2000);
  const [typesErr, setTypesErr] = useState('');
  const [type, setType] = useState('');
  const [file, setFile] = useState<File | null>(initialFile ?? null);
  const [fileErr, setFileErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const category = types?.find(c => c.key === type) ?? null;

  const loadTypes = () => {
    setTypesErr('');
    cvApi.importTypes()
      .then(r => { setTypes(r.data); setMaxRows(r.meta?.max_rows ?? 2000); })
      .catch(e => setTypesErr(errMsg(e)));
  };
  useEffect(loadTypes, []);

  const read = async (f: File, cat: ImportType | null = category) => {
    setFileErr('');
    if (!EXTS.includes((f.name.split('.').pop() ?? '').toLowerCase())) {
      setFileErr(`“${f.name}” is not a supported file. Use Excel (.xlsx) or CSV (.csv).`);
      return;
    }
    setFile(f);
    if (!cat) return;
    setBusy(true);
    try {
      const preview = await cvApi.importPreviewTyped(cat.key, f);
      onReviewed(buildReview(cat, preview));
    } catch (e) {
      setFileErr(e instanceof CvApiError ? (e.field('file') ?? e.field('type') ?? e.message) : errMsg(e));
      setBusy(false);
    }
  };

  const pick = (key: string) => {
    setType(key);
    const cat = types?.find(c => c.key === key) ?? null;
    if (file && cat && !busy) read(file, cat);
  };

  const sample = async (fmt: 'xlsx' | 'csv') => {
    if (!category) return;
    try {
      await cvApi.importSample(fmt, category.key);
      toast.success(`${category.label} sample downloaded`, 'Fill it in and upload it here');
    } catch (e) { toast.error('Could not download the sample', errMsg(e)); }
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
            {busy && <ImportVeil label={`Checking your ${category?.label ?? ''} sheet…`} />}
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
                <CrdSelect id="ir-cat" value={type} disabled={busy || !types}
                  placeholder={types ? 'Select the category you want to import' : typesErr ? 'Could not load the categories' : 'Loading categories…'}
                  options={(types ?? []).map(c => ({ value: c.key, label: `${c.label} — ${c.group}` }))} onChange={pick} />
                {typesErr
                  ? <small className="ir-cat-err">{typesErr} <button type="button" data-h40="skip" className="ir-cat-retry" onClick={loadTypes}>Retry</button></small>
                  : <small>The same {types?.length ?? 25} categories as the Add credential form. Every row in the file is checked as that category's form checks it.</small>}
              </div>

              {category && (
                <div className="ir-cat-smp">
                  <span>Need the {category.label} sheet? Download its sample — the “{category.sheet}” layout with two example rows:</span>
                  <div className="ix-smp">
                    {([['xlsx', 'Excel', IR_I.sheet], ['csv', 'CSV', IR_I.file]] as const).map(([k, l, ic]) => (
                      <button key={k} type="button" data-h40="skip" onClick={() => sample(k)}><Svg d={ic} size={13} />{l}<Svg d={IR_I.down} size={11} /></button>
                    ))}
                  </div>
                </div>
              )}

              <label className={`ix-drop${busy ? ' is-busy' : ''}${over ? ' is-over' : ''}${!category ? ' is-off' : ''}`}
                onDragOver={e => { e.preventDefault(); if (category) setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
                <input type="file" accept=".xlsx,.csv" disabled={locked}
                  onChange={e => { const f = e.target.files?.[0]; e.target.value = ''; if (f) read(f); }} />
                <span className="ix-drop__ico">{busy ? <span className="cp-spin" /> : <Svg d={IR_I.up} size={26} />}</span>
                <b>{busy ? `Checking your ${category?.label ?? ''} sheet…` : category ? `Import the ${category.label} Excel or CSV file` : 'Select a category first'}</b>
                <small>{category ? <>Drag &amp; drop it here, or <u>browse your computer</u> · up to {maxRows.toLocaleString('en-IN')} rows</> : 'The upload opens once a category is picked'}</small>
                {file && !busy && <span className="ir-cat-file"><Svg d={IR_I.file} size={11} />{file.name}</span>}
                <div className="ix-fmts">{FMTS.map(([l, x, ic]) => <span key={l}><Svg d={ic} size={11} />{l} <em>{x}</em></span>)}</div>
              </label>
              {fileErr && <div className="ir-cat-err ir-cat-err--file"><Svg d={IR_I.warn} size={13} /><span>{fileErr}</span></div>}
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
