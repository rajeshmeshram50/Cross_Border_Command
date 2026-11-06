import { useEffect, useRef, useState } from 'react';
import { CvPortal, CvTabsRow, Svg } from '../shared';
import { IR_I } from './irShared';
import type { ImportReview } from './irSample';

type Tab = 'accepted' | 'discarded';
const SAVE_MS = 800;

export default function ImportReviewModal({ review, onBack, onSaved }: {
  review: ImportReview; onBack: () => void; onSaved: (review: ImportReview) => void;
}) {
  const [tab, setTab] = useState<Tab>('accepted');
  const [busy, setBusy] = useState(false);
  const timer = useRef<number | null>(null);
  const { category, accepted, discarded } = review;
  const weak = accepted.filter(r => r.flags.includes('weak')).length;

  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const save = () => {
    if (busy || !accepted.length) return;
    setBusy(true);
    timer.current = window.setTimeout(() => onSaved(review), SAVE_MS);
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
                    <p className="mapsup-sub">{review.fileName} · {accepted.length + discarded.length} rows checked · accepted rows are saved to My Vault</p>
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

              <div className="tvc-list ir-rev-list">
              <div className="whm-tblwrap">
                {tab === 'accepted' ? (
                  <table className="whm-tbl mv-tbl">
                    <colgroup><col style={{ width: '8%' }} /><col style={{ width: '12%' }} /><col style={{ width: '30%' }} /><col style={{ width: '22%' }} /><col style={{ width: '11%' }} /><col style={{ width: '17%' }} /></colgroup>
                    <thead><tr><th>Sr. No</th><th>Sheet Row</th><th className="ir-al">Credential Name</th><th className="ir-al">{category.idLabel}</th><th>Strength</th><th>Check</th></tr></thead>
                    <tbody>
                      {accepted.length ? accepted.map((r, i) => (
                        <tr key={r.row}>
                          <td><span className="whm-sr">{i + 1}</span></td>
                          <td><span className="whm-idpill">Row {r.row}</span></td>
                          <td className="ir-al"><b>{r.name}</b></td>
                          <td className="ir-al">{r.identifier}</td>
                          <td>{r.strength ?? <span className="mv-str--na">—</span>}</td>
                          <td>
                            <div className="ir-flags">
                              {r.flags.includes('weak') && <span className="ir-flag ir-flag--bad">Weak password</span>}
                              {r.flags.includes('attach') && <span className="ir-flag ir-flag--warn">Attach file after import</span>}
                              {!r.flags.length && <span className="ir-flag ir-flag--ok"><Svg d={IR_I.tick} size={10} />Ready</span>}
                            </div>
                          </td>
                        </tr>
                      )) : <tr><td colSpan={6} className="mv-empty"><div className="mv-empty__box"><div className="mv-empty__t">No row can be imported</div></div></td></tr>}
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
                          <td className="ir-al">{r.name ? <b>{r.name}</b> : <i className="mv-str--na">Untitled</i>}</td>
                          <td className="ir-al">
                            <ul className="ir-why">{r.reasons.map(x => <li key={x.label}><b>{x.label}:</b> {x.message}</li>)}</ul>
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
