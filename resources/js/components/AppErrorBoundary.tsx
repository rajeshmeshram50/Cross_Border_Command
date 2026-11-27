import { Component, type ErrorInfo, type ReactNode } from 'react';

/* ─────────────────────────────────────────────────────────────────────────
 * App-wide error boundary. Any throw during render used to tear down the whole
 * tree and leave a blank white page; this shows the approved "Return to
 * workspace" recovery screen instead, with a button that reloads.
 *
 * Self-contained on purpose: the CSS is inlined in a <style> block scoped under
 * #cbcErrorRoot (so it can't clash with or leak into the app), and the markup
 * uses inline SVG — it must render even when the app's stylesheet is what failed.
 * ───────────────────────────────────────────────────────────────────────── */

type Props = { children: ReactNode };
type State = { error: Error | null };

export default class AppErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    /* Kept in the console (no reporting service is wired up). The component
       stack is what locates the failure, and React stops printing it once a
       boundary handles the error. */
    console.error('[AppErrorBoundary]', error, info.componentStack);
  }

  private reload = () => {
    /* Clear lazyPage's auto-reload stamp so a deliberate click is never
       refused by the machine-loop cooldown (same RELOAD_KEY). */
    try { sessionStorage.removeItem('cbc_chunk_reload_at'); } catch {}
    window.location.reload();
  };

  render() {
    if (!this.state.error) return this.props.children;

    return (
      <div id="cbcErrorRoot" role="alert" aria-live="assertive">
        <style>{CSS}</style>

        <div className="background-wave wave-top" aria-hidden="true">{WAVE}</div>
        <div className="background-wave wave-bottom" aria-hidden="true">{WAVE}</div>

        <section className="recovery-card">
          <div className="illustration">{ILLUSTRATION}</div>

          <h1 className="recovery-title">
            <span>Let’s get you</span> back to your workspace.
          </h1>

          <div className="decorative-divider" aria-hidden="true">
            <span /><span /><span />
          </div>

          <p className="recovery-description">
            Your workspace is ready. Continue your work and keep things moving forward.
          </p>

          <button type="button" className="reload-button" onClick={this.reload}>
            <svg className="reload-icon" width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M20 7v5h-5" /><path d="M4 17v-5h5" />
              <path d="M6 7a8 8 0 0 1 13 2l1 3" /><path d="M18 17a8 8 0 0 1-13-2l-1-3" />
            </svg>
            <span>Please Reload This Page</span>
            <svg className="arrow-icon" width="26" height="26" viewBox="0 0 24 24" fill="none"
              stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <path d="M3 12h17" /><path d="m13 5 7 7-7 7" />
            </svg>
          </button>
        </section>
      </div>
    );
  }
}

const WAVE = (
  <svg viewBox="0 0 600 350">
    <path d="M0 0 H600 C450 100 350 20 220 150 C120 250 60 180 0 350 Z" fill="#C8F3F9" />
    <path d="M0 0 H450 C300 70 260 20 160 120 C80 200 30 180 0 240 Z" fill="#B5EFF6" />
  </svg>
);

