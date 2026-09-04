import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import api from '../../../api';
import { useToast } from '../../../contexts/ToastContext';

// ── Types ────────────────────────────────────────────────────────────────────
// Note: 'space-between' kept in the union for back-compat with rows saved by
// the first version of this component. The UI now only exposes left/center/right
// — `align` controls *text alignment within the title block*. Container layout
// is driven by `logo_pos` / `title_pos` (free drag).
export type HeaderAlign = 'left' | 'center' | 'right' | 'space-between';
export type FooterAlign = 'left' | 'center' | 'right';

export interface PointPct { x: number; y: number }

export interface HeaderConfig {
  logo_path: string | null;     // storage path (resolved via /storage/{path})
  logo_url: string | null;      // public URL (cached so we don't re-resolve)
  title: string;
  subtitle: string;
  align: HeaderAlign;           // text alignment WITHIN the title block
  logo_pos: PointPct;           // free position inside the header (% of container, center anchor)
  title_pos: PointPct;
  background: string;
  text_color: string;
  show_logo: boolean;
  show_title: boolean;
  logo_height?: number;         // px — clamped 24-200, width auto-scales (legacy rows: undefined → 62)
}

export type PageNumberFormat = 'N' | 'Page N' | 'Page N of M' | 'N / M';

export interface FooterConfig {
  text: string;
  align: FooterAlign;
  background: string;
  text_color: string;
  show_page_number: boolean;
  page_number_align: FooterAlign;   // independent from `align` so number + text can sit in different cells
  page_number_format: PageNumberFormat;
}

// Default positions match the old "space-between" layout — logo on the left,
// title block on the right, both vertically centred. Center-anchored (so 0
// keeps an item at the left edge, 100 at the right edge, 50 centres it).
export const DEFAULT_HEADER: HeaderConfig = {
  logo_path: null,
  logo_url:  null,
  title:     'Company Name',
  subtitle:  'Confidential',
  align:     'right',
  logo_pos:  { x: 10, y: 50 },
  title_pos: { x: 88, y: 50 },
  background: '#ffffff',
  text_color: '#111827',
  show_logo:  true,
  show_title: true,
  logo_height: 62,
};

// Allowed pixel range for the user-configurable logo height. The lower bound
// keeps the image legible; the upper bound prevents the user from accidentally
// blowing the header up to fill the entire page.
export const LOGO_HEIGHT_MIN = 24;
export const LOGO_HEIGHT_MAX = 200;
export const LOGO_HEIGHT_DEFAULT = 62;

export const DEFAULT_FOOTER: FooterConfig = {
  text:       'Company Name Pvt. Ltd.  |  Confidential',
  align:      'center',
  background: '#ffffff',
  text_color: '#6b7280',
  // Page number lives in its own cell of the 3-column footer so it can sit
  // alongside (or apart from) the main footer text without clashing.
  show_page_number:    true,
  page_number_align:   'right',
  page_number_format:  'Page N of M',
};

// Fixed visual heights — exposed so the parent / DOCX exporter can stay aligned.
export const HEADER_HEIGHT = 90;
export const FOOTER_HEIGHT = 50;

// Max characters for the single-line footer text. The footer band is a fixed
// 50px-high, 3-column strip; without a cap a long paste runs off the edge (and
// would overflow the same way in the exported DOCX footer). 64 fits a
// "Company Name Pvt. Ltd. | Confidential" style line while staying inside the
// centre column — at the previous 120 the text still ran under the page-number
// cell and got clipped mid-word.
export const FOOTER_TEXT_MAX = 64;

// Max characters for the header title / subtitle. The title block is centre-
// anchored and capped at 60% of the header width, so an uncapped string wraps
// into a tall stack that overlaps the logo and spills past the 90px header
// band. Higher than FOOTER_TEXT_MAX because the header block is multi-line and
// two-field (title + subtitle), so it has the vertical room the single-line
// footer strip does not.
export const HEADER_TEXT_MAX = 75;

// ── Component ────────────────────────────────────────────────────────────────
/**
 * Page-style preview: fixed-height header on top, fixed-height footer at the
 * bottom, and whatever the parent passes as `children` (the Tiptap editor) in
 * the middle. Clicking a zone opens an inline edit panel for that zone's
 * content + styling.
 */
