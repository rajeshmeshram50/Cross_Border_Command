# E-SIGNATURE (ZOHO SIGN) — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → **E-signature** (cross-cutting)
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces the send in its seven numbered steps, then status sync, artefact recovery, the lock helpers and the CTC variant.
Files: [ClmSignatureController.php](../../../app/Http/Controllers/Api/ClmSignatureController.php) (~3,300 lines), [ZohoSignService.php](../../../app/Services/ZohoSignService.php), [ClmSignatureRequest.php](../../../app/Models/ClmSignatureRequest.php).

---

## 1. CONSTRUCTOR — directories first

```php
public function __construct(private ZohoSignService $zoho)
{
    $this->ensureTempDir();       // storage/app/temp
    $this->ensureStorageDirs();   // uploads/signed_documents/{customer,consignee,vendor}
}
```
Both run on every instantiation so a fresh deployment never fails mid-send on a missing directory.

---

## 2. PREVIEW (`preview`)

```php
$data = validate([
    'trade_doc_id' => 'required_without:agreement_id|exists:clm_trade_doc_library,id',
    'agreement_id' => 'required_without:trade_doc_id|exists:clm_agreement_library,id',
    'party_id'     => 'required|integer',
    'model_name'   => 'nullable|in:Customer,Consignee,Vendor',
    /* Per-render overrides for the page-shell zones. When the Send-for-Signature modal
     * lets the user tweak the header / footer / body inline, the SPA POSTs the
     * in-progress config here so the preview reflects the edit before they hit Send.
     * The saved row is NOT mutated by this path. */
    'header_config_override' => 'nullable|array',
    'footer_config_override' => 'nullable|array',
    'content_override'       => 'nullable|string',
    // Opportunity scope — lets the {{product.*}} table resolve against the lead's
    // products in the preview. Omitted for standalone vault previews.
    'lead_id' => 'nullable|exists:leads,id',
]);

$doc = agreement
    ? tap(ClmAgreementLibrary::…findOrFail(), fn($a) => $a->name = $a->title)  // alias title→name
    : ClmTradeDocLibrary::…findOrFail();
$party = $this->loadParty($modelName, $party_id, $user);   // scoped ->forUser($user)->findOrFail

return response($pdf->output(), 200, [
    'Content-Type'        => 'application/pdf',
    'Content-Disposition' => 'inline; filename="preview-…"',
    'Cache-Control'       => 'no-store',
]);
```

The `tap()` alias matters: agreements name their heading `title`, trade documents name it `name`, and the shared renderer expects `name`.

---

## 3. SEND (`send`) — the seven steps

```php
if (!$this->zoho->isConfigured())
    → 503 'Zoho Sign is not configured. Contact your administrator.'

validate([ trade_doc_ids[]|agreement_ids[] (max 10, mutually exclusive),
           party_id, model_name in {Customer,Consignee,Vendor}, lead_id?,
           signers[] (1..5: email, name, order?, role?),
           expiry_days 1..90, is_sequential?, notes?,
           document_settings{}, header/footer/content_overrides{},
           purchase_order_id? ]);
```

### Guard A — the same-party constraint
```php
/* A single signature request must not mix a Buyer-only document with a Consignee-only
 * or a Buyer+Consignee document: the signer set is tied to the document's applicable
 * party, so a mixed bundle would route the wrong papers to the wrong parties. Each
 * doc's `party` CSV is reduced to just its signer-bearing tokens (Buyer / Consignee —
 * Supplier-* and any others don't change who signs) and they must all collapse to the
 * same key. */
$normaliseParty = fn(?string $p) => tokens of {buyer, consignee} only, unique, sorted, imploded;
if ($orderedDocs->map($normaliseParty)->unique()->count() > 1)
    → 422 'A single signature request can only contain documents for the same
           applicable party. Found a mix of: … Send each party group separately.'
```

### Guard B — collapse duplicate signers
```php
/* A single person (same email) must appear only ONCE. Collapse any duplicate signers so
 * Zoho isn't sent the same recipient multiple times (which created multiple signature
 * actions for one person). Keep the first occurrence, preserving order/signing position. */
$data['signers'] = collect($data['signers'])->filter(unique by lowercased email)->values()->all();
```

