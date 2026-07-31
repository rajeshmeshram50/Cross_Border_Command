# CLM MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Central Legal Module
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough (module-wide) |

---

## 0. HOW TO READ
Traces the module in the order data flows: **master write → rule write → rule read → library draft → send for signature → status sync → evidence vault → CTC lifecycle → oversight aggregation.**
Sub-module walkthroughs live in the folders listed at the bottom.

---

## 1. THE SHARED MASTER PATTERN (`ClmKycController` — all six masters are the same)

```php
index():
  $q = ClmKycDocument::query()->orderBy('id');
  MasterVisibility::applyReadScope($q, $user, $request->integer('branch_id') ?: null);
  $rows = $q->get();
  $map = ClmAuthority::idNameMap($user->client_id);           // ids → CURRENT names
  $rows->each(fn($r) => $r->authority_names = ClmAuthority::displayNames($r->authority, $map));
  $rows->each(function ($r) {                                  // per-row delete guard
      $labels = $this->usageCheck($r->code);
      $r->in_use = !empty($labels); $r->used_in = array_values($labels);
  });

store():
  validate(name, authority, expiry?, status?);
  // case-insensitive dupe check WITHIN THE CALLER'S SCOPE (siblings may reuse the name)
  $dupe = query()->whereRaw('LOWER(name) = ?', [...]); applyReadScope($dupe, $user, $user->branch_id);
  $data['authority'] = ClmAuthority::normalizeIds($input, $client_id);   // names/ids → canonical IDS
  if ($data['authority'] === '') → 422 'Select at least one valid authority.'
  DB::transaction: create([... 'branch_id' => $user->branch_id, 'code' => nextCode($cid,$bid) ...]);

update():   scoped firstOrFail → hierarchicalDenial('edit') → validate → normalizeIds → clash check → update
destroy():  scoped firstOrFail → hierarchicalDenial('delete') → usageCheck → 409 {used_in} or delete

nextCode($clientId, $branchId):
  DB::table('clients')->lockForUpdate();                        // serialise concurrent inserts
  codes = rows WHERE client_id AND (branch_id IS NULL | = $branchId);
  maxN = max(preg_match '/^KYC-(\d+)$/');  n = maxN;
  do { n++; $code = sprintf('KYC-%03d', n); } while (isset($taken[$code]));   // skip gaps
```

`usageCheck($code)` looks for the code inside `clm_segment_rules.doc_selections` (`LIKE '%"KYC-001"%'`) and in `segment_doc_uploads.doc_code`.
**QC additionally scopes those lookups by `client_id`** (codes repeat per tenant); KYC/DD/TL do not.

### Where the six differ
| Controller | Difference |
|---|---|
| `ClmSegmentController` | `usageLabels()` batches usage across 8 tables in one query each; **name + regulatory_status freeze** once used; `cascadeSegmentRename()` rewrites party CSVs; `MasterBundleCache::bump()` on every write |
| `ClmAuthorityController` | `cascadeRename()` updates the legacy **name-based** tables (`vendor_documents`, `customer_documents`, `vendor_owners`); usage spans id-tables, name-tables and `auths_json` code-matching |
| `ClmQcController` | 7 fields instead of 4; `doc_type` cert\|comp drives the tab counts; usage also checks `product_qc_records.qc_name` joined through `products` for tenant scope |
| `ClmDdController` / `ClmTradeLicenseController` | Only the prefix, label and `expiry` vs `validity` differ |

---

## 2. SEGMENT RENAME CASCADE (`ClmSegmentController::update`)

```php
$usedIn = $this->usageLabels(collect([$row]))[$row->id] ?? [];
if (renaming && $usedIn)            → 409  "…its name can't be changed."
if (changing tier && $usedIn)       → 422  "…its regulatory status can't be changed."
if (name clashes in scope)          → 422  errors.name  (inline under the field)
$oldName = $row->name;  $row->update($data);
if (name actually changed) cascadeSegmentRename($row->client_id, $oldName, $row->name);
MasterBundleCache::bump();
```
`cascadeSegmentRename()` walks `customers.segment` / `consignees.segment` (comma-joined **names**), splits on commas, and replaces only **whole entries** with a case-insensitive `strcasecmp` — so `Rice` never partially rewrites `Rice Bran`. Scoped to the **client**, not the branch: a customer in branch A may legitimately reference a segment owned by branch B.

