# CONSIGNEE MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Consignee
> A guided, file-by-file trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT

Follows the Consignee lifecycle **in execution order**. Line numbers reference the live source and may drift; method names are stable. Legend: `→` a call · `⇒` a return.

Primary files:
- `app/Http/Controllers/Api/ConsigneeController.php` (+ `ConsigneeDocumentController`, `ConsigneeOwnerController`)
- `app/Models/Consignee.php` (+ `ConsigneeAddress`, `ConsigneeDocument`, `ConsigneeOwner`)
- `app/Services/ConsigneeKycMirror.php` · `app/Http/Controllers/Api/SegmentDocUploadController.php`
- `resources/js/pages/sales/core-masters/consignee/*` (SPA)

> A Consignee is a **mirror of the Customer**. Where a path is identical to Customer, this doc says so and points at the Customer walkthrough; it focuses on the **Consignee-specific** bits: the customer link, the `same_as_customer` mirror, and `cloneFromCustomer`.

---

## 1. LISTING CONSIGNEES

### 1.1 Frontend: `SalesConsignee.tsx`
```tsx
const load = async () => {
  const res = await api.get('/consignees');   // optionally ?customer_id= from the Map-Consignee modal
  setRows(res.data.data);
};
```
Emerald-themed list; columns include the parent **Customer ID** and the **Same as Customer** flag. Row actions: **Edit**, **Evidence Vault**.

### 1.2 Backend: `ConsigneeController::index()` (21)
```php
$q = Consignee::forUser($request->user());                 // tenant + hierarchical scope
if ($cid = $request->query('customer_id')) $q->where('customer_id', $cid);
if ($s = $request->query('q')) { /* ilike on company/legal/consignee_code/primary_email/segment */ }
return response()->json(['count' => …, 'data' => $rows->map(fn($c) => $this->shapeConsignee($c))]);
```

---

## 2. LOADING THE FORM (Phase A — pick the customer)

The consignee form reuses `GET /customers/master-bundle` (dropdowns) and `GET /customers?tab=all` (the customer picker). "Confirm & Continue" fixes `customer_id` for the rest of the wizard. When reached via **Map Consignee**, `preselectedCustomerId` is locked and `existingMirrorCount` is passed so the one-mirror rule is known up front.

---

## 3. CREATING A CONSIGNEE

### 3.1 Frontend submit (`AddConsigneeModal.tsx`)
Stage 1 auto-persists on advancing to Stage 2 (POST first, PUT after):
```tsx
const body = { customer_id: customer.db_id, company_name, legal_name, segment, …,
               same_as_customer: sameAsCustomer, primary_address: {…}, locations: [ … ] };
const res = editId ? await api.put(`/consignees/${editId}`, body)
                   : await api.post('/consignees', body);
```

### 3.2 Backend: `ConsigneeController::store()` (169) — annotated
```php
public function store(Request $request)
{
    $data  = $this->validatePayload($request);               // uniqueness skipped when same_as_customer
    $owner = $this->resolveOwnership($request->user());       // client_id / branch_id from auth
    $this->assertCustomerInScope($request->user(), $data['customer_id']);   // 404 if not visible
    $this->assertSingleMirrorPerCustomer($data);             // 422 if a mirror already exists

    return DB::transaction(function () use ($request, $data, $owner) {
        DB::table('clients')->where('id', $owner['client_id'])->lockForUpdate()->first();  // serialize
        $code = $this->nextConsigneeCode($owner['client_id']);      // /^CN-0*(\d+)$/, withTrashed()

        $consignee = Consignee::create($data + $owner + [
            'consignee_code' => $code,
            'primary_email'  => $data['primary_address']['cp_email'] ?? null,   // mirror
        ]);
        $consignee->addresses()->create([...$data['primary_address'], 'is_primary' => true]);
        foreach ($data['locations'] ?? [] as $loc)
            $consignee->addresses()->create([...$loc, 'is_primary' => false]);

        return response()->json(['data' => $this->shapeConsignee($consignee->fresh())], 201);
    });
}
```