### Step 1 — render each draft to a temp PDF
```php
foreach ($orderedDocs as $doc) {                       // the USER'S order, not DB order
    $docKey = (string) $doc->id;
    $pdf = $this->renderPdf($doc, $party, $modelName, $requestUuid, $data['signers'],
                            $headerByDoc[$docKey]  ?? null,     // per-doc overrides…
                            $footerByDoc[$docKey]  ?? null,
                            $contentByDoc[$docKey] ?? null,     // …never mutate the row
                            $lead);
    $tmp = storage_path('app/temp/'.Str::uuid().'.pdf');
    file_put_contents($tmp, $pdf->output());
    $tempPaths[]    = $tmp;
    $localDocMeta[] = ['id'=>$doc->id, 'document_name'=>"{$doc->code} {$doc->name}"];
}
```

### Step 1b — optionally bundle a Purchase Order
```php
/* The PO is a generated PDF (not a CLM library doc), so it rides alongside the trade
 * docs as one extra document in the same Zoho request. Its dragged signature box
 * arrives in document_settings under the reserved key "po". */
$poPdfBytes = app(SalesPdfController::class)->renderPoPdfBytes($poDoc, true, $poVendor);
$localDocMeta[] = ['id'=>'po', 'document_name'=>'Purchase Order '.$poDoc->code];
```

### Step 2 — build the Zoho body
```php
$expiryDays = min(90, max(1, $data['expiry_days'] ?? 30));   // Zoho caps expiration_days
                                                             // at TWO DIGITS
foreach ($data['signers'] as $i => $s)
    $actions[] = ['recipient_email'=>…, 'recipient_name'=>…, 'action_type'=>'SIGN',
                  'signing_order'=>$s['order'] ?? $i+1, 'verify_recipient'=>false];

$requestName = count > 1
    ? 'Multiple Documents: '.first three names.(count>3 ? '…' : '')
    : (string) $orderedDocs->first()->name;
```

### Step 3 — create (multipart: JSON + N PDFs)
```php
$createResp    = $this->zoho->createRequestMultipart($tempPaths, $filenames, $requestBody);
$zohoRequestId = data_get($createResp, 'requests.request_id')
    ?? throw new RuntimeException('Zoho create-request did not return a request_id: …');
```

### Step 4 — read back ids, tag each action with its role
```php
$details         = $this->zoho->getRequest($zohoRequestId);
$zohoActions     = data_get($details, 'requests.actions', []);
$zohoDocumentIds = data_get($details, 'requests.document_ids', []);

/* Tag each Zoho action with its CBC signer role (buyer / consignee) by matching its
 * recipient_email against the resolved signers. On a Buyer+Consignee trade document
 * submitWithFields uses `cbc_role` to place each signer's signature box at the position
 * the user dragged for THAT role — instead of both signers sharing one coord and
 * visually stacking. Single-signer sends carry no role and fall back to the flat shape. */
foreach ($zohoActions as &$a)
    if ($match = $signersByEmail->get(strtolower($a['recipient_email'] ?? '')))
        if (!empty($match['role'])) $a['cbc_role'] = $match['role'];
```

### Step 5 — map coordinates and submit
```php
/* document_settings is keyed by trade_doc_id; its value is either a flat
 * {x,y,page,width,height} (single signer) or a per-role map {buyer:{…},consignee:{…}}.
 * Both shapes pass straight through — submitWithFields resolves the role.
 * cbc doc-id order MUST mirror $tempPaths order (CLM docs, then the bundled PO under
 * key 'po') so coords align to the right Zoho doc. */
$cbcDocIdsOrdered = $orderedDocs->pluck('id')->all();
if ($poDoc) $cbcDocIdsOrdered[] = 'po';
$perDocCoords = $this->mapClientCoordsToZohoDocIds($data['document_settings'] ?? [],
                                                   $cbcDocIdsOrdered, $zohoDocumentIds);
$submitResp = $this->zoho->submitWithFields($zohoRequestId, $zohoActions,
                                            $zohoDocumentIds, $perDocCoords);
```
The positional mapping is why the ordered id list must exactly mirror the temp-PDF write order.

