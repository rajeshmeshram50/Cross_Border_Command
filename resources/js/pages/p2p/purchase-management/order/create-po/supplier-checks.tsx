// Supplier compliance checks shared by the Create PO form and the payment
// request view: the GST gate, the six risk checks, the legal status read from
// the Evidence Vault, and the severity icon.
import { formatDmy } from '../../../../../utils/formatDmy';

// A scrutiny or filing date older than this is treated as out of date.
export const GST_STALE_MONTHS = 3;

/** Months between a date and today, to one decimal (7.2), as the banner shows
 *  it. An average month of 30.44 days keeps it in step with the prototype. */
export function monthsAgo(iso: string): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.round(((Date.now() - then.getTime()) / (86400000 * 30.44)) * 10) / 10);
}

/** Whole days between a date and today; null when there is no date. */
export function daysAgo(iso: string): number | null {
  if (!iso) return null;
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return null;
  return Math.max(0, Math.floor((Date.now() - then.getTime()) / 86400000));
}

export type GstState = { tone: 'idle' | 'ok' | 'stop' | 'warn'; title: string; note: string; action?: string };

export type Severity = 'high' | 'med' | 'ok';
export type RiskItem = { sev: Severity; title: string; note: string; tag: string };

/** What the risk checks read about a supplier. */
export type RiskSubject = {
  /** The master's rating, e.g. "High" or "High Risk". */
  risk: string;
  category: string;
  gstStatus: string;
  gstNo: string;
  filing: string;
  scrutiny: string;
  /** Evidence Vault documents completed / required. */
  legal: { done: number; total: number };
};

const has = (value: string, word: string) => value.toLowerCase().includes(word);

export function riskTier(risk: string | null | undefined): 'high' | 'medium' | 'low' | null {
  const r = risk ?? '';
  if (has(r, 'high')) return 'high';
  if (has(r, 'medium')) return 'medium';
  if (has(r, 'low')) return 'low';
  return null;
}

/** "High" → "High Risk"; empty when the master has no rating. */
export function riskLabel(risk: string | null | undefined): string {
  const tier = riskTier(risk);
  return tier ? `${tier[0].toUpperCase()}${tier.slice(1)} Risk` : '';
}

/** High / medium risk with a high-risk or blacklisted category forces
 *  physical inspection — the same rule the server applies on save. */
export function isRiskMandatory(s: { risk: string; category: string }): boolean {
  const tier = riskTier(s.risk);
  return (tier === 'high' || tier === 'medium') && (has(s.category, 'high') || has(s.category, 'blacklist'));
}

export const RISK_GUIDELINES = [
  { title: 'Physical inspection is mandatory', note: 'Goods must be physically inspected and cleared by QA before the GRN is accepted into inventory.' },
  { title: 'Payment against milestones only', note: 'Release payment strictly against installation, goods delivery and 100% GST scrutiny — no advance.' },
];

// A GST return is expected inside 90 days; scrutiny is due every 180.
const FILING_DUE_DAYS = 90;
const SCRUTINY_DUE_DAYS = 180;