### 3.3 `validatePayload()` (511) — the mirror carve-out
```php
$mirror = $request->boolean('same_as_customer');
// legal_name / primary_email / primary cp_contact uniqueness apply ONLY when NOT a mirror,
// because a same_as_customer consignee deliberately copies the customer's legal_name/email/phone.
if (!$mirror) { /* legal_name (LOWER, per tenant) · primary_email unique · primary phone unique */ }
// within-consignee dedupe (email/phone across primary + locations) ALWAYS runs.
```
`assertSingleMirrorPerCustomer()` (690) rejects a second `same_as_customer` under the same customer with 422 (`errors.same_as_customer`).

---

## 4. THE "SAME AS CUSTOMER" MIRROR

### 4.1 Frontend (`AddConsigneeModal.tsx`)
- Ticking the toggle copies the customer's Stage-1 fields + address book into the form (guards: one mirror per customer; the toggle locks once you've hand-entered basics on a self-consignee).
- On **Stage 1 → Stage 2** while ticked, the SPA calls:
```tsx
await api.post(`/consignees/${id}/clone-from-customer`, { customer_id: customer.db_id });
```
- Unticking on an **unsaved** consignee clears the preview; on a **saved** one it keeps the values and unlocks the fields.

### 4.2 Backend: `ConsigneeController::cloneFromCustomer()` (337–435)
```php
// deep-clone the customer's Stage-2 KYC into this consignee (replace semantics)
DB::transaction(function () use ($consignee, $customer) {
    // wipe consignee documents/owners + on-disk files
    // copy each customer document → consignee_documents/{id}/cloned-{hex}.{ext}
    // copy each owner's id_proof/address_proof/photograph → owner-clone-{slot}-{hex}.{ext}
});
return response()->json(['message' => 'Cloned from customer.', 'documents' => …, 'owners' => …]);
```

### 4.3 Keeping the mirror in step — `ConsigneeKycMirror`
After the initial clone, **customer-side** edits propagate automatically (no consignee call):
```php
// on customer Stage-1 save  → ConsigneeKycMirror::syncCoreFromCustomer($customer)   [72–115]
//   copies core fields (SKIPS `type`) + replaces the address book.
// on customer doc/owner CRUD → ConsigneeKycMirror::resyncForCustomer($customer)      [40–55]
//   for each Consignee where customer_id=? and same_as_customer=true → resyncOne()   [122–190]
//   (own transaction) wipes + re-copies documents/owners + files.
```
Query: `Consignee::where('customer_id',$id)->where('same_as_customer',true)`.

---

## 5. UPDATING / DELETING

- `update()` (227) — same as `store` plus `SegmentGuard::blockedRemovals()` (422 on removing a segment with uploaded docs), address **replace-all**, and the one-mirror mutex.
- `destroy()` (301) — soft-delete after `hierarchicalDenial`.

---

## 6. KYC STORES (Stage 2)

Identical two-store model to Customer:
- **Segment uploads** (`segment_doc_uploads`, `type='consignee'`) — the vault store, auto-code driven, `POST /segment-uploads/consignee/{id}`.
- **Ad-hoc** — `ConsigneeDocumentController` (`dd`/`tl`) + `ConsigneeOwnerController`, `POST /consignees/{id}/documents|owners`. Each mirrors the Customer controllers.

See the Customer code walkthrough §7 for the reference-vs-live tables and upsert-by-code detail.

---

## 7. EVIDENCE VAULT & THE SAME-AS-CUSTOMER PASS-THROUGH

`GET /segment-uploads/consignee/{id}/vault` builds the read model like the Customer vault, but `SegmentDocUploadController::resolveOwner()` (≈1200–1238) first checks `same_as_customer`:
```
same_as_customer = true:
  · read  (list / vault)  → owner swapped to the PARENT customer; payload has same_as_customer:true
  · write (upload)        → 409 Conflict ("manage uploads on the linked customer instead")
  · shipment matrix       → still keyed on the original consignee id
same_as_customer = false:
  · the consignee's own uploads
```
The SPA overlays live Zoho status on the Trade Documents tab via `GET /clm/signature-requests?party_id=&model_name=Consignee&sync=1`. **"Verified" is display-only** (a file exists); "Signed" comes from a completed request.

