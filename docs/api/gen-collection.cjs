/* Generate a Postman v2.1 collection from Laravel's `route:list --json`.
   Folders: Module → Resource (controller) → requests. */
const fs = require('fs');
const path = require('path');

const SCRATCH = __dirname;
const routes = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'routes.json'), 'utf8'));

/* ── Validation-derived request bodies ──────────────────────────────────
   payloads.json (from extract-payloads.php) = { fields: {action:{field:rule}},
   calls: {action:[validateHelper]} }. We turn each write endpoint's fields
   into an example JSON (or multipart) body. */
let PAY = { fields: {}, calls: {} };
try { PAY = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'payloads.json'), 'utf8')); } catch { /* optional */ }

/* Hand-written example bodies keyed by "METHOD /api/path" (payload-overrides.json).
   These take precedence over rule-derived bodies so covered endpoints read exactly
   like the reference collection. Value: { raw: <obj|string> } or { formdata: [ {key,value} | {key,file} ] }. */
let OVERRIDES = {};
try { OVERRIDES = JSON.parse(fs.readFileSync(path.join(SCRATCH, 'payload-overrides.json'), 'utf8')); } catch { /* optional */ }

function overrideBody(reqName) {
  const o = OVERRIDES[reqName];
  if (!o) return null;
  if (o.formdata) {
    return { mode: 'formdata', formdata: o.formdata.map(f => f.file !== undefined
      ? { key: f.key, type: 'file', src: f.file }
      : { key: f.key, type: 'text', value: String(f.value) }) };
  }
  const raw = typeof o.raw === 'string' ? o.raw : JSON.stringify(o.raw, null, 2);
  return { mode: 'raw', raw, options: { raw: { language: 'json' } } };
}

/* Fields for a route action = its own validate() rules + those of any same-class
   validate* helper it delegates to (store/update → validatePayload, etc.). */
function resolveFields(action) {
  const cls = action.split('@')[0];
  let merged = { ...(PAY.fields[action] || {}) };
  for (const h of (PAY.calls[action] || [])) merged = { ...merged, ...(PAY.fields[cls + '@' + h] || {}) };
  return merged;
}

const isFileRule = (rule) => /\b(file|image|mimes|mimetypes)\b/i.test(rule || '');

/* Realistic sample values by field-name pattern (first match wins, specific
   → generic). Beats a bare "example" so the collection reads like real data. */
const NAME_SAMPLES = [
  [/gst.*num|gstin/,                                          '27AADCI6120M1ZH'],
  [/\bpan\b|pan_?(no|number)/,                                'AADCI6120M'],
  [/ifsc/,                                                    'HDFC0001234'],
  [/account.*(number|no)|acct/,                               '50100123456789'],
  [/bank.*name|bank_name/,                                    'HDFC Bank'],
  [/swift/,                                                   'HDFCINBB'],
  [/(^|_)(email)($|_)|_email$|email$/,                        'rahul.sharma@example.com'],
  [/mobile|phone|whatsapp|_tel$|cp_contact|^contact$|contact_?(no|num|number)/, '9876543210'],
  [/url|website|link|maps|gmaps/,                             'https://example.com'],
  [/company.*name|company_name/,                              'Shree Agro Exports Pvt Ltd'],
  [/legal.*name/,                                             'Shree Agro Exports Private Limited'],
  [/cp_name|contact_person|person_name|owner_name|sender_name|full_name|assignee|reporting|head$|manager$|^name$/, 'Rahul Sharma'],
  [/first_name/,                                              'Rahul'],
  [/last_name/,                                               'Sharma'],
  [/designation|role|position/,                               'Compliance Officer'],
  [/department/,                                              'Sales'],
  [/address_?type/,                                           'Registered Office'],
  [/doc_?type|document_?type/,                                'International'],
  [/address|street/,                                          '101, Business Park, MG Road'],
  [/(^|_)city($|_)/,                                          'Pune'],
  [/(^|_)state($|_)/,                                         'Maharashtra'],
  [/country/,                                                 'India'],
  [/pin|postal|zip|pincode/,                                  '411001'],
  [/hsn/,                                                     '1006'],
  [/\buom\b|(^|_)unit(_|$)/,                                   'KG'],
  [/incoterm/,                                                'FOB'],
  [/(^|_)port(_|$)|port_of|loading|discharge/,                'Nhava Sheva (INNSA)'],
  [/currency/,                                                'USD'],
  [/segment/,                                                 'Rice'],
  [/classification/,                                          'Standard'],
  [/risk/,                                                    'Low'],
  [/customer_?type|vendor_?type|type$/,                       'Retailer'],
  [/percentage|percent|gst_?rate|tax_?rate/,                  18],
  [/amount|price|total|value$|cost|salary|balance|advance/,   10000],
  [/quantity|qty|weight|net_?wt|gross_?wt|count|stock/,       100],
  [/length|width|height/,                                     10],
  [/subject|title|heading/,                                   'Sample Subject'],
  [/agenda|message|description|remark|note|comment|reason|body|content|red_?flag|clause/, 'Sample text for testing.'],
  [/invoice/,                                                 'INV-2026-001'],
  [/code/,                                                    'SRC-001'],
  [/password/,                                                'Password@123'],
  [/\botp\b/,                                                 '123456'],
  [/venue|place|location/,                                    'Head Office, Pune'],
  [/platform/,                                                'Zoom'],
];

