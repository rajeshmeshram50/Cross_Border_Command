import type { FieldDef, Policy, TypeDef } from '../cvApi';

export const TYPE_COLOR: Record<string, string> = {
  login: '#0d9488', password: '#0891b2', note: '#d97706', document: '#64748b', card: '#db2777', bank: '#2563eb',
  crypto: '#ea580c', rewards: '#7c3aed', api: '#4f46e5', ssh: '#0f172a', database: '#0e7490', server: '#059669',
  license: '#9333ea', wifi: '#0891b2', cert: '#d97706', totp: '#7c3aed', passkey: '#0d9488', email: '#dc2626',
  membership: '#db2777', identity: '#2563eb', passport: '#0e7490', driver: '#0f766e', govid: '#4338ca',
  medical: '#e11d48', outdoor: '#15803d',
};
export const typeColor = (k: string) => TYPE_COLOR[k] ?? '#0891b2';

export function strengthOf(pw: string): number {
  if (!pw) return 0;
  const mixed = /\p{L}/u.test(pw) && /\p{N}/u.test(pw) && /[^\p{L}\p{N}\s]/u.test(pw);
  const len = [...pw].length;
  return mixed && len >= 12 ? 4 : mixed && len >= 8 ? 3 : 2;
}
export const STR_LBL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

export const secretIsPassword = (T: TypeDef) => !!T.sec && T.fields.some(f => f.key === T.sec && f.kind === 'password');
export const hasTwofaSwitch = (T: TypeDef) => T.twofa || T.fields.some(f => f.key === 'twofa' && f.kind === 'toggle');

export function fieldSpan(f: FieldDef): number {
  let span = f.span || 1;
  if ((f.kind === 'password' || f.kind === 'secret') && span === 2 && f.key !== 'seed') span = 1;
  return span === 3 ? 4 : span;
}

export function fillRows(spans: number[]): number[] {
  const out = [...spans];
  let used = 0;
  let last = -1;
  spans.forEach((sp, i) => {
    if (used + sp > 4) { if (last >= 0 && used < 4) out[last] += 4 - used; used = 0; }
    used += sp; last = i;
    if (used === 4) { used = 0; last = -1; }
  });
  if (last >= 0 && used > 0 && used < 4) out[last] += 4 - used;
  return out;
}

