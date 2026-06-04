import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import api from '../../api';
import { useToast } from '../../contexts/ToastContext';
import type { OpsTokens } from './useOpsTheme';
import type { HeaderConfig, FooterConfig } from '../hrms/doc-templates/HeaderFooterPanel';

/* ─────────────────────────────────────────────────────────────────────────
 * CTC → Send for Signature & Negotiation · Step 2 (position signatures).
 *
 * Reuses the same Zoho Sign coordinate model as the sales signature modal:
 * the preview PDF is shown in an <iframe> (page-fit) and one draggable box
 * per signer is overlaid in the SAME coordinate space. Boxes are stored in
 * PDF points (A4 595×842, top-left origin) — exactly what Zoho's submit
 * field-placement expects. On send it POSTs to /clm/signature-requests/ctc-send.
 * ───────────────────────────────────────────────────────────────────────── */

const A4_W = 595;
const A4_H = 842;
type Box = { x: number; y: number; page: number; width: number; height: number };
type Signer = { name: string; email: string };

const SIG_GRADS = ['#4C1D95,#7C3AED', '#0e7490,#0891b2', '#047857,#059669', '#B45309,#D97706', '#9D174D,#DB2777'];

export default function ClmCtcSignPositionModal({ t, contractId, code, title, signers, header, footer, content, onClose, onSent }: {
  t: OpsTokens; contractId: number; code: string; title: string; signers: Signer[];
  header: HeaderConfig; footer: FooterConfig; content: string;
  onClose: () => void; onSent: () => void;
}) {
  const toast = useToast();
  // Stable per-signer key so each signer's field lands at its own coords.
  const keyed = signers.map((s, i) => ({ ...s, key: `signer${i + 1}` }));
  const seed = (i: number): Box => ({ x: 60 + (i % 3) * 170, y: 720 - Math.floor(i / 3) * 70, page: 0, width: 150, height: 45 });

  const [boxes, setBoxes] = useState<Record<string, Box>>(() => Object.fromEntries(keyed.map((s, i) => [s.key, seed(i)])));
  const [activeKey, setActiveKey] = useState<string>(keyed[0]?.key ?? '');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [expiryDays, setExpiryDays] = useState(14);
  const [notes, setNotes] = useState('Please review and sign this agreement.');
  const [wrapW, setWrapW] = useState(0);
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<{ mode: 'move' | 'resize'; sx: number; sy: number; init: Box } | null>(null);

  const active = boxes[activeKey];

  // Load the contract preview PDF (page-shell + org signature applied).
  useEffect(() => {
    let alive = true;
    setLoading(true); setPreviewUrl(null);
    api.post('/clm/signature-requests/ctc-preview', { contract_id: contractId, header_config_override: header, footer_config_override: footer, content_override: content }, { responseType: 'blob' })
      .then(r => { if (!alive) return; setPreviewUrl(URL.createObjectURL(r.data as Blob)); })
      .catch(() => { if (alive) toast.error('Preview failed', 'Could not render the contract for signing.'); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [contractId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl); }, [previewUrl]);

  // Measure the preview wrapper so px↔pt conversion stays accurate.
  useEffect(() => {
    const el = wrapRef.current; if (!el) return;
    const ro = new ResizeObserver(es => { for (const e of es) setWrapW(e.contentRect.width); });
    ro.observe(el);
    return () => ro.disconnect();
  }, [previewUrl]);

  const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
  const setActive = (patch: Partial<Box>) => setBoxes(b => ({ ...b, [activeKey]: { ...b[activeKey], ...patch } }));

  const onDown = (e: React.PointerEvent, mode: 'move' | 'resize') => {
    if (!active) return;
    e.preventDefault(); e.stopPropagation();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    dragRef.current = { mode, sx: e.clientX, sy: e.clientY, init: { ...active } };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
  };
  const onMove = (e: PointerEvent) => {
    const d = dragRef.current; if (!d || wrapW <= 0) return;
    const ptPerPx = A4_W / wrapW;
    const dx = (e.clientX - d.sx) * ptPerPx, dy = (e.clientY - d.sy) * ptPerPx;
    if (d.mode === 'move') setActive({ x: clamp(d.init.x + dx, 0, A4_W - d.init.width), y: clamp(d.init.y + dy, 0, A4_H - d.init.height) });
    else setActive({ width: clamp(d.init.width + dx, 40, A4_W - d.init.x), height: clamp(d.init.height + dy, 24, A4_H - d.init.y) });
  };
  const onUp = () => { dragRef.current = null; window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerup', onUp); };

  const send = async () => {
    setSending(true);
    try {
      const payload = {
        contract_id: contractId,
        signers: keyed.map((s, i) => ({ name: s.name, email: s.email, role: s.key, order: i + 1 })),
        document_settings: { [contractId]: Object.fromEntries(keyed.map(s => [s.key, boxes[s.key]])) },
        expiry_days: expiryDays,
        is_sequential: false,
        notes,
        header_config_override: header,
        footer_config_override: footer,
        content_override: content,
      };
      const res = await api.post('/clm/signature-requests/ctc-send', payload);
      const msg = res.data?.message ?? 'Sent for signature.';
      toast.success('Sent for signing', msg);
      onSent();
    } catch (e) {
      const m = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      toast.error('Could not send', m || 'Failed to send for signature.');
    } finally { setSending(false); }
  };

  const pxPerPt = wrapW > 0 ? wrapW / A4_W : 0;
  const ipt: React.CSSProperties = { width: '100%', height: 30, padding: '0 9px', border: `1.5px solid ${t.searchBorder}`, borderRadius: 8, fontSize: 11, fontFamily: 'inherit', color: t.text, outline: 'none', background: t.dark ? 'rgba(255,255,255,.04)' : '#fff', boxSizing: 'border-box' };

  return createPortal(
    <div onMouseDown={e => { if (e.target === e.currentTarget && !sending) onClose(); }} style={{ position: 'fixed', inset: 0, zIndex: 999999999, background: 'rgba(15,7,50,.6)', backdropFilter: 'blur(8px)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20, fontFamily: "'Rubik',system-ui,sans-serif" }}>
      <div onMouseDown={e => e.stopPropagation()} style={{ width: 'min(1080px,97vw)', height: 'min(88vh,820px)', background: t.surface, borderRadius: 18, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.4)' : 'rgba(124,58,237,.25)'}`, boxShadow: '0 40px 90px rgba(109,40,217,.4)', display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        {/* header */}
        <div style={{ padding: '14px 20px', background: 'linear-gradient(120deg,#4C1D95,#6D28D9,#7C3AED,#8B5CF6)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexShrink: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <div style={{ width: 38, height: 38, borderRadius: 11, background: 'rgba(255,255,255,.18)', border: '1.5px solid rgba(255,255,255,.3)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.1" strokeLinecap="round"><path d="M12 20h9" /><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z" /></svg></div>
            <div><div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.12em', textTransform: 'uppercase', color: 'rgba(255,255,255,.6)' }}>Position Signatures · {code}</div><div style={{ fontSize: 15, fontWeight: 800, color: '#fff' }}>{title || 'Agreement'}</div><div style={{ fontSize: 9, color: 'rgba(255,255,255,.72)', marginTop: 1 }}>Drag each signer's box to set where they sign · sent via Zoho Sign</div></div>
          </div>
          <button onClick={() => !sending && onClose()} style={{ width: 30, height: 30, borderRadius: 9, border: 'none', background: 'rgba(255,255,255,.18)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg></button>
        </div>
        {/* body: preview (left) + controls (right) */}
        <div style={{ flex: 1, minHeight: 0, display: 'flex', overflow: 'hidden' }}>
          {/* preview */}
          <div style={{ flex: 1, minWidth: 0, background: t.dark ? '#100c1c' : '#EDEAF6', padding: 18, overflowY: 'auto', display: 'flex', justifyContent: 'center' }}>
            <div ref={wrapRef} style={{ position: 'relative', width: '100%', maxWidth: 560, aspectRatio: `${A4_W} / ${A4_H}`, background: '#fff', boxShadow: '0 8px 30px rgba(0,0,0,.25)', borderRadius: 4, overflow: 'hidden', alignSelf: 'flex-start' }}>
              {loading && <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: '#64748B' }}>Rendering preview…</div>}
              {previewUrl && <iframe key={`${previewUrl}-p${active?.page ?? 0}`} title="CTC preview" src={`${previewUrl}#page=${(active?.page ?? 0) + 1}&toolbar=0&navpanes=0&scrollbar=0&zoom=page-fit&view=FitH`} style={{ width: '100%', height: '100%', border: 'none' }} />}
              {/* signer overlays on the active page */}
              {pxPerPt > 0 && keyed.map((s, i) => {
                const b = boxes[s.key]; if (!b || b.page !== (active?.page ?? 0)) return null;
                const on = s.key === activeKey;
                const grad = SIG_GRADS[i % SIG_GRADS.length];
                return (
                  <div key={s.key} onPointerDown={e => { if (!on) { e.stopPropagation(); setActiveKey(s.key); return; } onDown(e, 'move'); }}
                    style={{ position: 'absolute', left: b.x * pxPerPt, top: b.y * pxPerPt, width: b.width * pxPerPt, height: b.height * pxPerPt, border: `2px ${on ? 'solid' : 'dashed'} ${on ? '#7C3AED' : 'rgba(124,58,237,.45)'}`, borderRadius: 5, background: on ? 'rgba(124,58,237,.14)' : 'rgba(124,58,237,.05)', cursor: on ? 'move' : 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', boxSizing: 'border-box', touchAction: 'none', opacity: on ? 1 : 0.65 }}>
                    <span style={{ fontSize: 8, fontWeight: 800, color: '#6D28D9', background: `linear-gradient(135deg,${grad})`, WebkitBackgroundClip: 'text', backgroundClip: 'text', WebkitTextFillColor: 'transparent', pointerEvents: 'none', whiteSpace: 'nowrap', overflow: 'hidden', maxWidth: '90%' }}>✒ {s.name || `Signer ${i + 1}`}</span>
                    {on && <div onPointerDown={e => onDown(e, 'resize')} style={{ position: 'absolute', right: -5, bottom: -5, width: 12, height: 12, borderRadius: 3, background: '#7C3AED', border: '1.5px solid #fff', cursor: 'nwse-resize', touchAction: 'none' }} />}
                  </div>
                );
              })}
            </div>
          </div>
          {/* controls */}
          <div style={{ width: 300, flexShrink: 0, borderLeft: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.surface, display: 'flex', flexDirection: 'column', overflowY: 'auto', padding: '14px 16px', gap: 12 }}>
            <div>
              <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.1em', textTransform: 'uppercase', color: t.dark ? '#a78bfa' : '#6D28D9', marginBottom: 7 }}>Signers ({keyed.length})</div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {keyed.map((s, i) => {
                  const on = s.key === activeKey; const grad = SIG_GRADS[i % SIG_GRADS.length];
                  return (
                    <button key={s.key} onClick={() => setActiveKey(s.key)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '7px 9px', borderRadius: 9, border: `1.5px solid ${on ? '#7C3AED' : (t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE')}`, background: on ? (t.dark ? 'rgba(124,58,237,.14)' : '#F5F0FF') : t.surface, cursor: 'pointer', fontFamily: 'inherit', textAlign: 'left' }}>
                      <div style={{ width: 26, height: 26, borderRadius: 8, background: `linear-gradient(135deg,${grad})`, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}><span style={{ fontSize: 9, fontWeight: 800, color: '#fff' }}>{(s.name || `S${i + 1}`).slice(0, 2).toUpperCase()}</span></div>
                      <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: 10, fontWeight: 800, color: t.textStrong, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.name || `Signer ${i + 1}`}</div><div style={{ fontSize: 8, color: t.textMuted, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{s.email}</div></div>
                    </button>
                  );
                })}
              </div>
            </div>
            {/* coord pane for active signer */}
            {active && (
              <div style={{ borderRadius: 11, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, background: t.dark ? 'rgba(255,255,255,.02)' : '#FAFBFF', padding: '10px 11px' }}>
                <div style={{ fontSize: 8, fontWeight: 800, letterSpacing: '.08em', textTransform: 'uppercase', color: t.textMuted, marginBottom: 8 }}>Signature Position</div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  {([['X', 'x', A4_W], ['Y', 'y', A4_H], ['Width', 'width', A4_W], ['Height', 'height', A4_H]] as const).map(([lbl, k, max]) => (
                    <div key={k}><div style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>{lbl}</div><input type="number" value={Math.round(active[k])} onChange={e => setActive({ [k]: clamp(Number(e.target.value) || 0, 0, max) } as Partial<Box>)} style={ipt} /></div>
                  ))}
                  <div><div style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Page</div><input type="number" min={1} value={active.page + 1} onChange={e => setActive({ page: Math.max(0, (Number(e.target.value) || 1) - 1) })} style={ipt} /></div>
                </div>
              </div>
            )}
            {/* send options */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: 8 }}>
              <div><div style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Days to Sign</div><input type="number" min={1} max={180} value={expiryDays} onChange={e => setExpiryDays(Number(e.target.value) || 14)} style={ipt} /></div>
              <div><div style={{ fontSize: 7.5, fontWeight: 700, color: t.textMuted, textTransform: 'uppercase', marginBottom: 3 }}>Note to Signers</div><textarea value={notes} onChange={e => setNotes(e.target.value)} rows={2} style={{ ...ipt, height: 'auto', padding: '7px 9px', resize: 'vertical' }} /></div>
            </div>
          </div>
        </div>
        {/* footer */}
        <div style={{ flexShrink: 0, padding: '12px 18px', borderTop: `1.5px solid ${t.dark ? 'rgba(124,58,237,.2)' : '#EDE9FE'}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
          <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 9, fontWeight: 600, color: t.textMuted }}><svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><rect x="3" y="11" width="18" height="11" rx="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>Drag boxes to position · sent securely via Zoho Sign</span>
          <div style={{ display: 'flex', gap: 8 }}>
            <button onClick={() => !sending && onClose()} style={{ padding: '8px 18px', borderRadius: 9, border: `1.5px solid ${t.dark ? 'rgba(124,58,237,.3)' : '#DDD6FE'}`, background: t.dark ? 'rgba(124,58,237,.1)' : '#F5F0FF', color: t.dark ? '#c4b5fd' : '#6D28D9', fontSize: 10.5, fontWeight: 700, cursor: 'pointer', fontFamily: 'inherit' }}>Cancel</button>
            <button onClick={send} disabled={sending || loading} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '8px 20px', borderRadius: 9, border: 'none', background: sending || loading ? '#C4B5FD' : 'linear-gradient(135deg,#4C1D95,#6D28D9,#7C3AED)', color: '#fff', fontSize: 10.5, fontWeight: 800, cursor: sending || loading ? 'not-allowed' : 'pointer', fontFamily: 'inherit', boxShadow: '0 4px 14px rgba(109,40,217,.4)' }}><svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"><line x1="22" y1="2" x2="11" y2="13" /><polygon points="22 2 15 22 11 13 2 9 22 2" /></svg> {sending ? 'Sending…' : 'Send for Signature'}</button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  );
}