const ILLUSTRATION = (
  <svg viewBox="0 0 600 340" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Laptop with refresh symbol">
    <defs>
      <linearGradient id="tealGradient" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stopColor="#60E5E8" /><stop offset="50%" stopColor="#00C5D2" /><stop offset="100%" stopColor="#00859C" />
      </linearGradient>
      <linearGradient id="screenGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#F1FEFF" /><stop offset="100%" stopColor="#C6F4F9" />
      </linearGradient>
      <linearGradient id="baseGradient" x1="0%" y1="0%" x2="0%" y2="100%">
        <stop offset="0%" stopColor="#C0F0F4" /><stop offset="100%" stopColor="#289CB0" />
      </linearGradient>
      <linearGradient id="potGradient">
        <stop offset="0%" stopColor="#F5FFFF" /><stop offset="100%" stopColor="#B6E8EE" />
      </linearGradient>
      <radialGradient id="haloGradient">
        <stop offset="0%" stopColor="#E9FCFF" /><stop offset="100%" stopColor="#D6F5F9" />
      </radialGradient>
      <filter id="softShadow"><feGaussianBlur stdDeviation="7" /></filter>
    </defs>

    <circle cx="300" cy="155" r="145" fill="url(#haloGradient)" />
    <ellipse cx="300" cy="310" rx="265" ry="12" fill="#7DCED9" opacity="0.22" filter="url(#softShadow)" />

    <g stroke="#21CBD3" strokeWidth="5" strokeLinecap="round">
      <path d="M100 105 L84 96" /><path d="M116 88 L107 72" /><path d="M96 121 L80 122" />
      <path d="M473 85 L482 69" /><path d="M490 99 L507 87" /><path d="M496 119 L514 115" />
    </g>

    <rect x="155" y="110" width="290" height="184" rx="12" fill="url(#tealGradient)" />
    <rect x="163" y="119" width="274" height="166" rx="5" fill="url(#screenGradient)" />
    <circle cx="300" cy="114" r="1.8" fill="#E8FFFF" />

    <circle cx="300" cy="202" r="72" fill="#F1FEFF" opacity="0.55" />
    <circle cx="300" cy="202" r="59" fill="#D5FAFC" />
    <circle cx="300" cy="202" r="44" fill="url(#tealGradient)" />

    <g fill="none" stroke="#FFFFFF" strokeWidth="6" strokeLinecap="round" strokeLinejoin="round">
      <path d="M276 195 A25 25 0 0 1 321 184 L326 192" />
      <path d="M326 177 V192 H311" />
      <path d="M324 209 A25 25 0 0 1 279 220 L274 212" />
      <path d="M274 227 V212 H289" />
    </g>

    <path d="M155 294 H445 L480 307 H120 Z" fill="url(#baseGradient)" />
    <path d="M120 307 H480 Q480 319 465 319 H135 Q120 319 120 307" fill="url(#baseGradient)" />
    <path d="M275 294 H325 L319 301 H281 Z" fill="#197F94" />

    <g fill="url(#tealGradient)">
      <ellipse cx="75" cy="225" rx="13" ry="30" transform="rotate(-15 75 225)" />
      <ellipse cx="94" cy="243" rx="13" ry="28" transform="rotate(45 94 243)" />
      <ellipse cx="56" cy="245" rx="12" ry="25" transform="rotate(-48 56 245)" />
    </g>
    <g stroke="#1699A8" strokeWidth="2" fill="none">
      <path d="M77 276 L75 225" /><path d="M77 276 L94 243" /><path d="M77 276 L56 245" />
    </g>
    <path d="M47 271 H107 L100 307 Q77 319 54 307 Z" fill="url(#potGradient)" />
    <rect x="44" y="267" width="66" height="12" rx="4" fill="#E9FCFF" />

    <rect x="490" y="285" width="98" height="28" rx="7" fill="url(#tealGradient)" />
    <rect x="505" y="290" width="83" height="18" rx="3" fill="#F0FFFF" />
    <rect x="484" y="260" width="98" height="25" rx="6" fill="#91E0E8" />
    <rect x="499" y="265" width="83" height="15" rx="3" fill="#F5FFFF" />
    <g stroke="#C9E9ED" strokeWidth="1">
      <path d="M510 296 H584" /><path d="M510 302 H584" /><path d="M504 270 H578" /><path d="M504 275 H578" />
    </g>
  </svg>
);

/* Approved recovery-screen CSS, scoped under #cbcErrorRoot so it neither leaks
   into the app nor is overridden by it. Base sizes kept compact at 100% zoom;
   width + height media queries step DOWN further on narrow/short screens. */
