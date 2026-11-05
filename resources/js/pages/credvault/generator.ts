import { strengthOf } from './form/formHelpers';

/**
 * Generate Password (CS-1430 … CS-1433), on the device: every value is made here with
 * crypto.getRandomValues and never sent anywhere until the credential is saved (GP-R5).
 * The same rules and defaults as the server's PasswordGenerator, used by the dialog and
 * the ↻ button in password fields alike (GP-R8).
 *
 * Passphrases use the EFF long list (7,776 words, © EFF, CC BY 3.0), loaded on first use.
 */

export const UPPER = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
export const LOWER = 'abcdefghijklmnopqrstuvwxyz';
export const DIGITS = '0123456789';
export const SYMBOLS = '!@#$%^&*-_=+?';
const AMBIGUOUS = /[IOlo01]/g;

export type Sep = '-' | '.' | '_' | ' ';
export interface GenOpts {
  mode: 'chars' | 'phrase';
  length: number; upper: boolean; lower: boolean; numbers: boolean; symbols: boolean; avoidAmbiguous: boolean;
  words: number; capitalize: boolean; addNumber: boolean; separator: Sep;
}
export const GEN_DEFAULTS: GenOpts = {
  mode: 'chars', length: 20, upper: true, lower: true, numbers: true, symbols: true, avoidAmbiguous: true,
  words: 6, capitalize: true, addNumber: true, separator: '-',
};
export const LENGTH: [number, number] = [12, 64];
export const WORDS: [number, number] = [4, 10];
export const SEPARATORS: [Sep, string][] = [['-', 'Hyphen'], ['.', 'Dot'], ['_', 'Underscore'], [' ', 'Space']];
export const LEVEL_LABEL = ['', 'Weak', 'Fair', 'Good', 'Strong'];

export interface Generated { password: string; level: number; bits: number }

/** An integer in [0, n), every value equally likely: rejection sampling over 32-bit draws (GP-R2). */
export function randomBelow(n: number): number {
  const limit = Math.floor(0x100000000 / n) * n;
  const a = new Uint32Array(1);
  for (;;) {
    window.crypto.getRandomValues(a);
    if (a[0] < limit) return a[0] % n;
  }
}
const pick = (s: string) => s[randomBelow(s.length)];

/** The chosen character sets, look-alikes removed when asked. */
export function charSets(o: GenOpts): string[] {
  const strip = (s: string) => (o.avoidAmbiguous ? s.replace(AMBIGUOUS, '') : s);
  return [o.upper && strip(UPPER), o.lower && strip(LOWER), o.numbers && strip(DIGITS), o.symbols && SYMBOLS].filter((s): s is string => !!s);
}

/**
 * The level a Characters setting always gives (D34), known before generating — so a
 * setting below the policy minimum is disabled, never shown (GP-R4). The length is at
 * least 12, so letters + numbers + a symbol is always Strong; anything less is Fair.
 */
export const charsLevel = (o: GenOpts) => ((o.upper || o.lower) && o.numbers && o.symbols ? 4 : 2);

/** Characters mode: one from each chosen set, the rest from all of them, shuffled (Fisher–Yates). */
export function makeCharacters(o: GenOpts): Generated {
  const sets = charSets(o);
  const all = sets.join('');
  const out = sets.map(pick);
  while (out.length < o.length) out.push(pick(all));
  for (let i = out.length - 1; i > 0; i--) { const j = randomBelow(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  const password = out.join('');
  return { password, level: strengthOf(password), bits: Math.round(o.length * Math.log2(all.length)) };
}

let wordList: Promise<string[]> | null = null;
/** The EFF long list, fetched with the page bundle's code split — once. */
export function loadWords(): Promise<string[]> {
  wordList ??= import('../../../credvault/eff_large_wordlist.txt?raw')
    .then(m => m.default.split(/\r?\n/).filter(Boolean).map(l => l.slice(l.indexOf('\t') + 1).trim()))
    .catch(e => { wordList = null; throw e; });
  return wordList;
}

/**
 * Passphrase mode: N EFF words, capitalised, a digit on one word (always when the policy
 * minimum is Good or higher), joined by the separator — a hyphen, dot or underscore is the
 * special character; with a space one symbol is added to a random word.
 */
export function makePassphrase(o: GenOpts, list: string[], digitRequired: boolean): Generated {
  let words = Array.from({ length: o.words }, () => list[randomBelow(list.length)]);
  if (o.capitalize) words = words.map(w => w.charAt(0).toUpperCase() + w.slice(1));
  let bits = o.words * Math.log2(list.length);
  if (o.addNumber || digitRequired) { words[randomBelow(words.length)] += pick(DIGITS); bits += Math.log2(10); }
  if (o.separator === ' ') { words[randomBelow(words.length)] += pick(SYMBOLS); bits += Math.log2(SYMBOLS.length); }
  const password = words.join(o.separator);
  return { password, level: strengthOf(password), bits: Math.round(bits) };
}

/** The ↻ button in a password field: the dialog's defaults — 20 characters, every set. */
export const quickPassword = () => makeCharacters(GEN_DEFAULTS).password;
