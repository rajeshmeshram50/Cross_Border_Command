import type { FieldDef, Policy, TypeDef } from '../cvApi';

/* ─────────────────────────────────────────────────────────────────────────
 * Add / Edit Credential — the prototype's form logic that is not markup:
 * the strength meter (mvStrength), the generator (crdPwGen), the client-side
 * checks (crdSave), the row filler (crdFillRows) and the authenticator code
 * check (cpVerify).
 * ───────────────────────────────────────────────────────────────────────── */

/** Each type's tile colour (the prototype's CRD_TYPES[].c). Presentation only. */
export const TYPE_COLOR: Record<string, string> = {
  login: '#0d9488', password: '#0891b2', note: '#d97706', document: '#64748b', card: '#db2777', bank: '#2563eb',
  crypto: '#ea580c', rewards: '#7c3aed', api: '#4f46e5', ssh: '#0f172a', database: '#0e7490', server: '#059669',
  license: '#9333ea', wifi: '#0891b2', cert: '#d97706', totp: '#7c3aed', passkey: '#0d9488', email: '#dc2626',
  membership: '#db2777', identity: '#2563eb', passport: '#0e7490', driver: '#0f766e', govid: '#4338ca',
  medical: '#e11d48', outdoor: '#15803d',
};
export const typeColor = (k: string) => TYPE_COLOR[k] ?? '#0891b2';

/** The prototype's meter — Credential::strengthOf() scores the same way. */
export function strengthOf(pw: string): number {
  if (!pw) return 0;
  let sc = 0;
  if (pw.length >= 8) sc++;
  if (pw.length >= 12) sc++;
  if (/[a-z]/.test(pw) && /[A-Z]/.test(pw)) sc++;
  if (/\d/.test(pw)) sc++;
  if (/[^A-Za-z0-9]/.test(pw)) sc++;
  if (pw.length < 8) return 1;
  return sc <= 2 ? 1 : sc === 3 ? 2 : sc === 4 ? 3 : 4;
}
export const STR_LBL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

/** A strong password from the browser's CSPRNG — one of each set, then shuffled. */
export function generatePassword(length = 16, symbols = true): string {
  const sets = ['ABCDEFGHJKLMNPQRSTUVWXYZ', 'abcdefghijkmnopqrstuvwxyz', '23456789'];
  if (symbols) sets.push('!@#$%^&*-_=+?');
  const all = sets.join('');
  const rnd = (n: number) => { const a = new Uint32Array(1); window.crypto.getRandomValues(a); return a[0] % n; };
  const out = sets.map(s => s[rnd(s.length)]);
  while (out.length < Math.max(length, 12)) out.push(all[rnd(all.length)]);
  for (let i = out.length - 1; i > 0; i--) { const j = rnd(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out.join('');
}

/** Whether the type's main secret is a password — rotation and strength apply to it. */
export const secretIsPassword = (T: TypeDef) => !!T.sec && T.fields.some(f => f.key === T.sec && f.kind === 'password');
/** Login, email, bank, crypto, passkey (a top-level 2FA switch) and Password (its own 2FA toggle field). */
export const hasTwofaSwitch = (T: TypeDef) => T.twofa || T.fields.some(f => f.key === 'twofa' && f.kind === 'toggle');

/** A password/secret field shows at most two columns wide, as crdField narrowed it. */
export function fieldSpan(f: FieldDef): number {
  let span = f.span || 1;
  if ((f.kind === 'password' || f.kind === 'secret') && span === 2 && f.key !== 'seed') span = 1;
  return span === 3 ? 4 : span;
}

/**
 * crdFillRows: stretch the last field of an incomplete row so every row
 * spans all four columns. Returns the span to use for each item.
 */
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

const URL_RE = /^(https?:\/\/)?[\w.-]+\.[a-z]{2,}|^(https?:\/\/)?\d{1,3}(\.\d{1,3}){3}/i;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
export const PHONE_RE = /^\+?[\d\s()-]{10,16}$/;

/** crdSave's per-field check — the server repeats these and more. */
export function checkField(f: FieldDef, val: string): string | null {
  const k = f.key;
  if (f.kind === 'url' && !URL_RE.test(val)) return 'Enter a valid URL';
  if (f.kind === 'email' && !EMAIL_RE.test(val)) return 'Enter a valid email address';
  if (f.kind === 'tel' && !PHONE_RE.test(val)) return 'Enter a valid phone number, e.g. +91 98200 11223';
  if (k === 'cardno' && !/^\d{12,19}$/.test(val.replace(/[\s-]/g, ''))) return 'Card number must be 12–19 digits';
  if (k === 'exp' && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(val)) return 'Use MM/YY, e.g. 08/28';
  if (k === 'cvv' && !/^\d{3,4}$/.test(val)) return 'CVV must be 3 or 4 digits';
  if (k === 'ifsc' && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(val.toUpperCase())) return 'IFSC must look like ICIC0001234';
  if (k === 'port' && !(+val > 0 && +val < 65536)) return 'Port must be between 1 and 65535';
  return null;
}
export const isEmail = (v: string) => EMAIL_RE.test(v);

export function policyStrengthMsg(pol: Policy): string {
  return `Policy requires ${pol.min_strength === 4 ? 'a Strong' : `a ${STR_LBL[pol.min_strength]} or stronger`} password — use the generate button`;
}

/* ══ TOTP (RFC 6238, SHA-1, 6 digits, 30 s) — the prototype's cpVerify, so "Verify & link" answers at once ══ */

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

/**
 * true / false when the browser can check the code (±1 step, as the server
 * does); null when it cannot (no SubtleCrypto outside a secure context) —
 * the server then checks it on save.
 */
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