const URL_RE = /^(https?:\/\/)?(localhost|[\w.-]+\.[a-z]{2,}|\d{1,3}(\.\d{1,3}){3})(:\d+)?([/?#]|$)/i;
const EMAIL_RE = /^[A-Za-z0-9](?:[A-Za-z0-9._%+-]*[A-Za-z0-9_%+-])?@[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?)*\.[A-Za-z]{2,}$/;
export const PHONE_RE = /^\+?[\d\s()-]{10,16}$/;
export const PHONE_CHARS = (v: string) => v.replace(/[^\d+\s()-]/g, '').replace(/(?!^)\+/g, '');

const PHONE_MSG = 'Enter a valid phone number, e.g. +91 98200 11223';
const EMAIL_MSG = 'Enter a valid email address';

export function phoneError(v: string): string | null {
  const t = v.trim();
  if (!/^\+?[\d\s()-]+$/.test(t) || t.length > 16) return PHONE_MSG;
  if (!/^\+?\(?\d/.test(t) || !/\d$/.test(t)) return PHONE_MSG;
  if (/[\s-]{2,}|\(\s*\)|\+\s*[\s-]/.test(t)) return PHONE_MSG;
  let depth = 0;
  for (const ch of t) { if (ch === '(') depth++; if (ch === ')' && --depth < 0) return PHONE_MSG; }
  if (depth !== 0) return PHONE_MSG;
  const digits = t.replace(/\D/g, '').length;
  return digits < 10 || digits > 15 ? PHONE_MSG : null;
}

export function emailError(v: string): string | null {
  const t = v.trim();
  return t.length > 191 || t.includes('..') || !EMAIL_RE.test(t) ? EMAIL_MSG : null;
}

const HOST_MSG = 'Enter a valid hostname, domain or IP address, e.g. prod.example.com or 10.0.1.25';

export function hostError(v: string): string | null {
  const t = v.trim();
  if (/^[\d.]+$/.test(t)) {
    const o = t.split('.');
    return o.length === 4 && o.every(x => /^\d{1,3}$/.test(x) && +x <= 255) ? null : HOST_MSG;
  }
  if (t.includes(':')) {
    const parts = t.split('::');
    if (parts.length > 2 || !/^[0-9a-f:]+$/i.test(t)) return HOST_MSG;
    const groups = parts.flatMap(p => (p ? p.split(':') : []));
    if (groups.some(g => !/^[0-9a-f]{1,4}$/i.test(g))) return HOST_MSG;
    return (parts.length === 2 ? groups.length < 8 : groups.length === 8) ? null : HOST_MSG;
  }
  if (t.length > 253) return HOST_MSG;
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  return t.split('.').every(l => label.test(l)) ? null : HOST_MSG;
}

export const HOST_MAX = 253;
export const ISSUER_MAX = 64;
export const LKEY_MAX = 4096;

export const HOST_CHARS = (raw: string) => raw.replace(/[^A-Za-z0-9.:-]/g, '').slice(0, HOST_MAX);
export const DOMAIN_CHARS = (raw: string) => raw.replace(/[^A-Za-z0-9.*-]/g, '').slice(0, HOST_MAX);

const DOMAIN_MSG = 'Enter a valid domain, e.g. inorbvict.com or *.inorbvict.com';
export function domainError(v: string): string | null {
  const t = v.trim();
  if (t.length > HOST_MAX) return `Domain can be at most ${HOST_MAX} characters`;
  const name = t.startsWith('*.') ? t.slice(2) : t;
  if (name.includes('*')) return 'A wildcard can only be "*." at the very start, e.g. *.inorbvict.com';
  const labels = name.split('.');
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  if (labels.length < 2 || !labels.every(l => label.test(l)) || /^\d+$/.test(labels[labels.length - 1])) return DOMAIN_MSG;
  return null;
}

const KEY_MAX = 128;
const PRIVKEY_MAX = 64;
export const fieldMax = (f: FieldDef): number | undefined =>
  (f.key === 'apikey' || f.key === 'secret' ? KEY_MAX : f.key === 'privkey' ? PRIVKEY_MAX
    : f.key === 'lkey' ? LKEY_MAX : f.key === 'host' || f.key === 'domain' ? HOST_MAX : f.key === 'issuer' ? ISSUER_MAX
    : f.max ?? undefined);

function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

const HOLDER_RE = /^[\p{L}\p{M}\s.'’&,()/-]+$/u;
export const HOLDER_CHARS = (raw: string) => raw.replace(/[^\p{L}\p{M}\s.'’&,()/-]/gu, '');

function privateKeyError(v: string): string | null {
  const t = v.trim();
  if (/^PuTTY-User-Key-File-\d+:/.test(t)) return null;
  const m = t.match(/^-----BEGIN ((?:[A-Z0-9]+ )*)PRIVATE KEY-----\r?\n([\s\S]*?)\r?\n?-----END ((?:[A-Z0-9]+ )*)PRIVATE KEY-----$/);
  if (!m) return 'Paste the full private key, from -----BEGIN … PRIVATE KEY----- to -----END … PRIVATE KEY-----';
  if (m[1] !== m[3]) return 'The BEGIN and END lines of the private key do not match';
  const lines = m[2].split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const body = lines.filter(l => !/^[A-Za-z-]+: [A-Za-z0-9,\- ]+$/.test(l));
  if (!body.length || body.some(l => !/^[A-Za-z0-9+/=]+$/.test(l))) {
    return 'The private key can only contain letters, numbers and + / = between its BEGIN and END lines';
  }
  return null;
}

export function checkField(f: FieldDef, val: string, strict = false): string | null {
  const k = f.key;
  if (strict && k === 'host') return hostError(val);
  if (strict && f.kind === 'text' && !/[\p{L}\p{N}]/u.test(val)) return `${f.label} must include at least one letter or number`;
  if (strict && k === 'program' && !/\p{L}/u.test(val)) return 'Program name must include letters, not only numbers';
  if (f.kind === 'url' && !URL_RE.test(val)) return 'Enter a valid URL';
  if (f.kind === 'email') return emailError(val);
  if (f.kind === 'tel') return phoneError(val);
  if (k === 'cardno') {
    const d = val.replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(d)) return 'Card number must be 12–19 digits';
    if (!luhnOk(d)) return `This doesn’t look like a real card number — the ${d.length} digits don’t pass the card checksum. Re-check for a typo.`;
  }
  if (k === 'holder') {
    if (!/\p{L}/u.test(val)) return `${f.label} must include letters, not only numbers or symbols`;
    if (/\p{N}/u.test(val)) return `${f.label} cannot contain numbers`;
    if (!HOLDER_RE.test(val)) return `${f.label} can only use letters, spaces and . ' - & , ( ) /`;
  }
  if (k === 'apikey' || k === 'secret') {
    if (/\s/.test(val)) return `${f.label} cannot contain spaces or line breaks`;
    if (!/^[\x21-\x7E]+$/.test(val)) return `${f.label} can only use standard keyboard characters`;
    if (val.length > KEY_MAX) return `${f.label} can be at most ${KEY_MAX.toLocaleString('en-IN')} characters`;
  }
  if (k === 'privkey') {
    if (val.length > PRIVKEY_MAX) return `${f.label} can be at most ${PRIVKEY_MAX} characters`;
    if (!/^[A-Za-z0-9+/=\-\s]+$/.test(val)) return `${f.label} can only contain letters, numbers and + / = -`;
    return PRIVKEY_MAX >= 400 ? privateKeyError(val) : null;
  }
  if (k === 'domain') return domainError(val);
  if (k === 'issuer' && [...val].length > ISSUER_MAX) return `${f.label} can be at most ${ISSUER_MAX} characters`;
  if (k === 'lkey' && val.length > LKEY_MAX) return `${f.label} can be at most ${LKEY_MAX.toLocaleString('en-IN')} characters`;
  if (k === 'exp' && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(val)) return 'Use MM/YY, e.g. 08/28';
  if (k === 'cvv' && !/^\d{3,4}$/.test(val)) return 'CVV must be 3 or 4 digits';
  if (k === 'ifsc' && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(val.toUpperCase())) return 'IFSC must look like ICIC0001234';
  if (strict && k === 'acno' && !/^\d{9,18}$/.test(val)) return /\D/.test(val) ? 'Account number must contain digits only' : 'Account number must be 9–18 digits';
  if (k === 'port' && !(+val > 0 && +val < 65536)) return 'Port must be between 1 and 65535';
  return null;
}
export const isEmail = (v: string) => EMAIL_RE.test(v);

export function policyStrengthMsg(pol: Policy): string {
  return `Policy requires ${pol.min_strength === 4 ? 'a Strong' : `a ${STR_LBL[pol.min_strength]} or stronger`} password — use the generate button`;
}

function base32(secret: string): ArrayBuffer {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const s = secret.replace(/[\s=]/g, '').toUpperCase();
  let bits = 0, val = 0;
  const out: number[] = [];
  for (const ch of s) {
    const i = A.indexOf(ch);
    if (i < 0) continue;
    val = (val << 5) | i; bits += 5;
    if (bits >= 8) { out.push((val >>> (bits - 8)) & 255); bits -= 8; }
  }
  return new Uint8Array(out).buffer;
}

async function totpAt(secret: string, counter: number): Promise<string> {
  const msg = new ArrayBuffer(8);
  const view = new DataView(msg);
  view.setUint32(0, Math.floor(counter / 2 ** 32));
  view.setUint32(4, counter >>> 0);
  const key = await crypto.subtle.importKey('raw', base32(secret), { name: 'HMAC', hash: 'SHA-1' }, false, ['sign']);
  const h = new Uint8Array(await crypto.subtle.sign('HMAC', key, msg));
  const o = h[h.length - 1] & 15;
  const n = ((h[o] & 127) << 24) | (h[o + 1] << 16) | (h[o + 2] << 8) | h[o + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

export async function verifyTotp(secret: string, code: string): Promise<boolean | null> {
  if (!/^\d{6}$/.test(code)) return false;
  if (!window.crypto?.subtle) return null;
  try {
    const now = Math.floor(Date.now() / 30000);
    for (const d of [-1, 0, 1]) if ((await totpAt(secret, now + d)) === code) return true;
    return false;
  } catch {
    return null;
  }
}