---

## 3. DOCUMENT CONTROL PANEL (`ClmSegmentRuleController`)

### 3.1 Bootstrap — one call feeds the whole modal
```php
bootstrap():
  $load = fn($modelClass) => applyReadScope($modelClass::query()->orderBy('id'), $user, $branchId)->get();
  segments, authorities, kyc, dd, tl, qc                     // td deliberately NOT shipped
  $authMap = ClmAuthority::idNameMap($cid);
  each doc row gets:
     ->authority_list = displayNamesList(stored, $authMap)   // ARRAY — safe to count
     ->authority      = displayNames(stored, $authMap)       // display string
  // QC uses `issued_by` instead of `authority`
```
Branch-scoping this loader is what stopped sibling branches' segments leaking into another branch's SELECT SEGMENT dropdown.

### 3.2 Write
```php
store():
  validatePayload():  segment_code, regulatory_status, document_type (REQUIRED),
                      auths[], doc_selections{kyc,dd,tl,qc};   unset doc_selections['td']
  // one rule per (segment_code, document_type) within the caller's scope
  $existing = scoped(segment_code + document_type)->first();  → 409 {existing, rule_code}
  DB::transaction:
     lockForUpdate clients row
     $code = nextRuleCode($clientId)                          // SR-NNN, CLIENT-wide
     [$mand, $opt] = countSelections($doc_selections)         // rolled up for the badges
     create([... 'branch_id' => $user->branch_id, 'segment_id' => resolved from code ...]);
  MasterBundleCache::bump();      // 0 → ≥1 docs makes the segment appear in party pickers

update(): same clash check excluding self → recount → update → bump
destroy(): scoped → hierarchicalDenial → delete → bump
```

### 3.3 Read for the consumer forms
```php
forSegment($segmentId, ?document_type):
  $rule = rules WHERE client_id AND segment_id [AND document_type];
  $resolveCat('kyc', ClmKycDocument::class):
      codes  = array_keys($rule->doc_selections['kyc'] ?? []);
      rows   = Model WHERE client_id AND code IN (codes);
      each → { id, code, name, status, +optional(authority|expiry|validity|title|doc_type|purpose|party),
               authority_list[], authority (names), requirement: 'M'|'O' }
  → always HTTP 200 even with no rule, so AddCustomer/AddConsignee/AddVendor render an empty Stage 2
```

---

## 4. DRAFTING LIBRARIES

### 4.1 Two-tab pattern (`ClmTradeDocumentController`, `ClmAgreementController`, `ClmClauseController`, `ClmTncController`)
```
namesIndex/typesIndex/categoriesIndex → scoped list + `in_use` count
   in_use = COUNT of library rows whose *name string* matches (LOWER(TRIM(...)))
namesUpdate/typesUpdate  → 409 while in_use > 0   (renaming would orphan the drafts)
namesDestroy/typesDestroy→ 409 while in_use > 0
libraryIndex             → scoped list + `is_signed` / `in_use` signature flags
```

### 4.2 The signature locks (`libraryUpdate` / `libraryDestroy`)
```php
// Trade documents — lock only once SIGNED
if (ClmSignatureRequest::hasSignedDraft($cid, $row->id, DOC_TRADE))
    → 422 'already been signed by the customer/consignee'

// Agreements — lock as soon as SENT (inprogress OR completed)
if (ClmSignatureRequest::hasUsedDraft($cid, $row->id, DOC_AGREEMENT))
    → 422 'This agreement is In-use, you cannot edit it.'
```
Both delegate to `hasDraftByStatus()`, which first reads the draft's own `created_at` and requires the signature request to be **at or after** it — the id-reuse guard.

