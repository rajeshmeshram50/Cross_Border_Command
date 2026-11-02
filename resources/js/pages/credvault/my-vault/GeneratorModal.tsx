import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { cvApi } from '../cvApi';
import { copyText, CvPortal, errMsg, Svg, useCvMeta } from '../shared';

/** CredVault · Generate Password popup. onUse → "Use in New Credential". */
export interface GeneratorModalProps {
  onClose: () => void;
  onUse?: (password: string) => void;
}

type Mode = 'chars' | 'phrase';
interface Opts {
  mode: Mode; len: number; words: number;
  upper: boolean; lower: boolean; num: boolean; sym: boolean; amb: boolean;
  sep: '-' | '.' | '_' | ' '; cap: boolean;
}
type BoolKey = 'upper' | 'lower' | 'num' | 'sym' | 'amb' | 'cap';

const SLIDERS = 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6';
const SEPS: [Opts['sep'], string][] = [['-', 'Hyphen'], ['.', 'Dot'], ['_', 'Underscore'], [' ', 'Space']];

/** The meter class and fill for the API's level, as the prototype's gpLevel(). */
function levelOf(level: string): [string, number] {
  switch (level) {
    case 'Very strong': return ['vstrong', 100];
    case 'Strong': return ['strong', 80];
    case 'Good': return ['good', 60];
    case 'Fair': return ['fair', 40];
    default: return ['weak', 20];
  }
}

/** Digits and symbols tinted (gp-n / gp-s); a passphrase may break after each separator. */
function Colored({ value, phrase }: { value: string; phrase: boolean }) {
  return (
    <>
      {value.split('').map((c, i) => {
        if (/[0-9]/.test(c)) return <i key={i} className="gp-n">{c}</i>;
        if (/[^A-Za-z0-9 ]/.test(c)) return <Fragment key={i}><i className="gp-s">{c}</i>{phrase && <wbr />}</Fragment>;
        return <Fragment key={i}>{c}</Fragment>;
      })}
    </>
  );
}

