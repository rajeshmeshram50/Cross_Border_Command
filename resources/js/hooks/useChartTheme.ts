import { useEffect, useState } from 'react';

/**
 * Live chart palette tied to the app's dark/light theme. recharts SVG
 * attrs (`stroke`, `fill`, `tick.fill`) don't reliably resolve `var(--…)`
 * across browsers, so we hand recharts concrete colors and recompute
 * them when the user flips the theme toggle.
 *
 * Background: hard-coding `stroke="#f0f3f8"` on CartesianGrid + axis
 * ticks looked great in light mode (subtle wash on white) but became
 * stark white stripes on the dark surface (#1c2531) and confused
 * readers. This hook centralises the four colors every chart needs:
 *
 *   grid       — dashed grid lines
 *   axisTick   — primary tick text (X / Y labels)
 *   axisTickMuted — secondary numeric ticks (lower contrast)
 *   dotStroke  — outline on area/line chart point markers
 */
export interface ChartTheme {
  grid: string;
  axisTick: string;
  axisTickMuted: string;
  dotStroke: string;
  tooltipBg: string;
  tooltipBorder: string;
}

const LIGHT: ChartTheme = {
  grid: '#eef1f7',
  axisTick: '#5f6975',
  axisTickMuted: '#a0aec0',
  dotStroke: '#ffffff',
  tooltipBg: '#ffffff',
  tooltipBorder: '#e5e7eb',
};

const DARK: ChartTheme = {
  // Translucent white grid sits between 0.06–0.08 — visible enough to read
  // values off, faint enough that it doesn't compete with the chart line.
  grid: 'rgba(255,255,255,0.07)',
  axisTick: 'rgba(255,255,255,0.78)',
  axisTickMuted: 'rgba(255,255,255,0.45)',
  // Dot outline contrasts with the card surface, not the page background.
  dotStroke: '#1c2531',
  tooltipBg: '#232f40',
  tooltipBorder: 'rgba(255,255,255,0.10)',
};

function readTheme(): 'light' | 'dark' {
  if (typeof document === 'undefined') return 'light';
  return document.documentElement.getAttribute('data-bs-theme') === 'dark' ? 'dark' : 'light';
}

export function useChartTheme(): ChartTheme {
  const [mode, setMode] = useState<'light' | 'dark'>(() => readTheme());

  useEffect(() => {
    // Observe the <html data-bs-theme="…"> attribute so charts re-render
    // the moment the user flips the toggle, without a full page reload.
    const root = document.documentElement;
    const obs = new MutationObserver(() => setMode(readTheme()));
    obs.observe(root, { attributes: true, attributeFilter: ['data-bs-theme'] });
    return () => obs.disconnect();
  }, []);

  return mode === 'dark' ? DARK : LIGHT;
}