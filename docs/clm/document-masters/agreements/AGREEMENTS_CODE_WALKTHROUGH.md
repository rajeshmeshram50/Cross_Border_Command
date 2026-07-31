# AGREEMENTS — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Contract & Document Masters → **Agreements**
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: Types tab → Library tab (the **in-use** lock) → `applicableForLead()` (the Sales-Matrix feed) → party filtering → files → code allocation.
File: [ClmAgreementController.php](../../../../app/Http/Controllers/Api/ClmAgreementController.php).

---

## 1. TYPES TAB

```php
typesIndex():   scoped list + in_use count (library rows matching this type NAME)
typesStore():
    validate(['name'=>'required|max:255', 'description'=>'required|max:500']);
    // Reject duplicate names within the creator's own scope (case-insensitive).
    // Scoped via MasterVisibility so the same name can exist in different branches.
    $dupQuery = ClmAgreementType::query()->whereRaw('LOWER(name) = ?', [mb_strtolower($name)]);
    MasterVisibility::applyReadScope($dupQuery, $user, $user->branch_id ?: null);
    if ($dupQuery->exists()) → 409 'An agreement type named "…" already exists.'

    DB::transaction(function () {
        DB::table('clients')->lockForUpdate();
        $code = $this->nextCode(ClmAgreementType::class, $cid, $bid, 'AT-');
        return ClmAgreementType::create([... 'branch_id'=>$user->branch_id, 'code'=>$code ...]);
    });
typesUpdate()/typesDestroy():  scoped firstOrFail → hierarchicalDenial → …
```

---

## 2. LIBRARY TAB

### `libraryIndex()` — **two** derived flags
```php
$libQuery = ClmAgreementLibrary::query()->orderBy('id');
MasterVisibility::applyReadScope($libQuery, $user, $branchFilter);
$rows = $libQuery->get();

/* Flag agreements the frontend must lock Edit / Delete on:
 *  · is_signed → a COMPLETED signature exists (fully signed).
 *  · in_use    → SENT for signature at least once (in-progress OR completed) —
 *                editing/deleting would desync what was already sent, so it's
 *                blocked with a toaster.
 * Batch lookups avoid an N+1 of per-row existence checks. */
$signedIds = ClmSignatureRequest::signedDraftIds($user->client_id, DOC_AGREEMENT);
$usedIds   = ClmSignatureRequest::usedDraftIds($user->client_id, DOC_AGREEMENT);
$rows->each(function ($r) use ($signedIds,$usedIds) {
    $r->setAttribute('is_signed', in_array((int)$r->id, $signedIds, true));
    $r->setAttribute('in_use',    in_array((int)$r->id, $usedIds,   true));
});
```

### `libraryStore()`
```php
$data = validate([
    'agreement_type'=>'required|max:255',   // the TYPE name string
    'title'=>'required|max:255',  'purpose'=>'nullable|max:1000',
    'party'=>'required|max:255',            // CSV: Buyer / Consignee / Supplier-*
    'regulatory'=>Rule::in(REG_VALUES),     // highly | less
    'signing'=>'nullable|boolean',
    'segment'=>'nullable|max:1024',         // CSV of segment names/codes
    'agr_status'=>'nullable|max:32',
    'content'=>'nullable|string',
    'header_config'=>'nullable|array', 'footer_config'=>'nullable|array',
]);

DB::transaction(function () {
    DB::table('clients')->lockForUpdate();
    $code = $this->nextCode(ClmAgreementLibrary::class, $cid, $bid, 'A-');
    return ClmAgreementLibrary::create([
        …,
        'regulatory' => $data['regulatory'] ?? REG_LESS,     // default: less
        'signing'    => $data['signing']    ?? true,         // default: REQUIRES signature
        'agr_status' => $data['agr_status'] ?? 'Active',     // default: offerable
    ]);
});
```

### `libraryUpdate()` — the **in-use** lock (stricter than trade documents)
```php
scoped firstOrFail → hierarchicalDenial('edit') → 403
// "Branch users may view shared client-level agreements but not edit them."

// Lock once the agreement is IN USE — i.e. it has been sent for signature at least
// once (still in-progress OR already signed). Editing it would silently diverge the
// master from the copy that was already sent to / signed by the customer/consignee.
if (ClmSignatureRequest::hasUsedDraft($user->client_id, (int)$row->id, DOC_AGREEMENT))
    → 422 'This agreement is In-use, you cannot edit it.'

$data = validate([...same fields, all `sometimes`...]);

// Same docx invalidation as the trade-document library: downloadDocx() PREFERS the
// stored file, so an edited body would otherwise keep serving the OLD document.
if (content changed) { delete docx_path from disk; docx_path = null; docx_original_name = null; }
$row->update($data);
```