const CSS = `
#cbcErrorRoot{--primary:#00859c;--primary-light:#00cbd5;--primary-dark:#075b75;--heading-color:#214f69;--text-color:#405a76;--card-border:#b5eff7;--white:#fff;
 position:fixed;inset:0;z-index:99999;overflow:hidden;isolation:isolate;
 display:flex;align-items:center;justify-content:center;padding:88px 24px 40px;
 font-family:"Inter",Arial,sans-serif;-webkit-font-smoothing:antialiased;
 background:radial-gradient(ellipse at center,#ffffff 0%,#f4fafc 45%,#e9f8fc 100%);}
#cbcErrorRoot *{margin:0;padding:0;box-sizing:border-box;}
#cbcErrorRoot .background-wave{position:absolute;width:34%;pointer-events:none;z-index:-1;}
#cbcErrorRoot .background-wave svg{display:block;width:100%;height:auto;}
#cbcErrorRoot .wave-top{top:0;left:0;}
#cbcErrorRoot .wave-bottom{bottom:0;right:0;transform:rotate(180deg);}
#cbcErrorRoot .recovery-card{position:relative;width:100%;max-width:620px;padding:0 32px 34px;
 border:2px solid var(--card-border);border-radius:38px;
 background:linear-gradient(135deg,rgba(255,255,255,.65),rgba(234,249,252,.72));
 box-shadow:0 16px 28px rgba(0,188,212,.12),inset 0 0 26px rgba(255,255,255,.65);text-align:center;}
#cbcErrorRoot .illustration{position:relative;width:100%;max-width:360px;margin:-98px auto 14px;}
#cbcErrorRoot .illustration svg{display:block;width:100%;height:auto;overflow:visible;}
#cbcErrorRoot .recovery-title{color:var(--heading-color);font-size:clamp(18px,1.9vw,27px);font-weight:800;line-height:1.3;letter-spacing:-.8px;margin:0 auto;}
#cbcErrorRoot .recovery-title span{color:#087c95;}
#cbcErrorRoot .decorative-divider{display:flex;justify-content:center;align-items:center;gap:10px;margin:16px auto;}
#cbcErrorRoot .decorative-divider span{display:block;width:44px;height:4px;border-radius:10px;}
#cbcErrorRoot .decorative-divider span:first-child{background:linear-gradient(to right,transparent,#8be6ef);}
#cbcErrorRoot .decorative-divider span:nth-child(2){background:#00d3da;}
#cbcErrorRoot .decorative-divider span:last-child{background:linear-gradient(to right,#8be6ef,transparent);}
#cbcErrorRoot .recovery-description{color:var(--text-color);font-size:clamp(12.5px,1vw,14.5px);font-weight:400;line-height:1.6;max-width:560px;margin:0 auto 22px;}
#cbcErrorRoot .reload-button{display:inline-flex;align-items:center;justify-content:center;gap:14px;min-height:48px;padding:12px 28px;
 border:none;border-radius:40px;background:linear-gradient(145deg,#00d6d8 0%,#00b6c6 45%,#00839c 100%);color:var(--white);
 font-family:inherit;font-size:15.5px;font-weight:700;line-height:1.4;cursor:pointer;
 box-shadow:0 9px 18px rgba(0,181,200,.28),inset 0 1px 1px rgba(255,255,255,.25);
 transition:transform .25s ease,box-shadow .25s ease,background .25s ease;}
#cbcErrorRoot .reload-button:hover{transform:translateY(-3px);box-shadow:0 13px 24px rgba(0,181,200,.35);background:linear-gradient(145deg,#00c6ce,#007b94);}
#cbcErrorRoot .reload-button:active{transform:translateY(0) scale(.98);}
#cbcErrorRoot .reload-button:focus-visible{outline:3px solid #00859c;outline-offset:5px;}
#cbcErrorRoot .reload-icon,#cbcErrorRoot .arrow-icon{flex-shrink:0;width:20px;height:20px;}
#cbcErrorRoot .reload-icon{transition:transform .6s ease;}
#cbcErrorRoot .reload-button:hover .reload-icon{transform:rotate(180deg);}
#cbcErrorRoot .arrow-icon{transition:transform .25s ease;}
#cbcErrorRoot .reload-button:hover .arrow-icon{transform:translateX(4px);}
@media (max-width:1024px){
 #cbcErrorRoot .recovery-card{max-width:520px;border-radius:34px;padding:0 28px 30px;}
 #cbcErrorRoot .illustration{max-width:330px;margin-top:-90px;}
 #cbcErrorRoot .recovery-title{font-size:23px;}
 #cbcErrorRoot .recovery-description{font-size:14px;}
 #cbcErrorRoot .reload-button{font-size:15px;min-height:46px;}
}
@media (max-width:600px){
 #cbcErrorRoot{padding:48px 16px 28px;}
 #cbcErrorRoot .background-wave{width:62%;}
 #cbcErrorRoot .recovery-card{border-radius:26px;padding:0 16px 24px;}
 #cbcErrorRoot .illustration{max-width:280px;margin:-74px auto 12px;}
 #cbcErrorRoot .recovery-title{font-size:21px;letter-spacing:-.4px;line-height:1.35;}
 #cbcErrorRoot .decorative-divider{margin:14px auto;gap:8px;}
 #cbcErrorRoot .decorative-divider span{width:40px;height:4px;}
 #cbcErrorRoot .recovery-description{font-size:13.5px;line-height:1.6;margin-bottom:20px;}
 #cbcErrorRoot .reload-button{width:100%;max-width:300px;min-height:46px;font-size:14.5px;gap:12px;padding:11px 16px;}
 #cbcErrorRoot .reload-icon,#cbcErrorRoot .arrow-icon{width:19px;height:19px;}
}
@media (max-height:720px){
 #cbcErrorRoot{padding:44px 22px 34px;}
 #cbcErrorRoot .recovery-card{padding:0 28px 30px;}
 #cbcErrorRoot .illustration{max-width:320px;margin:-84px auto 10px;}
 #cbcErrorRoot .recovery-title{font-size:clamp(17px,1.7vw,24px);}
 #cbcErrorRoot .recovery-description{font-size:13.5px;margin-bottom:18px;}
 #cbcErrorRoot .reload-button{min-height:46px;font-size:15px;}
 #cbcErrorRoot .decorative-divider{margin:14px auto;}
}
@media (max-height:600px){
 #cbcErrorRoot{padding:30px 18px 24px;}
 #cbcErrorRoot .recovery-card{padding:0 26px 24px;border-radius:32px;}
 #cbcErrorRoot .illustration{max-width:270px;margin:-70px auto 8px;}
 #cbcErrorRoot .recovery-title{font-size:21px;line-height:1.2;}
 #cbcErrorRoot .recovery-description{font-size:12.5px;line-height:1.45;margin-bottom:14px;}
 #cbcErrorRoot .reload-button{min-height:42px;font-size:14px;padding:10px 24px;gap:12px;}
 #cbcErrorRoot .reload-icon,#cbcErrorRoot .arrow-icon{width:19px;height:19px;}
 #cbcErrorRoot .decorative-divider{margin:10px auto;}
 #cbcErrorRoot .decorative-divider span{width:40px;height:4px;}
}
@media (max-height:500px){
 #cbcErrorRoot{padding:20px 14px 18px;}
 #cbcErrorRoot .recovery-card{padding:0 22px 20px;border-radius:28px;}
 #cbcErrorRoot .illustration{max-width:220px;margin:-56px auto 6px;}
 #cbcErrorRoot .recovery-title{font-size:19px;}
 #cbcErrorRoot .recovery-description{font-size:12px;margin-bottom:10px;}
 #cbcErrorRoot .reload-button{min-height:40px;font-size:13px;padding:9px 20px;}
}
@media (prefers-reduced-motion:reduce){#cbcErrorRoot *,#cbcErrorRoot *::before,#cbcErrorRoot *::after{animation:none!important;transition:none!important;}}
`;
