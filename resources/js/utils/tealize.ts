const VIOLET_MIN = 225;
const VIOLET_MAX = 300;
const TEAL_HUE = 190;

function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, l * 100];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
  return [h * 60, s * 100, l * 100];
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  s /= 100; l /= 100;
  const k = (n: number) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return [Math.round(f(0) * 255), Math.round(f(8) * 255), Math.round(f(4) * 255)];
}

function shiftLightness(l: number): number {
  if (l <= 20 || l >= 85) return l;
  return l <= 58 ? 20 + (l - 20) * (20 / 38) : 40 + (l - 58) * (45 / 27);
}

function toTeal(r: number, g: number, b: number): [number, number, number] | null {
  const [h, s, l] = rgbToHsl(r, g, b);
  if (s < 12 || h < VIOLET_MIN || h > VIOLET_MAX) return null;
  return hslToRgb(TEAL_HUE, s, shiftLightness(l));
}

const hex2 = (n: number) => n.toString(16).padStart(2, '0');

/** Turns every violet / purple colour in a CSS string into the matching teal; other colours stay. */
export function tealize(css: string): string {
  return css
    .replace(/#([0-9a-f]{6}|[0-9a-f]{3})\b/gi, (m, h: string) => {
      const full = h.length === 3 ? h.split('').map(c => c + c).join('') : h;
      const t = toTeal(parseInt(full.slice(0, 2), 16), parseInt(full.slice(2, 4), 16), parseInt(full.slice(4, 6), 16));
      return t ? `#${t.map(hex2).join('')}` : m;
    })
    .replace(/rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/gi, (m, r, g, b) => {
      const t = toTeal(+r, +g, +b);
      return t ? m.replace(/\(\s*\d+\s*,\s*\d+\s*,\s*\d+/, `(${t.join(',')}`) : m;
    });
}