/** The six standing checks on a supplier, read from its own record. */
export function riskItems(s: RiskSubject, physInsp: boolean): RiskItem[] {
  const items: RiskItem[] = [];
  const tier = riskTier(s.risk);

  // Inspection asked for on this PO but not forced by the supplier's rating.
  if (physInsp && tier !== 'high') {
    items.push({ sev: 'med', title: 'Physical inspection flagged', note: 'This purchase order is marked for mandatory physical inspection before GRN acceptance.', tag: 'Inspection' });
  }

  if (tier === 'high') items.push({ sev: 'high', title: 'High risk supplier', note: 'Rated High Risk — senior approval recommended before releasing this PO.', tag: 'Risk' });
  else if (tier === 'medium') items.push({ sev: 'med', title: 'Medium risk supplier', note: 'Rated Medium Risk — review the open items below before proceeding.', tag: 'Risk' });
  else if (tier === 'low') items.push({ sev: 'ok', title: 'Low risk supplier', note: 'Rated Low Risk. No rating-based restriction applies to this purchase order.', tag: 'Risk' });
  else items.push({ sev: 'med', title: 'Risk rating not set', note: 'The supplier master has no risk rating — set one on the supplier record.', tag: 'Risk' });

  if (has(s.category, 'blacklist')) items.push({ sev: 'high', title: 'Supplier is blacklisted', note: 'Category is Blacklisted. New purchase orders should not be raised.', tag: 'Category' });
  else if (has(s.category, 'high')) items.push({ sev: 'high', title: 'High risk category', note: 'Classified as a High Risk Supplier in the supplier master.', tag: 'Category' });
  else if (s.category) items.push({ sev: 'ok', title: `${s.category} in good standing`, note: `Classified as ${s.category} with no category restriction on trade.`, tag: 'Category' });
  else items.push({ sev: 'med', title: 'Supplier category not set', note: 'The supplier master has no category — set one on the supplier record.', tag: 'Category' });

  if (!s.gstStatus) items.push({ sev: 'med', title: 'GST status not recorded', note: 'No GST scrutiny record gives this supplier\'s registration status.', tag: 'GST' });
  else if (s.gstStatus.toLowerCase() !== 'active') items.push({ sev: 'high', title: `GST registration ${s.gstStatus.toLowerCase()}`, note: `GSTIN ${s.gstNo || '—'} is not active — input credit may be blocked.`, tag: 'GST' });
  else items.push({ sev: 'ok', title: 'GST registration active', note: `GSTIN ${s.gstNo || '—'} is active. Input tax credit can be claimed on this PO.`, tag: 'GST' });

  const fd = daysAgo(s.filing);
  if (fd === null) items.push({ sev: 'med', title: 'No GST filing recorded', note: 'The supplier\'s last GST return date is not on record.', tag: 'Filing' });
  else if (fd > FILING_DUE_DAYS) items.push({ sev: 'med', title: 'GST return filing overdue', note: `Last return filed ${fd} days ago (${formatDmy(s.filing)}). Expected within ${FILING_DUE_DAYS} days.`, tag: 'Filing' });
  else items.push({ sev: 'ok', title: 'GST returns up to date', note: `Last return filed ${fd} day${fd === 1 ? '' : 's'} ago (${formatDmy(s.filing)}), well inside the ${FILING_DUE_DAYS} day window.`, tag: 'Filing' });

  const sd = daysAgo(s.scrutiny);
  if (sd === null) items.push({ sev: 'med', title: 'No GST scrutiny recorded', note: 'Run a GST scrutiny on the supplier record.', tag: 'Scrutiny' });
  else if (sd > SCRUTINY_DUE_DAYS) items.push({ sev: 'med', title: 'GST scrutiny not refreshed', note: `Last scrutiny was ${sd} days ago (${formatDmy(s.scrutiny)}). Due every ${SCRUTINY_DUE_DAYS} days.`, tag: 'Scrutiny' });
  else items.push({ sev: 'ok', title: 'GST scrutiny current', note: `Last reviewed ${sd} day${sd === 1 ? '' : 's'} ago (${formatDmy(s.scrutiny)}). Next review due in ${Math.max(0, SCRUTINY_DUE_DAYS - sd)} days.`, tag: 'Scrutiny' });

  const { done, total } = s.legal;
  if (total === 0) items.push({ sev: 'med', title: 'No compliance documents on file', note: 'The Evidence Vault has no required documents for this supplier yet.', tag: 'Documents' });
  else if (done < total) items.push({ sev: 'med', title: 'Compliance documents incomplete', note: `${total - done} of ${total} documents still outstanding in the Evidence Vault.`, tag: 'Documents' });
  else items.push({ sev: 'ok', title: 'Compliance documents complete', note: `All ${total} KYC, licence and agreement documents are on file in the Evidence Vault.`, tag: 'Documents' });

  return items;
}

