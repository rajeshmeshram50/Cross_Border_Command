/* Supplier Type → the "Applicable Party" token a CLM trade document / agreement stores for it.
   TS twin of app/Support/SupplierPartyToken.php — the Evidence Vault filters its list here while
   the supplier form asks the server, so both sides need the same rule. Keep the maps in step.

   null = unclassified: the caller keeps matching every Supplier-* document. */

const MATERIAL = 'Supplier-Material / Goods';
const LOGISTICS = 'Supplier-FFD / Transporter';

/** Normalised type name → token. */
const BY_NAME: Record<string, string> = {
  'material / goods':      MATERIAL,
  'ffd / transporter':     LOGISTICS,
  'logistic':              LOGISTICS,
  'logistics':             LOGISTICS,
  'soft service provider': 'Supplier-Soft Service',
  'trackable services':    'Supplier-Trackable',
  'consumable services':   'Supplier-Consumable',
  'professional services': 'Supplier-Professional',
  'utility services':      'Supplier-Utility',
  'facility services':     'Supplier-Facility',
  'maintenance services':  'Supplier-Maintenance',
  'outsourcing services':  'Supplier-Outsourcing',
};

/** Older party spellings a token replaced (see tradeDocParty.ts LEGACY_SUPPLIER). */
const LEGACY_MATERIAL = ['Supplier', 'Supplier-Material'];
const LEGACY_LOGISTICS = ['Supplier-Logistic'];
const LEGACY_SERVICES = ['Supplier-Services', 'Supplier-Tech', 'Supplier-Advisory', 'Supplier-Strategic Risk'];

/** "Material/ Goods" and "Material / Goods" are one type; case ignored. */
const normalise = (s: string) => s.trim().toLowerCase().replace(/\s*\/\s*/g, ' / ').replace(/\s+/g, ' ');

export function supplierPartyToken(typeName: string | null | undefined): string | null {
  const key = normalise(typeName ?? '');
  return key ? BY_NAME[key] ?? null : null;
}

/** Every lower-cased party entry that counts as this token. */
export function supplierPartyAliases(token: string): string[] {
  const spellings = token === MATERIAL ? [token, ...LEGACY_MATERIAL]
    : token === LOGISTICS ? [token, ...LEGACY_LOGISTICS]
    : Object.values(BY_NAME).includes(token) ? [token, ...LEGACY_SERVICES]
    : [token];
  return spellings.map(s => s.toLowerCase());
}