### 4.3 Content edit invalidates the uploaded Word file
```php
if (content changed && $row->docx_path) {
    Storage::disk('public')->delete($row->docx_path);
    $data['docx_path'] = null; $data['docx_original_name'] = null;
}
```
Without this, `downloadDocx()` would keep serving the stale uploaded file because it *prefers* the stored DOCX over regenerating from HTML.

### 4.4 DOCX round-trip (`HandlesDocxHtmlRoundtrip`)
```php
downloadDocx():
  @ini_set('memory_limit','1024M'); @set_time_limit(300);
  if (docx_path exists) return Storage::disk('public')->download(...);   // source of truth after a Word edit
  if (strlen(content) > RENDER_MAX_CHARS) → 422 with the MB/char numbers
  $phpWord = new PhpWord(Calibri 11); $section = addSection();
  applyDocxHeaderFooter($section, header_config, footer_config, $logoAbs);   // logo resolved from
                                                                            // header.logo_path → /storage/ url → client->logo
  $html = normaliseEditorHtml($html);   // <font>, span-bold, div-align → PhpWord-friendly shapes
  $html = toWellFormedHtml($html);      // lenient HTML parse → XHTML (PhpWord uses strict loadXML)
  Html::addHtml($section, '<!DOCTYPE html><html><body>'.$html.'</body></html>', true, false);
  catch → $section->addText(strip_tags($html));                            // last-resort fallback
  IOFactory::createWriter('Word2007')->save($tmp);  → download()->deleteFileAfterSend(true)

uploadDocx():
  validateDocxUpload()   // deliberately NOT `mimes:docx` — a .docx is a ZIP and fileinfo
                         // reports application/zip on many servers; extension + size only
  store to public disk;  read BYTES into a LOCAL temp file (Azure has no readable Storage::path());
  $html = docxToHtml($tmpDocx);
  if (conversion failed || stripped text empty) { delete stored file; 422 with a .doc-specific hint }
  if (strlen > RENDER_MAX_CHARS)             { delete stored file; 422 too-large }
  update(docx_path, docx_original_name, content = $html);

downloadPdf():
  Pdf::loadView('pdf.clm-signature-document', [document, processedHtml, headerConfig, footerConfig,
                headerLogoBase64 (raw base64 — the blade adds the data: prefix), signers: []])
     ->setPaper('a4')->setOption('isPhpEnabled', true);
```

### 4.5 T&C uniqueness (`ClmTncController::findDuplicate`)
```php
isNoteCategory('debit note'|'credit note') → segment/regulatory/party forced to '' (NOT null,
    because ConvertEmptyStringsToNull would let the '?? General'/'?? highly' fallbacks backfill them)
findDuplicate(): same LOWER(TRIM(category)) in the SAME branch, then
    array_intersect(segmentTokens(incoming), segmentTokens(existing))  → any overlap = duplicate → 422
```

### 4.6 Clause "used in a CTC" detection
```php
ctcHaystacks($cid): every CtcContract's `content` + every saved `versions[].content`, lower-cased
clauseNeedle($name): mb_strtolower('<h3>' . e($name) . '</h3>')     // how ClmClauseInsertPanel inserts it
libraryIndex → in_use flag;  libraryDestroy → 409 when the needle is found
```
Best-effort by design: clauses are **copied**, not linked.

---

## 5. SEND FOR SIGNATURE (`ClmSignatureController::send`)

