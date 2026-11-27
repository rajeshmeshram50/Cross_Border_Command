import { useCallback, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { DraftProduct } from './data';
import { IcoPen, IcoUpload, IcoX } from './icons';
import { clarityPaths, fileOf } from './targetProducts';
import AttachedFiles from './AttachedFiles';
import AttachPicker from './AttachPicker';
import { usePopup } from './popupHooks';

/* Product Clarity dialog (Assign / Edit Sourcing Target → Clarity): a note, a link or a document
   for one product. Document upload offers Upload file / Take photo (AttachPicker). */


/** Clarity document: what POST /p2p/upload accepts — PDF, JPG, PNG or WEBP, one file, up to 5 MB. */
const CLARITY_ACCEPT = '.pdf,.jpg,.jpeg,.png,.webp';
const CLARITY_EXT = /\.(pdf|jpe?g|png|webp)$/i;
const CLARITY_TYPE_ERR = 'Upload a PDF, JPG, PNG or WEBP file up to 5 MB.';

/** Largest clarity document (the upload API's limit). */
const CLARITY_MAX_BYTES = 5 * 1024 * 1024;

type ClarityType = 'text' | 'link' | 'pdf';
/** Clarity of one product: a note, a link, or a document. A document picked in this session has
    `file` (uploaded on save); a saved one has only `value` = its stored path(s), newline-joined. */
export type Clarity = { type: ClarityType; value: string; file?: File };
/** The saved-clarity chip label (Figma: ✓ Text / ✓ Link / ✓ Pdf). */
export const CLARITY_LABEL: Record<ClarityType, string> = { text: 'Text', link: 'Link', pdf: 'Pdf' };
/** A document clarity's display name: the picked file's name, or the stored file's name (+N more). */
const clarityFileName = (c: Clarity) => {
  if (c.file) return c.file.name;
  const paths = c.value.split('\n').filter(Boolean);
  const base = (paths[0] ?? '').split('/').pop() ?? '';
  return paths.length > 1 ? `${base} +${paths.length - 1}` : base;
};
/** Hover preview of a saved clarity: the first 40 characters of the note, the link, or the file name. */
export const clarityPreview = (c: Clarity) => {
  const v = c.type === 'pdf' ? clarityFileName(c) : c.value;
  return c.type === 'text' && v.length > 40 ? `${v.slice(0, 40).trimEnd()}…` : v;
};


export default function ClarityDialog({ product, initial, onCancel, onSave }: {
  product: DraftProduct; initial?: Clarity; onCancel: () => void; onSave: (c: Clarity | null) => void;
}) {
  const [type, setType] = useState<ClarityType>(initial?.type ?? 'text');
  const [text, setText] = useState(initial?.type === 'text' ? initial.value : '');
  const [link, setLink] = useState(initial?.type === 'link' ? initial.value : '');
  // Document: a file picked in this session (uploaded on save), or the stored one(s) of a saved
  // clarity (paths; a target saved in Bulk Sourcing can hold several). One document per product
  // (V-T13), so a new pick replaces what was there.
  const initialPaths = initial?.type === 'pdf' && !initial.file ? clarityPaths(initial) : [];
  const [file, setFile] = useState<File | undefined>(initial?.type === 'pdf' ? initial.file : undefined);
  const [paths, setPaths] = useState<string[]>(initialPaths);
  const [err, setErr] = useState('');
  const hasDoc = !!file || paths.length > 0;

  const pickFile = (f?: File) => {
    if (!f) return;
    if (!CLARITY_EXT.test(f.name) || f.size > CLARITY_MAX_BYTES) { setErr(CLARITY_TYPE_ERR); return; }
    setErr(''); setFile(f); setPaths([]);
  };

  // "Add attachment" menu under the upload area: Upload file / Take photo.
  const dropRef = useRef<HTMLButtonElement>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const closeAttach = useCallback(() => setAttachOpen(false), []);
  // Esc closes this dialog (it is the top popup, so the form behind stays open) — but not while its
  // attachment menu is open (it takes that Esc; so does the camera), and not once the clarity has
  // been changed (only × / Cancel close it then, so typed text is never lost to one key press).
  const dirty = type !== (initial?.type ?? 'text') || text !== (initial?.type === 'text' ? initial.value : '')
    || link !== (initial?.type === 'link' ? initial.value : '')
    || file !== (initial?.type === 'pdf' ? initial.file : undefined) || paths.join('\n') !== initialPaths.join('\n');
  const dialogRef = useRef<HTMLDivElement>(null);
  usePopup(dialogRef, { onClose: onCancel, blocked: () => attachOpen || dirty });

  const save = () => {
    if (type === 'text') {
      const v = text.trim();
      return onSave(v ? { type, value: v } : null);          // empty note = remove the clarity
    }
    if (type === 'link') {
      const v = link.trim();
      if (!v) return onSave(null);
      if (!/^https?:\/\/\S+\.\S+/i.test(v)) { setErr('Enter a valid link starting with http:// or https://'); return; }
      return onSave({ type, value: v });
    }
    if (file) return onSave({ type, value: '', file });            // uploaded on save
    if (paths.length) return onSave({ type, value: paths.join('\n') });   // the stored document(s), kept
    onSave(null);                                                    // removed
  };

  return createPortal(
    // A click on the backdrop does nothing. Esc closes only an unchanged clarity; × and Cancel always close.
    <div className="sta-overlay sta-overlay--top">
      <div ref={dialogRef} className="sta-modal sta-modal--sm" role="dialog" aria-modal="true" aria-label="Product Clarity">
        <div className="sta-head sta-head--sm">
          <div className="sta-head-ico"><IcoPen size={16} stroke="#fff" /></div>
          <div className="sta-head-txt">
            <div className="sta-title">Product Clarity</div>
            <div className="sta-sub">{product.code !== '—' ? `${product.code} — ` : ''}{product.name}</div>
          </div>
          <button type="button" className="sta-close sta-close--sm" aria-label="Close" onClick={onCancel}><IcoX size={14} /></button>
        </div>
        <div className="sta-pop-body sct-scroller">
          <div className="sta-tabs" role="tablist">
            {(['text', 'link', 'pdf'] as ClarityType[]).map(t => (
              <button key={t} type="button" role="tab" aria-selected={type === t} className={`stsrc-ltab${type === t ? ' is-active' : ''}`}
                onClick={() => { setType(t); setErr(''); }}>{t === 'pdf' ? 'PDF' : t[0].toUpperCase() + t.slice(1)}</button>
            ))}
          </div>

          {type === 'text' && (
            <textarea className="sta-inp sta-inp--area" autoFocus rows={4} placeholder="Add notes or specs..." value={text} onChange={e => setText(e.target.value)} />
          )}
          {type === 'link' && (
            <input type="url" className={`sta-inp${err ? ' has-err' : ''}`} autoFocus placeholder="https://..." value={link}
              onChange={e => { setLink(e.target.value); setErr(''); }} onKeyDown={e => {
                // Enter does nothing: only the Save Clarity button saves. (Saving on Enter closed the
                // dialog and the same key press reached the Clarity button behind it: a blink.)
                if (e.key === 'Enter') e.preventDefault();
              }} />
          )}
          {type === 'pdf' && (
            <>
              <button type="button" ref={dropRef} className={`sta-drop${hasDoc ? ' has-file' : ''}`} onClick={() => setAttachOpen(true)}
                aria-haspopup="menu" aria-expanded={attachOpen}
                onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pickFile(e.dataTransfer.files?.[0]); }}>
                <IcoUpload size={16} />
                <b>{hasDoc ? 'Replace document' : 'Click to upload a PDF specification'}</b>
                <small>{hasDoc ? 'Click or drop a new file to replace it' : 'or drag and drop · PDF, JPG, PNG or WEBP · max 5 MB'}</small>
              </button>
              {/* The attached document(s): open it in a new tab to check it, or remove it. */}
              <AttachedFiles
                items={file ? [{ key: 'new', name: file.name, src: file }] : paths.map(p => ({ key: p, name: fileOf(p), src: p }))}
                onRemove={k => { if (k === 'new') setFile(undefined); else setPaths(ps => ps.filter(x => x !== k)); }} />
              <AttachPicker anchorRef={dropRef} open={attachOpen} onClose={closeAttach} accept={CLARITY_ACCEPT} onFile={pickFile}
                camera={{ title: 'Take a photo of the specification', subject: product.name, namePrefix: 'clarity' }} />
            </>
          )}
          {err && <div className="sta-pop-err">{err}</div>}

          <div className="sta-pop-foot">
            <button type="button" className="sta-btn sta-btn-ghost" onClick={onCancel}>Cancel</button>
            <button type="button" className="sta-btn sta-btn-primary" onClick={save}>Save Clarity</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}