---

## 8. THE MODEL LAYER

### 8.1 `Consignee` (`app/Models/Consignee.php`)
```php
class Consignee extends Model {
    use SoftDeletes;
    protected $casts = ['same_as_customer' => 'boolean'];
    public function customer()  { return $this->belongsTo(Customer::class); }
    // addresses() primaryAddress() documents() owners() client() branch() creator()
    public function scopeForUser($q, $user, ?int $branchFilter = null) {
        return MasterVisibility::applyReadScope($q, $user, $branchFilter);
    }
}
```
No `type`, no `gstScrutiny()`. `ConsigneeDocument` exposes `KIND_DD`/`KIND_TL` and appends `attachment_url`; `ConsigneeOwner` appends the three proof URLs.

---

## 9. FRONTEND CODE WALKTHROUGH (SPA)

> The backend trace (§1–8) followed the API; this section follows the React side in execution order.
> Files: `resources/js/pages/sales/core-masters/consignee/` — `SalesConsignee.tsx` (list) · `AddConsigneeModal.tsx` (wizard) · `ConsigneeEvidenceVaultModal.tsx` (vault). Line numbers drift; identifiers are stable.

### 9.1 List page — `SalesConsignee.tsx`
```tsx
// permissions off the user grant
const canView/canEdit/canAdd = perm('sales.consignee');   // no-access banner if !canView
useEffect(() => { fetchRows(); }, []);                     // on mount
const fetchRows = async () => {                            // GET /consignees
  const r = await api.get('/consignees');
  setRows(r.data.data.map(d => ({ id, company, customerId, segment, risk, same_as_customer, … })));
};
requestIdleCallback(() => api.get('/customers/master-bundle'));  // warm the wizard's dropdown cache
```
- **Columns:** Sr · **Consignee ID** · **Customer ID** (parent) · Company · **Segment** (comma-split → "+N more" popover) · **Risk** (Low/Med/High pill) · **Same as Customer** (Yes/No pill) · Contact/Email/Phone · Country · **Actions**.
- **Search** — client-side `filtered` useMemo over company/id/customerId/contact/email/phone/segment/country/risk.
- **Row actions:** **Edit** (`canEdit`) → `setEditing(row); setAddOpen(true)`; **Evidence Vault** → `setVaultTarget({db_id, company, risk, segment, country, contact, customerId})`.
- **Delete** — confirm modal → `DELETE /consignees/{dbId}` → `fetchRows()`.
- **Modals:** `<AddConsigneeModal consignee={editing} onSaved={fetchRows}/>` (null = create); `<ConsigneeEvidenceVaultModal consignee={vaultTarget}/>`. States: ShimmerTable while loading, *"No consignees found"* when empty.

### 9.2 The wizard — `AddConsigneeModal.tsx`
Two phases → **Phase A** pick-customer, **Phase B** a 2-stage wizard (`phase`, `stage`, `maxStage`).

**Phase A — pick the customer**
```tsx
useEffect(() => { if (open) api.get('/customers?tab=all').then(map→customerOptions); }, [open]);
// options carry hasSameAsCustomerConsignees + sameAsCustomerConsigneeCount (the one-mirror hint)
// "Confirm & Continue" → setPhase('wizard'); setStage(1)
```
When opened via **Map Consignee**, `preselectedCustomerId` resolves `customer` up front so the mirror rule is known.