### Step 6 — read back the real status
```php
/* Zoho takes a tick to flip from 'draft' to 'inprogress' so we briefly sleep before
 * re-fetching. */
sleep(1);
$finalStatus = strtolower(data_get($this->zoho->getRequest($zohoRequestId),
                                   'requests.request_status', 'inprogress'));
// on failure: log a warning and assume 'inprogress'
```

### Step 7 — persist
```php
$sigReq->document_type     = $isAgreement ? DOC_AGREEMENT : DOC_TRADE;
$sigReq->lead_id           = $data['lead_id'] ?? null;      // without it the Sales-Matrix
                                                            // poll can't find the request
$sigReq->trade_doc_id      = $orderedDocs->first()->id;     // legacy single pointer
$sigReq->trade_doc_ids     = all ids;                       // populated even for 1 doc
$sigReq->zoho_document_ids = …;
$sigReq->status            = $finalStatus;
$sigReq->expiry_date       = now()->addDays($expiryDays);
$sigReq->metadata          = ['sent_at', 'is_multi_document', 'document_ids',
                              'document_names', 'document_count', 'party' snapshot,
                              'document_settings', 'request_uuid',
                              'purchase_order_id', 'purchase_order_code'];
$sigReq->save();

// a bundled PO is now out for signature too
if ($poDoc) $poDoc->update(['status' => 'Sent for Sign']);
```

### The error and cleanup contract
```php
} catch (\Throwable $e) {
    Log::error('CLM signature send failed', [… 'request' => $request->except(['signers'])]);
    return response()->json(['status'=>false,
        'message'=>$this->cleanSendError($e, 'Failed to send documents')], 500);
} finally {
    foreach ($tempPaths as $p) @unlink($p);       // ALWAYS — success or failure
}
```

```php
/* Turn a raw send-flow exception into a clean, user-facing message. Zoho Sign failures
 * bubble up as "Zoho Sign API error: <raw JSON body>" — that raw third-party payload
 * must NEVER reach the UI (QA #10). */
private function cleanSendError(\Throwable $e, string $fallback): string
{
    if (!str_contains($raw, 'Zoho Sign API error:')) return $fallback.': '.$raw;
    $low = strtolower($zohoMsg.' '.$body);
    if (str_contains($low,'already') || 'processed' || 'signed' || 'completed'
        || 'in progress' || 'duplicate')
        return 'This document has already been signed or is being processed in another
                tab or session. Refresh the page to see its current status.';
    return $zohoMsg !== ''
        ? 'The e-signature service could not process this request: '.$zohoMsg
        : 'The e-signature service could not process this request right now. Please try
           again in a moment.';
}
```

---

## 4. STATUS SYNC (`index`)

### The same-as-customer read-through
```php
/* A consignee flagged `same_as_customer = true` has no signature requests of its own —
 * its Stage 3 Trade Documents tab needs to surface the linked CUSTOMER's signed PDFs
 * (and any inprogress requests) as if they were the consignee's. Swap the
 * (party_id, model_name) filter BEFORE the where() clauses so the rest of the pipeline
 * (status, sync polling, fetchSignedArtifacts) operates uniformly. */
if ($filterModelName === 'Consignee' && $consignee->same_as_customer && $consignee->customer_id) {
    $filterPartyId   = $consignee->customer_id;
    $filterModelName = 'Customer';
}
```

### The query
```php
$q = ClmSignatureRequest::query()->forUser($user, $request->integer('branch_id') ?: null)->latest();
filters: party_id · model_name · document_type · lead_id · status[]
$rows = $q->limit(200)->get();
```
`document_type` scoping is essential: *"Without the filter, the LeadAgreementSendModal poller would pick up trade-doc requests for the same party and try to project them onto agreement rows that happen to share numeric IDs."*

