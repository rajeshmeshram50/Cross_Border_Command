import type { CSSProperties } from 'react';
import { Shimmer } from '../../../../components/ui/Shimmer';

const col = (gap = 6, center = false): CSSProperties =>
  ({ display: 'flex', flexDirection: 'column', alignItems: center ? 'center' : 'flex-start', gap });
const row = (gap = 8, center = false): CSSProperties =>
  ({ display: 'flex', alignItems: 'center', justifyContent: center ? 'center' : 'flex-start', gap });

export type ShimCol = 'sr' | 'code' | 'name' | 'pill' | 'text' | 'mapped' | 'action';

/** List rows while a page loads — each cell takes the shape of its column. */
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

/** The add / edit form body while its data loads: section cards with label + input placeholders. */
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

/** Mapped-supplier table rows while the service's suppliers load. */
export function ShimSupplierRows({ rows = 3 }: { rows?: number }) {
  return (
    <div className="svs-tablewrap" aria-busy="true" aria-label="Loading suppliers">
      <div style={{ padding: '12px 14px', ...col(14) }}>
        {Array.from({ length: rows }, (_, r) => (
          <div key={r} style={{ ...row(14), width: '100%' }}>
            <Shimmer width={26} height={26} radius={8} />
            <div style={{ ...col(6), flex: '1 1 auto' }}><Shimmer width={150 + (r % 3) * 30} height={12} /><Shimmer width={60} height={9} /></div>
            <Shimmer width={84} height={22} radius={999} />
            <Shimmer width={90} height={11} />
            <Shimmer width={80} height={11} />
            <Shimmer width={46} height={22} radius={7} />
            <Shimmer width={96} height={13} />
            <Shimmer width={30} height={30} radius={9} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** The My Vault "saving" lock: a blurred veil over the popup with a ring spinner and a caption. */
export function SavingLock({ label }: { label: string }) {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="svf-lock">
      <div className="svf-lock__box"><span className="svf-lock__spin" />{label}</div>
    </div>
  );
}
