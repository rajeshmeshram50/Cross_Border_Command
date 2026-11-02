import { useState } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi, type CredentialRow } from '../cvApi';
import { ConfirmModal, CvPortal, errMsg, Svg, useCvMeta } from '../shared';

/**
 * CredVault · "Move to Recycle Bin" (own credential) / "Remove from your
 * vault?" (shared with you) confirm. Calls the API itself; onDone after.
 */
export interface BinConfirmProps {
  row: Pick<CredentialRow, 'id' | 'code' | 'name' | 'type' | 'type_label' | 'url' | 'risk' | 'scope' | 'access' | 'active_shares'>;
  onClose: () => void;
  onDone: () => void;
}

const BIN = '<path d="M3 6h18M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>';
const PT_GONE = '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><line x1="18" y1="8" x2="23" y2="13"/><line x1="23" y1="8" x2="18" y2="13"/>';
const PT_RESTORE = '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 1 0 2.13-9.36L1 10"/>';
const PT_CLOCK = '<circle cx="12" cy="12" r="9"/><polyline points="12 7 12 12 15 14"/>';

export default function BinConfirm({ row, onClose, onDone }: BinConfirmProps) {
  const toast = useToast();
  const { meta, typeOf } = useCvMeta();
  const [busy, setBusy] = useState(false);
  const [ack, setAck] = useState(false);
  const shared = row.access?.via === 'share';

  const go = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const r = await cvApi.remove(row.id);
      toast.warning(r.message);
      onDone();
    } catch (e) {
      toast.error(shared ? 'Could not remove it' : 'Could not move it to the bin', errMsg(e));
      setBusy(false);
    }
  };

  // Shared with you: the short "Remove from your vault?" dialog — the owner's copy stays.
  if (shared) {
    return (
      <CvPortal onClose={onClose}>
        <div className="dl-ov" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="dl-modal" role="dialog" aria-modal="true" aria-label="Remove from your vault?">
            <div className="dl-ico"><Svg d={BIN} size={30} sw={2.1} /></div>
            <div className="dl-title">Remove from your vault?</div>
            <div className="dl-text">
              Are you sure you want to remove <b>{row.name}</b> <span className="dl-id">{row.code}</span>? The original stays with its owner.
            </div>
            <label className="dl-ack">
              <input type="checkbox" checked={ack} onChange={e => setAck(e.target.checked)} />
              <span className="dl-ack__box"><Svg icon="check" size={11} sw={3.2} /></span>
              <span>I understand and want to remove it.</span>
            </label>
            <div className="dl-actions">
              <button type="button" data-h40="skip" className="dl-cancel" onClick={onClose}>Cancel</button>
              <button type="button" data-h40="skip" className="dl-go" disabled={!ack || busy} onClick={go}>{busy ? 'Working…' : 'Remove'}</button>
            </div>
          </div>
        </div>
      </CvPortal>
    );
  }

  const days = meta?.policy.bin_days ?? 30;
  const until = new Date(Date.now() + days * 864e5).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
  const sh = row.active_shares;

  return (
    <ConfirmModal
      title="Move to Recycle Bin"
      sub={`You can restore it any time within ${days} days`}
      icon={BIN}
      cred={{ icon: typeOf(row.type)?.icon, name: row.name, code: row.code, meta: row.type_label + (row.url ? ` · ${row.url}` : ''), risk: row.risk }}
      points={[
        {
          icon: PT_GONE,
          title: `Removed from ${row.scope === 'team' ? 'Team' : 'My'} Vault`,
          text: sh ? `Access for ${sh} shared ${sh === 1 ? 'person' : 'people'} is paused` : 'It will no longer appear in any list',
        },
        { icon: PT_RESTORE, title: `Restorable for ${days} days`, text: 'From the Recycle Bin, with all its details' },
        { icon: PT_CLOCK, title: `Permanently deleted on ${until}`, text: 'Unless you restore it before then' },
      ]}
      ackLabel={<>Yes, move <b>{row.name}</b> to the recycle bin</>}
      confirmLabel="Move to Bin"
      confirmIcon={BIN}
      busy={busy}
      onConfirm={go}
      onClose={onClose}
    />
  );
}
