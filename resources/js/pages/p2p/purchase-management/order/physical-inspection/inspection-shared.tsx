import { useLayoutEffect, useRef, useState, type ReactNode } from 'react';

export type Verdict = 'correct' | 'damaged' | 'mismatched';

export type ProofFile = {
  /** Position on the server, for removal; absent on a file not uploaded yet. */
  index?: number;
  name: string;
  size: number;
  kind: 'image' | 'video' | 'file';
  url: string;
  thumb?: string;
};

export type InspectionLine = {
  verdict: Verdict | '';
  files: ProofFile[];
};

export type InspectionProduct = {
  code: string;
  name: string;
  hsn: string;
  qty: number;
  gst: number;
  price: number;
  uom: string;
  uomShort: string;
  segment: string;
  condition: string;
  packaging: string;
  brand: string;
  desc: string;
};

export function fileSize(b: number): string {
  if (!b && b !== 0) return '';
  if (b < 1024) return `${b} B`;
  if (b < 1048576) return `${(b / 1024).toFixed(0)} KB`;
  return `${(b / 1048576).toFixed(1)} MB`;
}

const THUMB_PX = 80;

async function makeThumb(file: File): Promise<string> {
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, THUMB_PX / Math.max(bmp.width, bmp.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bmp.width * scale));
    canvas.height = Math.max(1, Math.round(bmp.height * scale));
    canvas.getContext('2d')?.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    bmp.close();
    const blob = await new Promise<Blob | null>((res) => canvas.toBlob(res, 'image/jpeg', 0.72));
    return blob ? URL.createObjectURL(blob) : '';
  } catch {
    return '';
  }
}

export async function toProofFiles(list: FileList | File[] | null): Promise<ProofFile[]> {
  const files = list ? Array.from(list) : [];
  return Promise.all(files.map(async (f): Promise<ProofFile> => {
    const isImg = /^image\//.test(f.type);
    const isVid = /^video\//.test(f.type);
    /* Every picked file gets a link to itself, not only the pictures. A PDF was
       left with no url at all, so View and Download on a file just attached
       both refused it — "Preview unavailable", "Download unavailable" — until
       the inspection had been submitted and the file came back from the server
       (CS-567). The thumbnail is still an image-only affair. */
    const url = URL.createObjectURL(f);
    const thumb = isImg ? await makeThumb(f) : '';
    return { name: f.name, size: f.size, kind: isVid ? 'video' : isImg ? 'image' : 'file', url, thumb };
  }));
}

const ic = {
  viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
  strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const,
};

export const VERDICTS: { k: Verdict; t: string; ico: ReactNode }[] = [
  { k: 'correct', t: 'Correct', ico: <svg {...ic} strokeWidth={3}><polyline points="20 6 9 17 4 12" /></svg> },
  {
    k: 'damaged', t: 'Damaged',
    ico: (
      <svg {...ic} strokeWidth={2.4}>
        <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z" />
        <line x1="12" y1="9" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" />
      </svg>
    ),
  },
  { k: 'mismatched', t: 'Mismatched', ico: <svg {...ic} strokeWidth={2.6}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg> },
];

const ICON_DOC = <svg {...ic} strokeWidth={2.2}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
const ICON_VID = <svg {...ic} strokeWidth={2.2}><polygon points="23 7 16 12 23 17 23 7" /><rect x="1" y="5" width="15" height="14" rx="2" /></svg>;
const ICON_EYE = <svg {...ic} strokeWidth={2.4}><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z" /><circle cx="12" cy="12" r="3" /></svg>;
const ICON_DL = <svg {...ic} strokeWidth={2.4}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" /></svg>;
const ICON_X = <svg {...ic} strokeWidth={2.8}><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>;

export function ProofChip({ file, onView, onDownload, onRemove }: {
  file: ProofFile; onView: () => void; onDownload: () => void; onRemove?: () => void;
}) {
  return (
    <div className="pins-chip">
      {file.thumb
        ? <span className="pins-chip__thumb pins-chip__thumb--img"><img src={file.thumb} alt="" decoding="async" /></span>
        : <span className="pins-chip__thumb">{file.kind === 'video' ? ICON_VID : ICON_DOC}</span>}
      <span className="pins-chip__meta">
        <b title={file.name}>{file.name}</b>
        <i>{fileSize(file.size)}</i>
      </span>
      <span className="pins-chip__acts">
        <button type="button" className="pins-chip__act pins-chip__act--view" title={`View ${file.name}`} onClick={onView}>{ICON_EYE}</button>
        <button type="button" className="pins-chip__act pins-chip__act--dl" title={`Download ${file.name}`} onClick={onDownload}>{ICON_DL}</button>
      </span>
      {onRemove && (
        <button type="button" className="pins-chip__x" title="Remove" onClick={onRemove}>{ICON_X}</button>
      )}
    </div>
  );
}

/**
 * The description cell of an inspection table: clipped to three lines, with
 * "Read more" opening the product's own view rather than unfolding the cell.
 *
 * It ends the last line of the text — a short description keeps it right after
 * the last word, and only a genuinely clipped one pins it to the third line,
 * where a fade hands it the space. Anchored to the text, never to the cell: on a
 * tall row (several proof chips beside it) a cell-anchored button dropped onto a
 * line of its own underneath.
 */
export function InspectionDescription({ text, onOpen, disabled }: {
  text: string; onOpen?: () => void; disabled?: boolean;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const [clamped, setClamped] = useState(false);
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const check = () => setClamped(el.scrollHeight > el.clientHeight + 1);
    check();
    const ro = new ResizeObserver(check);
    ro.observe(el);
    return () => ro.disconnect();
  }, [text]);

  return (
    <span ref={ref} className={`pins-desc__clip${clamped ? ' is-clamped' : ''}`}>
      {text}
      {onOpen && (
        <button type="button" className="pins-desc__more" disabled={disabled} onClick={onOpen} title="Open the product details">
          {clamped ? '… Read more' : 'Read more'}
        </button>
      )}
    </span>
  );
}

export function openFile(file: ProofFile): boolean {
  if (!file.url) return false;
  try { window.open(file.url, '_blank'); return true; } catch { return false; }
}

/** Saves what the browser already holds — a file picked here, not yet uploaded.
 *  A stored file goes through saveBlob instead: `download` is ignored on a
 *  cross-origin link, which is every file once the disk is remote (Azure). */
export function downloadFile(file: ProofFile): boolean {
  if (!file.url) return false;
  try {
    const a = document.createElement('a');
    a.href = file.url;
    a.download = file.name || 'attachment';
    document.body.appendChild(a);
    a.click();
    a.remove();
    return true;
  } catch { return false; }
}

/** Hands the viewer bytes we already have, under the name we choose. */
export function saveBlob(blob: Blob, name: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name || 'attachment';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