`libraryDestroy()` applies the **same** `hasUsedDraft` check → *'This agreement is In-use, you cannot delete it.'*

| Master | Lock statuses |
|---|---|
| Trade Document | `completed` only |
| **Agreement** | `inprogress` **or** `completed` |

---

## 3. THE SALES-MATRIX FEED (`applicableForLead`)

```php
/* GET /api/clm/leads/{leadId}/agreement-applicable
 *
 * Drives the Sales Matrix lead detail "Segment Details" card. Given a lead, walks its
 * latest non-cancelled Proforma Invoice → line-item product IDs → product.segment_id →
 * clm_segments. For each segment, pulls the matching agreement-library rows (filtered
 * by segment name + regulatory tier), grouped so the frontend can render High / Less
 * popups directly. Also surfaces existing clm_signature_requests so each row shows its
 * current send status. */

$lead = Lead::where('client_id',$cid)->findOrFail($leadId);

// Stage 5 = "Quotation vs PI". Stage 5 complete ⇒ the lead moved to stage 6+ (Victory).
// The Send button on the card stays disabled until then.
$stage5Complete = (int)($lead->lead_stage_id ?? 1) >= 6;

// PI preferred; Quotation is the fallback so Segment Details populates as soon as
// products are QUOTED, not only after PI conversion. Cancelled rows never count.
$pi        = ProformaInvoice::where(client)->where('opp_id',$lead->id)
                ->where('status','!=','cancelled')->orderByDesc('id')->first();
$quotation = Quotation::where(client)->where('opp_id',$lead->id)
                ->where('status','!=','cancelled')->orderByDesc('id')->first();
$source    = $pi ?: $quotation;

$productIds = $source?->items()->whereNotNull('product_id')->pluck('product_id')->unique();
$segmentIds = Product::where(client)->whereIn('id',$productIds)
                ->whereNotNull('segment_id')->pluck('segment_id')->unique();
//              ^ soft FK (no DB constraint per the products migration) — missing refs tolerated
$segments   = ClmSegment::where(client)->whereIn('id',$segmentIds)
                ->orderBy('regulatory_status')->orderBy('code')->get();
```

### Indexing the existing signature requests
```php
// AGREEMENT sends for this lead → "agreement_id => most recent row" in O(1)
$sigRows = ClmSignatureRequest::where(client)
    ->where('document_type', DOC_AGREEMENT)->where('lead_id',$lead->id)
    ->whereNull('deleted_at')->orderByDesc('id')->get();
foreach ($sigRows as $r)
    foreach ((array)$r->trade_doc_ids as $aid)
        $latestPerAgreement[$aid] ??= $r;          // first wins — the list is id DESC

// TRADE-DOCUMENT sends for this lead, keyed by trade-doc-library id, so each trade-doc
// row can surface Sent/Signed, the Remind button + count, and the signed-PDF /
// certificate download links — exactly like the agreement rows.
$latestPerTradeDoc[...] = same shape, falling back to the scalar `trade_doc_id`
                          when `trade_doc_ids` is empty (legacy single-doc rows)
```

### Parties (resolved BEFORE the segment loop)
```php
$customer  = Customer::with('primaryAddress')->find($lead->customer_id);
$consignee = Consignee::with('primaryAddress')->find($lead->consignee_id);
// primaryAddress eager-loaded because COUNTRY lives on customer_addresses /
// consignee_addresses, not on the party row itself
$partyOwners = [['party'=>'customer','model'=>$customer], ['party'=>'consignee','model'=>$consignee]];

// Buyer == Consignee when there's no distinct consignee, or it's flagged same_as_customer.
// Drives the Trade Documents popup: equal ⇒ one flat list; different ⇒ Buyer/Consignee/Both tabs.
$buyerEqualsConsignee = !$consignee || (bool)($consignee->same_as_customer ?? false);
```

