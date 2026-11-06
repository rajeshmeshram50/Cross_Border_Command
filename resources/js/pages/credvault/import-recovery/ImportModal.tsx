import { useState, type DragEvent } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi } from '../cvApi';
import { CvPortal, Svg, errMsg } from '../shared';
import { IR_I, IrCard } from './irShared';
import ImportCategoryModal from './ImportCategoryModal';
import ImportReviewModal from './ImportReviewModal';
import type { ImportReview } from './irReview';

const COLS = ['name', 'url', 'username', 'password', 'category', 'notes'];
const FMTS: [string, string, string][] = [['Excel', '.xlsx', IR_I.sheet], ['CSV', '.csv', IR_I.file]];

export default function ImportModal({ onClose, onImported }: { onClose: () => void; onImported: (message: string) => void }) {
  const toast = useToast();
  const [over, setOver] = useState(false);
  const [cat, setCat] = useState<{ file: File | null } | null>(null);
  const [review, setReview] = useState<ImportReview | null>(null);

  const sample = async (fmt: 'xlsx' | 'csv') => {
    try {
      await cvApi.importSample(fmt);
      toast.success('Sample file downloaded', 'Fill it in and upload it here');
    } catch (e) { toast.error('Could not download the sample', errMsg(e)); }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault(); setOver(false);
    setCat({ file: e.dataTransfer.files?.[0] ?? null });
  };

  const close = () => onClose();

  return (
    <CvPortal onClose={close}>
      <div id="crd-host">
        <div className="mapsup-overlay">
          <div className="mapsup-box crd-box gp-box ir-imp-box" role="dialog" aria-modal="true" aria-label="Import data">
            <div className="mapsup-header gp-hd">
              <div className="mapsup-hrow">
                <div className="mapsup-title-wrap">
                  <div className="mapsup-hicon crd-hicon"><Svg d={IR_I.up} size={22} sw={2.1} /></div>
                  <div className="mapsup-title-block">
                    <h3 className="mapsup-title">Import data</h3>
                    <p className="mapsup-sub">Bring credentials into My Vault in bulk from an Excel or CSV file.</p>
                  </div>
                </div>
                <div className="crd-hbtns">
                  <button type="button" className="mapsup-close" onClick={close} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
                </div>
              </div>
            </div>

            <div className="mapsup-body gp-body ir-imp-body">
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

              <IrCard icon={IR_I.up} title="Upload file" sub="Excel or CSV — up to 2,000 rows">
                <div role="button" tabIndex={0} className={`ix-drop${over ? ' is-over' : ''}`}
                  onClick={() => setCat({ file: null })} onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); setCat({ file: null }); } }}
                  onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)} onDrop={onDrop}>
                  <span className="ix-drop__ico"><Svg d={IR_I.up} size={26} /></span>
                  <b>Drag &amp; drop your file here</b>
                  <small>or <u>browse your computer</u> — you pick its category next</small>
                  <div className="ix-fmts">{FMTS.map(([l, x, ic]) => <span key={l}><Svg d={ic} size={11} />{l} <em>{x}</em></span>)}</div>
                </div>
                <div className="ix-also">
                  <Svg d={IR_I.globe} size={13} />
                  <span>Moving from a browser or password manager? Upload its CSV export as it is — <b>Chrome, Edge, Firefox, LastPass, 1Password, Bitwarden</b> and <b>KeePass</b> are recognised automatically.</span>
                </div>
              </IrCard>
            </div>

            <div className="mapsup-footer">
              <div className="mapsup-footer__info"><Svg d={IR_I.lock} size={12} /> Nothing is saved until every row has been checked</div>
              <div className="mapsup-footer__actions">
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={close}>Close</button>
              </div>
            </div>
          </div>
        </div>
      </div>
      {cat && <ImportCategoryModal initialFile={cat.file} onClose={() => setCat(null)}
        onReviewed={r => { setCat(null); setReview(r); }} />}
      {review && <ImportReviewModal review={review} onBack={() => setReview(null)}
        onExpired={() => { setReview(null); setCat({ file: null }); }}
        onSaved={m => { setReview(null); onImported(m); }} />}
    </CvPortal>
  );
}