### The polling loop
```php
if ($request->boolean('sync') && $this->zoho->isConfigured()) {
    foreach ($rows as $row) {
        $isInProgress      = $row->status === 'inprogress';
        $isCompletedNoFile = $row->status === 'completed' && empty($row->signed_document_paths);
        if (!$isInProgress && !$isCompletedNoFile) continue;      // only what needs it

        $details = $this->zoho->getRequest($row->zoho_request_id);
        $this->syncSignerActivity($row, $details);                // per-signer Viewed/Signed
        $newStatus = data_get($details, 'requests.request_status', $row->status);
        if ($newStatus !== $row->status) { save (+ completed_at on first completion); }
        if (in_array($newStatus, ['declined','rejected','recalled']))
            $this->stampDeclineFromZoho($row, $details);          // who / why / when
        /* Retry the artifact fetch on EVERY completed-with-no-file pass, not just the
         * status transition. The user's "View/Download stuck disabled" stops as soon as
         * the PDF download succeeds. */
        if ($newStatus === 'completed' && empty($row->fresh()->signed_document_paths))
            $this->fetchSignedArtifacts($row, $details);
    }
    if ($changed) $rows = $q->limit(200)->get();                  // re-read
}
```
Failures are caught per row and logged as a warning — one bad request never fails the list.

### URL resolution + the disk fallback
```php
$rows->transform(function ($row) {
    // resolve every stored path through file_url() — Azure Blob vs local is invisible
    $resolvedMulti = array_map(fn($e) => …file_url($e['path'])…, $row->signed_document_paths);

    /* Disk-scan fallback. When status === 'completed' but signed_document_paths is empty,
     * the actual signed PDFs frequently DO exist in the signed_documents folder —
     * fetchSignedArtifacts wrote them in a prior run but a later partial-fail left the
     * column unset. Rather than fight Zoho for another download, list the folder and
     * match by document-name slug (`signed_<slug>_<ts>_<i>.pdf`). Most-recent file per
     * doc wins. Merged at READ time only — never persisted, so the next successful Zoho
     * retry (a richer payload with zoho_document_id + size) stays authoritative. */
    if (empty($resolvedMulti) && $row->status === 'completed')
        $resolvedMulti = $this->adoptSignedDocsFromDisk($row) ?: $resolvedMulti;

    /* NOTE: the signed-document URLs must NOT fall back to the certificate. The
     * completion certificate is a DIFFERENT artifact (audit trail), exposed separately
     * via `certificate_url`. When the signed PDF hasn't been fetched yet (e.g. the Zoho
     * refresh token lacks the ZohoSign.documents.READ scope), these stay null so the UI
     * shows "signed PDF unavailable" instead of silently serving the certificate as if
     * it were the document. */
    $row->signed_document_url = file_url($row->signed_document_path) ?: $firstSignedFromDisk;
    $row->certificate_url     = file_url($row->certificate_path);
});
```

---

## 5. THE LOCK HELPERS (`ClmSignatureRequest`)

```php
hasSignedDraft($cid,$docId,$docType) → hasDraftByStatus(…, ['completed'])
hasUsedDraft($cid,$docId,$docType)   → hasDraftByStatus(…, ['inprogress','completed'])

private static function hasDraftByStatus($cid, $docId, $docType, array $statuses): bool
{
    /* Guard against draft-id REUSE. A matching request only locks a draft if it was
     * created at/after the draft's own creation. Otherwise an orphaned request left
     * behind by a since-DELETED draft — whose id was later reused by a brand-new draft —
     * would wrongly mark the new draft as locked. (Happens when the library is wiped and
     * re-seeded: ids restart and collide with stale signature requests.) */
    $docCreatedAt = $libModel::where('client_id',$cid)->where('id',$docId)->value('created_at');
    if (!$docCreatedAt) return false;               // draft gone → nothing to lock

    return static::where('client_id',$cid)->where('document_type',$docType)
        ->whereIn('status',$statuses)
        ->where('created_at','>=',$docCreatedAt)     // ← THE GUARD
        ->where(fn($q) => $q->where('trade_doc_id',$docId)
                            ->orWhereJsonContains('trade_doc_ids',$docId))
        ->exists();
}
```
`signedDraftIds()` / `usedDraftIds()` are the batch versions, applying the same guard so a list endpoint can flag every locked row without an N+1.

