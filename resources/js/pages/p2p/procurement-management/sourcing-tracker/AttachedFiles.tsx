import Tooltip from '../../../../components/ui/Tooltip';
import { useToast } from '../../../../contexts/ToastContext';
import { viewDocument } from './targetProducts';
import { Svg } from './icons';
import './attached-files.css';

/* The files attached in an upload field (Product Clarity document, New Supplier business card):
   one row each with its icon, name, View (opens it in a new tab) and Remove. A file picked in
   this session (not saved yet) carries a NEW badge. */

type AttachedItem = {
  key: string;
  name: string;
  /** A picked File, or a stored clarity path (opened through the API). */
  src: File | string;
};

export default function AttachedFiles({ items, onRemove, disabled }: {
  items: AttachedItem[]; onRemove: (key: string) => void; disabled?: boolean;
}) {
  const toast = useToast();
  if (!items.length) return null;
  const view = (src: File | string) => {
    viewDocument(src).catch(() => toast.error('Couldn’t open the document', 'Please try again.'));
  };
  return (
    <div className="stfile-list">
      {items.map(it => (
        <div className="stfile" key={it.key}>
          <span className="stfile__ico" aria-hidden>
            <Svg size={15} sw={2.1}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></Svg>
          </span>
          <Tooltip label={it.name}><span className="stfile__name">{it.name}</span></Tooltip>
          {typeof it.src !== 'string' && <span className="stfile__new">New</span>}
          <Tooltip label="View document">
            <button type="button" className="stfile__btn" aria-label={`View ${it.name}`} onClick={() => view(it.src)}>
              <Svg size={14} sw={2.2}><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" /><circle cx="12" cy="12" r="3" /></Svg>
            </button>
          </Tooltip>
          <Tooltip label="Remove document">
            <button type="button" className="stfile__btn is-del" aria-label={`Remove ${it.name}`} disabled={disabled} onClick={() => onRemove(it.key)}>
              <Svg size={13} sw={2.2}><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></Svg>
            </button>
          </Tooltip>
        </div>
      ))}
    </div>
  );
}
