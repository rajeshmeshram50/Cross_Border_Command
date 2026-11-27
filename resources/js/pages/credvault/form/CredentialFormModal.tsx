import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { cvApi, recentDetail, rowHints, type CredentialDetail, type CredentialRow, type TypeDef } from '../cvApi';
import { CvPortal, ShimCredForm, Svg, cap, errMsg, useCvMeta } from '../shared';
import { typeColor } from './formHelpers';
import CredentialForm from './CredentialForm';
import TypePicker from './TypePicker';
import './form.css';

export interface CredentialFormProps {
  credentialId?: number;
  initialType?: string;
  critical?: boolean;
  prefillPassword?: string;
  scope?: 'personal' | 'team';
  departmentId?: number | null;
  previewRow?: CredentialRow;
  /** Detail already loaded for `credentialId` (e.g. by the view drawer): used instead of fetching it again. */
  initialDetail?: CredentialDetail;
  onClose: () => void;
  onSaved: (c: CredentialDetail) => void;
}

const SAMPLE_PW = ['', 'tally123', 'tallycloud2026', 'Tally@2026', 'Tq#9vL!m2Rx$8wPz'];

function previewDetail(row: CredentialRow, T: TypeDef): CredentialDetail {
  const loose = row as unknown as Record<string, unknown>;
  return {
    ...row,
    rotation_days: row.rotation_days ?? 90,
    can: row.can ? { ...row.can, edit_protection: true } : row.can,
    locked: false, updated_by: row.owner.name,
    fields: T.fields.filter(f => f.kind !== 'file').map(f => {
      const own = typeof loose[f.key] === 'string' ? loose[f.key] as string : null;
      const value = f.secret ? (row.has_password ? SAMPLE_PW[row.strength_level] || null : null)
        : own ?? (f.kind === 'url' ? row.url : null);
      return { key: f.key, label: f.label, kind: f.kind, value, masked: f.secret, has_value: f.secret ? row.has_password : !!value };
    }),
    recovery: { reg_email: null, reg_phone: null, has_recovery_key: false },
    notes: null, attachments: [],
    protection: row.risk === 'critical' ? {
      admin: row.lock_steps.includes('admin'), admin_user: null,
      manager: row.lock_steps.includes('manager'), manager_user: null,
      otp: row.lock_steps.includes('otp'), otp_linked: row.lock_steps.includes('otp'),
      policy: { admin: true, manager: true, otp: true },
    } : undefined,
  };
}

/* What the loaded form's header will show, known up front from the list row,
   so the header does not change once the detail arrives. */
interface WaitHead { T: TypeDef; noun: string; name: string; code: string; risk: string }

