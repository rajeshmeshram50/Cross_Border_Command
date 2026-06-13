/* ───────────────────────────────────────────────────────────────────────
 * Lightweight, dependency-free spell checker for the CLM draft editor's
 * "AI Writing Assistant" (Grammarly-style live review).
 *
 * It is deliberately NOT a full Hunspell dictionary (that would add ~1 MB to
 * the bundle and flag every proper noun, company name, Incoterm and legal
 * term in a trade agreement). Instead it flags two high-confidence classes
 * of spelling mistake while leaving unknown-but-plausible words alone:
 *
 *   1. Common misspellings — a curated typo → correction map (gives a
 *      suggestion the writer can act on).
 *   2. Gibberish / keyboard-mash tokens — words with no vowels, a letter
 *      repeated 3+ times, or a 6+ consonant run (e.g. "sdfghjkl").
 *
 * All-uppercase acronyms (DGFT, FSSAI, GST…) and numbers are skipped, and
 * the gibberish rules ignore acronyms, so false positives are rare.
 *
 * The Quality Score is simply the percentage of words spelled correctly.
 * ─────────────────────────────────────────────────────────────────────── */

export type SpellIssue = { word: string; suggestion?: string };
export type SpellResult = { score: number; words: number; issues: SpellIssue[] };

/* Curated common English + business/legal misspellings → correction. */
const COMMON_MISSPELLINGS: Record<string, string> = {
  teh: 'the', adn: 'and', nad: 'and', taht: 'that', thier: 'their', recieve: 'receive',
  recieved: 'received', recieving: 'receiving', beleive: 'believe', beleived: 'believed',
  acheive: 'achieve', acheived: 'achieved', wich: 'which', occured: 'occurred',
  occurence: 'occurrence', occurrence: 'occurrence', seperate: 'separate', seperated: 'separated',
  definately: 'definitely', goverment: 'government', enviroment: 'environment',
  neccessary: 'necessary', necesary: 'necessary', accomodate: 'accommodate',
  accomodation: 'accommodation', adress: 'address', adressed: 'address', agreeement: 'agreement',
  agrement: 'agreement', aggreement: 'agreement', appropiate: 'appropriate',
  begining: 'beginning', buisness: 'business', bussiness: 'business', calender: 'calendar',
  collegue: 'colleague', comming: 'coming', commited: 'committed', commitee: 'committee',
  completly: 'completely', concious: 'conscious', dependant: 'dependent',
  dissapoint: 'disappoint', embarass: 'embarrass', enterprice: 'enterprise', existance: 'existence',
  experiance: 'experience', familar: 'familiar', finaly: 'finally', foriegn: 'foreign',
  fourty: 'forty', freind: 'friend', fullfil: 'fulfil', gaurantee: 'guarantee', garantee: 'guarantee',
  garunteed: 'guaranteed', goverance: 'governance', grammer: 'grammar', happend: 'happened',
  harrass: 'harass', immediatly: 'immediately', independant: 'independent', interupt: 'interrupt',
  knowlege: 'knowledge', liason: 'liaison', liase: 'liaise', maintainance: 'maintenance',
  maintenence: 'maintenance', managment: 'management', millenium: 'millennium', mispell: 'misspell',
  noticable: 'noticeable', occassion: 'occasion', oppurtunity: 'opportunity', oportunity: 'opportunity',
  paymnet: 'payment', paymen: 'payment', perdiem: 'per diem', persistant: 'persistent',
  posession: 'possession', possesion: 'possession', prefered: 'preferred', priviledge: 'privilege',
  probaly: 'probably', proffesional: 'professional', proffessional: 'professional', publically: 'publicly',
  quanity: 'quantity', quantites: 'quantities', recomend: 'recommend', recomended: 'recommended',
  refered: 'referred', refering: 'referring', relevent: 'relevant', responsability: 'responsibility',
  responsibilty: 'responsibility', rythm: 'rhythm', sacrafice: 'sacrifice', secratary: 'secretary',
  succesful: 'successful', successfull: 'successful', supercede: 'supersede', suprise: 'surprise',
  tendancy: 'tendency', tomatos: 'tomatoes', tommorow: 'tomorrow', tommorrow: 'tomorrow',
  truely: 'truly', unfortunatly: 'unfortunately', untill: 'until', usefull: 'useful',
  vaccum: 'vacuum', wether: 'whether', whereever: 'wherever', writting: 'writing', writen: 'written',
  yeild: 'yield', acknowlegement: 'acknowledgement', aquire: 'acquire', aquired: 'acquired',
  arrangment: 'arrangement', assesment: 'assessment', cancelation: 'cancellation', catagory: 'category',
  comparision: 'comparison', confirmaton: 'confirmation', consignmnet: 'consignment',
  delievery: 'delivery', delivary: 'delivery', documnet: 'document', documnets: 'documents',
  guarentee: 'guarantee', invioce: 'invoice', invoise: 'invoice', purchace: 'purchase',
  quotaton: 'quotation', recipt: 'receipt', reciept: 'receipt', signiture: 'signature',
  signatue: 'signature', shipmnet: 'shipment', supplir: 'supplier', vender: 'vendor',
  warrenty: 'warranty', wharehouse: 'warehouse', contralct: 'contract',
  contarct: 'contract', aggrement: 'agreement', complaince: 'compliance', complience: 'compliance',
};

