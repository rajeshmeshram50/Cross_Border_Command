import { useRef, useState, type ReactNode } from 'react';
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
};

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
  children,
}: {
  header: HeaderConfig;
  setHeader: (next: HeaderConfig) => void;
  footer: FooterConfig;
  setFooter: (next: FooterConfig) => void;
  readOnly?: boolean;
  children: ReactNode;
}) {
  const [openZone, setOpenZone] = useState<'header' | 'footer' | null>(null);
  const toast = useToast();
  const fileRef = useRef<HTMLInputElement | null>(null);

  const uploadLogo = async (file: File) => {
    const fd = new FormData();
    fd.append('logo', file);
    try {
      const { data } = await api.post('/hr-document-templates/upload-header-logo', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      setHeader({ ...header, logo_path: data.path || null, logo_url: data.url || null, show_logo: true });
      toast.success('Logo uploaded', 'Header now uses this image.');
    } catch (err: any) {
      toast.error('Upload failed', err?.response?.data?.message || 'Please try again.');
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

    const start = which === 'logo' ? logoPos : titlePos;
    const startMouseX = e.clientX;
    const startMouseY = e.clientY;

    const onMove = (ev: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const dxPct = ((ev.clientX - startMouseX) / Math.max(1, rect.width)) * 100;
      const dyPct = ((ev.clientY - startMouseY) / Math.max(1, rect.height)) * 100;
      const next: PointPct = {
        x: clamp(start.x + dxPct, 0, 100),
        y: clamp(start.y + dyPct, 0, 100),
      };
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
    <div className="tpl-page-shell" style={{ border: '1px solid #e5e7eb', borderRadius: 12, background: '#fff', overflow: 'hidden' }}>
      <HfpDarkStyles />
      {/* HEADER zone — fixed height, absolute children, free drag */}
      <div
        ref={headerRef}
        onClick={() => !readOnly && setOpenZone(openZone === 'header' ? null : 'header')}
        title={readOnly ? '' : 'Drag the logo / title; click any empty area to edit settings'}
        style={{
          height: HEADER_HEIGHT, minHeight: HEADER_HEIGHT, maxHeight: HEADER_HEIGHT,
          background: header.background, color: header.text_color,
          borderBottom: '2px solid #f3f4f6',
          cursor: readOnly ? 'default' : 'pointer',
          position: 'relative',
          backgroundImage: readOnly ? undefined :
            // Faint dotted grid so the user can see the drop zone & alignment.
            'radial-gradient(circle, rgba(99,102,241,0.10) 1px, transparent 1px)',
          backgroundSize: '14px 14px',
        }}
      >
        {header.show_logo && (
          <div
            onMouseDown={startDrag('logo')}
            style={draggableItemStyle(logoPos)}
            title={readOnly ? '' : 'Drag to reposition logo'}
          >
            {header.logo_url ? (
              <img src={header.logo_url} alt="logo" draggable={false}
                style={{ maxHeight: HEADER_HEIGHT - 28, maxWidth: 180, objectFit: 'contain', pointerEvents: 'none' }} />
            ) : (
              <div style={{ width: 92, height: 44, borderRadius: 6, border: '2px dashed #cbd5e1', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#94a3b8', fontSize: 11, fontWeight: 700, letterSpacing: 1, background: '#f8fafc', pointerEvents: 'none' }}>
                LOGO
              </div>
            )}
          </div>
        )}
        {header.show_title && (
          <div
            onMouseDown={startDrag('title')}
            style={{ ...draggableItemStyle(titlePos), textAlign: (header.align === 'left' || header.align === 'center' || header.align === 'right') ? header.align : 'right', maxWidth: '60%' }}
            title={readOnly ? '' : 'Drag to reposition title'}
          >
            <div style={{ fontWeight: 800, fontSize: 16, lineHeight: 1.2, pointerEvents: 'none' }}>{header.title || 'Company Name'}</div>
            {header.subtitle && <div style={{ fontSize: 11.5, opacity: 0.7, marginTop: 2, pointerEvents: 'none' }}>{header.subtitle}</div>}
          </div>
        )}
        {!readOnly && (
          <>
            <span className="tpl-edit-hint" style={{ position: 'absolute', right: 10, top: 8, fontSize: 10.5, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 999 }}>
              <i className="ri-edit-line me-1" />Edit Header
            </span>
            <span className="tpl-drag-hint" style={{ position: 'absolute', left: 10, top: 8, fontSize: 10.5, color: '#6366f1', background: '#eef2ff', padding: '2px 8px', borderRadius: 999, fontWeight: 700 }}>
              <i className="ri-drag-move-2-line me-1" />Drag logo / title to reposition
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
        />
      )}

      {/* BODY — Tiptap or whatever the parent renders */}
      <div className="tpl-page-body" style={{ padding: 18, minHeight: 320, background: '#fff' }}>
        {children}
      </div>

      {/* FOOTER zone — fixed height, 3-cell flex (left / center / right).
          Footer text sits in the cell matching footer.align; page number sits
          in the cell matching footer.page_number_align. Both can land in the
          same cell and render side-by-side. */}
      <div
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
              style={{ display: 'flex', alignItems: 'center', justifyContent: justify, gap: 10, minWidth: 0 }}>
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
          <span className="tpl-edit-hint" style={{ position: 'absolute', right: 10, bottom: 6, fontSize: 10.5, color: '#6b7280', background: '#f3f4f6', padding: '2px 8px', borderRadius: 999 }}>
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
  header, setHeader, onClose, onChooseLogo,
}: {
  header: HeaderConfig;
  setHeader: (next: HeaderConfig) => void;
  onClose: () => void;
  onChooseLogo: () => void;
}) {
  return (
    <div className="tpl-popover" style={popoverStyle}>
      <PopoverHeader title="Header Settings" onClose={onClose} />
      <div className="row g-3" style={{ padding: 14 }}>
        <div className="col-md-6">
          <label className="tpl-popover-label" style={labelStyle}>Title</label>
          <input type="text" value={header.title} onChange={e => setHeader({ ...header, title: e.target.value })}
            placeholder="e.g. Inorbvict Healthcare" className="tpl-popover-input" style={inputStyle} />
        </div>
        <div className="col-md-6">
          <label className="tpl-popover-label" style={labelStyle}>Subtitle</label>
          <input type="text" value={header.subtitle} onChange={e => setHeader({ ...header, subtitle: e.target.value })}
            placeholder="e.g. Confidential / Document name" className="tpl-popover-input" style={inputStyle} />
        </div>

        <div className="col-md-6">
          <label className="tpl-popover-label" style={labelStyle}>Logo</label>
          <div className="d-flex align-items-center gap-2">
            <button type="button" onClick={onChooseLogo}
              className="tpl-logo-upload"
              style={{ padding: '7px 12px', background: '#6366f1', color: '#fff', border: 0, borderRadius: 8, fontSize: 12.5, fontWeight: 700, cursor: 'pointer' }}>
              <i className="ri-upload-2-line me-1" />{header.logo_url ? 'Replace Logo' : 'Upload Logo'}
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
              onClick={() => setHeader({ ...header, logo_pos: { x: 10, y: 50 }, title_pos: { x: 88, y: 50 } })}
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
    </div>
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
    <div className="tpl-popover" style={popoverStyle}>
      <PopoverHeader title="Footer Settings" onClose={onClose} />
      <div className="row g-3" style={{ padding: 14 }}>
        <div className="col-md-8">
          <label className="tpl-popover-label" style={labelStyle}>Footer Text</label>
          <input type="text" value={footer.text} onChange={e => setFooter({ ...footer, text: e.target.value })}
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
                <option value="N">1</option>
                <option value="Page N">Page 1</option>
                <option value="Page N of M">Page 1 of 10</option>
                <option value="N / M">1 / 10</option>
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
    </div>
  );
}

/* ── Small primitives ──────────────────────────────────────────────────────── */
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
      [data-bs-theme="dark"] .tpl-page-shell .tpl-edit-hint {
        background: rgba(255,255,255,0.10) !important;
        color: rgba(255,255,255,0.75) !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell .tpl-drag-hint {
        background: rgba(99,102,241,0.20) !important;
        color: #c7d2fe !important;
      }
      [data-bs-theme="dark"] .tpl-page-shell .tpl-page-body {
        background: var(--vz-secondary-bg) !important;
      }

      /* Popover (Header Settings / Footer Settings) */
      [data-bs-theme="dark"] .tpl-popover {
        background: var(--vz-card-bg) !important;
        border-bottom-color: #8b5cf6 !important;
      }
      [data-bs-theme="dark"] .tpl-popover-label {
        color: rgba(255,255,255,0.55) !important;
      }
      [data-bs-theme="dark"] .tpl-popover-hint {
        color: rgba(255,255,255,0.45) !important;
      }
      [data-bs-theme="dark"] .tpl-popover-warn {
        color: #fbbf24 !important;
      }
      [data-bs-theme="dark"] .tpl-popover-input {
        background: var(--vz-secondary-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }
      [data-bs-theme="dark"] .tpl-popover-input::placeholder {
        color: rgba(255,255,255,0.40) !important;
      }
      [data-bs-theme="dark"] .tpl-popover-divider {
        border-top-color: var(--vz-border-color) !important;
      }

      /* Inline chips (alignment selector, page-number alignment) */
      [data-bs-theme="dark"] .tpl-chip:not(.is-active) {
        background: var(--vz-secondary-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }
      [data-bs-theme="dark"] .tpl-chip.tpl-chip-reset {
        background: rgba(245,158,11,0.18) !important;
        border-color: rgba(245,158,11,0.40) !important;
        color: #fbbf24 !important;
      }

      [data-bs-theme="dark"] .tpl-toggle-chip:not(.is-on) {
        background: var(--vz-secondary-bg) !important;
        border-color: var(--vz-border-color) !important;
        color: var(--vz-body-color) !important;
      }

      [data-bs-theme="dark"] .tpl-color-swatch {
        background: var(--vz-secondary-bg) !important;
        border-color: var(--vz-border-color) !important;
      }
      [data-bs-theme="dark"] .tpl-logo-remove {
        background: rgba(248,113,113,0.18) !important;
        color: #fca5a5 !important;
      }
    `}</style>
  );
}