### Sales-document helpers
```php
hasSignedForDoc($cid,$type,$docId)   // completed → lock the Quotation / PI
hasSentForDoc($cid,$type,$docId)     // inprogress|completed → gates Stage 6:
                                     // "once the PI is out for the customer's signature
                                     //  the deal may advance to Victory — we no longer
                                     //  wait for the signing to finish"
supersedeForDoc($cid,$type,$docId)   // draft|inprogress → 'superseded' + recall_reason
                                     // "Document edited while signature was pending —
                                     //  superseded; re-send required."
                                     // COMPLETED requests are never touched
```

---

## 6. THE CTC VARIANT

```php
ctcPreview / ctcSend       render the contract with the ORG SIGNATURE stamped in
                           (orgSignatureDataUri → branch->signature_url as a data URI,
                            because dompdf can't fetch /storage URLs)
ctcSignatureStatus         polls Zoho AND feeds the CTC Review Timeline
ctcRemindSigning           nudge the counterparty
ctcPushVersion             append a version entry, mirroring CtcContractController
istCtcStr / istCtcEntries  → CtcAuditTime
```

> `ctcSignatureStatus()` feeds the **same** Review Timeline as `CtcContractController::show()`. When each controller kept its own timezone conversion, only one got fixed and the timeline shifted by 5:30 depending on which endpoint the SPA had last polled — hence the shared `CtcAuditTime` helper (CBC-574).

`resolveCtcContent()` strips unresolved `{{…}}` placeholders but **preserves `{{signature}}`**, which the SPA swaps for the sign-here marker.

---

## 7. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| `isConfigured()` gate → 503 | `send` | Fail clearly rather than half-way through |
| Same-party constraint | `send` | Never route the wrong papers to the wrong party |
| Collapse duplicate signer emails | `send` | One person, one signing action |
| Preserve the user's document order | `send` | Coordinates map to Zoho ids **by position** |
| Per-doc overrides that never mutate the row | `send` | The master stays the master |
| `cbc_role` tagging | step 4 | Buyer and Consignee boxes land where each was dragged |
| `sleep(1)` before re-reading status | step 6 | Zoho lags flipping draft → inprogress |
| `finally { @unlink }` | `send` | Temp PDFs never leak |
| `cleanSendError()` | every send path | Raw third-party JSON must never reach the UI |
| Sync only what needs it | `index` | `inprogress`, or `completed` with no files |
| Retry artefacts on every pass | `index` | Transient Zoho download failures self-heal |
| Read-time disk fallback, never persisted | `adoptSignedDocsFromDisk` | A later richer Zoho payload stays authoritative |
| Signed URL never falls back to the certificate | `index` | They are different artefacts |
| Id-reuse guard on every lock check | `ClmSignatureRequest` | Re-seeded libraries must not re-lock fresh rows |
| `CtcAuditTime` shared | `ctcSignatureStatus` | Two endpoints, one timeline |

---

## 8. NOTES & CAVEATS

- **No webhook** — status is polled via `?sync=true`.
- `expiration_days` is clamped to ≤ 90 because Zoho caps it at two digits.
- The list is capped at **200 rows**.
- `document_settings` keys must match the ordered document ids exactly, including the reserved `"po"` key for a bundled Purchase Order.
- Trade documents lock on **completed**; agreements lock on **sent** — so a trade-document draft stays editable while its signature is in flight.
- A consignee flagged `same_as_customer` reads through to the parent customer's requests.
- Sandbox mode appends a note to the success message: signer emails are only delivered to Zoho Sign users on the same org.
- `RENDER_MAX_CHARS` (1,000,000) guards every render; memory is raised to 1 GB with `set_time_limit(300)`.
- DB is PostgreSQL; `trade_doc_ids`, `signers`, `signed_document_paths` and `metadata` are real JSON columns.

---

*Related documents: E_SIGNATURE_FUNCTIONAL_DOCUMENTATION.md · E_SIGNATURE_TECHNICAL_DOCUMENTATION.md · E_SIGNATURE_API_DOCUMENTATION.md*
