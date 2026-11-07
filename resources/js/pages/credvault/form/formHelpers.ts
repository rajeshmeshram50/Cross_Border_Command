import type { FieldDef, Policy, TypeDef } from '../cvApi';

export const TYPE_COLOR: Record<string, string> = {
  login: '#0d9488', password: '#0891b2', note: '#d97706', document: '#64748b', card: '#db2777', bank: '#2563eb',
  crypto: '#ea580c', rewards: '#7c3aed', api: '#4f46e5', ssh: '#0f172a', database: '#0e7490', server: '#059669',
  license: '#9333ea', wifi: '#0891b2', cert: '#d97706', totp: '#7c3aed', passkey: '#0d9488', email: '#dc2626',
  membership: '#db2777', identity: '#2563eb', passport: '#0e7490', driver: '#0f766e', govid: '#4338ca',
  medical: '#e11d48', outdoor: '#15803d',
};
export const typeColor = (k: string) => TYPE_COLOR[k] ?? '#0891b2';

/**
 * The password strength criteria (D34) — Credential::strengthOf() decides the same way:
 * Strong (4) 12+ characters with letters, numbers and a special character; Good (3) 8+
 * with all three; anything else Fair (2), which counts as weak. A space is not special.
 */
export function strengthOf(pw: string): number {
  if (!pw) return 0;
  const mixed = /\p{L}/u.test(pw) && /\p{N}/u.test(pw) && /[^\p{L}\p{N}\s]/u.test(pw);
  const len = [...pw].length;
  return mixed && len >= 12 ? 4 : mixed && len >= 8 ? 3 : 2;
}
export const STR_LBL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

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

// host: localhost, a dotted domain, or an IPv4 — each with an optional scheme and port.
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

/** Host (SSH Key, Database, Server): a hostname / domain, an IPv4 or an IPv6 address — no scheme, path, spaces or symbols. */
export function hostError(v: string): string | null {
  const t = v.trim();
  // Digits and dots only is meant as an IPv4: four octets of 0–255.
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
  // Hostname: dot-separated labels of letters, digits and hyphens (1–63 each, no hyphen at either end), 253 at most.
  if (t.length > 253) return HOST_MSG;
  const label = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;
  return t.split('.').every(l => label.test(l)) ? null : HOST_MSG;
}

/* ── CS-1456 field formats ─────────────────────────────────────────────────────────────────── */

/** API key / secret: 128 characters at most (CS-1457 #5, as QA asked). The API's own limit is 10,000. */
const KEY_MAX = 128;
/**
 * SSH private key: 64 characters at most (CS-1457 #9, as QA asked). NOTE: a real key is ~400–3,300
 * characters, so full keys no longer fit; the BEGIN/END block check (privateKeyError) cannot pass
 * within 64 and is not used while this limit stands. Raise PRIVKEY_MAX to accept real keys again.
 */
const PRIVKEY_MAX = 64;
/** Longest value the input lets a field hold — the type's own max, KEY_MAX for an API key / secret, PRIVKEY_MAX for an SSH key. */
export const fieldMax = (f: FieldDef): number | undefined =>
  (f.key === 'apikey' || f.key === 'secret' ? KEY_MAX : f.key === 'privkey' ? PRIVKEY_MAX : f.max ?? undefined);

/** Luhn checksum — every real card number passes it; a mistyped digit fails it. */
function luhnOk(digits: string): boolean {
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let d = +digits[digits.length - 1 - i];
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

/** Account holder / cardholder: a person's or company's name — letters required; digits only beside letters ("3M India"). */
const HOLDER_RE = /^[\p{L}\p{M}\p{N}\s.'’&,()/-]+$/u;

/**
 * SSH private key: the whole PEM block — "-----BEGIN … PRIVATE KEY-----", base64 lines (A–Z a–z 0–9 + / =),
 * optional "Name: value" headers of an encrypted RSA key, then the matching "-----END … PRIVATE KEY-----".
 * A PuTTY .ppk file ("PuTTY-User-Key-File-2/3: …") is accepted as it is.
 */
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

/** crdSave's per-field check — the server repeats these and more. */
/** `strict` adds the My Vault QA checks (CS-1435): symbols-only text, numbers-only Program Name, Account Number. */
export function checkField(f: FieldDef, val: string, strict = false): string | null {
  const k = f.key;
  // A text field of symbols only (e.g. "@@@###", Member ID) holds nothing: it needs a letter or a digit.
  if (strict && k === 'host') return hostError(val);
  if (strict && f.kind === 'text' && !/[\p{L}\p{N}]/u.test(val)) return `${f.label} must include at least one letter or number`;
  // Rewards → Program Name is a name: digits alone (e.g. "123456") are not one.
  if (strict && k === 'program' && !/\p{L}/u.test(val)) return 'Program name must include letters, not only numbers';
  if (f.kind === 'url' && !URL_RE.test(val)) return 'Enter a valid URL';
  if (f.kind === 'email') return emailError(val);
  if (f.kind === 'tel') return phoneError(val);
  if (k === 'cardno') {
    const d = val.replace(/[\s-]/g, '');
    if (!/^\d{12,19}$/.test(d)) return 'Card number must be 12–19 digits';
    if (!luhnOk(d)) return 'This card number is not valid — check the digits';
  }
  if (k === 'holder') {
    if (!/\p{L}/u.test(val)) return `${f.label} must include letters, not only numbers or symbols`;
    if (!HOLDER_RE.test(val)) return `${f.label} can only use letters, numbers, spaces and . ' - & , ( ) /`;
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
  if (k === 'exp' && !/^(0[1-9]|1[0-2])\/\d{2}$/.test(val)) return 'Use MM/YY, e.g. 08/28';
  if (k === 'cvv' && !/^\d{3,4}$/.test(val)) return 'CVV must be 3 or 4 digits';
  if (k === 'ifsc' && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(val.toUpperCase())) return 'IFSC must look like ICIC0001234';
  // Bank Account → Account Number: digits only, 9–18 of them (the range Indian bank account numbers use).
  if (strict && k === 'acno' && !/^\d{9,18}$/.test(val)) return /\D/.test(val) ? 'Account number must contain digits only' : 'Account number must be 9–18 digits';
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