/* Infer a realistic value from a field name + its (space-joined) rule text. */
function exampleFor(key, rule) {
  const r = (rule || '').toLowerCase();
  const k = key.toLowerCase();
  const inm = (rule || '').match(/\bin:([A-Za-z0-9_,\- ]+)/i);   // enum → first option (case preserved)
  if (inm) { const opt = inm[1].split(/[\s,]+/).filter(Boolean)[0]; if (opt) return opt; }
  if (/\bboolean\b/.test(r)) return true;
  for (const [re, val] of NAME_SAMPLES) if (re.test(k)) return val;
  if (/\bdate\b/.test(r) || /(^|_)date($|_)|_at$/.test(k)) return /end/.test(k) ? '2026-01-31' : '2026-01-01';
  if (/\b(integer|numeric)\b/.test(r) || /_?id$/.test(k)) return 1;
  if (/\barray\b/.test(r)) return [];                    // children (if any) rebuild it
  return 'Sample';
}

/* Set value at a dotted path where '*' means "array of". */
function setPath(root, segs, value) {
  let node = root;
  for (let i = 0; i < segs.length; i++) {
    const seg = segs[i];
    if (seg === '*') { if (!node.length) node.push({}); node = node[0]; continue; }
    if (i === segs.length - 1) { if (node[seg] === undefined) node[seg] = value; return; }
    if (segs[i + 1] === '*') { if (!Array.isArray(node[seg])) node[seg] = []; node = node[seg]; }
    else { if (typeof node[seg] !== 'object' || node[seg] === null || Array.isArray(node[seg])) node[seg] = {}; node = node[seg]; }
  }
}

/* dotted → multipart bracket key: a.*.b → a[0][b] ; a.* → a[] */
function bracketKey(key) {
  const s = key.split('.');
  let out = s[0];
  for (let i = 1; i < s.length; i++) out += s[i] === '*' ? (s[i + 1] ? '[0]' : '[]') : `[${s[i]}]`;
  return out;
}

/* Build a Postman request body for a write endpoint (null for GET/DELETE-only). */
function buildBody(action, method) {
  if (!['POST', 'PUT', 'PATCH'].includes(method)) return null;
  const fields = resolveFields(action);
  const keys = Object.keys(fields);
  if (!keys.length) return null;   // no inline validation → action endpoint takes no body (don't show a blank {})
  const leafOf = (k) => k.split('.').filter(s => s !== '*').pop() || k;   // infer value from the LEAF, not the dotted path
  if (keys.some(k => isFileRule(fields[k]))) {                       // multipart
    const formdata = keys.map(k => isFileRule(fields[k])
      ? { key: bracketKey(k), type: 'file', src: [] }
      : { key: bracketKey(k), type: 'text', value: String(exampleFor(leafOf(k), fields[k])) });
    return { mode: 'formdata', formdata };
  }
  const root = {};                                                  // raw JSON
  for (const k of keys) setPath(root, k.split('.'), exampleFor(leafOf(k), fields[k]));
  return { mode: 'raw', raw: JSON.stringify(root, null, 2), options: { raw: { language: 'json' } } };
}

/* ── Controller → top-level MODULE folder. Ordered numeric prefixes keep the
      Postman tree in a sensible reading order. Matched by substring on the
      controller short name; first match wins; fallback = "ZZ · Other". */