export default function GeneratorModal({ onClose, onUse }: GeneratorModalProps) {
  const toast = useToast();
  const { meta } = useCvMeta();
  const [o, setO] = useState<Opts>({ mode: 'chars', len: 20, words: 8, upper: true, lower: true, num: true, sym: true, amb: true, sep: '-', cap: true });
  const [res, setRes] = useState<{ password: string; bits: number; level: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const seq = useRef(0);
  const seeded = useRef(false);

  // The policy's default length and symbols, once /meta is in.
  useEffect(() => {
    if (!meta || seeded.current) return;
    seeded.current = true;
    setO(p => ({ ...p, len: meta.policy.gen_length || p.len, sym: meta.policy.gen_symbols ?? p.sym }));
  }, [meta]);

  const generate = useCallback(async (x: Opts) => {
    const n = ++seq.current;
    setBusy(true);
    try {
      const d = await cvApi.generatePassword(x.mode === 'phrase'
        ? { mode: 'phrase', words: x.words, separator: x.sep, capitalize: x.cap, add_number: x.num, numbers: x.num }
        : { mode: 'chars', length: x.len, upper: x.upper, lower: x.lower, numbers: x.num, symbols: x.sym, avoid_ambiguous: x.amb });
      if (n === seq.current) setRes(d);
    } catch (e) {
      if (n === seq.current) toast.error('Could not generate a password', errMsg(e));
    } finally {
      if (n === seq.current) setBusy(false);
    }
  }, [toast]);

  // Regenerate on every option change; the slider is debounced so dragging sends one call.
  useEffect(() => {
    const t = setTimeout(() => generate(o), 180);
    return () => clearTimeout(t);
  }, [o, generate]);

  const phrase = o.mode === 'phrase';
  const min = phrase ? 4 : 8;
  const max = phrase ? 12 : 64;
  const v = phrase ? o.words : o.len;
  const pct = ((v - min) / (max - min)) * 100;
  const [lvCls, lvPct] = levelOf(res?.level ?? '');

  const setFlag = (k: BoolKey, val: boolean) => {
    if (!phrase && !val && (['upper', 'lower', 'num', 'sym'] as BoolKey[]).includes(k)) {
      const on = (['upper', 'lower', 'num', 'sym'] as const).filter(x => o[x]).length;
      if (on <= 1) { toast.warning('Keep at least one character set on'); return; }
    }
    setO(p => ({ ...p, [k]: val }));
  };

  const copy = async () => {
    if (!res?.password) return;
    try { await copyText(res.password); toast.success('Password copied to clipboard'); } catch { toast.error('Could not copy', 'Your browser blocked clipboard access.'); }
  };

  const tg = (k: BoolKey, lbl: string, sub: string) => (
    <label key={k} className={`crd-tg gp-tg${o[k] ? ' is-on' : ''}`}>
      <input type="checkbox" checked={o[k]} onChange={e => setFlag(k, e.target.checked)} />
      <span className="crd-tg__sw"><i /></span>
      <span className="gp-tg__t"><b>{lbl}</b><small>{sub}</small></span>
    </label>
  );

  return (
    <CvPortal onClose={onClose}>
      <div id="crd-host">
        <div className="mapsup-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
          <div className="mapsup-box crd-box gp-box" role="dialog" aria-modal="true" aria-label="Generate Password">
            <div className="mapsup-header gp-hd">
              <div className="mapsup-hrow">
                <div className="mapsup-title-wrap">
                  <div className="mapsup-hicon crd-hicon"><Svg icon="key" size={22} /></div>
                  <div className="mapsup-title-block">
                    <h3 className="mapsup-title">Generate Password</h3>
                    <p className="mapsup-sub">Cryptographically random, generated on the vault server — never stored until you save a credential.</p>
                  </div>
                </div>
                <div className="crd-hbtns"><button type="button" className="mapsup-close" onClick={onClose} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button></div>
              </div>
            </div>

            <div className="mapsup-body gp-body">
              <div className="gp-out">
                <div className={`gp-out__v${phrase ? ' is-phrase' : ''}`} style={busy && !res ? { opacity: .5 } : undefined}>
                  {res ? <Colored value={res.password} phrase={phrase} /> : 'Generating…'}
                </div>
                <div className="gp-out__btns">
                  <button type="button" data-h40="skip" className="crd-pw__b" title="Copy" onClick={copy} disabled={!res}><Svg icon="copy" size={15} /></button>
                  <button type="button" data-h40="skip" className="crd-pw__b crd-pw__b--gen" title="Regenerate" onClick={() => generate(o)}><Svg icon="gen" size={15} sw={2.4} /></button>
                </div>
              </div>
              <div className={`gp-meter gp-meter--${lvCls}`}>
                <div className="gp-meter__track"><span className="gp-meter__fill" style={{ width: `${res ? lvPct : 0}%` }} /></div>
                <span className="gp-meter__lbl">{res?.level ?? ''}</span>
                <span className="gp-meter__bits">{res ? `~${res.bits} bits` : ''}</span>
              </div>

              <div className="gp-grid">
                <div className="mapsup-seccard gp-card">
                  <div className="mapsup-sechead">
                    <span className="mapsup-sechead__ico"><Svg icon={SLIDERS} size={14} /></span>
                    <div className="mapsup-sechead__txt"><span className="mapsup-sechead__title">Type &amp; Length</span><span className="mapsup-sechead__sub">Random characters or an easy-to-type passphrase</span></div>
                  </div>
                  <div className="gp-modes">
                    <button type="button" data-h40="skip" className={phrase ? '' : 'is-on'} onClick={() => setO(p => ({ ...p, mode: 'chars' }))}>
                      <Svg icon="hash" size={14} /><span><b>Characters</b><small>Random mix of characters</small></span>
                    </button>
                    <button type="button" data-h40="skip" className={phrase ? 'is-on' : ''} onClick={() => setO(p => ({ ...p, mode: 'phrase' }))}>
                      <Svg icon="note" size={14} /><span><b>Passphrase</b><small>Random dictionary words</small></span>
                    </button>
                  </div>
                  <div className="gp-len">
                    <div className="gp-len__top"><b>{phrase ? 'Words' : 'Length'}</b><span className="gp-len__v"><span>{v}</span> {phrase ? 'words' : 'characters'}</span></div>
                    <input type="range" className="gp-range" min={min} max={max} value={v}
                      onChange={e => { const n = +e.target.value; setO(p => (phrase ? { ...p, words: n } : { ...p, len: n })); }}
                      style={{ '--gpp': `${pct}%` } as CSSProperties} />
                    <div className="gp-len__sc"><span>{min}</span><span>{max}</span></div>
                  </div>
                </div>
                <div className="mapsup-seccard gp-card">
                  <div className="mapsup-sechead">
                    <span className="mapsup-sechead__ico"><Svg icon="shield" size={14} /></span>
                    <div className="mapsup-sechead__txt"><span className="mapsup-sechead__title">Options</span><span className="mapsup-sechead__sub">What the password is made of</span></div>
                  </div>
                  <div className="gp-opts">
                    {phrase ? (
                      <>
                        {tg('cap', 'Capitalise words', 'e.g. Amber-Falcon')}
                        {tg('num', 'Add a number', 'one digit on a random word')}
                        <div className="gp-sep">
                          <b>Separator</b>
                          <div className="gp-seg">
                            {SEPS.map(([s, l]) => (
                              <button key={l} type="button" data-h40="skip" className={o.sep === s ? 'is-on' : ''} onClick={() => setO(p => ({ ...p, sep: s }))}>{l}</button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        {tg('upper', 'Uppercase', 'A – Z')}
                        {tg('lower', 'Lowercase', 'a – z')}
                        {tg('num', 'Numbers', '0 – 9')}
                        {tg('sym', 'Symbols', '! @ # $ % ^ &')}
                        {tg('amb', 'Avoid ambiguous', 'skip I l O 0 1')}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="gp-note"><Svg icon="lock" size={12} /> Not stored until you save a credential</div>
            </div>

            <div className="mapsup-footer">
              <div className="mapsup-footer__info"><Svg icon="lock" size={12} /> Not stored until you save a credential</div>
              <div className="mapsup-footer__actions">
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={() => generate(o)}><Svg icon="gen" size={13} />Regenerate</button>
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={copy} disabled={!res}><Svg icon="copy" size={13} />Copy</button>
                {onUse && (
                  <button type="button" className="mapsup-footer__btn mapsup-footer__btn--primary" disabled={!res} onClick={() => res && onUse(res.password)}>
                    <Svg icon="plus" size={13} sw={2.6} />Use in New Credential
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </CvPortal>
  );
}
