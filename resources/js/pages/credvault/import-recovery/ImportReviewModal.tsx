import { useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, CvApiError } from '../cvApi';
import { CvPortal, CvTabsRow, Svg, errMsg } from '../shared';
import { IR_I } from './irShared';
import type { ImportReview } from './irReview';

type Tab = 'accepted' | 'discarded';

/**
 * Review of one category's sheet (POST /imports/preview with type). Save sends the accepted rows to
 * POST /imports { token, rows, duplicates: 'skip' }, where each row is saved through the category's
 * Add form — a row that form still refuses comes back as failed in the history.
 */
export default function ImportReviewModal({ review, onBack, onExpired, onSaved }: {
  review: ImportReview; onBack: () => void;
  /** The preview's token expired or was used: the file has to be uploaded again. */
  onExpired: () => void;
  onSaved: (message: string) => void;
}) {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('accepted');
  const [busy, setBusy] = useState(false);
  const { category, accepted, discarded } = review;
  const weak = accepted.filter(r => r.weak).length;

  const save = async () => {
    if (busy || !accepted.length) return;
    setBusy(true);
    try {
      const r = await cvApi.importRun({ token: review.token, rows: accepted.map(x => x.index), duplicates: 'skip' });
      onSaved(r.message);
    } catch (e) {
      setBusy(false);
      if (e instanceof CvApiError && e.status === 410) {
        toast.error('This review has expired', 'Upload the file again to import it.');
        onExpired();
        return;
      }
      toast.error('Could not import', errMsg(e));
    }
  };
  const back = () => { if (!busy) onBack(); };

  return (
    <CvPortal onClose={back}>
      <div id="crd-host">
        <div className="mapsup-overlay">
          <div className="mapsup-box crd-box gp-box ir-rev-box" role="dialog" aria-modal="true" aria-label="Review the import">
            <div className="mapsup-header gp-hd">
              <div className="mapsup-hrow">
                <div className="mapsup-title-wrap">
                  <div className="mapsup-hicon crd-hicon"><Svg d={IR_I.check} size={22} sw={2.1} /></div>
                  <div className="mapsup-title-block">
                    <h3 className="mapsup-title">Review {category.label} import</h3>
                    <p className="mapsup-sub">
                      {review.fileName}{review.sheet ? ` · “${review.sheet}” tab` : ''} · {accepted.length + discarded.length} rows checked · accepted rows are saved to My Vault
                    </p>
                  </div>
                </div>
                <div className="crd-hbtns">
                  <button type="button" className="mapsup-close" onClick={back} disabled={busy} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
                </div>
              </div>
            </div>

            <div className="mapsup-body gp-body ir-imp-body">
              <CvTabsRow active={tab} onTab={k => setTab(k as Tab)} tabs={[
                { key: 'accepted', label: 'Accepted Records', icon: IR_I.check, count: accepted.length },
                { key: 'discarded', label: 'Discarded Records', icon: IR_I.warn, count: discarded.length },
              ]} />

              {review.ignoredColumns.length > 0 && (
                <div className="ix-note"><Svg d={IR_I.warn} size={13} />
                  <span>Columns not in the {category.label} layout were ignored: {review.ignoredColumns.join(', ')}.</span>
                </div>
              )}

              <div className="tvc-list ir-rev-list">
              <div className="whm-tblwrap">
                {tab === 'accepted' ? (
                  <table className="whm-tbl mv-tbl">
                    <colgroup><col style={{ width: '8%' }} /><col style={{ width: '12%' }} /><col style={{ width: '32%' }} /><col style={{ width: '12%' }} /><col style={{ width: '36%' }} /></colgroup>
                    <thead><tr><th>Sr. No</th><th>Sheet Row</th><th className="ir-al">Credential Name</th><th>Strength</th><th>Check</th></tr></thead>
                    <tbody>
                      {accepted.length ? accepted.map((r, i) => (
                        <tr key={r.row}>
                          <td><span className="whm-sr">{i + 1}</span></td>
                          <td><span className="whm-idpill">Row {r.row}</span></td>
                          <td className="ir-al"><b title={r.name}>{r.name}</b></td>
                          <td>{r.strength ?? <span className="mv-str--na">—</span>}</td>
                          <td>
                            <div className="ir-flags">
                              {r.weak && <span className="ir-flag ir-flag--bad">Weak password</span>}
                              {r.notes.map(n => <span key={n} className="ir-flag ir-flag--warn" title={n}>{n}</span>)}
                              {!r.weak && !r.notes.length && <span className="ir-flag ir-flag--ok"><Svg d={IR_I.tick} size={10} />Ready</span>}
                            </div>
                          </td>
                        </tr>
                      )) : <tr><td colSpan={5} className="mv-empty"><div className="mv-empty__box"><div className="mv-empty__t">No row can be imported</div><div className="mv-empty__s">See Discarded Records for the reasons.</div></div></td></tr>}
                    </tbody>
                  </table>
                ) : (
                  <table className="whm-tbl mv-tbl">
                    <colgroup><col style={{ width: '8%' }} /><col style={{ width: '12%' }} /><col style={{ width: '30%' }} /><col style={{ width: '50%' }} /></colgroup>
                    <thead><tr><th>Sr. No</th><th>Sheet Row</th><th className="ir-al">Credential Name</th><th className="ir-al">Why it was discarded</th></tr></thead>
                    <tbody>
                      {discarded.length ? discarded.map((r, i) => (
                        <tr key={r.row}>
                          <td><span className="whm-sr">{i + 1}</span></td>
                          <td><span className="whm-idpill">Row {r.row}</span></td>
                          <td className="ir-al">{r.name ? <b title={r.name}>{r.name}</b> : <i className="mv-str--na">Untitled</i>}</td>
                          <td className="ir-al">
                            <ul className="ir-why">{r.reasons.map((x, k) => <li key={`${x.field}-${k}`}>{x.label ? <b>{x.label}:</b> : null} {x.message}</li>)}</ul>
                          </td>
                        </tr>
                      )) : <tr><td colSpan={4} className="mv-empty"><div className="mv-empty__box"><div className="mv-empty__t">Every row was accepted</div></div></td></tr>}
                    </tbody>
                  </table>
                )}
              </div>
              </div>
            </div>

            <div className="mapsup-footer">
              <div className="mapsup-footer__info">
                <Svg d={IR_I.lock} size={12} /> {accepted.length} will be saved · {discarded.length} discarded{weak ? ` · ${weak} with weak passwords` : ''}
              </div>
              <div className="mapsup-footer__actions">
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={back} disabled={busy}>Back</button>
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--primary" onClick={save} disabled={busy || !accepted.length}>
                  {busy ? 'Saving…' : `Save ${accepted.length} Record${accepted.length === 1 ? '' : 's'}`}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </CvPortal>
  );
}
