// Supplier compliance checks shared by the Create PO form and the payment
// request view: the GST gate, the six risk checks and their severity icon.
import { formatDmy } from '../../../../../utils/formatDmy';
import { legalTotals, type Supplier } from './sample-suppliers';

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

// A GST return is expected inside 90 days; scrutiny is due every 180.
const FILING_DUE_DAYS = 90;
const SCRUTINY_DUE_DAYS = 180;

/** The six standing checks on a supplier, read from its own record. */
export function riskItems(s: Supplier, physInsp: boolean): RiskItem[] {
  const items: RiskItem[] = [];

  // Inspection asked for on this PO but not forced by the supplier's rating.
  if (physInsp && s.risk !== 'High Risk') {
    items.push({ sev: 'med', title: 'Physical inspection flagged', note: 'This purchase order is marked for mandatory physical inspection before GRN acceptance.', tag: 'Inspection' });
  }

  if (s.risk === 'High Risk') items.push({ sev: 'high', title: 'High risk supplier', note: 'Rated High Risk — senior approval recommended before releasing this PO.', tag: 'Risk' });
  else if (s.risk === 'Medium Risk') items.push({ sev: 'med', title: 'Medium risk supplier', note: 'Rated Medium Risk — review the open items below before proceeding.', tag: 'Risk' });
  else items.push({ sev: 'ok', title: 'Low risk supplier', note: 'Rated Low Risk. No rating-based restriction applies to this purchase order.', tag: 'Risk' });

  if (s.category === 'Blacklisted Supplier') items.push({ sev: 'high', title: 'Supplier is blacklisted', note: 'Category is Blacklisted. New purchase orders should not be raised.', tag: 'Category' });
  else if (s.category === 'High Risk Supplier') items.push({ sev: 'high', title: 'High risk category', note: 'Classified as a High Risk Supplier in the supplier master.', tag: 'Category' });
  else items.push({ sev: 'ok', title: `${s.category} in good standing`, note: `Classified as a ${s.category} with no category restriction on trade.`, tag: 'Category' });

  if (s.gstStatus !== 'Active') items.push({ sev: 'high', title: `GST registration ${s.gstStatus.toLowerCase()}`, note: `GSTIN ${s.gstNo} is not active — input credit may be blocked.`, tag: 'GST' });
  else items.push({ sev: 'ok', title: 'GST registration active', note: `GSTIN ${s.gstNo} is active. Input tax credit can be claimed on this PO.`, tag: 'GST' });

  const fd = daysAgo(s.filing);
  if (fd !== null && fd > FILING_DUE_DAYS) items.push({ sev: 'med', title: 'GST return filing overdue', note: `Last return filed ${fd} days ago (${formatDmy(s.filing)}). Expected within ${FILING_DUE_DAYS} days.`, tag: 'Filing' });
  else if (fd !== null) items.push({ sev: 'ok', title: 'GST returns up to date', note: `Last return filed ${fd} day${fd === 1 ? '' : 's'} ago (${formatDmy(s.filing)}), well inside the ${FILING_DUE_DAYS} day window.`, tag: 'Filing' });

  const sd = daysAgo(s.scrutiny);
  if (sd !== null && sd > SCRUTINY_DUE_DAYS) items.push({ sev: 'med', title: 'GST scrutiny not refreshed', note: `Last scrutiny was ${sd} days ago (${formatDmy(s.scrutiny)}). Due every ${SCRUTINY_DUE_DAYS} days.`, tag: 'Scrutiny' });
  else if (sd !== null) items.push({ sev: 'ok', title: 'GST scrutiny current', note: `Last reviewed ${sd} day${sd === 1 ? '' : 's'} ago (${formatDmy(s.scrutiny)}). Next review due in ${Math.max(0, SCRUTINY_DUE_DAYS - sd)} days.`, tag: 'Scrutiny' });

  const { done, total } = legalTotals(s);
  if (done < total) items.push({ sev: 'med', title: 'Compliance documents incomplete', note: `${total - done} of ${total} documents still outstanding in the Evidence Vault.`, tag: 'Documents' });
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

export function SevIcon({ sev }: { sev: Severity }) {
  if (sev === 'ok') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>;
  if (sev === 'med') return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><circle cx="12" cy="12" r="9" /><polyline points="12 7 12 12.5 15 14" /></svg>;
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.8" strokeLinecap="round" strokeLinejoin="round"><line x1="12" y1="7" x2="12" y2="13" /><line x1="12" y1="17" x2="12.01" y2="17" /><circle cx="12" cy="12" r="10" /></svg>;
}
