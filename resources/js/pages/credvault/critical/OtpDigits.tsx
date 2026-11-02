import { useEffect, useRef } from 'react';

/**
 * The six one-digit boxes of the authenticator step (.cp-digs / .cp-d), with
 * the prototype's keyboard behaviour: auto-advance, Backspace back, arrows,
 * paste of a whole code, Enter to submit.
 */
export default function OtpDigits({ value, onChange, onEnter, bad, autoFocus = true }: {
  value: string[]; onChange: (v: string[]) => void; onEnter: () => void; bad?: boolean; autoFocus?: boolean;
}) {
  const refs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => { if (autoFocus) setTimeout(() => refs.current[0]?.focus({ preventScroll: true }), 40); }, [autoFocus]);
  // A cleared code (after a wrong try) puts the cursor back on the first box.
  const empty = value.every(d => !d);
  useEffect(() => { if (empty && !bad) refs.current[0]?.focus({ preventScroll: true }); }, [empty, bad]);

  const set = (i: number, d: string) => { const n = [...value]; n[i] = d; onChange(n); };

  return (
    <div className="cp-digs" id="cpDigs">
      {value.map((d, i) => (
        <span key={i} style={{ display: 'contents' }}>
          <input
            ref={el => { refs.current[i] = el; }}
            className={`cp-d${d ? ' is-f' : ''}${bad ? ' is-bad' : ''}`}
            type="text" inputMode="numeric" autoComplete="one-time-code" maxLength={1}
            aria-label={`Digit ${i + 1}`} value={d}
            onChange={e => {
              const v = e.target.value.replace(/[^0-9]/g, '').slice(-1);
              set(i, v);
              if (v) refs.current[i + 1]?.focus();
            }}
            onKeyDown={e => {
              if (e.key === 'Backspace' && !d && i > 0) {
                e.preventDefault();
                const n = [...value]; n[i - 1] = ''; onChange(n);
                refs.current[i - 1]?.focus();
              } else if (e.key === 'ArrowLeft') refs.current[i - 1]?.focus();
              else if (e.key === 'ArrowRight') refs.current[i + 1]?.focus();
              else if (e.key === 'Enter') { e.preventDefault(); onEnter(); }
            }}
            onPaste={e => {
              const t = (e.clipboardData.getData('text') || '').replace(/\D/g, '').slice(0, 6);
              if (!t) return;
              e.preventDefault();
              onChange(Array.from({ length: 6 }, (_, k) => t[k] ?? ''));
              refs.current[Math.min(t.length, 5)]?.focus();
            }}
          />
          {i === 2 && <span className="cp-d__sep" />}
        </span>
      ))}
    </div>
  );
}