### The per-segment match
```php
foreach ($segments as $seg) {
    $name = $seg->name;  $code = $seg->code;
    $agreements = ClmAgreementLibrary::where('client_id',$cid)
        ->where('regulatory', $seg->regulatory_status)        // ← TIER must match exactly
        ->where(function ($q) use ($name,$code) {
            foreach ([$name,$code] as $needle) {
                /* Less-reg agreements can be saved against MULTIPLE segments (a
                 * comma-separated string), so LIKE-match the needle against the CSV
                 * instead of an equality check. The patterns wrap the needle in comma
                 * separators so "Tobacco" can't accidentally match a row tagged
                 * "Tobacco Stripping", while still hitting first/middle/last/sole
                 * positions in the list. */
                $q->orWhere('segment', $needle)                       // sole
                  ->orWhere('segment','LIKE',$needle.',%')            // first
                  ->orWhere('segment','LIKE',$needle.', %')
                  ->orWhere('segment','LIKE','%,'.$needle)            // last
                  ->orWhere('segment','LIKE','%, '.$needle)
                  ->orWhere('segment','LIKE','%,'.$needle.',%')       // middle
                  ->orWhere('segment','LIKE','%, '.$needle.',%');
            }
        })
        ->where('agr_status','Active')                         // only Active rows are offered
        ->orderBy('id')->get()
        // Exclude supplier/other-only agreements — the Sales Matrix only sends to the
        // customer / consignee side.
        ->filter(fn($a) => $this->partyForBuyerConsignee($a->party)[0])
        ->values();
    …
}
```

### Shaping each agreement row
```php
$req = $latestPerAgreement[$a->id] ?? null;
$sigOut = $req ? [
    'id'=>…, 'status'=>…, 'sent_at'=>…, 'completed_at'=>…,
    'signed_url'      => $signedPaths[0]['file_url'] ?? $signedPaths[0]['url'] ?? null,
    'certificate_url' => $req->certificate_path ? file_url($req->certificate_path) : null,
    // Reminder counter + last-sent timestamp drive the "Sent N times" badge on Remind.
    'reminder_count'=>…, 'last_reminder_sent_at'=>…,
] : null;

return [
  'id','code','title','agreement_type','party','regulatory','segment',
  'required'   => $a->regulatory === 'highly' ? 'REQ' : 'OPT',
  'updated_at' => date,
  'signature_request' => $sigOut,
  /* Send-for-Signature editor seed — body HTML + saved page-shell config so the
   * Edit Header/Footer/Body popup can hydrate without an extra round-trip.
   * Per-row send-time overrides layer over these WITHOUT mutating the saved row. */
  'content','header_config','footer_config',
];
```

### The response envelope
```php
[ 'stage5Complete', 'buyerEqualsConsignee',
  'lead' => [ id, code, customer{id,code,name,email,country,segment},
                        consignee{…} ],
  'pi'        => { id, code, status } | null,
  'quotation' => { id, code, status } | null,
  'totals' => [ 'highly' => ['matched'=>X,'total'=>Y],       // X = segments IN THIS LEAD
                'less'   => ['matched'=>X,'total'=>Y] ],     // Y = active segments in the master
  'segments' => [ { id, code, name, regulatory,
                    agreements: [...],
                    trade_documents: segmentTradeDocs($seg, $cid, $partyOwners, $latestPerTradeDoc) } ] ]
```

---

## 4. PARTY FILTERING (`partyForBuyerConsignee`)

```php
/* Resolve a library row's `party` CSV against the Sales-Matrix context, which only
 * ever deals with the buyer (customer) / consignee side.
 *
 * A row is applicable when its party names Buyer or Consignee. Rows that name only
 * Supplier/other parties (e.g. "Supplier-Material / Goods") are NOT applicable and
 * must be excluded — previously they slipped through because "names neither" fell
 * back to "both". A BLANK party stays universal (applicable to both), preserving the
 * old permissive behaviour for unclassified rows.
 *
 * @return array{0:bool,1:bool,2:bool}  [applicable, forBuyer, forConsignee] */
$tokens       = lowercased, trimmed CSV parts;
$forBuyer     = in_array('buyer', $tokens, true);
$forConsignee = in_array('consignee', $tokens, true);
```

---

## 5. FILES

Identical in shape to the trade-document methods — see that walkthrough for the annotated pipeline. The agreement-specific details:

