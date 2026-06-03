// Reversible obfuscation for the opportunity (OPP) code that appears in the
// Sales Matrix detail URL — e.g. /sales/matrix/OPP-0168/stage/1.
//
// Goal: keep the readable, sequential OPP code out of the address bar so it
// can't be eyeballed or hand-tweaked into another opportunity. Tenant
// isolation is still enforced server-side in SalesLeadController::applyScope
// (queries are pinned to the user's client_id / branch_id), so this is URL
// obfuscation for UX — NOT the security boundary.
//
// The token is intentionally reversible on the client: the app still resolves
// the plain OPP code -> lead id via the existing list endpoint. A short XOR
// pass + URL-safe base64 turns "OPP-0168" into an opaque blob. A version
// marker lets decode() distinguish our tokens from a plain code, so old links
// and bookmarks (and the DEFAULT_HEADER fallback) keep working unchanged.

const KEY = 'cbc-sales-matrix-v1';
const MAGIC = 'v1';

function xor(input: string): string {
  let out = '';
  for (let i = 0; i < input.length; i++) {
    out += String.fromCharCode(input.charCodeAt(i) ^ KEY.charCodeAt(i % KEY.length));
  }
  return out;
}

function toBase64Url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(b64);
}

/** Encrypt a plain OPP code into an opaque, URL-safe token. */
export function encodeOppId(oppId: string): string {
  if (!oppId) return oppId;
  try {
    return toBase64Url(xor(`${MAGIC}:${oppId}`));
  } catch {
    return oppId; // never block navigation on an encode failure
  }
}

/**
 * Decrypt a token back into the plain OPP code. If the param isn't one of our
 * tokens (legacy plain code / bookmark), it's returned unchanged.
 */
export function decodeOppId(token: string): string {
  if (!token) return token;
  try {
    const raw = xor(fromBase64Url(token));
    if (raw.startsWith(`${MAGIC}:`)) {
      return raw.slice(MAGIC.length + 1);
    }
  } catch {
    /* not a valid token — fall through to treat it as a plain code */
  }
  return token;
}

/** Encrypt the stage number into an opaque, URL-safe token. */
export function encodeStage(stage: number | string): string {
  return encodeOppId(`s${stage}`);
}

/**
 * Decrypt a stage token back into the plain stage number. Falls back to a
 * legacy plain digit (e.g. "1") or 1 if the token can't be read.
 */
export function decodeStage(token: string): number {
  if (!token) return 1;
  if (/^\d+$/.test(token)) return parseInt(token, 10); // legacy plain stage
  const m = /^s(\d+)$/.exec(decodeOppId(token));
  return m ? parseInt(m[1], 10) : 1;
}
