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

## 9. CROSS-CUTTING PATTERNS

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

## 10. NOTES & CAVEATS

- **Mirror is one-directional** (Customer → Consignee) and **replace-semantics** — a mirror is always an exact snapshot of the customer's KYC.
- **`type` is intentionally skipped** in `syncCoreFromCustomer` because the consignee table has no `type` column.
- **No GST scrutiny** — there is no `consignee_gst_scrutiny` table/endpoint (would need a new model to add).
- **"Verified" is display-only** (segment upload exists) — no reviewer/approval step; "Signed" = completed Zoho request.
- **Two doc stores** — `segment_doc_uploads` (vault) vs. `consignee_documents`/`consignee_owners` (ad-hoc / mirror clone target).
- **DB is PostgreSQL** — `ilike` search; partial unique index `(client_id, consignee_code) WHERE deleted_at IS NULL`.

---

*Related documents: CONSIGNEE_TECHNICAL_DOCUMENTATION.md · CONSIGNEE_FUNCTIONAL_DOCUMENTATION.md · CONSIGNEE_API_DOCUMENTATION.md*