const MODULE_RULES = [
  [/^Auth|ForgotPassword|Google/i,                         '01 · Auth & Session'],
  [/^Client|^Branch|^User|^Permission|^Settings/i,          '02 · Tenancy & Access'],
  [/^Customer/i,                                            '03 · Customers'],
  [/^Consignee/i,                                           '04 · Consignees'],
  [/^SalesLead|^LeadAck|^SalesTodo|^SalesReminder|^Meeting/i,'05 · Sales · Leads & To-Do'],
  [/^Quotation|^ProformaInvoice|^SalesPdf|^Procurement|^Shipment/i,'06 · Sales · Quotation/PI'],
  [/^Product/i,                                             '07 · Products'],
  [/^Vendor/i,                                              '08 · Vendors'],
  [/^Clm|^Ctc/i,                                            '09 · CLM (Legal)'],   // CtcContract = Case-to-Case Contract
  [/^Employee|^PreviousEmployment|^Attendance|^FaceBiometric|^Exit/i,'10 · HRMS · Employees'],
  [/^Leave/i,                                               '11 · HRMS · Leave'],
  [/^Expense|^AdvanceRequest/i,                             '12 · HRMS · Expenses'],
  [/^Recruitment|^HiringRequest|^Candidate|^Onboarding/i,   '13 · HRMS · Recruitment'],
  [/^Payroll|^Salary|^Holiday/i,                            '14 · HRMS · Payroll'],
  [/^Hr[A-Z]|^MyTeam|^Announcement|^Notification/i,         '15 · HRMS · Docs & Team'],
  [/^Plan|^Subscription|^Payment|^Razorpay|^Module/i,       '16 · Billing'],
  [/^Master|^OrganizationType|^SegmentDocUpload/i,          '17 · Masters'],
  [/^Dashboard|^HrOverview/i,                               '18 · Dashboards'],
  [/^P2p\\|Sourcing|PurchaseOrder|SupplierPurchase/i,       '19 · Procure to Pay (P2P)'],
  [/^Email/i,                                               '20 · System'],
  [/^Dummy/i,                                               '99 · Dev / Test'],
];

const moduleFor = (ctrl) => {
  for (const [re, name] of MODULE_RULES) if (re.test(ctrl)) return name;
  return 'ZZ · Other';
};

/* Human resource label from a controller short name: "AdvanceRequestController" → "Advance Requests". */
const resourceLabel = (ctrl) => {
  let base = ctrl.replace(/Controller$/, '').replace(/^P2p\\/, '');
  base = base.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ').trim();
  return base;
};

/* Readable request name from method + resource. */
const VERB_NAME = { index: 'List', store: 'Create', show: 'Get', update: 'Update', destroy: 'Delete' };
const requestName = (fn, resource) => {
  if (VERB_NAME[fn]) return `${VERB_NAME[fn]} ${resource}`;
  const pretty = fn.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^\w/, c => c.toUpperCase());
  return `${pretty} · ${resource}`;
};

const firstMethod = (m) => m.split('|').filter(v => v !== 'HEAD')[0] || 'GET';

