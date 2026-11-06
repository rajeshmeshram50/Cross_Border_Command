/* Import by category — sample data only (no API): the 25 categories of the Add credential form,
   and the accepted / discarded rows an uploaded sheet of a category produces. */

export interface ImportCategory { key: string; label: string; group: string; idLabel: string; keyField: string; hasPassword: boolean }

export const IMPORT_CATEGORIES: ImportCategory[] = [
  { key: 'login', label: 'Login', group: 'Logins & Access', idLabel: 'Username', keyField: 'Website / URL', hasPassword: true },
  { key: 'password', label: 'Password', group: 'Logins & Access', idLabel: 'Username', keyField: 'Password', hasPassword: true },
  { key: 'email', label: 'Email', group: 'Logins & Access', idLabel: 'Email Address', keyField: 'Email Address', hasPassword: true },
  { key: 'passkey', label: 'Passkey', group: 'Logins & Access', idLabel: 'Username', keyField: 'Website / App', hasPassword: false },
  { key: 'totp', label: 'TOTP / 2FA Seed', group: 'Logins & Access', idLabel: 'Account', keyField: 'Secret Key', hasPassword: false },
  { key: 'card', label: 'Credit Card', group: 'Finance & Banking', idLabel: 'Cardholder Name', keyField: 'Card Number', hasPassword: false },
  { key: 'bank', label: 'Bank Account', group: 'Finance & Banking', idLabel: 'Account Number', keyField: 'IFSC Code', hasPassword: true },
  { key: 'crypto', label: 'Crypto Wallet', group: 'Finance & Banking', idLabel: 'Wallet / Exchange', keyField: 'Recovery Phrase', hasPassword: true },
  { key: 'rewards', label: 'Rewards', group: 'Finance & Banking', idLabel: 'Member ID', keyField: 'Member ID', hasPassword: true },
  { key: 'api', label: 'API Credentials', group: 'Development & IT', idLabel: 'Service / Platform', keyField: 'API Key / Client ID', hasPassword: false },
  { key: 'ssh', label: 'SSH Key', group: 'Development & IT', idLabel: 'Host', keyField: 'Private Key', hasPassword: false },
  { key: 'database', label: 'Database', group: 'Development & IT', idLabel: 'Username', keyField: 'Port', hasPassword: true },
  { key: 'server', label: 'Server', group: 'Development & IT', idLabel: 'Username', keyField: 'Hostname / IP', hasPassword: true },
  { key: 'cert', label: 'Certificate', group: 'Development & IT', idLabel: 'Domain / Common Name', keyField: 'Valid Till', hasPassword: false },
  { key: 'license', label: 'Software License', group: 'Development & IT', idLabel: 'Software', keyField: 'License Key', hasPassword: false },
  { key: 'wifi', label: 'Wireless Router', group: 'Development & IT', idLabel: 'Network Name (SSID)', keyField: 'Security', hasPassword: true },
  { key: 'identity', label: 'Identity', group: 'Identity & Documents', idLabel: 'Full Name', keyField: 'Full Name', hasPassword: false },
  { key: 'passport', label: 'Passport', group: 'Identity & Documents', idLabel: 'Passport Number', keyField: 'Passport Number', hasPassword: false },
  { key: 'driver', label: 'Driver License', group: 'Identity & Documents', idLabel: 'License Number', keyField: 'License Number', hasPassword: false },
  { key: 'govid', label: 'SSN / Aadhaar / PAN', group: 'Identity & Documents', idLabel: 'ID Number', keyField: 'ID Number', hasPassword: false },
  { key: 'document', label: 'Document', group: 'Identity & Documents', idLabel: 'Document Number', keyField: 'Document Number', hasPassword: false },
  { key: 'note', label: 'Secure Note', group: 'Personal & Lifestyle', idLabel: 'Title', keyField: 'Note', hasPassword: false },
  { key: 'membership', label: 'Membership', group: 'Personal & Lifestyle', idLabel: 'Member ID', keyField: 'Member ID', hasPassword: false },
  { key: 'medical', label: 'Medical Record', group: 'Personal & Lifestyle', idLabel: 'Patient Name', keyField: 'Patient Name', hasPassword: false },
  { key: 'outdoor', label: 'Outdoor License', group: 'Personal & Lifestyle', idLabel: 'License Number', keyField: 'License Number', hasPassword: false },
];

export interface AcceptedRow { row: number; name: string; identifier: string; strength: 'Strong' | 'Good' | 'Fair' | null; flags: ('weak' | 'attach')[] }
export interface DiscardedRow { row: number; name: string; reasons: { label: string; message: string }[] }
export interface ImportReview { category: ImportCategory; fileName: string; format: 'xlsx' | 'csv'; accepted: AcceptedRow[]; discarded: DiscardedRow[] }

const PLACES = ['Head Office', 'Mumbai Branch', 'Finance Team', 'IT Admin', 'Sales Desk', 'Export Desk', 'Nagpur Office', 'Warehouse'];
const IDS = ['admin@inhpl.com', 'accounts@inhpl.com', 'it.support@inhpl.com', 'sales@inhpl.com', 'export@inhpl.com', 'ops@inhpl.com'];

/** The review of an uploaded sheet: 6 accepted rows (two weak where the category has a password) and 3 discarded. */
export function sampleReview(category: ImportCategory, fileName: string): ImportReview {
  const ext = fileName.split('.').pop()?.toLowerCase() === 'csv' ? 'csv' : 'xlsx';
  const accepted: AcceptedRow[] = PLACES.slice(0, 6).map((place, i) => {
    const weak = category.hasPassword && (i === 2 || i === 4);
    return {
      row: i + 2,
      name: `${category.label} · ${place}`,
      identifier: category.idLabel === 'Username' || category.idLabel === 'Email Address' ? IDS[i] : `${category.idLabel} ${1001 + i}`,
      strength: category.hasPassword ? (weak ? 'Fair' : i % 2 ? 'Good' : 'Strong') : null,
      flags: [...(weak ? ['weak' as const] : []), ...(category.key === 'cert' || category.key === 'document' ? ['attach' as const] : [])],
    };
  });
  const discarded: DiscardedRow[] = [
    { row: 8, name: '', reasons: [{ label: 'Credential Name', message: 'Enter the Credential Name.' }] },
    { row: 9, name: `${category.label} · ${PLACES[6]}`, reasons: [{ label: category.keyField, message: `${category.keyField} is missing or not valid.` }] },
    { row: 10, name: `${category.label} · ${PLACES[0]}`, reasons: [{ label: 'Duplicate', message: 'Already in your vault — a credential of this category has the same name.' }] },
  ];
  return { category, fileName, format: ext, accepted, discarded };
}