const VOWELS = new Set(['a', 'e', 'i', 'o', 'u', 'y']);

/* Looks like a typo even though it's not in the misspelling map. Applied only
 * to real word tokens (letters), skipping all-uppercase acronyms. */
function looksLikeGibberish(lower: string, original: string): boolean {
  if (lower.length < 4) return false;
  if (original === original.toUpperCase()) return false;       // acronym (GST, DGFT…)
  if (/(.)\1\1/.test(lower)) return true;                       // same letter 3+ in a row
  let hasVowel = false;
  for (const ch of lower) if (VOWELS.has(ch)) { hasVowel = true; break; }
  if (!hasVowel) return true;                                   // no vowel at all
  if (/[bcdfghjklmnpqrstvwxz]{6,}/.test(lower)) return true;    // 6+ consonant run
  return false;
}

/**
 * Strip HTML, entities and {{placeholders}} from the draft, then score the
 * remaining prose for spelling. Returns the 0–100 quality score, the word
 * count, and the list of flagged words (with suggestions where known).
 */
export function checkSpelling(html: string): SpellResult {
  const text = (html || '')
    .replace(/<[^>]+>/g, ' ')        // tags
    .replace(/\{\{[^}]*\}\}/g, ' ')  // placeholders — never spell-check these
    .replace(/&[a-z]+;/gi, ' ')      // entities (&nbsp; &amp; …)
    .replace(/&#\d+;/g, ' ');

  const tokens = text.match(/[A-Za-z][A-Za-z'’-]*/g) ?? [];
  let words = 0;
  let badCount = 0;                  // every bad occurrence (drives the score)
  const issues: SpellIssue[] = [];
  const seen = new Set<string>();    // de-dupe the displayed list

  for (const raw of tokens) {
    // Normalise: drop surrounding apostrophes/hyphens and a trailing possessive.
    const word = raw.replace(/^['’-]+|['’-]+$/g, '').replace(/['’]s$/i, '');
    if (word.length < 2 || /\d/.test(word)) continue;
    words++;
    const lower = word.toLowerCase();
    const suggestion = COMMON_MISSPELLINGS[lower];
    if (suggestion === undefined && !looksLikeGibberish(lower, word)) continue;
    badCount++;                      // repeating the same typo keeps the score down
    if (!seen.has(lower)) {
      seen.add(lower);
      issues.push(suggestion ? { word, suggestion } : { word });
    }
  }

  const score = words === 0 ? 0 : Math.max(0, Math.round((100 * (words - badCount)) / words));
  return { score, words, issues };
}