/* Convert Laravel `{param}` / `{param?}` → Postman `:param`, collect variables. */
const toPostmanPath = (uri) => {
  const clean = uri.replace(/^api\//, '');
  const segs = clean.split('/').map(s => s.replace(/^\{(\w+)\??\}$/, ':$1'));
  const vars = [];
  clean.split('/').forEach(s => { const m = s.match(/^\{(\w+)\??\}$/); if (m) vars.push({ key: m[1], value: '1' }); });
  return { segs, vars };
};

/* Token-capture test script attached to the login endpoints — saves the
   returned token into {{token}} so every other request just works. */
const TOKEN_TEST = {
  listen: 'test',
  script: {
    type: 'text/javascript',
    exec: [
      'var j;',
      'try { j = pm.response.json(); } catch (e) { return; }',
      'var t = j.token || (j.data && j.data.token);',
      'if (t) {',
      '  pm.collectionVariables.set("token", t);',
      '  pm.environment.set("token", t);',
      '  console.log("Saved token to {{token}}");',
      '}',
    ],
  },
};
const isLoginPath = (uri) => /^api\/(login|login\/face|google-login)$/.test(uri);

// Group: Module → Resource (controller) → requests.
const tree = {};
for (const r of routes) {
  if (!r.action || !/Controllers\\/.test(r.action)) continue;      // skip closures / Fortify etc.
  const cm = r.action.match(/Controllers\\(.+)@(\w+)/);
  if (!cm) continue;
  const ctrlShort = cm[1].replace(/^Api\\/, '');   // strip Api\ ; keep P2p\ prefix
  const fn = cm[2];
  const module = moduleFor(ctrlShort);
  const resource = resourceLabel(ctrlShort);
  const method = firstMethod(r.method);
  const { segs, vars } = toPostmanPath(r.uri);
  const isPublic = !(r.middleware || []).some(m => /sanctum/.test(m));

  const reqName = `${method} /${r.uri}`;                 // override lookup key (independent of display name)
  const body = overrideBody(reqName) || buildBody(r.action, method);
  const header = [{ key: 'Accept', value: 'application/json' }];
  // JSON write endpoints declare the content type; multipart lets Postman set
  // its own boundary, so we don't force a Content-Type there.
  if (body && body.mode === 'raw') header.unshift({ key: 'Content-Type', value: 'application/json' });

  (tree[module] ||= {});
  (tree[module][resource] ||= []);
  tree[module][resource].push({
    name: requestName(fn, resource) + (isPublic ? '  (public)' : ''),
    ...(isLoginPath(r.uri) ? { event: [TOKEN_TEST] } : {}),
    request: {
      ...(isPublic ? { auth: { type: 'noauth' } } : {}),
      method,
      header,
      ...(body ? { body } : {}),
      url: {
        raw: `{{base_url}}/api/${segs.join('/')}`,
        host: ['{{base_url}}'],
        path: ['api', ...segs],
        ...(vars.length ? { variable: vars } : {}),
      },
      description: `${ctrlShort}@${fn} — ${method} /${r.uri} — Auth: ${isPublic ? 'Public' : 'Bearer token required'}.`
        + (vars.length ? ` Path params: ${vars.map(v => `{${v.key}}`).join(', ')}.` : ''),
    },
  });
}

// Build Postman folders: Module → Resource → requests (sorted)
const collectionItems = Object.keys(tree).sort().map(module => ({
  name: module,
  item: Object.keys(tree[module]).sort().map(resource => ({
    name: resource,
    item: tree[module][resource].sort((a, b) => a.name.localeCompare(b.name)),
  })),
}));

const collection = {
  info: {
    name: 'Cross_Border_Command — Full API',
    description: 'Generated from Laravel route:list. One folder per controller; requests named "METHOD /api/path" '
      + 'and carrying a realistic sample payload (adjust IDs / GSTINs / emails to your tenant before sending). '
      + 'Auth is Bearer {{token}} at the collection level (inherited); public routes override to no-auth. '
      + 'Run POST /api/login first — its test script auto-saves the token to {{token}}. '
      + 'The SPA injects ?branch_id={{branch_id}} on GETs — add it where a request is branch-scoped.',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  auth: { type: 'bearer', bearer: [{ key: 'token', value: '{{token}}', type: 'string' }] },
  variable: [
    { key: 'base_url', value: 'http://127.0.0.1:8000' },
    { key: 'token', value: '' },
    { key: 'branch_id', value: '' },
  ],
  item: collectionItems,
};

const environment = {
  name: 'CBC · Local',
  values: [
    { key: 'base_url', value: 'http://127.0.0.1:8000', enabled: true },
    { key: 'token', value: '', enabled: true },
    { key: 'branch_id', value: '', enabled: true },
  ],
  _postman_variable_scope: 'environment',
};

const OUT_DIR = process.argv[2];
fs.mkdirSync(OUT_DIR, { recursive: true });
fs.writeFileSync(path.join(OUT_DIR, 'CrossBorderCommand.postman_collection.json'), JSON.stringify(collection, null, 2));
fs.writeFileSync(path.join(OUT_DIR, 'CrossBorderCommand.local.postman_environment.json'), JSON.stringify(environment, null, 2));

// Summary
const modCount = collectionItems.length;
const resCount = collectionItems.reduce((n, m) => n + m.item.length, 0);
const reqCount = collectionItems.reduce((n, m) => n + m.item.reduce((k, r) => k + r.item.length, 0), 0);
console.log(`Modules: ${modCount}\nResources: ${resCount}\nRequests: ${reqCount}`);
console.log('\nFolders:');
collectionItems.forEach(m => console.log(`  ${m.name}  (${m.item.length} resources)`));