**Stage 1 — Legal Identity** (`form1`, `locations[]`, `errors1`, `sameAsCustomer`)
```tsx
// master dropdowns (session-cached, else fetched)
GET /customers/master-bundle → mSegments/mClassifications/mRiskLevels/mAddressTypes/mCountries/mStates/mDesignations/mDocumentTypes
// segment inherited once from the parent (segPrefillCustomerRef guards against re-adding after edits)
```
*Same-as-Customer toggle* — copies the customer's company/legal/website/segment[]/classification/risk + address + contact into `form1`, then loads the parent's extra addresses **cache-first** (`bundledCustomerLocationsRef` from a prior `/consignees/{id}`) else `GET /customers/{db_id}`. Un-ticking on an **unsaved** consignee wipes `form1`+`locations`; on a **saved** one it keeps values and just unlocks the fields. Per-keystroke `validateField1`; duplicate email/phone across primary + locations is checked live.

**Stage 1 → Stage 2 auto-persist** — `persistStage1()`:
```tsx
const payload = buildPayload();   // customer_id, company_name, legal_name, segment(csv), risk_level, website,
                                  // status:'Active', same_as_customer, primary_address{}, locations[]
const r = editId ? await api.put(`/consignees/${dbId}`, payload)          // PUT if known
                 : await api.post('/consignees', payload);                // else POST → savedDbId
if (sameAsCustomer && customer.db_id)
  await api.post(`/consignees/${id}/clone-from-customer`, { customer_id }); // then refetchKyc(id)
// 422 errors.same_as_customer → toggle off + surface; inFlightRef blocks double-submit; dirtySavedRef fires onSaved on early close
```

**Stage 2 — KYC / Due Diligence** (sub-tabs *Company DD → Owner KYC → Trade Licence*)
```tsx
// template: required/optional docs per segment + party
segments.forEach(s => GET /clm/segment-rules/for-segment/{s});   // merge+dedupe by code, mandatory wins
GET /clm/trade-doc-library/for-party/consignee;                  // → segmentDocs, segCodeMap, tdDocs
// ad-hoc docs/owners:
POST/DELETE /consignees/{dbId}/documents        // KycDocRow (dd/tl)
POST/DELETE /consignees/{dbId}/owners           // KycOwnerRow (id/address/photo proofs)
// segment-rule uploads (the vault store):
POST /segment-uploads/consignee/{dbId}  { category:'dd'|'tl', doc_code, attachment }  // → attachment_url
refetchKyc(id): GET /consignees/{id}/documents · /owners · GET /segment-uploads/consignee/{id}
```

**Final save** — `handleSave()` re-runs `validateStage1()`, then idempotent `PUT /consignees/{db_id ?? savedDbId}` (POST fallback) → toast → `onSaved()` → `onClose()`.

**Edit hydration** — on open with `consignee.db_id`: `GET /consignees/{db_id}` returns the bundle (`data`, `locations`, `documents`, `owners`, `segment_uploads`, **`customer_locations`**) and replays it into `form1`/`locations`/`kycDocs`/`kycOwners`/`segmentRefUploads` + `sameAsCustomer`; `customer_locations` is stashed for the cache-first mirror preview.

### 9.3 Evidence Vault — `ConsigneeEvidenceVaultModal.tsx`
```tsx
useEffect(() => { if (open && db_id && !data)                     // fetch once
  api.get(`/segment-uploads/consignee/${db_id}/vault`)            // → counts + per-bucket docs + shipment matrix
    .catch(() => setData(buildDemoVault(consignee)));             // demo scaffold only if the fetch fails
}, [open]);
api.get(`/clm/signature-requests?party_id=${db_id}&model_name=Consignee&sync=1`);  // Zoho overlay
// signatureRequestsToVaultDocs() → mergeTradeDocuments() overlays Signed/Sent onto Trade Documents; KPIs recomputed
```
- **Tabs:** *Company Due Diligence · Owner KYC · Trade Licenses* (Standard/one-time) and *Trade Documents · Shipment Agreements* (Case-to-Case/per-shipment). **KPI strip:** Total / Verified-Signed / Pending.
- **Row actions:** **View** (open `attachment_url`) · **Download** (`downloadFile`) · **Upload** (non-trade-docs → `POST /segment-uploads/consignee/{id}`, PDF/JPG/PNG only, reload vault) · **Send for Signature** (trade-docs → `SalesCustomerSendForSignatureModal`) · **Remind** (`POST /clm/signature-requests/{id}/remind`) · **Signing Tracker** · **Certificate** (if `certificate_url`).
- **Shipment matrix** (`forceParty="consignee"` hides buyer columns) with per-shipment ratios; **Export All** → an XLSX workbook (Summary + 5 sheets).
- **Same-as-Customer:** the parent's docs simply arrive in the vault payload (the backend `resolveOwner` swap of §7); a direct upload on a mirror returns **409**. **"Verified" is display-only.**

