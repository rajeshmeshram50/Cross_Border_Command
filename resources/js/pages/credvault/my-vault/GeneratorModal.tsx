import { Fragment, useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { useToast } from '../../../contexts/ToastContext';
import { copyText, CvPortal, errMsg, Svg, useCvMeta } from '../shared';
import {
  GEN_DEFAULTS, LENGTH, LEVEL_LABEL, SEPARATORS, WORDS, charSets, charsLevel, loadWords, makeCharacters, makePassphrase,
  type GenOpts, type Generated,
} from '../generator';

/** CredVault · Generate Password popup — made on the device, never sent anywhere. onUse → "Use in New Credential". */
export interface GeneratorModalProps {
  onClose: () => void;
  onUse?: (password: string) => void;
}

type BoolKey = 'upper' | 'lower' | 'numbers' | 'symbols' | 'avoidAmbiguous' | 'capitalize' | 'addNumber';

const SLIDERS = 'M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6';
const CLIPBOARD_CLEAR_SECONDS = 30;
const SETS: BoolKey[] = ['upper', 'lower', 'numbers', 'symbols'];

/** The meter class and fill for a D34 level — no score is shown (D5). */
function levelOf(level: number): [string, number] {
  switch (level) {
    case 4: return ['strong', 100];
    case 3: return ['good', 66];
    case 2: return ['fair', 33];
    default: return ['weak', 0];
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
  const minLevel = meta?.policy.min_strength ?? 3;
  const minLabel = LEVEL_LABEL[minLevel] || 'Good';
  const digitForced = minLevel >= 3;
  const [o, setO] = useState<GenOpts>(GEN_DEFAULTS);
  const [res, setRes] = useState<Generated | null>(null);
  const seq = useRef(0);

  // A new value replaces the old one; the old one is not kept (GP-V06).
  const generate = useCallback(async (x: GenOpts) => {
    const n = ++seq.current;
    try {
      const out = x.mode === 'phrase' ? makePassphrase(x, await loadWords(), digitForced) : makeCharacters(x);
      if (n === seq.current) setRes(out);
    } catch (e) {
      if (n === seq.current) toast.error('Could not generate a password', errMsg(e));
    }
  }, [toast, digitForced]);

  // Regenerate on every option change; the slider is debounced so dragging makes one value.
  useEffect(() => {
    const t = setTimeout(() => generate(o), 120);
    return () => clearTimeout(t);
  }, [o, generate]);

  const phrase = o.mode === 'phrase';
  const [min, max] = phrase ? WORDS : LENGTH;
  const v = phrase ? o.words : o.length;
  const pct = ((v - min) / (max - min)) * 100;
  const [lvCls, lvPct] = levelOf(res?.level ?? 0);

  /** Why a toggle can't be turned off, or null when it can (GP-V01, GP-V03). */
  const blockedOff = (k: BoolKey): string | null => {
    if (phrase) return k === 'addNumber' && digitForced ? `Always on — the policy minimum is ${minLabel}` : null;
    if (!SETS.includes(k) || !o[k]) return null;
    const next = { ...o, [k]: false };
    if (!charSets(next).length) return 'Keep at least one character set on';
    if (charsLevel(next) < minLevel) return `This setting can’t reach the policy minimum (${minLabel})`;
    return null;
  };

  const setFlag = (k: BoolKey, val: boolean) => {
    const why = !val ? blockedOff(k) : null;
    if (why) { toast.warning(why); return; }
    setO(p => ({ ...p, [k]: val }));
  };

  const copy = async () => {
    if (!res?.password) return;
    try {
      await copyText(res.password, CLIPBOARD_CLEAR_SECONDS);
      toast.success('Password copied to clipboard', `The clipboard clears in ${CLIPBOARD_CLEAR_SECONDS} seconds.`);
    } catch { toast.warning('Copy failed — allow clipboard access'); }
  };

  const tg = (k: BoolKey, lbl: string, sub: string) => {
    const on = phrase && k === 'addNumber' && digitForced ? true : o[k];
    const why = on ? blockedOff(k) : null;
    return (
      <label key={k} className={`crd-tg gp-tg${on ? ' is-on' : ''}`} title={why ?? undefined} style={why ? { opacity: .7 } : undefined}>
        <input type="checkbox" checked={on} disabled={!!why} onChange={e => setFlag(k, e.target.checked)} />
        <span className="crd-tg__sw"><i /></span>
        <span className="gp-tg__t"><b>{lbl}</b><small>{why ?? sub}</small></span>
      </label>
    );
  };

  const meets = !!res && res.level >= minLevel;

  return (
    <CvPortal onClose={onClose}>
      <div id="crd-host">
        <div className="mapsup-overlay">
          <div className="mapsup-box crd-box gp-box" role="dialog" aria-modal="true" aria-label="Generate Password">
            <div className="mapsup-header gp-hd">
              <div className="mapsup-hrow">
                <div className="mapsup-title-wrap">
                  <div className="mapsup-hicon crd-hicon"><Svg icon="key" size={22} /></div>
                  <div className="mapsup-title-block">
                    <h3 className="mapsup-title">Generate Password</h3>
                    <p className="mapsup-sub">Cryptographically random, generated on your device — never sent anywhere.</p>
                  </div>
                </div>
                <div className="crd-hbtns"><button type="button" className="mapsup-close" onClick={onClose} aria-label="Close"><Svg icon="x" size={13} sw={2.8} /></button></div>
              </div>
            </div>

            <div className="mapsup-body gp-body">
              <div className="gp-out">
                <div className={`gp-out__v${phrase ? ' is-phrase' : ''}`} style={!res ? { opacity: .5 } : undefined}>
                  {res ? <Colored value={res.password} phrase={phrase} /> : 'Generating…'}
                </div>
                <div className="gp-out__btns">
                  <button type="button" data-h40="skip" className="crd-pw__b" title="Copy" onClick={copy} disabled={!res}><Svg icon="copy" size={15} /></button>
                  <button type="button" data-h40="skip" className="crd-pw__b crd-pw__b--gen" title="Regenerate" onClick={() => generate(o)}><Svg icon="gen" size={15} sw={2.4} /></button>
                </div>
              </div>
              <div className={`gp-meter gp-meter--${lvCls}`}>
                <div className="gp-meter__track"><span className="gp-meter__fill" style={{ width: `${res ? lvPct : 0}%` }} /></div>
                <span className="gp-meter__lbl">{res ? LEVEL_LABEL[res.level] : ''}</span>
                <span className="gp-meter__bits">{res ? `~${res.bits} bits` : ''}</span>
              </div>
              {res && !meets && (
                <span className="crd-err cv-ferr" role="alert">
                  Policy requires a {minLabel} or stronger password — turn on more character sets.
                </span>
              )}

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
                      <Svg icon="note" size={14} /><span><b>Passphrase</b><small>Random words from a 7,776-word list</small></span>
                    </button>
                  </div>
                  <div className="gp-len">
                    <div className="gp-len__top"><b>{phrase ? 'Words' : 'Length'}</b><span className="gp-len__v"><span>{v}</span> {phrase ? 'words' : 'characters'}</span></div>
                    <input type="range" className="gp-range" min={min} max={max} value={v}
                      onChange={e => { const n = +e.target.value; setO(p => (phrase ? { ...p, words: n } : { ...p, length: n })); }}
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
                        {tg('capitalize', 'Capitalise words', 'e.g. Amber-Falcon')}
                        {tg('addNumber', 'Add a number', 'one digit on a random word')}
                        <div className="gp-sep">
                          <b>Separator</b>
                          <div className="gp-seg">
                            {SEPARATORS.map(([s, l]) => (
                              <button key={l} type="button" data-h40="skip" className={o.separator === s ? 'is-on' : ''} onClick={() => setO(p => ({ ...p, separator: s }))}>{l}</button>
                            ))}
                          </div>
                        </div>
                      </>
                    ) : (
                      <>
                        {tg('upper', 'Uppercase', 'A – Z')}
                        {tg('lower', 'Lowercase', 'a – z')}
                        {tg('numbers', 'Numbers', '0 – 9')}
                        {tg('symbols', 'Symbols', '! @ # $ % ^ &')}
                        {tg('avoidAmbiguous', 'Avoid ambiguous', 'skip I l O o 0 1')}
                      </>
                    )}
                  </div>
                </div>
              </div>
              <div className="gp-note"><Svg icon="lock" size={12} /> Generated on your device — not stored until you save a credential</div>
            </div>

            <div className="mapsup-footer">
              <div className="mapsup-footer__info"><Svg icon="lock" size={12} /> Not stored until you save a credential</div>
              <div className="mapsup-footer__actions">
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={() => generate(o)}><Svg icon="gen" size={13} />Regenerate</button>
                <button type="button" className="mapsup-footer__btn mapsup-footer__btn--ghost" onClick={copy} disabled={!res}><Svg icon="copy" size={13} />Copy</button>
                {onUse && (
                  <button type="button" className="mapsup-footer__btn mapsup-footer__btn--primary" disabled={!meets}
                    title={res && !meets ? `Policy requires a ${minLabel} or stronger password` : undefined}
                    onClick={() => res && meets && onUse(res.password)}>
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
