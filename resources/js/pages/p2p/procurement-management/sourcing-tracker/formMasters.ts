import { useEffect, useState } from 'react';
import api from '../../../../api';

/* Masters for the Map Supplier forms: GET /p2p/form-masters (segments, countries, states, GST state
   codes, GST rates, currencies with their default ₹ rate, and our own state = place of supply).
   Loaded once per page visit and shared by every form that asks. */

export type FormMasters = {
  segments: { id: number; name: string }[];
  countries: { id: number; name: string }[];
  states: { id: number; country_id: string | number; name: string }[];
  stateCodes: { state_id: string | number; state_code: string }[];
  gstRates: number[];
  currencies: { code: string; name?: string; symbol?: string | null; exchange_rate?: string | number | null }[];
  homeState: { state: string | null; stateCode: string | null };
};

const EMPTY: FormMasters = { segments: [], countries: [], states: [], stateCodes: [], gstRates: [], currencies: [], homeState: { state: null, stateCode: null } };

let cache: Promise<FormMasters> | null = null;
const load = () => {
  if (!cache) {
    cache = api.get<{ data: Partial<FormMasters> }>('/p2p/form-masters')
      .then(r => ({ ...EMPTY, ...(r.data?.data ?? {}) }))
      .catch(e => { cache = null; throw e; });   // a failed load is tried again next time
  }
  return cache;
};

export function useFormMasters() {
  const [masters, setMasters] = useState<FormMasters | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    load().then(m => { if (alive) setMasters(m); }).catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; };
  }, []);
  return { masters, failed };
}

const norm = (s?: string | null) => (s ?? '').trim().toLowerCase();

/** The country master's India row (its id scopes the Indian states). */
const indiaId = (m: FormMasters) => m.countries.find(c => norm(c.name) === 'india')?.id;

/** Indian states, for a Domestic supplier's State dropdown. */
export const indianStates = (m: FormMasters) => {
  const id = indiaId(m);
  return id == null ? [] : m.states.filter(s => String(s.country_id) === String(id));
};

/** Countries outside India, for an International supplier. */
export const overseasCountries = (m: FormMasters) => m.countries.filter(c => norm(c.name) !== 'india');

/** The GST state code of an Indian state (e.g. Maharashtra → 27), or ''. */
export const stateCodeOf = (m: FormMasters, stateName: string) => {
  const st = indianStates(m).find(s => norm(s.name) === norm(stateName));
  if (!st) return '';
  return m.stateCodes.find(c => String(c.state_id) === String(st.id))?.state_code ?? '';
};

/** Default ₹ per unit of a currency from the Currency master, as typed into the rate field. */
export const rateOf = (m: FormMasters | null, code: string) => {
  const r = m?.currencies.find(c => c.code?.toUpperCase() === code.toUpperCase())?.exchange_rate;
  const n = r == null ? NaN : Number(r);
  return Number.isFinite(n) && n > 0 ? String(n) : '';
};

/** A supplier in our own state is Intra-state (CGST + SGST); any other Indian state is Inter-state (IGST). */
export const gstTypeFor = (m: FormMasters | null, stateName: string): 'intra' | 'inter' =>
  m?.homeState.state && norm(m.homeState.state) === norm(stateName) ? 'intra' : 'inter';