### 9.4 Frontend ↔ backend call map
| User action | Frontend | Backend (see §) |
|---|---|---|
| Open list | `GET /consignees` | §1.2 `index()` |
| Pick customer | `GET /customers?tab=all` | Customer `index` |
| Load dropdowns | `GET /customers/master-bundle` | Customer bundle |
| Mirror preview | `GET /customers/{id}` | Customer `show` |
| Save & Next (Stage 1) | `POST`/`PUT /consignees[/id]` | §3.2 `store()` / §5 `update()` |
| Mirror clone | `POST /consignees/{id}/clone-from-customer` | §4.2 `cloneFromCustomer()` |
| Stage-2 docs/owners | `POST/DELETE /consignees/{id}/documents\|owners` | §6 ad-hoc stores |
| Segment upload | `POST /segment-uploads/consignee/{id}` | §6/§7 vault store |
| Open vault | `GET …/vault` + `GET /clm/signature-requests?model_name=Consignee` | §7 vault + Zoho |

---

## 10. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Parent-scope guard | `assertCustomerInScope()` | Can only link to a visible customer (404) |
| One-mirror mutex | `assertSingleMirrorPerCustomer()` | ≤ 1 `same_as_customer` per customer (422) |
| Mirror carve-out | `validatePayload()` | Skip legal/email/phone uniqueness for mirrors |
| Deep clone | `cloneFromCustomer()` | Copy the customer's KYC + files into the consignee |
| Auto-sync | `ConsigneeKycMirror` | Customer edits propagate to mirror consignees |
| Vault pass-through | `SegmentDocUploadController::resolveOwner` | Mirror reads the customer's docs; uploads blocked (409) |
| Row-locked code | `nextConsigneeCode()` | Race-free `CN-####` per client |
| Replace-all addresses | `store()`/`update()` | Simple correct sync of a variable set |

---

## 11. NOTES & CAVEATS

- **Mirror is one-directional** (Customer → Consignee) and **replace-semantics** — a mirror is always an exact snapshot of the customer's KYC.
- **`type` is intentionally skipped** in `syncCoreFromCustomer` because the consignee table has no `type` column.
- **No GST scrutiny** — there is no `consignee_gst_scrutiny` table/endpoint (would need a new model to add).
- **"Verified" is display-only** (segment upload exists) — no reviewer/approval step; "Signed" = completed Zoho request.
- **Two doc stores** — `segment_doc_uploads` (vault) vs. `consignee_documents`/`consignee_owners` (ad-hoc / mirror clone target).
- **DB is PostgreSQL** — `ilike` search; partial unique index `(client_id, consignee_code) WHERE deleted_at IS NULL`.
- **Vault demo fallback** — `ConsigneeEvidenceVaultModal` renders a `buildDemoVault()` scaffold **only if** `GET …/vault` fails; real uploads come from `segment_doc_uploads`. Don't mistake the demo rows for live data in QA.
- **Segment-rule uploads are manual** — ad-hoc KYC docs/owners auto-persist on save, but the segment-rule (vault) uploads are added by hand via the Evidence Vault / Stage-2 upload cells.

---

*Related documents: CONSIGNEE_TECHNICAL_DOCUMENTATION.md · CONSIGNEE_FUNCTIONAL_DOCUMENTATION.md · CONSIGNEE_API_DOCUMENTATION.md*