```php
guard: Zoho configured?                                    → 503
validate: trade_doc_ids[]|agreement_ids[] (max 10, mutually exclusive), party_id,
          model_name ∈ {Customer,Consignee,Vendor}, lead_id?, signers[] (1..5, email+name+order+role),
          expiry_days 1..90, is_sequential?, notes?, document_settings{}, *_overrides{}, purchase_order_id?

$party = loadParty()                                        // scoped ->forUser($user)->findOrFail
$docs  = library rows keyed by id;  $orderedDocs = user's chosen order preserved
if (agreement) $a->name = $a->title;                        // alias for the shared renderer

// same-party constraint
normaliseParty($p) = tokens of {buyer, consignee} only, unique, sorted, imploded
if (distinct party keys > 1)                                → 422 "…same applicable party…"

// dedupe signers by lowercase email, keep first occurrence

try {
  1.  foreach ($orderedDocs) renderPdf(doc, party, modelName, uuid, signers,
                                       header/footer/content override for THIS doc id, lead)
                              → temp PDF on disk
  1b. optional Purchase Order → SalesPdfController::renderPoPdfBytes() as one extra document,
      keyed 'po' in document_settings
  2.  build Zoho body: request_name, is_sequential, expiration_days (min 90),
      notes, actions[] {recipient_email, recipient_name, action_type SIGN, signing_order, verify_recipient:false}
  3.  $createResp = zoho->createRequestMultipart($tempPaths, $filenames, $requestBody)
      → requests.request_id  (throw if absent)
  4.  $details = zoho->getRequest($id)  → actions[] (action_ids) + document_ids[]
      tag each Zoho action with `cbc_role` by matching recipient_email → our signer's role
  5.  $perDocCoords = mapClientCoordsToZohoDocIds(document_settings, cbcDocIdsOrdered, zohoDocsOrdered)
      zoho->submitWithFields($id, $zohoActions, $zohoDocumentIds, $perDocCoords)
  6.  sleep(1); re-getRequest → finalStatus (Zoho lags flipping draft → inprogress)
  7.  persist ClmSignatureRequest {document_type, lead_id, trade_doc_id + trade_doc_ids,
        document_names, zoho_document_ids, model_name, party_id, zoho_request_id,
        status, signers, expiry_date, metadata{sent_at, document_settings, request_uuid,
        purchase_order_id/code, party snapshot}}
      bundled PO → PurchaseOrder.status = 'Sent for Sign'
} catch  → Log::error + 500 with cleanSendError($e, …)      // raw Zoho JSON never reaches the UI
finally  → @unlink every temp PDF
```

**Placeholder resolution** happens inside `renderPdf()` → `replacePlaceholders()` → `replacePartyNamespaceTokens()` (`{{customer.*}}`, `{{consignee.*}}`, `{{vendor.*}}`, `{{org.*}}`) and `expandProductTable()` / `fillProductTokens()` for the `{{product.*}}` row template, resolved against the lead's `LeadProduct` rows.

---

## 6. STATUS SYNC (`index?sync=true` and `show`)

```php
index():
  // same-as-customer read-through: a Consignee flagged same_as_customer swaps its
  // (party_id, model_name) filter to the parent Customer's before any where() runs
  $q = ClmSignatureRequest::forUser($user, branch_id)->latest();
  filters: party_id · model_name · document_type · lead_id · status[]   → limit(200)

  if (?sync=true && zoho configured):
     foreach rows where status=='inprogress' OR (status=='completed' && no signed_document_paths):
        $details = zoho->getRequest($row->zoho_request_id);
        syncSignerActivity($row, $details);                    // per-signer Viewed / Signed timestamps
        newStatus = requests.request_status;
        if changed → save (+ completed_at on first completion)
        if declined|rejected|recalled → stampDeclineFromZoho()  // who / why / when
        if completed && still no files → fetchSignedArtifacts()  // per-doc PDF + certificate
     if anything changed → re-run the query

  transform(): resolve every stored path through file_url() (Azure vs local);
     if completed but signed_document_paths empty → adoptSignedDocsFromDisk()
        (list the party's signed_documents folder, match by the `signed_<slug>_<ts>_<i>.pdf` naming,
         newest per doc — READ-time only, never persisted, so a later Zoho retry stays authoritative)
     signed_document_url NEVER falls back to certificate_url — they are different artifacts
```

`remind()` bumps `reminder_count` + `last_reminder_sent_at`; `recall()` stores `recalled_at` + `recall_reason`; `downloadFile`/`viewFile` stream through `streamSignedFile()` by array index.

