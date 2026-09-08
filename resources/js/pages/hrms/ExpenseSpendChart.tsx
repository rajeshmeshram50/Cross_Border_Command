import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell, LabelList } from 'recharts';
import { useChartTheme } from '../../hooks/useChartTheme';

/**
 * Spend Analytics bar chart, lifted out of HrExpenseManagement so it can be
 * lazily loaded.
 *
 * recharts is ~250 KB and this chart lives inside the Spend Analytics card,
 * which is COLLAPSED by default — so the library was downloaded on every visit
 * to draw something nobody had asked to see. In its own module it becomes its
 * own chunk, fetched the first time the card is expanded.
 *
 * The markup and every visual value below are a verbatim move from the page —
 * this is a relocation, not a redesign. `useChartTheme` moved with it because
 * the chart is its only consumer.
 */

/* Short INR ticks — a category axis labelled in full rupees overflows, so
 * ₹1,23,45,678 reads as ₹1.23Cr. Moved here with the chart; the page had no
 * other use for it. */
export function fmtINRShort(v: number): string {
  const n = Math.abs(v);
  const sign = v < 0 ? '-' : '';
  if (n >= 1_00_00_000) return `${sign}₹${(n / 1_00_00_000).toFixed(2)}Cr`;
  if (n >= 1_00_000)    return `${sign}₹${(n / 1_00_000).toFixed(1)}L`;
  if (n >= 1_000)       return `${sign}₹${(n / 1_000).toFixed(0)}K`;
  return `${sign}₹${Math.round(n)}`;
}

export interface SpendSlice {
  id: number | string;
  name: string;
  spent: number;
  color: string;
}

export default function ExpenseSpendChart({ data }: { data: SpendSlice[] }) {
  const chartTheme = useChartTheme();
  return (
    <>
      <div style={{ width: '100%', height: 320 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data.map(c => ({
              name:  c.name,
              spent: Math.round(c.spent),
              color: c.color,
            }))}
            margin={{ top: 24, right: 12, left: 0, bottom: 48 }}
            barCategoryGap="22%"
          >
            <CartesianGrid strokeDasharray="3 3" stroke={chartTheme.grid} vertical={false} />
            <XAxis
              dataKey="name"
              interval={0}
              axisLine={false}
              tickLine={false}
              height={64}
              // Rotate + truncate so all category names stay legible
              // instead of overlapping in one flat row. Full name
              // shows on hover via <title>.
              tick={(props: any) => {
                const { x, y, payload } = props;
                const label = String(payload?.value ?? '');
                const short = label.length > 14 ? label.slice(0, 13) + '…' : label;
                return (
                  <g transform={`translate(${x},${y})`}>
                    <text
                      dy={10}
                      textAnchor="end"
                      transform="rotate(-35)"
                      fontSize={10.5}
                      fontWeight={600}
                      fill={chartTheme.axisTick}
                    >
                      <title>{label}</title>
                      {short}
                    </text>
                  </g>
                );
              }}
            />
            <YAxis
              tick={{ fontSize: 10, fill: chartTheme.axisTickMuted }}
              axisLine={false}
              tickLine={false}
              width={64}
              tickFormatter={fmtINRShort}
            />
            <Tooltip
              cursor={{ fill: 'rgba(124,92,252,0.06)' }}
              contentStyle={{
                background: chartTheme.tooltipBg,
                border: `1px solid ${chartTheme.tooltipBorder}`,
                borderRadius: 8, fontSize: 12, padding: '6px 10px',
                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
              }}
              itemStyle={{ color: chartTheme.axisTick }}
              labelStyle={{ color: chartTheme.axisTick }}
              formatter={(value: any) => [`₹${Number(value).toLocaleString('en-IN')}`, 'Spent']}
            />
            <Bar dataKey="spent" radius={[6, 6, 0, 0]}>
              {data.map((c, i) => (
                <Cell key={`cell-${i}`} fill={c.color} />
              ))}
              <LabelList
                dataKey="spent"
                position="top"
                formatter={(v: any) => Number(v) > 0 ? fmtINRShort(Number(v)) : ''}
                style={{ fontSize: 10.5, fontWeight: 700, fill: chartTheme.axisTick }}
              />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
      <div className="d-flex flex-wrap" style={{ gap: '6px 16px', marginTop: 8, paddingTop: 8, borderTop: '1px solid var(--vz-border-color)' }}>
        {data.map(c => (
          <div key={`leg:${c.id}:${c.name}`} className="d-inline-flex align-items-center gap-2" style={{ fontSize: 11 }}>
            <span style={{ width: 8, height: 8, borderRadius: '50%', background: c.color, flexShrink: 0 }} />
            <span className="fw-semibold" style={{ color: 'var(--vz-body-color, #1f2937)' }}>{c.name}</span>
            <span className="text-muted" style={{ fontVariantNumeric: 'tabular-nums' }}>
              {c.spent > 0 ? `₹${Number(c.spent).toLocaleString('en-IN')}` : '—'}
            </span>
          </div>
        ))}
      </div>
    </>
  );
}