```php
private const DOCX_MAX_KB       = 20 * 1024;
private const RENDER_MAX_CHARS  = 1000000;   // ~1 MB of HTML

downloadDocx():  prefer $row->docx_path (streamed via Storage disk) → else regenerate:
                 normaliseEditorHtml → toWellFormedHtml → PhpWord Word2007
downloadPdf():   pdf.clm-signature-document blade, base64 header logo, signers: []
uploadDocx():    validateDocxUpload (extension, not MIME) → store → bytes to a LOCAL
                 temp file → docxToHtml → 422 if unreadable/oversized → update content
uploadHeaderLogo():
    $folder = "agreement_library/{$clientSlug}/logos";   // ← agreement-specific folder
    return ['path'=>$path, 'url'=>file_url($path)];      // the shape HeaderFooterPanel expects
```

---

## 6. CODE ALLOCATION (`nextCode`)

```php
// Branch-scoped so each branch restarts at 001 (AT-001 / A-001).
// A client-level creator ($branchId null) sequences the shared rows.
$query = $modelClass::where('client_id',$clientId);
$branchId === null ? $query->whereNull('branch_id') : $query->where('branch_id',$branchId);
$maxN = max over /^{prefix}(\d+)$/;
do { $n++; $code = sprintf('%s%03d', $prefix, $n); } while (isset($taken[$code]));
```

---

## 7. FRONTEND

```tsx
// ClmAgreementsPage.tsx
/* Applicable-party values are STORED as "Buyer" / "Supplier-Material" etc. (the wizard's
   PARTY_* value set) but the user picks — and should see — the friendly labels
   ("Customer", "Material"). Map value → label for the Applicable Party column so it never
   shows "Buyer" instead of "Customer" (CBC-436). Unknown values fall through unchanged. */
const PARTY_LABELS = {
  'Buyer': 'Customer', 'Consignee': 'Consignee',
  'Supplier-Material': 'Material', 'Supplier-Logistic': 'Logistic',
  'Supplier-Tech': 'Tech', 'Supplier-Advisory': 'Advisory',
  'Supplier-Strategic Risk': 'Strategic Risk',
};

type AgrLib = { …, is_signed?: boolean; in_use?: boolean };
row.in_use → Edit + Delete disabled with a toaster explaining why

// ClmAgreementWizardModal.tsx — details → page shell → body editor
// Sales Matrix Segment Details card → GET /clm/leads/{id}/agreement-applicable
```

---

## 8. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Two batched flag lookups (`signedDraftIds` + `usedDraftIds`) | `libraryIndex` | Avoids N+1; `in_use` ⊋ `is_signed` |
| Lock on **sent**, not signed | `libraryUpdate/Destroy` | A contract in a counterparty's inbox must not change |
| Drop `docx_path` when content changes | `libraryUpdate` | Downloads must not serve a stale Word file |
| PI preferred, Quotation fallback | `applicableForLead` | Segment Details populates as soon as products are quoted |
| Comma-boundary CSV `LIKE` | `applicableForLead` | `Tobacco` ≠ `Tobacco Stripping` |
| Tier equality + segment match | `applicableForLead` | Both must hold for an agreement to apply |
| `partyForBuyerConsignee` | `applicableForLead` | Supplier-only rows must not reach the Sales Matrix |
| Blank party = universal | `partyForBuyerConsignee` | Backwards compatibility for unclassified rows |
| Eager-load `primaryAddress` | `applicableForLead` | Country lives on the address table |
| Seed `content` + header/footer in the response | `applicableForLead` | The send modal hydrates without another round-trip |
| Overrides never mutate the saved row | send path | The master stays the master |

---

## 9. NOTES & CAVEATS

- The in-use lock is **stricter than trade documents'** — `inprogress` counts.
- `hasUsedDraft` / `usedDraftIds` include the **id-reuse guard** (a request only locks a template created at or before it).
- Segment matching is string-based; a segment rename is not cascaded into the library (the segment master blocks such renames while referenced).
- `agr_status` is a free string — only the literal `'Active'` is offered on a lead.
- `products.segment_id` is a soft FK; unresolvable references are silently skipped.
- Leads with neither a non-cancelled PI nor Quotation return empty segments and a null signature lookup.
- DB is PostgreSQL.

---

*Related documents: AGREEMENTS_FUNCTIONAL_DOCUMENTATION.md · AGREEMENTS_TECHNICAL_DOCUMENTATION.md · AGREEMENTS_API_DOCUMENTATION.md*