---

## 7. EVIDENCE VAULT (`SegmentDocUploadController`)

```php
resolveOwner($type, $id, $action)      // 'customer'|'consignee'|'vendor' → scoped model
resolveDocType($owner, $type)          // party's country India ⇒ 'domestic' else 'international'
resolveSegmentIds($owner, $type, $cid) // party's segment CSV/ids → clm_segments ids
resolveScopeCustomer()                 // a consignee's checklist scopes to the LEAD customer's segment,
                                       // not its cross-customer union
index/summary:  rule doc_selections → required docs → join uploads → X of Y
store:          one file per (owner, category, doc_code); re-upload REPLACES (unique constraint),
                snapshots doc_name + requirement at upload time
vault:          the big drill-down — buildShipmentAgreements() / buildVendorDeals() /
                applicableShipmentDocs() overlay live ClmSignatureRequest status per document row
missingMandatoryDocs(): the gate other modules call before allowing a downstream action
```

---

## 8. CASE-TO-CASE LIFECYCLE (`CtcContractController`)

```php
store():
  assertCounterpartyCategories()   // Customer & Consignee must BOTH be India or BOTH not → 422
  approvers[] normalised to {name, email(lower), role, mandatory, status:'pending', acted_at:null}
  DB::transaction: lockForUpdate clients;
     seq = CtcContract::withTrashed()->where(client)->where(branch|null)->count() + 1
     code = 'CTC-%03d'
     versions = [ v1 'Agreement drafted & submitted for internal review' / 'Under Review' ]
     stage = 2, approval_status = 'pending', status = 'inprogress', submitted_at = now()
  broadcastApproval()              // deferred to app()->terminating() → CtcApprovalUpdated

approve():
  match caller's email in approvers[] (fallback: primary_approver_email → slot 0) else 403
  stamp {status:'approved', acted_at: now()->format('d M Y H:i')}
  if (approved >= total) { approval_status='approved'; pushVersion('Approved by all N approvers','Approved') }
  else                   { approval_status='pending';  pushVersion('X approved (n of N)…','Approving') }
                            // 'Approving' is deliberately NOT a round status so
                            // approvalRoundsShaped() doesn't close the round early

reject():   stamp this approver 'rejected'; approval_status='rejected'; status stays 'inprogress'
            (the sender may revise & resubmit); pushVersion with the reason
clarify():  append {query, by, date, response:'', resolved:false}; approval_status='clarification'
respond():  fill the newest empty response + response_date (distinct from the query's date)
resubmit(): re-enter Stage 2; clears any live signing request; label differs when the counterparty declined

sendForSigning():   requires approval_status==='approved' → recipients[], days_to_sign, stage=3
recordSignature():  mark one (index|email) or all recipients signed; all signed → cp_signed_date + version
moveToRepository(): requires every recipient signed → stage=4, status='signed'

listStatus(): approval_status==='rejected' → 'rejected'
              stage>=4 || status==='signed' → 'signed'
              else 'inprogress'
```

**Time handling:** version/clarification/approver stamps are written with `now()->format('d M Y H:i')` in **UTC** and converted on read by `CtcAuditTime::str()` / `::entries()`. `ClmSignatureController::ctcSignatureStatus()` feeds the *same* Review Timeline, so it must mirror `show()` exactly — when each controller kept its own copy the timeline shifted by 5:30 depending on which endpoint the SPA polled (CBC-574).

**Counterparty resolution:** `resolveCounterparties()` re-reads each stored counterparty against its live Customer/Consignee/Vendor row by `source_type` + `source_id`, overlaying only the factual fields (name, country, phone, email) and preserving the user's `referred` alias and `badge`. `resolvePartyRow()` falls back numeric PK → code column → the digits inside a `PREFIX-NNN` display code.

---

## 9. OVERSIGHT AGGREGATION

