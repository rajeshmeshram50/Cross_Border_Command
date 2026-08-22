import { useEffect, useState } from 'react';

/**
 * A number that counts up to its value instead of appearing at it.
 *
 * Used by the KPI cards across HR (Employees, Exit Management). Lifted out of
 * HrEmployees.tsx so the two pages animate identically — a second copy would
 * drift the first time one of them was tuned.
 *
 * Counting always starts from zero, including when the value merely changes:
 * these cards answer "how many are there", and a figure that re-counts is the
 * signal that it has been recalculated.
 */
export default function AnimatedNumber({
  value,
  prefix = '',
  suffix = '',
}: {
  value: number;
  prefix?: string;
  suffix?: string;
}) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    if (!end) { setDisplay(0); return; }
    const duration = 1200;
    const step = Math.max(1, Math.floor(end / 60));
    const interval = duration / (end / step || 1);
    const timer = setInterval(() => {
      start += step;
      if (start >= end) { setDisplay(end); clearInterval(timer); }
      else setDisplay(start);
    }, interval);
    return () => clearInterval(timer);
  }, [value]);
  return <>{prefix}{display.toLocaleString()}{suffix}</>;
}
