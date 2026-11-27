import type { CSSProperties } from 'react';
import { Shimmer } from '../../../../components/ui/Shimmer';

const col = (gap = 6, center = false): CSSProperties =>
  ({ display: 'flex', flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', gap });
const row = (gap = 8, center = false): CSSProperties =>
  ({ display: 'flex', alignItems: 'center', justifyContent: center ? 'center' : 'flex-start', gap });

export type ShimCol = 'sr' | 'code' | 'name' | 'pill' | 'text' | 'mapped' | 'action';

export function ShimServiceRows({ cols, rows = 8 }: { cols: ShimCol[]; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, r) => {
        const v = (base: number, spread: number) => base + ((r * 37) % spread);
        return (
          <tr key={r} className="svm-skrow" aria-hidden="true">
            {cols.map((c, i) => (
              <td key={i}>
                {c === 'sr' && <div style={row(0, true)}><Shimmer width={26} height={26} radius={8} /></div>}
                {c === 'code' && <div style={col(6)}><Shimmer width={72} height={22} radius={7} /><Shimmer width={56} height={9} /></div>}
                {c === 'name' && (
                  <div style={row(10)}>
                    <Shimmer width={32} height={32} radius={10} />
                    <div style={col(6)}><Shimmer width={v(110, 60)} height={12} /><Shimmer width={v(60, 30)} height={9} /></div>
                  </div>
                )}
                {c === 'pill' && <div style={row(0, true)}><Shimmer width={v(78, 40)} height={22} radius={999} /></div>}
                {c === 'text' && <Shimmer width={v(80, 70)} height={11} />}
                {c === 'mapped' && <div style={row(0, true)}><Shimmer width={34} height={30} radius={9} /></div>}
                {c === 'action' && <div style={row(6, true)}>{[0, 1, 2].map(k => <Shimmer key={k} width={30} height={30} radius={9} />)}</div>}
              </td>
            ))}
          </tr>
        );
      })}
    </>
  );
}

export function ShimServiceForm({ sections = [8, 3] }: { sections?: number[] }) {
  return (
    <div aria-busy="true" aria-label="Loading form">
      {sections.map((n, s) => (
        <div className="svf-section" key={s}>
          <div className="svf-section-head">
            <Shimmer width={30} height={30} radius={8} />
            <Shimmer width={170 + (s % 2) * 60} height={12} />
          </div>
          <div className="svf-section-body">
            <div className="svf-grid svf-grid-4">
              {Array.from({ length: n }, (_, f) => (
                <div key={f} style={col(8)}>
                  <Shimmer width={70 + ((s * 3 + f) * 17) % 60} height={9} />
                  <Shimmer width="100%" height={42} radius={12} />
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* Same table, header and columns as the mapped-suppliers list, so each
   placeholder sits in the column its value will fill. */
const SUP_SHIM: Array<{ h: string; a?: 'l' | 'r'; w: number; ht?: number; r?: number; sub?: number }> = [
  { h: 'Sr. No', w: 26, ht: 26, r: 8 },
  { h: 'Supplier', a: 'l', w: 150, ht: 12, sub: 54 },
  { h: 'Supplier Type', a: 'l', w: 84, ht: 22, r: 999 },
  { h: 'Supplier Origin', w: 92, ht: 22, r: 999 },
  { h: 'State / Country', a: 'l', w: 90, ht: 11, sub: 60 },
  { h: 'Contact Person', a: 'l', w: 86, ht: 11 },
  { h: 'Price', a: 'r', w: 70, ht: 12 },
  { h: 'GST (%)', w: 46, ht: 22, r: 7 },
  { h: 'GST Value', a: 'r', w: 62, ht: 11 },
  { h: 'Total Service Cost', a: 'r', w: 82, ht: 13 },
  { h: 'Action', w: 30, ht: 30, r: 9 },
];

export function ShimSupplierRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="svs-tablewrap" aria-busy="true" aria-label="Loading suppliers">
      <div className="svs-tablescroll">
        <table className="svs-table svs-shimtbl">
          <thead>
            <tr>{SUP_SHIM.map(c => <th key={c.h} className={c.a ? `is-${c.a}` : undefined}>{c.h}</th>)}</tr>
          </thead>
          <tbody>
            {Array.from({ length: rows }, (_, r) => (
              <tr key={r} aria-hidden="true">
                {SUP_SHIM.map((c, i) => (
                  <td key={c.h} className={c.a ? `is-${c.a}` : undefined}>
                    <div className={`svs-shim svs-shim--${c.a ?? 'c'}`}>
                      <Shimmer width={i === 1 ? c.w - (r % 3) * 24 : c.w} height={c.ht} radius={c.r ?? 6} />
                      {c.sub && <Shimmer width={c.sub} height={9} />}
                    </div>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

export function SavingLock({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="svf-lock">
      <div className="svf-lock__box"><span className="svf-lock__spin" />{label}</div>
    </div>
  );
}
