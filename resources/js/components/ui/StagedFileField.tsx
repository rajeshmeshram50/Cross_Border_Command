import { useRef } from 'react';
import { downloadFile } from '../../utils/resolveFileUrl';

/** What the record already has stored: where to fetch it and what to call it. */
export type SavedUpload = { url: string; name: string } | null;

/** Display name for a stored upload — the basename of its path or URL. */
export const storedFileName = (path?: string | null): string => {
  if (!path) return '';
  const clean = String(path).split('?')[0].split('#')[0];
  const base = clean.split(/[\/]/).pop() || '';
  try { return decodeURIComponent(base); } catch { return base; }
};

interface Props {
  accept: string;
  /** File picked in this session, not yet saved. */
  staged: File | null;
  /** File already saved on the server, if any. */
  saved: SavedUpload;
  /** Overrides the name shown for `staged` — e.g. when a cropper replaces the
   *  picked file with a generated one but the user should still see what they
   *  chose. */
  stagedName?: string;
  onPick: (file: File | null, inputEl?: HTMLInputElement) => void;
  /** Drop the staged file and fall back to whatever is saved. */
  onClear: () => void;
  fontSize?: number;
}

/**
 * File field that keeps showing the CURRENT file after a form is reopened.
 *
 * A native <input type="file"> always reads "No file chosen" on a fresh mount,
 * even when the record already has a logo / photo saved — which reads as
 * "nothing was ever uploaded" (QA #6, #7). So the input is hidden and this
 * renders the saved (or newly staged) file name with Replace / Download /
 * Cancel actions on one line: the name takes the slack and truncates, the
 * buttons keep their width, and the full name is in the tooltip.
 */
export default function StagedFileField({
  accept, staged, saved, stagedName, onPick, onClear, fontSize = 11.5,
}: Props) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const name = (staged ? (stagedName || staged.name) : saved?.name) || '';
  const btn: React.CSSProperties = { fontSize: fontSize - 1, lineHeight: '18px', whiteSpace: 'nowrap' };

  return (
    <div className="flex-grow-1" style={{ minWidth: 0 }}>
      <input ref={inputRef} type="file" accept={accept} className="d-none"
        onChange={e => {
          const el = e.target as HTMLInputElement;
          onPick(el.files?.[0] || null, el);
          /* Never leave the pick on the input itself — the name on screen comes
             from `staged` / `saved`, and an empty input means picking the SAME
             file again (after a rejected upload, or after a save) still fires a
             change event. */
          el.value = '';
        }} />

      {name ? (
        <div className="d-flex align-items-center gap-2" style={{ minWidth: 0 }}>
          <i className="ri-file-image-line flex-shrink-0" style={{ fontSize, color: 'var(--vz-secondary-color)' }} />
          <span className="text-truncate" title={name}
            style={{ fontSize, fontWeight: 600, minWidth: 0, flex: '1 1 auto' }}>{name}</span>
          {staged && (
            <span className="badge bg-warning-subtle text-warning flex-shrink-0"
              style={{ fontSize: fontSize - 2.5 }}>Unsaved</span>
          )}
          <div className="d-flex gap-1 flex-shrink-0">
            <button type="button" className="btn btn-sm btn-soft-primary py-0 px-2" style={btn}
              onClick={() => inputRef.current?.click()}>
              <i className="ri-upload-2-line me-1" />Replace
            </button>
            {saved && (
              <button type="button" className="btn btn-sm btn-soft-secondary py-0 px-2" style={btn}
                onClick={() => downloadFile(saved.url, saved.name || undefined)}>
                <i className="ri-download-2-line me-1" />Download
              </button>
            )}
            {staged && (
              <button type="button" className="btn btn-sm btn-soft-danger py-0 px-2" style={btn}
                onClick={() => { if (inputRef.current) inputRef.current.value = ''; onClear(); }}>
                <i className="ri-close-line me-1" />Cancel
              </button>
            )}
          </div>
        </div>
      ) : (
        <button type="button" className="btn btn-sm btn-soft-primary py-0 px-2" style={btn}
          onClick={() => inputRef.current?.click()}>
          <i className="ri-upload-2-line me-1" />Choose File
        </button>
      )}
    </div>
  );
}