export default function HeaderFooterPanel({
  header, setHeader,
  footer, setFooter,
  readOnly = false,
  fillHeight = false,
  uploadLogoEndpoint = '/hr-document-templates/upload-header-logo',
  children,
}: {
  header: HeaderConfig;
  setHeader: (next: HeaderConfig) => void;
  footer: FooterConfig;
  setFooter: (next: FooterConfig) => void;
  readOnly?: boolean;
  /* Make the shell fill its parent's height instead of growing with content.
   *
   * ONLY for callers whose parent already has a definite height and does its
   * own scrolling — TemplateEditor's pageWrapper, where the editor column is
   * a grid row. Everyone else puts this shell INSIDE a scroller (the CLM CTC
   * draft's .ctc-mid-scroll, the Trade Document draft's .tdw-editor-scroll)
   * and needs the shell to grow with the document, or the scroller has
   * nothing to scroll and overflow:hidden clips the page — which strands the
   * footer band in the middle of the text. It is off by default for exactly
   * that reason: filling was made unconditional once and broke both drafts. */
  fillHeight?: boolean;
  /* API path that accepts a multipart `logo` file and returns
   * { path, url }. Defaults to the HR Document Templates endpoint so the
   * existing caller stays untouched; the CLM Trade Document draft passes
   * its own `/clm/trade-doc-library/upload-header-logo` so the file lands
   * under that module's tenant folder. */
  uploadLogoEndpoint?: string;
  children: ReactNode;
}) {
  const [openZone, setOpenZone] = useState<'header' | 'footer' | null>(null);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);
  // True while a header logo is being uploaded — drives the spinner on the
  // Replace/Upload Logo button and disables Update so the popover can't close
  // (losing the file) before the upload finishes.
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const uploadLogo = async (file: File) => {
    const fd = new FormData();
    fd.append('logo', file);
    setUploadingLogo(true);
    const started = Date.now();
    try {
      const { data } = await api.post(uploadLogoEndpoint, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setHeader({ ...header, logo_path: data.path || null, logo_url: data.url || null, show_logo: true });
      toast.success('Logo uploaded', 'Header now uses this image.');
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message || 'Please try again.');
    } finally {
      // Keep the loader on screen for at least ~600ms so a fast (local) upload
      // doesn't just flash — the spinner + blocked controls stay perceptible.
      const elapsed = Date.now() - started;
      if (elapsed < 600) await new Promise(res => setTimeout(res, 600 - elapsed));
      setUploadingLogo(false);
    }
  };

  // Normalise position values — pre-drag rows may have undefined / out-of-range
  // values, especially older rows saved before this column existed.
  const logoPos = clampPoint(header.logo_pos);
  const titlePos = clampPoint(header.title_pos);

  // Drag handlers — return a mousedown handler that pins the dragged item
  // to the cursor inside the header container. Updates are throttled by
  // React's normal batching; positions are stored as percentages so the
  // layout scales when the container resizes.
  const headerRef = useRef<HTMLDivElement | null>(null);
  const startDrag = (which: 'logo' | 'title') => (e: React.MouseEvent) => {
    if (readOnly) return;
    if (e.button !== 0) return;
    e.preventDefault();
    // Stop the wrapper's onClick from interpreting this as "open settings".
    e.stopPropagation();

    const container = headerRef.current;
    if (!container) return;

    // The item we actually move is the center-anchored box that carries the
    // `data-tpl-no-popover` flag. For the title that's the block *containing*
    // the small drag handle (e.currentTarget) — not the handle itself — so we
    // walk up to it; for the logo it's the mousedown target directly.
    const node = (e.currentTarget as HTMLElement).closest('[data-tpl-no-popover="1"]') as HTMLElement | null;

    const start = which === 'logo' ? logoPos : titlePos;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const dxPct = ((ev.clientX - startMouseX) / Math.max(1, rect.width)) * 100;
      const dyPct = ((ev.clientY - startMouseY) / Math.max(1, rect.height)) * 100;
      // The item is center-anchored (translate(-50%,-50%)), so clamping the
      // center to 0–100 still lets half of it spill past the edges. Clamp to
      // the item's half-size instead so its bounding box stays fully inside the
      // header. If the item is wider/taller than the container, just centre it.
      const nodeRect = node?.getBoundingClientRect();
      const halfWPct = nodeRect ? (nodeRect.width  / 2 / Math.max(1, rect.width))  * 100 : 0;
      const halfHPct = nodeRect ? (nodeRect.height / 2 / Math.max(1, rect.height)) * 100 : 0;
      const boundedX = halfWPct >= 50 ? 50 : clamp(start.x + dxPct, halfWPct, 100 - halfWPct);
      const boundedY = halfHPct >= 50 ? 50 : clamp(start.y + dyPct, halfHPct, 100 - halfHPct);
      const next: PointPct = { x: boundedX, y: boundedY };
      if (which === 'logo')  setHeader({ ...header, logo_pos: next });
      else                   setHeader({ ...header, title_pos: next });
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  };

  // Resolve & clamp the configured logo height — falls back to the legacy
  // baked-in value (HEADER_HEIGHT - 28) so rows saved before this field
  // existed keep rendering identically.
  const logoHeightPx = clamp(
    typeof header.logo_height === 'number' ? header.logo_height : LOGO_HEIGHT_DEFAULT,
    LOGO_HEIGHT_MIN, LOGO_HEIGHT_MAX,
  );

  /* The title block is absolutely positioned, so — unlike the logo, whose
     height is a known config value — it contributes nothing to the header's
     own height. A multi-line title therefore never grew the band: being
     centre-anchored it overflowed equally above and below, and the shell's
     overflow:hidden clipped the top. Measure the rendered block and feed it
     into minHeight, mirroring what logoHeightPx already does for the logo. */
  const titleBlockRef = useRef<HTMLDivElement | null>(null);
  const [titleBlockH, setTitleBlockH] = useState(0);
  useEffect(() => {
    const el = titleBlockRef.current;
    if (!el) { setTitleBlockH(0); return; }
    const measure = () => setTitleBlockH(el.offsetHeight);
    measure();
    // Observes wrap changes from every source — typing, font/align changes,
    // dragging (maxWidth is derived from title_pos), and container resize.
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, [header.show_title]);

  const draggableItemStyle = (pos: PointPct): React.CSSProperties => ({
    position: 'absolute',
    left: `${pos.x}%`,
    top:  `${pos.y}%`,
    transform: 'translate(-50%, -50%)',
    cursor: readOnly ? 'default' : 'grab',
    userSelect: 'none',
    touchAction: 'none',
  });

  return (
    /* height:100% + column flex — only under fillHeight. The shell is a CHILD
       of the editor column in TemplateEditor's pageWrapper, and that column
       has a definite height from the grid row; without passing it down the
       body sized to its content, leaving the editor a short box with dead
       space under it and the footer stranded at the bottom.
       Off by default: inside a scroller (CTC / Trade Document drafts) a fixed
       height plus overflow:hidden stops the page growing with the document,
       so the scroller has nothing to scroll and the footer lands mid-text. */
    <div className="tpl-page-shell" style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', overflow: 'hidden', ...(fillHeight ? { height: '100%', display: 'flex', flexDirection: 'column', minHeight: 0 } : null) }}>
      <HfpDarkStyles />
      {/* HEADER zone — min-height (grows to fit multi-line title), absolute
          children, free drag. Title + subtitle are inline-editable. */}
      <div
        ref={headerRef}
        className="tpl-page-header"
        onClick={(e) => {
          // Only open the settings popover when the click landed on the
          // empty header backdrop — not on the title/subtitle (which is
          // inline-editable) or the logo (which is draggable).
          if (readOnly) return;
          if ((e.target as HTMLElement).closest('[data-tpl-no-popover="1"]')) return;
          setOpenZone(openZone === 'header' ? null : 'header');
        }}
        title={readOnly ? '' : 'Drag the logo / title; click any empty area to edit settings'}
        style={{
          // Grow the header to fit whichever of the logo / title is taller.
          // +28 keeps the same vertical breathing room the baked-in value used
          // to provide. Without the titleBlockH term a wrapped title spills out
          // of the band and gets clipped.
          minHeight: Math.max(HEADER_HEIGHT, logoHeightPx + 28, titleBlockH + 28),
          background: header.background, color: header.text_color,
          borderBottom: '2px solid #f3f4f6',
          cursor: readOnly ? 'default' : 'pointer',
          position: 'relative',
          paddingTop: 32, paddingBottom: 12,
          backgroundImage: readOnly ? undefined :
            // Faint dotted grid so the user can see the drop zone & alignment.
            'radial-gradient(circle, rgba(99,102,241,0.10) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      >
        {header.show_logo && (
          <div
            onMouseDown={startDrag('logo')}
            data-tpl-no-popover="1"
            style={draggableItemStyle(logoPos)}
            title={readOnly ? '' : 'Drag to reposition logo'}
          >
            {header.logo_url ? (
              <img src={header.logo_url} alt="logo" draggable={false}
                style={{ height: logoHeightPx, maxWidth: Math.max(180, logoHeightPx * 3), objectFit: 'contain', pointerEvents: 'none' }} />
            ) : (
              <div className="tpl-logo-placeholder" style={{ width: Math.max(72, logoHeightPx * 1.8), height: logoHeightPx, borderRadius: 6, border: '2px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 1, background: '#f8fafc', pointerEvents: 'none' }}>
                LOGO
              </div>
            )}
          </div>
        )}
        {header.show_title && (
          <div
            ref={titleBlockRef}
            data-tpl-no-popover="1"
            style={{
              ...draggableItemStyle(titlePos),
              cursor: readOnly ? 'default' : 'text',
              textAlign: (header.align === 'left' || header.align === 'center' || header.align === 'right') ? header.align : 'right',
              // Block is center-anchored at titlePos, so its half-width can't
              // exceed the distance to the nearest edge or it spills out of the
              // (overflow:hidden) header. Cap maxWidth = 2 × that gap, ceiling
              // 60%. Long unbreakable strings then wrap instead of clipping off
              // the right edge.
              maxWidth: `${Math.min(60, 2 * Math.min(titlePos.x, 100 - titlePos.x))}%`,
              boxSizing: 'border-box',
              overflowWrap: 'anywhere',
            }}
            title={readOnly ? '' : 'Click to edit, or drag the handle to reposition'}
          >
            {!readOnly && (
              <span
                onMouseDown={startDrag('title')}
                className="tpl-title-drag-handle"
                title="Drag to reposition"
                style={{
                  position: 'absolute', top: -10, left: -10,
                  width: 22, height: 22, borderRadius: 6,
                  background: 'rgba(99,102,241,0.15)', color: '#4338ca',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                  cursor: 'grab', fontSize: 12,
                  border: '1px solid rgba(99,102,241,0.30)',
                }}
              >
                <i className="ri-drag-move-2-line" />
              </span>
            )}
            <EditableText
              value={header.title}
              placeholder="Company Name"
              readOnly={readOnly}
              maxLength={HEADER_TEXT_MAX}
              titleAttr={(header.title || '').length > 18 ? header.title : undefined}
              onChange={(v) => setHeader({ ...header, title: v.slice(0, HEADER_TEXT_MAX) })}
              /* Single-line with an ellipsis instead of wrapping to 2–3 lines in
                 the narrow title block; hover shows the full name. While editing,
                 contentEditable scrolls horizontally so the caret stays visible. */
              style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.3, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}
            />
            <EditableText
              value={header.subtitle}
              placeholder="Subtitle (optional)"
              readOnly={readOnly}
              maxLength={HEADER_TEXT_MAX}
              titleAttr={(header.subtitle || '').length > 18 ? header.subtitle : undefined}
              onChange={(v) => setHeader({ ...header, subtitle: v.slice(0, HEADER_TEXT_MAX) })}
              style={{ fontSize: 11.5, opacity: 0.7, marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}
            />
          </div>
        )}
        {!readOnly && (
          <>
            <span className="tpl-edit-hint" style={{ position: 'absolute', right: 10, top: 8, fontSize: 10.5, color: '#ffffff', background: '#4b5563', padding: '2px 8px', borderRadius: 999, fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}>
              <i className="ri-edit-line me-1" />Edit Header
            </span>
            <span className="tpl-drag-hint" style={{ position: 'absolute', left: 10, top: 8, fontSize: 10.5, color: '#ffffff', background: '#4f46e5', padding: '2px 8px', borderRadius: 999, fontWeight: 700, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}>
              <i className="ri-text" />&nbsp;Click title to edit · Enter for a new line
            </span>
          </>
        )}
      </div>

      {/* HEADER editor (popover) */}
      {openZone === 'header' && (
        <HeaderEditor
          header={header}
          setHeader={setHeader}
          onClose={() => setOpenZone(null)}
          onChooseLogo={() => fileRef.current?.click()}
          uploading={uploadingLogo}
        />
      )}

      {/* BODY — Tiptap or whatever the parent renders */}
      {/* Under fillHeight the body absorbs whatever the fixed-height header and
          footer leave (flex:1 + minHeight:0). Otherwise it keeps the original
          grow-with-content sizing, which is what the scroller-based drafts
          need — minHeight 320 just stops an empty document collapsing. */}
      <div className="tpl-page-body" style={{ padding: 18, background: '#fff', ...(fillHeight ? { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } : { minHeight: 320 }) }}>
        {children}
      </div>

      {/* FOOTER zone — fixed height, 3-cell flex (left / center / right).
          Footer text sits in the cell matching footer.align; page number sits
          in the cell matching footer.page_number_align. Both can land in the
          same cell and render side-by-side. */}
      <div
        className="tpl-page-footer"
        onClick={() => !readOnly && setOpenZone(openZone === 'footer' ? null : 'footer')}
        title={readOnly ? '' : 'Click to edit footer'}
        style={{
          height: FOOTER_HEIGHT, minHeight: FOOTER_HEIGHT, maxHeight: FOOTER_HEIGHT,
          background: footer.background, color: footer.text_color,
          borderTop: '2px solid #f3f4f6',
          padding: '0 22px',
          display: 'grid',
          gridTemplateColumns: '1fr 1fr 1fr',
          alignItems: 'center',
          cursor: readOnly ? 'default' : 'pointer',
          position: 'relative',
          fontSize: 12.5,
          columnGap: 12,
        }}
      >
        {(['left', 'center', 'right'] as const).map(cell => {
          const showText = footer.align === cell;
          const showNum  = footer.show_page_number && footer.page_number_align === cell;
          const justify  = cell === 'left' ? 'flex-start' : cell === 'right' ? 'flex-end' : 'center';
          return (
            <div key={cell}
              style={{
                display: 'flex', alignItems: 'center', justifyContent: justify, gap: 10, minWidth: 0,
                // Keep right-cell content (page number / footer text) clear of the
                // floating "Edit Footer" hint chip pinned at the bottom-right.
                ...(cell === 'right' && !readOnly ? { paddingRight: 96 } : {}),
              }}>
              {showText && (
                <span style={{ textAlign: cell, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: '100%' }}>
                  {footer.text || 'Footer text…'}
                </span>
              )}
              {showNum && (
                <span style={{
                  background: 'rgba(99,102,241,0.10)', color: '#4338ca',
                  padding: '2px 8px', borderRadius: 6, fontWeight: 700, fontSize: 11.5, whiteSpace: 'nowrap',
                }}>
                  {previewPageNumber(footer.page_number_format)}
                </span>
              )}
            </div>
          );
        })}
        {!readOnly && (
          <span className="tpl-edit-hint" style={{ position: 'absolute', right: 10, bottom: 6, fontSize: 10.5, color: '#ffffff', background: '#4b5563', padding: '2px 8px', borderRadius: 999, fontWeight: 600, boxShadow: '0 1px 2px rgba(0,0,0,0.15)' }}>
            <i className="ri-edit-line me-1" />Edit Footer
          </span>
        )}
      </div>

      {/* FOOTER editor (popover) */}
      {openZone === 'footer' && (
        <FooterEditor
          footer={footer}
          setFooter={setFooter}
          onClose={() => setOpenZone(null)}
        />
      )}

      {/* Hidden file input — used by the header editor's "Upload Logo" button */}
      <input ref={fileRef} type="file" accept=".png,.jpg,.jpeg,.svg,.webp" style={{ display: 'none' }}
        onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadLogo(f); e.currentTarget.value = ''; }} />
    </div>
  );
}

/* ── Header editor (popover) ───────────────────────────────────────────────── */
function HeaderEditor({
  header, setHeader, onClose, onChooseLogo, uploading = false,
}: {
  header: HeaderConfig;
  setHeader: (next: HeaderConfig) => void;
  onClose: () => void;
  onChooseLogo: () => void;
  uploading?: boolean;
}) {
  // While the logo image is uploading, block every other control (and closing)
  // so no action can fire mid-upload — only the Uploading… spinner stays.
  const guardedClose = () => { if (!uploading) onClose(); };
  return (
    <PopoverFrame onClose={guardedClose}>
      <PopoverHeader title="Header Settings" onClose={guardedClose} />
      <div className="row g-3" style={{ padding: 14, ...(uploading ? { pointerEvents: 'none', opacity: 0.55 } : null) }}>
        <div className="col-md-6">
          <div className="d-flex align-items-center justify-content-between mb-1">
            <label className="tpl-popover-label" style={{ ...labelStyle, marginBottom: 0 }}>Title <span style={{ fontWeight: 600, color: '#9ca3af' }}>(multi-line)</span></label>
            <span className="tpl-popover-hint" style={{ fontSize: 11, color: (header.title || '').length >= HEADER_TEXT_MAX ? '#b45309' : '#9ca3af', fontWeight: 700 }}>
              {(header.title || '').length}/{HEADER_TEXT_MAX}
            </span>
          </div>
          <textarea rows={3} value={header.title} maxLength={HEADER_TEXT_MAX}
            onChange={e => setHeader({ ...header, title: e.target.value.slice(0, HEADER_TEXT_MAX) })}
            placeholder={'e.g. Inorbvict Healthcare\nNew Delhi Office'}
            className="tpl-popover-input"
            style={{ ...inputStyle, resize: 'vertical', minHeight: 64, lineHeight: 1.4 }} />
        </div>
        <div className="col-md-6">
          <div className="d-flex align-items-center justify-content-between mb-1">
            <label className="tpl-popover-label" style={{ ...labelStyle, marginBottom: 0 }}>Subtitle <span style={{ fontWeight: 600, color: '#9ca3af' }}>(multi-line)</span></label>
            <span className="tpl-popover-hint" style={{ fontSize: 11, color: (header.subtitle || '').length >= HEADER_TEXT_MAX ? '#b45309' : '#9ca3af', fontWeight: 700 }}>
              {(header.subtitle || '').length}/{HEADER_TEXT_MAX}
            </span>
          </div>
          <textarea rows={3} value={header.subtitle} maxLength={HEADER_TEXT_MAX}
            onChange={e => setHeader({ ...header, subtitle: e.target.value.slice(0, HEADER_TEXT_MAX) })}
            placeholder={'e.g. Confidential\nDocument: Offer Letter'}
            className="tpl-popover-input"
            style={{ ...inputStyle, resize: 'vertical', minHeight: 64, lineHeight: 1.4 }} />
        </div>

        <div className="col-md-6">
          <label className="tpl-popover-label" style={labelStyle}>Logo</label>
          <div className="d-flex align-items-center gap-2">
            <button type="button" onClick={onChooseLogo} disabled={uploading}
              className="tpl-logo-upload"
              style={{ padding: '7px 12px', background: '#6366f1', color: '#fff', border: 0, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: uploading ? 'wait' : 'pointer', opacity: uploading ? 0.7 : 1 }}>
              {uploading
                ? <><span className="spinner-border spinner-border-sm me-1" role="status" aria-hidden="true" style={{ width: 13, height: 13, borderWidth: 2 }} />Uploading…</>
                : <><i className="ri-upload-2-line me-1" />{header.logo_url ? 'Replace Logo' : 'Upload Logo'}</>}
            </button>
            {header.logo_url && (
              <button type="button" onClick={() => setHeader({ ...header, logo_path: null, logo_url: null })}
                className="tpl-logo-remove"
                style={{ padding: '7px 10px', background: '#fee2e2', color: '#b91c1c', border: 0, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
                Remove
              </button>
            )}
          </div>
          <div className="tpl-popover-hint" style={{ fontSize: 11, color: '#9ca3af', marginTop: 4 }}>PNG / JPG / SVG up to 5MB.</div>

          {/* Logo size slider — visible once a logo is uploaded so the user
              can scale it up/down without re-cropping the source image. */}
          <div className="mt-2">
            <div className="d-flex align-items-center justify-content-between mb-1">
              <span className="tpl-popover-label" style={{ ...labelStyle, marginBottom: 0 }}>Logo Size</span>
              <span className="tpl-popover-hint" style={{ fontSize: 11, color: '#6b7280', fontWeight: 700 }}>
                {clamp(header.logo_height ?? LOGO_HEIGHT_DEFAULT, LOGO_HEIGHT_MIN, LOGO_HEIGHT_MAX)} px
              </span>
            </div>
            <div className="d-flex align-items-center gap-2">
              <input
                type="range"
                min={LOGO_HEIGHT_MIN}
                max={LOGO_HEIGHT_MAX}
                step={2}
                value={clamp(header.logo_height ?? LOGO_HEIGHT_DEFAULT, LOGO_HEIGHT_MIN, LOGO_HEIGHT_MAX)}
                onChange={(e) => setHeader({ ...header, logo_height: clamp(Number(e.target.value) || LOGO_HEIGHT_DEFAULT, LOGO_HEIGHT_MIN, LOGO_HEIGHT_MAX) })}
                className="tpl-logo-size-range"
                style={{ flex: 1, accentColor: '#6366f1' }}
              />
              <button type="button"
                onClick={() => setHeader({ ...header, logo_height: LOGO_HEIGHT_DEFAULT })}
                title="Reset to default"
                className="tpl-chip"
                style={{ ...chipStyle(false), padding: '4px 8px', fontSize: 11 }}>
                <i className="ri-restart-line" />
              </button>
            </div>
          </div>
        </div>

        <div className="col-md-6">
          <label className="tpl-popover-label" style={labelStyle}>Title Text Alignment</label>
          <div className="d-flex gap-1 align-items-center flex-wrap">
            {(['left', 'center', 'right'] as HeaderAlign[]).map(a => (
              <button key={a} type="button" onClick={() => setHeader({ ...header, align: a })}
                className={`tpl-chip${header.align === a ? ' is-active' : ''}`}
                style={chipStyle(header.align === a)}>{a}</button>
            ))}
            <button type="button"
              onClick={() => setHeader({ ...header, logo_pos: { ...DEFAULT_HEADER.logo_pos }, title_pos: { ...DEFAULT_HEADER.title_pos }, align: DEFAULT_HEADER.align })}
              title="Snap logo to left, title to right"
              className="tpl-chip tpl-chip-reset"
              style={{ ...chipStyle(false), marginLeft: 6, background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e' }}>
              <i className="ri-restart-line me-1" />Reset Positions
            </button>
          </div>
          <div className="tpl-popover-hint" style={{ fontSize: 10.5, color: '#9ca3af', marginTop: 4 }}>
            Drag the logo / title directly in the preview to position them anywhere in the header.
          </div>
        </div>

        <div className="col-md-4">
          <label className="tpl-popover-label" style={labelStyle}>Background</label>
          <ColorInput value={header.background} onChange={v => setHeader({ ...header, background: v })} />
        </div>
        <div className="col-md-4">
          <label className="tpl-popover-label" style={labelStyle}>Text Color</label>
          <ColorInput value={header.text_color} onChange={v => setHeader({ ...header, text_color: v })} />
        </div>
        <div className="col-md-4 d-flex flex-column">
          <label className="tpl-popover-label" style={labelStyle}>Visibility</label>
          <div className="d-flex gap-2 mt-1">
            <ToggleChip on={header.show_logo}  setOn={(v) => setHeader({ ...header, show_logo: v })}  label="Logo" />
            <ToggleChip on={header.show_title} setOn={(v) => setHeader({ ...header, show_title: v })} label="Title" />
          </div>
        </div>
      </div>
      <div className="tpl-popover-foot">
        <button type="button" className="tpl-popover-update" onClick={guardedClose} disabled={uploading}
          style={uploading ? { opacity: 0.55, cursor: 'wait' } : undefined}
          title={uploading ? 'Please wait — the logo is still uploading' : undefined}>
          <i className="ri-check-line me-1" />Update
        </button>
      </div>
    </PopoverFrame>
  );
}

/* ── Footer editor (popover) ───────────────────────────────────────────────── */
function FooterEditor({
  footer, setFooter, onClose,
}: {
  footer: FooterConfig;
  setFooter: (next: FooterConfig) => void;
  onClose: () => void;
}) {
  return (
    <PopoverFrame onClose={onClose}>
      <PopoverHeader title="Footer Settings" onClose={onClose} />
      <div className="row g-3" style={{ padding: 14 }}>
        <div className="col-md-8">
          <div className="d-flex align-items-center justify-content-between mb-1">
            <label className="tpl-popover-label" style={{ ...labelStyle, marginBottom: 0 }}>Footer Text</label>
            <span className="tpl-popover-hint" style={{ fontSize: 11, color: (footer.text || '').length >= FOOTER_TEXT_MAX ? '#b45309' : '#9ca3af', fontWeight: 700 }}>
              {(footer.text || '').length}/{FOOTER_TEXT_MAX}
            </span>
          </div>
          <input type="text" value={footer.text} maxLength={FOOTER_TEXT_MAX}
            onChange={e => setFooter({ ...footer, text: e.target.value.slice(0, FOOTER_TEXT_MAX) })}
            placeholder="e.g. Company Name Pvt. Ltd. | Confidential" className="tpl-popover-input" style={inputStyle} />
        </div>
        <div className="col-md-4">
          <label className="tpl-popover-label" style={labelStyle}>Alignment</label>
          <div className="d-flex gap-1">
            {(['left', 'center', 'right'] as FooterAlign[]).map(a => (
              <button key={a} type="button" onClick={() => setFooter({ ...footer, align: a })}
                className={`tpl-chip${footer.align === a ? ' is-active' : ''}`}
                style={chipStyle(footer.align === a)}>{a}</button>
            ))}
          </div>
        </div>

        <div className="col-md-6">
          <label className="tpl-popover-label" style={labelStyle}>Background</label>
          <ColorInput value={footer.background} onChange={v => setFooter({ ...footer, background: v })} />
        </div>
        <div className="col-md-6">
          <label className="tpl-popover-label" style={labelStyle}>Text Color</label>
          <ColorInput value={footer.text_color} onChange={v => setFooter({ ...footer, text_color: v })} />
        </div>

        {/* Page number — own row, separator so it visually groups together */}
        <div className="tpl-popover-divider col-12" style={{ marginTop: 4, paddingTop: 10, borderTop: '1px dashed #e5e7eb' }}>
          <div className="d-flex align-items-center justify-content-between">
            <div>
              <label className="tpl-popover-label" style={{ ...labelStyle, marginBottom: 2 }}>Page Number</label>
              <div className="tpl-popover-hint" style={{ fontSize: 11, color: '#9ca3af' }}>Renders as a live Word field in the exported DOCX.</div>
            </div>
            <ToggleChip on={footer.show_page_number} setOn={(v) => setFooter({ ...footer, show_page_number: v })} label={footer.show_page_number ? 'Enabled' : 'Disabled'} />
          </div>
        </div>

        {footer.show_page_number && (
          <>
            <div className="col-md-6">
              <label className="tpl-popover-label" style={labelStyle}>Format</label>
              <select value={footer.page_number_format}
                onChange={e => setFooter({ ...footer, page_number_format: e.target.value as PageNumberFormat })}
                className="tpl-popover-input" style={inputStyle}>
                {/* Labels use "N" for the total (the real page count is filled
                    in at generation via {PAGE_COUNT}); a fixed sample like
                    "of 10" wrongly implied every document was 10 pages. */}
                <option value="N">1</option>
                <option value="Page N">Page 1</option>
                <option value="Page N of M">Page 1 of N</option>
                <option value="N / M">1 / N</option>
              </select>
            </div>
            <div className="col-md-6">
              <label className="tpl-popover-label" style={labelStyle}>Number Position</label>
              <div className="d-flex gap-1">
                {(['left', 'center', 'right'] as FooterAlign[]).map(a => (
                  <button key={a} type="button" onClick={() => setFooter({ ...footer, page_number_align: a })}
                    className={`tpl-chip${footer.page_number_align === a ? ' is-active' : ''}`}
                    style={chipStyle(footer.page_number_align === a)}>{a}</button>
                ))}
              </div>
              {footer.page_number_align === footer.align && (
                <div className="tpl-popover-warn" style={{ fontSize: 10.5, color: '#b45309', marginTop: 4 }}>
                  <i className="ri-information-line me-1" />Number sits alongside the footer text (same cell).
                </div>
              )}
            </div>
          </>
        )}
      </div>
      <div className="tpl-popover-foot">
        <button type="button" className="tpl-popover-update" onClick={onClose}>
          <i className="ri-check-line me-1" />Update
        </button>
      </div>
    </PopoverFrame>
  );
}

/* ── Small primitives ──────────────────────────────────────────────────────── */

/**
 * Inline-editable text block. Renders a contentEditable div that commits to
 * `onChange` on blur. Supports multi-line (Enter inserts a newline). Keeps its
 * DOM text in sync with the external `value` when the user isn't actively
 * editing, so popover edits / external resets stay visible.
 */
function EditableText({
  value, placeholder, readOnly, onChange, style, maxLength, titleAttr,
}: {
  value: string;
  placeholder?: string;
  readOnly?: boolean;
  onChange: (next: string) => void;
  style?: React.CSSProperties;
  /* Native tooltip — shows the full text on hover when the field truncates. */
  titleAttr?: string;
  /* Hard character cap. Enforced on three fronts: typing (beforeinput),
     pasting (onPaste truncates to the remaining room), and commit (blur
     slices as a backstop, which also trims any over-long value that was
     saved before this cap existed). */
  maxLength?: number;
}) {
  const ref = useRef<HTMLDivElement | null>(null);
  const [focused, setFocused] = useState(false);

  // Sync external value → DOM only when the field isn't focused, otherwise
  // typing would fight React (cursor would jump on every keystroke).
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    if (focused) return;
    if ((el.innerText || '') !== (value || '')) {
      el.innerText = value || '';
    }
  }, [value, focused]);

  const stop = (e: React.MouseEvent | React.KeyboardEvent) => e.stopPropagation();

  return (
    <div
      ref={ref}
      contentEditable={!readOnly}
      suppressContentEditableWarning
      role={readOnly ? undefined : 'textbox'}
      aria-multiline="true"
      title={titleAttr || undefined}
      data-placeholder={placeholder || ''}
      className={`tpl-editable${!value ? ' is-empty' : ''}`}
      onFocus={() => setFocused(true)}
      onBlur={(e) => {
        setFocused(false);
        const raw = e.currentTarget.innerText || '';
        const next = maxLength ? raw.slice(0, maxLength) : raw;
        if (next !== value) onChange(next);
      }}
      /* Refuse a keystroke that would push the field past the cap. Only
         insertions carry `data`; deletions leave it null, so Backspace still
         works on a value that is already over the limit (e.g. one saved
         before this cap existed). */
      onBeforeInput={(e) => {
        if (!maxLength) return;
        const incoming = (e.nativeEvent as InputEvent).data || '';
        if (!incoming) return;
        const selected = window.getSelection()?.toString().length ?? 0;
        const len = (e.currentTarget.innerText || '').length;
        if (len - selected + incoming.length > maxLength) e.preventDefault();
      }}
      /* Paste bypasses beforeinput's `data`, so handle it here: plain text
         only (a rich paste would drag its own fonts/colours into the title),
         truncated to whatever room is left. */
      onPaste={(e) => {
        if (!maxLength) return;
        e.preventDefault();
        const selected = window.getSelection()?.toString().length ?? 0;
        const room = maxLength - ((e.currentTarget.innerText || '').length - selected);
        if (room <= 0) return;
        document.execCommand('insertText', false, e.clipboardData.getData('text/plain').slice(0, room));
      }}
      onMouseDown={stop}
      onClick={stop}
      onKeyDown={(e) => {
        // Plain Enter inserts a newline (default browser behavior in
        // contentEditable already does this); we just want to keep the
        // event from bubbling up to anything else.
        stop(e);
      }}
      style={{
        outline: 'none',
        cursor: readOnly ? 'default' : 'text',
        minHeight: '1.2em',
        ...style,
      }}
    />
  );
}

function PopoverHeader({ title, onClose }: { title: string; onClose: () => void }) {
  return (
    <div style={{ padding: '10px 14px', background: 'linear-gradient(135deg,#6366f1,#8b5cf6)', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
      <strong style={{ fontSize: 13 }}>{title}</strong>
      <button type="button" onClick={onClose} title="Close"
        style={{ width: 26, height: 26, borderRadius: 6, border: 0, background: 'rgba(255,255,255,0.2)', color: '#fff', cursor: 'pointer' }}>
        <i className="ri-close-line" />
      </button>
    </div>
  );
}

function ColorInput({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="d-flex align-items-center gap-2">
      <input type="color" value={value} onChange={e => onChange(e.target.value)}
        className="tpl-color-swatch"
        style={{ width: 36, height: 32, border: '1px solid #e5e7eb', borderRadius: 6, padding: 2, cursor: 'pointer', background: '#fff' }} />
      <input type="text" value={value} onChange={e => onChange(e.target.value)}
        className="tpl-popover-input"
        style={{ ...inputStyle, flex: 1, fontFamily: 'monospace' }} />
    </div>
  );
}

function ToggleChip({ on, setOn, label }: { on: boolean; setOn: (v: boolean) => void; label: string }) {
  return (
    <button type="button" onClick={() => setOn(!on)}
      className={`tpl-toggle-chip${on ? ' is-on' : ''}`}
      style={{ padding: '6px 10px', borderRadius: 999, border: '1px solid ' + (on ? '#6366f1' : '#e5e7eb'),
        background: on ? '#6366f1' : '#fff', color: on ? '#fff' : '#374151', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}>
      {on ? <i className="ri-check-line me-1" /> : <i className="ri-eye-off-line me-1" />}{label}
    </button>
  );
}

// ── Position helpers ──────────────────────────────────────────────────────
function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
function clampPoint(p: PointPct | null | undefined): PointPct {
  if (!p || typeof p.x !== 'number' || typeof p.y !== 'number') {
    return { x: 50, y: 50 };
  }
  return { x: clamp(p.x, 0, 100), y: clamp(p.y, 0, 100) };
}

// Format the page-number chip in the SPA preview. Real Word page numbers
// come from PhpWord's PAGE / NUMPAGES fields in downloadDocx(). For preview
// we substitute N=1, M=1 (single-page preview).
function previewPageNumber(format: PageNumberFormat): string {
  switch (format) {
    case 'N':            return '1';
    case 'Page N':       return 'Page 1';
    case 'Page N of M':  return 'Page 1 of 1';
    case 'N / M':        return '1 / 1';
    default:             return '1';
  }
}

const popoverStyle: React.CSSProperties = { borderBottom: '2px solid #6366f1', background: '#fafaff' };

/* Centered modal frame for the Header / Footer Settings editors. Portalled to
 * <body> so it sits above the (possibly transform-clipped / full-page) editor,
 * with a click-away backdrop. Both editors render through this so the two
 * settings panels open as proper popups instead of an inline bottom panel. */
function PopoverFrame({ onClose, children }: { onClose: () => void; children: ReactNode }) {
  return createPortal(
    <div className="tpl-popover-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="tpl-popover tpl-popover-modal" style={popoverStyle}>
        {children}
      </div>
    </div>,
    document.body,
  );
}
const labelStyle: React.CSSProperties = { fontSize: 10.5, fontWeight: 800, letterSpacing: 0.4, color: '#6b7280', textTransform: 'uppercase', marginBottom: 4, display: 'block' };
const inputStyle: React.CSSProperties = { width: '100%', padding: '7px 10px', borderRadius: 8, border: '1px solid #e5e7eb', fontSize: 13, background: '#fff' };
function chipStyle(active: boolean): React.CSSProperties {
  return {
    padding: '6px 10px', borderRadius: 8, border: '1px solid ' + (active ? '#6366f1' : '#e5e7eb'),
    background: active ? '#6366f1' : '#fff', color: active ? '#fff' : '#374151',
    fontSize: 12, fontWeight: 700, cursor: 'pointer', textTransform: 'capitalize',
  };
}

/* Dark-theme overrides. The "document page" itself (header / body / footer
   backgrounds) intentionally stays driven by the user's saved config so the
   preview matches what gets exported. Only the surrounding chrome — popover
   editors, edit-hint pills, page-body slot — adapts to dark mode. */
function HfpDarkStyles() {
  return (
    <style>{`
      [data-bs-theme="dark"] .tpl-page-shell {
        border-color: var(--vz-border-color) !important;
      }
      /* Pills sit on the (always-white) header/footer band — solid colors
         render the same in both themes, so we don't override them in dark
         mode anymore. Previous translucent-white overrides made the hint
         labels nearly invisible on the white preview band. */
      [data-bs-theme="dark"] .tpl-page-shell .tpl-edit-hint {
        background: #4b5563 !important;
        color: #ffffff !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell .tpl-drag-hint {
        background: #4f46e5 !important;
        color: #ffffff !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell .tpl-page-body {
        background: var(--vz-secondary-bg) !important;
      }
      /* Read-only DOCUMENT preview (Inbox sign/view, vault) — DARK "paper" in
         dark mode (user preference). The whole page (shell + header + body +
         footer) goes dark and ALL preview text is forced light so author-
         defined dark colours in content_html don't vanish on the dark surface.
         Scoped to :has(.tpl-readonly-preview) so the live template EDITOR is
         unaffected. NOTE: the generated DOCX/PDF is still white — this is a
         dark-mode viewing surface only, not the printed output. */
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview),
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) .tpl-page-body,
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) .tpl-page-header,
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) .tpl-page-footer {
        background: #1b2230 !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) {
        border-color: rgba(255,255,255,0.12) !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) .tpl-page-header {
        border-bottom-color: rgba(255,255,255,0.10) !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) .tpl-page-footer {
        border-top-color: rgba(255,255,255,0.10) !important;
      }
      /* Force every preview text node (content + header title/subtitle +
         footer) light so nothing stays dark-on-dark. */
      [data-bs-theme="dark"] .tpl-readonly-preview,
      [data-bs-theme="dark"] .tpl-readonly-preview *,
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) .tpl-page-header,
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) .tpl-page-header *,
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) .tpl-page-footer,
      [data-bs-theme="dark"] .tpl-page-shell:has(.tpl-readonly-preview) .tpl-page-footer * {
        color: #e5e7eb !important;
      }

      /* Live EDITOR page (Template Design step). The header + footer bands use
         inline white backgrounds, which left them bright white against the
         already-dark editor body in dark mode. Make them dark too so the whole
         "page" reads cohesively, and force their text light so the default
         dark header/footer text doesn't vanish. Scoped with
         :not(:has(.tpl-readonly-preview)) so the read-only preview rules above
         keep owning the Inbox/vault surface. */
      [data-bs-theme="dark"] .tpl-page-shell:not(:has(.tpl-readonly-preview)) .tpl-page-header,
      [data-bs-theme="dark"] .tpl-page-shell:not(:has(.tpl-readonly-preview)) .tpl-page-footer {
        background: #1b2230 !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell:not(:has(.tpl-readonly-preview)) .tpl-page-header {
        border-bottom-color: rgba(255,255,255,0.10) !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell:not(:has(.tpl-readonly-preview)) .tpl-page-footer {
        border-top-color: rgba(255,255,255,0.10) !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell:not(:has(.tpl-readonly-preview)) .tpl-page-header,
      [data-bs-theme="dark"] .tpl-page-shell:not(:has(.tpl-readonly-preview)) .tpl-page-header *,
      [data-bs-theme="dark"] .tpl-page-shell:not(:has(.tpl-readonly-preview)) .tpl-page-footer,
      [data-bs-theme="dark"] .tpl-page-shell:not(:has(.tpl-readonly-preview)) .tpl-page-footer * {
        color: #e5e7eb !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell:not(:has(.tpl-readonly-preview)) .tpl-page-body {
        color: #e5e7eb !important;
      }
      /* "LOGO" placeholder box (shown until a logo is uploaded) — inline
         #f8fafc + dashed light border stayed bright on the dark header band. */
      [data-bs-theme="dark"] .tpl-page-shell .tpl-logo-placeholder {
        background: rgba(255,255,255,0.04) !important;
        border-color: rgba(255,255,255,0.22) !important;
        color: rgba(255,255,255,0.50) !important;
      }

      /* Popover (Header Settings / Footer Settings). Inline popoverStyle
         hard-codes background: '#fafaff' so we have to use !important.
         We also use explicit hex values instead of var(--vz-card-bg) so
         the dark surface is reliably dark — the Velzon CSS variables
         don't always resolve correctly inside this inline-styled tree. */
      /* Header / Footer Settings open as a centered modal popup (portalled to
         <body>) with a click-away backdrop, sitting above the full-page editor
         (z 210000) and other modals. */
      .tpl-popover-backdrop {
        position: fixed; inset: 0; z-index: 260000;
        background: rgba(15,23,42,0.45);
        backdrop-filter: blur(2px); -webkit-backdrop-filter: blur(2px);
        display: flex; align-items: center; justify-content: center; padding: 20px;
      }
      .tpl-popover.tpl-popover-modal {
        width: 100%; max-width: 660px; max-height: 86vh; 
        border-radius: 14px; box-shadow: 0 24px 64px rgba(8,15,40,0.45);
        animation: tpl-pop-in .16s ease-out both;
      }
      @keyframes tpl-pop-in { from { opacity: 0; transform: translateY(6px) scale(.985); } to { opacity: 1; transform: none; } }
      /* Sticky action footer with the Update (apply + close) button. Changes
         already reflect live in the preview; Update simply confirms + closes. */
      .tpl-popover-foot {
        position: sticky; bottom: 0;
        display: flex; justify-content: flex-end;
        gap: 8px; padding: 12px 14px;
        background: #fafaff; border-top: 1px solid #e5e7eb;
      }
      .tpl-popover-update {
        display: inline-flex; align-items: center;
        padding: 8px 20px; border: none; border-radius: 9px;
        background: linear-gradient(135deg,#6366f1,#8b5cf6); color: #fff;
        font-size: 12.5px; font-weight: 700; cursor: pointer;
        box-shadow: 0 3px 10px rgba(99,102,241,0.35); transition: all .15s;
      }
      .tpl-popover-update:hover { transform: translateY(-1px); filter: brightness(1.06); box-shadow: 0 6px 16px rgba(99,102,241,0.45); }
      [data-bs-theme="dark"] .tpl-popover-foot,
      [data-layout-mode="dark"] .tpl-popover-foot { background: #111827 !important; border-top-color: rgba(255,255,255,0.08) !important; }
      [data-bs-theme="dark"] .tpl-popover {
        background: #1e293b !important;
        border-bottom-color: #8b5cf6 !important;
      }
      [data-bs-theme="dark"] .tpl-popover-label {
        color: #94a3b8 !important;
      }
      /* The inline "(multi-line)" sub-span uses color: '#9ca3af' which
         is the same gray in both themes — readable but dim. Brighten
         slightly for dark mode. */
      [data-bs-theme="dark"] .tpl-popover-label span { color: #cbd5e1 !important; }
      [data-bs-theme="dark"] .tpl-popover-hint {
        color: #94a3b8 !important;
      }
      [data-bs-theme="dark"] .tpl-popover-warn {
        color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .tpl-popover-input {
        background: #0f172a !important;
        border-color: rgba(99,102,241,0.30) !important;
        color: #e2e8f0 !important;
      }
      [data-bs-theme="dark"] .tpl-popover-input::placeholder {
        color: rgba(255,255,255,0.40) !important;
      }
      [data-bs-theme="dark"] .tpl-popover-divider {
        border-top-color: rgba(99,102,241,0.30) !important;
      }
      /* The font-size / page-number-format range slider has no class —
         target the bare input[type=range] inside the popover. */
      [data-bs-theme="dark"] .tpl-popover input[type="range"] {
        accent-color: #8b5cf6;
      }

      /* Inline chips (alignment selector, page-number alignment) */
      [data-bs-theme="dark"] .tpl-chip:not(.is-active) {
        background: #0f172a !important;
        border-color: rgba(99,102,241,0.30) !important;
        color: #e2e8f0 !important;
      }
      [data-bs-theme="dark"] .tpl-chip.tpl-chip-reset {
        background: rgba(245,158,11,0.18) !important;
        border-color: rgba(245,158,11,0.40) !important;
        color: #fbbf24 !important;
      }

      [data-bs-theme="dark"] .tpl-toggle-chip:not(.is-on) {
        background: #0f172a !important;
        border-color: rgba(99,102,241,0.30) !important;
        color: #e2e8f0 !important;
      }

      [data-bs-theme="dark"] .tpl-color-swatch {
        background: #0f172a !important;
        border-color: rgba(99,102,241,0.30) !important;
      }
      [data-bs-theme="dark"] .tpl-logo-remove {
        background: rgba(248,113,113,0.18) !important;
        color: #fca5a5 !important;
      }

      /* Inline-editable title / subtitle in the header preview */
      .tpl-editable { caret-color: #6366f1; }
      .tpl-editable:hover { outline: 1px dashed rgba(99,102,241,0.40); outline-offset: 2px; border-radius: 4px; }
      .tpl-editable:focus { outline: 2px solid #6366f1; outline-offset: 2px; border-radius: 4px; background: rgba(99,102,241,0.04); }
      .tpl-editable.is-empty:before {
        content: attr(data-placeholder);
        opacity: 0.45; pointer-events: none;
      }
      [data-bs-theme="dark"] .tpl-editable:focus { background: rgba(99,102,241,0.10); }
    `}</style>
  );
}