```php
ClmBuyerProfileController::index()
  1. segments → name→id, id→regulatory
  2. rules keyed [segment_id][document_type] → doc_selections;
     selForSeg(sid, docType) falls back to the segment's OTHER type when the match is missing
  3. segment_doc_uploads grouped "Type#id" → set of "cat::code"
  4. active agreements + active trade docs matched per segment by regulatory tier AND
     csvHasToken(segment CSV, segment name|code)
  5. completed signature requests indexed by party and by lead
  6. rows built for buyers, consignees, ws_eq, ws_neq, wos_eq, wos_neq
     (ws_* = a ShipmentOrder exists for the lead; buyer==consignee decides eq vs neq)

ClmSupplierProfileController::index()  → ws_mat, ws_logi, wos_svc, wos_mat, wos_logi + txn_* variants

ClmDiagnosisResolutionController::index($req, $buyer, $supplier)
  → { buyer: buyerData, supplier: supplierData, ctc: ctcRows() }
    // both profile controllers are METHOD-INJECTED and called directly — tenant scoping is
    // inherited, and there is no duplicated aggregation to drift
escalate() → validate + Log::info only (no escalation store yet) → 200 ack

ClmRegulatoryDefenseFileController::index()
  withShipment($buyer, $cid)  // each buyer shipment row × every procurement under its lead
                              // × every vendor supplying a product in that procurement
  withoutShipment($supplier)  // procurement-wise supplier records + compliance
  caseToCase($cid)            // per-deal agreements mapped to counterparties
```

---

## 10. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `MasterVisibility::applyReadScope` + `hierarchicalDenial` | every CLM controller | One place decides who sees / mutates what |
| `clm_` prefix ⇒ branch-shared reads for employees | `applyReadScope` | The whole CLM team works off one branch catalogue |
| Authority stored by **id**, resolved on read | KYC/DD/TL/QC | Renames propagate with zero cascade |
| `displayNamesList()` (array) vs `displayNames()` (string) | DCP + doc lists | Authority names contain commas — never re-split the joined string |
| `nextCode` = MAX+1 then skip-taken, under a client row lock | all masters | Deletes leave gaps; `count()+1` would collide with the composite unique |
| `MasterBundleCache::bump()` | segment + rule writes | The picker bundle is cached per user for 5 min |
| `Schema::hasTable/hasColumn` guards | every usage check | The endpoint must not crash on an environment that skipped a migration |
| 409 + `used_in[]` on delete | every master | The UI disables the button *and* the server refuses |
| `hasSignedDraft` / `hasUsedDraft` id-reuse guard | library locks | Re-seeded libraries restart ids and would collide with stale requests |
| `file_url()` on every stored path | signatures, uploads | Local disk vs Azure Blob is invisible to the SPA |
| `cleanSendError()` | signature send paths | Raw Zoho JSON must never reach the user |
| `RENDER_MAX_CHARS` + raised memory/time | every PDF/DOCX path | Clean 422 instead of a worker OOM |
| `CtcAuditTime` | CTC + ctcSignatureStatus | One timezone conversion, two endpoints, one timeline |

---

## 11. NOTES & CAVEATS

- **DB is PostgreSQL** — `ilike`, `whereJsonContains`, no MySQL-only syntax.
- `SR-NNN` is the only CLM code that is **not** branch-scoped.
- `usageCheck()` in KYC/DD/TL is **not** client-scoped; QC's is. Since codes repeat per tenant, the unscoped versions can over-report "in use" and wrongly block a delete.
- The `td` category was stripped from the DCP (`2026_06_09_000010_strip_trade_documents_from_clm_segment_rules`); `validatePayload()` still `unset()`s it defensively for old clients.
- Clause and trade-doc-name "in use" checks are **string** matches, not FKs.
- CLM Analytics still carries a mock dataset (`clmAnalyticsData.ts`) beside the live hook (`useClmAnalyticsData.ts`).
- `escalate()` persists nothing beyond a log line.

---

*Related documents: CLM_FUNCTIONAL_DOCUMENTATION.md · CLM_TECHNICAL_DOCUMENTATION.md · CLM_API_DOCUMENTATION.md*