function Wait({ title, text, onClose, error, onRetry, head }: { title: string; text: string; onClose: () => void; error?: boolean; onRetry?: () => void; head?: WaitHead }) {
  const h = !error ? head : undefined;
  return (
    <div className="mapsup-overlay">
      <div className="mapsup-box crd-box" role="dialog" aria-modal="true" aria-label={h ? `Edit ${h.noun}` : title}>
        <div className="mapsup-header">
          <div className="mapsup-hrow">
            <div className="mapsup-title-wrap">
              {h ? (
                <>
                  <div className="mapsup-hicon crd-hicon" style={{ '--tc': typeColor(h.T.key) } as CSSProperties}><Svg icon={h.T.icon} size={20} /></div>
                  <div className="mapsup-title-block">
                    <h3 className="mapsup-title">Edit {h.noun}</h3>
                    <p className="mapsup-sub">Update <b>{h.name}</b> <span className="crd-edit-id">{h.code}</span> — every field is pre-filled, change only what you need.</p>
                  </div>
                </>
              ) : (
                <>
                  <div className="mapsup-hicon crd-hicon"><Svg icon={error ? 'x' : 'lock'} size={20} /></div>
                  <div className="mapsup-title-block"><h3 className="mapsup-title">{title}</h3></div>
                </>
              )}
            </div>
            <div className="crd-hbtns">
              {h && <span className={`znm-flag mv-rk mv-rk--${h.risk}`} title="Risk level"><i />{cap(h.risk)}</span>}
              <button type="button" className="mapsup-close" onClick={onClose} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button>
            </div>
          </div>
        </div>
        <div className="mapsup-body">
          {error
            ? <div className="cv-form-wait"><b>Could not open the form</b><span>{text}</span></div>
            : <ShimCredForm />}
        </div>
        <div className="mapsup-footer">
          <div className="mapsup-footer__info" />
          <div className="mapsup-footer__actions">
            <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={onClose}>Close</button>
            {onRetry && <button type="button" className="mapsup-footer__btn mapsup-footer__btn--primary" onClick={onRetry}>Try again</button>}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function CredentialFormModal({ credentialId, initialType, critical, prefillPassword, scope, departmentId, previewRow, initialDetail, onClose, onSaved }: CredentialFormProps) {
  const { meta, typeOf, error: metaFailed, reload: reloadMeta } = useCvMeta();
  const [typeKey, setTypeKey] = useState<string | null>(credentialId ? null : initialType ?? null);
  const [detail, setDetail] = useState<CredentialDetail | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const retryMeta = () => { setRetrying(true); reloadMeta().finally(() => setRetrying(false)); };

  const previewT = previewRow ? typeOf(previewRow.type) : null;
  const preview = useMemo(() => (previewRow && previewT ? previewDetail(previewRow, previewT) : null), [previewRow, previewT]);
  useEffect(() => { if (preview) { setDetail(preview); setTypeKey(preview.type); } }, [preview]);

  useEffect(() => {
    if (!credentialId || previewRow) return;
    setFailed(null);
    // Detail handed in, or fetched moments ago by the view drawer this Edit was clicked from.
    const ready = initialDetail && initialDetail.id === credentialId ? initialDetail : recentDetail(credentialId);
    if (ready) {
      if (ready.can && !ready.can.edit) setFailed('Only the owner, a Vault Admin or someone with Full Access can edit this credential.');
      else { setDetail(ready); setTypeKey(ready.type); }
      return;
    }
    let on = true;
    setDetail(null);
    cvApi.show(credentialId)
      .then(d => {
        if (!on) return;
        if (d.can && !d.can.edit) setFailed('Only the owner, a Vault Admin or someone with Full Access can edit this credential.');
        else { setDetail(d); setTypeKey(d.type); }
      })
      .catch(e => { if (on) setFailed(errMsg(e)); });
    return () => { on = false; };
  }, [credentialId]);

  const T = typeOf(typeKey);
  const title = credentialId ? 'Edit Credential' : 'Add Credential';

  // Header for the loading state, built the same way CredentialForm builds its own.
  const hint = credentialId ? rowHints.get(credentialId) : undefined;
  const hintT = hint ? typeOf(hint.type) : null;
  const head: WaitHead | undefined = hint && hintT ? {
    T: hintT,
    noun: (critical || !!hint.critical_code) && /\bcredentials?$/i.test(hintT.label) ? hintT.label : `${hintT.label} Credentials`,
    name: hint.name, code: hint.code, risk: hint.risk,
  } : undefined;

  let content;
  if (failed) content = <Wait title={title} text={failed} onClose={onClose} error />;
  else if (!meta) {
    const err = retrying ? null : metaFailed;
    content = <Wait title={title} text={err ?? 'Loading credential types…'} onClose={onClose} error={!!err} onRetry={err ? retryMeta : undefined} head={head} />;
  }
  else if (credentialId && !detail) content = <Wait title={title} text="Loading the credential…" onClose={onClose} head={head} />;
  else if (credentialId && !T) content = <Wait title={title} text={`This credential's type (${typeKey}) is no longer offered.`} onClose={onClose} error />;
  else if (!T) content = <TypePicker meta={meta} critical={!!critical} onPick={setTypeKey} onClose={onClose} />;
  else {
    content = (
      <CredentialForm key={`${T.key}:${detail?.id ?? 'new'}`} meta={meta} T={T} detail={detail} preview={!!previewRow}
        init={{ critical, prefillPassword, scope, departmentId }}
        onClose={onClose} onSaved={onSaved}
        onChangeType={credentialId ? undefined : () => setTypeKey(null)} />
    );
  }

  return (
    <CvPortal onClose={onClose}>
      <div id="crd-host" className={critical ? 'crd-host--cv' : undefined}>{content}</div>
    </CvPortal>
  );
}