/** Stale scrutiny blocks the PO; a stale return only needs senior approval. */
export function gstState(supplier: string, scrutinyAge: number | null, filingAge: number | null): GstState {
  if (!supplier) {
    return { tone: 'idle', title: 'Select a supplier to run the GST compliance check', note: `Scrutiny and filing dates are checked against a ${GST_STALE_MONTHS}-month window.` };
  }
  if (scrutinyAge === null || scrutinyAge >= GST_STALE_MONTHS) {
    return { tone: 'stop', title: 'GST scrutiny required', note: `Scrutiny is older than ${GST_STALE_MONTHS} months. Refresh it on the supplier record before this PO can move forward.`, action: 'Review requirement' };
  }
  if (filingAge === null || filingAge >= GST_STALE_MONTHS) {
    return { tone: 'warn', title: 'Senior approval required', note: `Scrutiny is current, but the last GST return is older than ${GST_STALE_MONTHS} months. A senior must approve this PO.`, action: 'Send for senior approval' };
  }
  return { tone: 'ok', title: 'GST compliance cleared', note: `Scrutiny and filing are both inside the ${GST_STALE_MONTHS}-month window. This PO can proceed.` };
}

/** The oldest date a scrutiny or return may carry and still be accepted. */
export function cutoffDate(): string {
  const d = new Date();
  d.setMonth(d.getMonth() - GST_STALE_MONTHS);
  return d.toISOString().slice(0, 10);
}

/* ══ Legal status from the supplier's Evidence Vault ══ */

export type LegalSection = { name: string; sub: string; parts: string[]; done: number; total: number; pct: number; tone: 'ok' | 'warn' | 'bad' };
export type LegalView = { sections: LegalSection[]; done: number; total: number; pct: number };

// A vault document counts as done once it is verified or signed.
const DONE_STATUSES = ['verified', 'signed', 'approved'];

const LEGAL_GROUPS: { name: string; sub: string; parts: [string, string][] }[] = [
  { name: 'Standard Documents', sub: 'One Time · KYC, DD & Licenses', parts: [['Company Due Diligence', 'company_dd'], ['Owner KYC Documents', 'owner_kyc'], ['Trade Licenses', 'trade_licenses']] },
  { name: 'Case to Case Documents & Agreements', sub: 'Per Deal · Trade Docs & Agreements', parts: [['Trade Documents', 'trade_documents']] },
];

const pctOf = (done: number, total: number) => (total ? Math.round((done / total) * 100) : 0);
const toneOf = (pct: number): LegalSection['tone'] => (pct === 100 ? 'ok' : pct >= 60 ? 'warn' : 'bad');

export function legalFromVault(vault: Record<string, unknown> | null): LegalView {
  const rows = (key: string) => (Array.isArray(vault?.[key]) ? (vault![key] as { status?: unknown }[]) : []);
  const sections = LEGAL_GROUPS.map((g) => {
    const docs = g.parts.flatMap(([, key]) => rows(key));
    const done = docs.filter((d) => DONE_STATUSES.includes(String(d.status ?? '').toLowerCase())).length;
    const pct = pctOf(done, docs.length);
    return { name: g.name, sub: g.sub, parts: g.parts.map(([label]) => label), done, total: docs.length, pct, tone: toneOf(pct) };
  });
  const done = sections.reduce((n, s) => n + s.done, 0);
  const total = sections.reduce((n, s) => n + s.total, 0);
  return { sections, done, total, pct: pctOf(done, total) };
}

export function SevIcon({ sev }: { sev: Severity }) {
  if (sev === 'ok') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
  if (sev === 'med') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12.5 15 14" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="7" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /><circle cx="12" cy="12" r="10" /></svg>;
}

/** The Evidence Vault's header card for a supplier from the master. */
export function vaultTargetOf(sup: {
  id: number; code: string; name: string; legalName: string | null; risk: string | null; segments?: string[];
  country: string | null; type: string | null; contact: string | null; city: string | null; email: string | null;
}) {
  return {
    id: sup.code, db_id: sup.id, company: sup.legalName || sup.name, risk: riskLabel(sup.risk),
    segment: sup.segments?.[0], segments: sup.segments, country: sup.country ?? '', type: sup.type ?? '',
    contact: sup.contact ?? '', contactCity: sup.city ?? '', email: sup.email ?? '',
  };
}
