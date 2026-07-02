# CUSTOMER MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · Sales Matrix → Customer
> A guided, file-by-file trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ THIS DOCUMENT

This walkthrough follows the Customer lifecycle **in execution order**. Line numbers reference the live source and may drift; method names are stable. Legend: `→` a call · `⇒` a return.

Primary files:
- `app/Http/Controllers/Api/CustomerController.php` (~811 lines · CRUD + GST + master bundle)
- `app/Http/Controllers/Api/CustomerDocumentController.php`, `CustomerOwnerController.php`
- `app/Models/Customer.php` (+ `CustomerAddress`, `CustomerDocument`, `CustomerOwner`, `CustomerGstScrutiny`, `Consignee`)
- `app/Services/ConsigneeKycMirror.php`, `app/Support/{MasterVisibility,MasterBundleCache,SegmentGuard}.php`
- `resources/js/pages/sales/core-masters/customer/*` (SPA)

---

## 1. LISTING CUSTOMERS

### 1.1 Frontend: `SalesCustomers.tsx`
```tsx
// Fresh/Recurring tabs + debounced search (300 ms)
const load = async () => {
  const res = await api.get('/customers', { params: { tab, q: query } });
  setRows(res.data.data);
};
```
Row actions: **Edit** (warns first if the customer has consignees), **Map Consignee** (needs a saved `db_id`), **Customer Evidence Vault**. Table is `TableContainer` (velzon), 10 rows/page.

### 1.2 Backend: `CustomerController::index()` (29)
```php
public function index(Request $request)
{
    $q = Customer::forUser($request->user());          // tenant + hierarchical scope

    // prioritized search: exact code → email prefix → name/segment/type ilike → address
    if ($s = $request->query('q') ?? $request->query('search')) { /* … */ }

    // tab: recurring = has ≥1 non-deleted lead; fresh = none
    match ($request->query('tab')) {
        'recurring' => $q->whereHas('… leads …'),
        'fresh'     => $q->whereDoesntHave('… leads …'),
        default     => null,
    };

    // pagination optional (default: all rows; per_page ≤ 200)
    return response()->json(['tab' => $tab, 'count' => …, 'data' => $rows->map(fn($c) => $this->shapeCustomer($c))]);
}
```
> `Customer::forUser` (model scope) delegates to `MasterVisibility::applyReadScope` — super-admins see all; branch users see client-level + their branch; a `?branch_id` narrows a client-admin.

---

## 2. LOADING THE FORM (master bundle)

### 2.1 `masterBundle()` (776)
```php
public function masterBundle(Request $request)
{
    $key = MasterBundleCache::key('customer:master-bundle', $request->user()->id);
    return Cache::remember($key, now()->addMinutes(5), function () use ($request) {
        return [
            'customer_types'           => /* MasterVisibility::applyReadScope(...)->active */,
            'segments'                 => /* active, id+name+code */,
            'customer_classifications' => …, 'risk_levels' => …,
            'address_types' => …, 'countries' => …, 'states' => …,
            'designations'  => …, 'document_type' => …,
        ];
    });
}
```
The SPA reads a sessionStorage copy first (`customerBundleCache.ts`) before calling this.

---

## 3. CREATING A CUSTOMER (the provisioning transaction)

### 3.1 Frontend submit (`AddCustomerModal.tsx`)
Stage 1 auto-persists when advancing to Stage 2 (`persistStage1`): **POST on the first save, PUT thereafter**, so KYC uploads in Stage 2 attach to a real customer id.
```tsx
const body = { company_name, legal_name, type, segment, gst_applicable, …,
               primary_address: {…}, locations: [ … ] };
const res = editId ? await api.put(`/customers/${editId}`, body)
                   : await api.post('/customers', body);
setDbId(res.data.data.db_id);   // enables Stage-2 uploads + GST flush
```

### 3.2 Backend: `CustomerController::store()` (221) — annotated
```php
public function store(Request $request)
{
    $data = $this->validatePayload($request);          // field rules + cross-row email/phone uniqueness

    return DB::transaction(function () use ($request, $data) {
        $clientId = $request->user()->client_id;

        // 1. allocate C-#### under a clients row lock (never reuse soft-deleted codes)
        DB::table('clients')->where('id', $clientId)->lockForUpdate()->first();
        $code = $this->nextCustomerCode($clientId);    // /^C-0*(\d+)$/, withTrashed()

        // 2. create the customer (client_id/branch_id/created_by from auth)
        $customer = Customer::create($data + [
            'customer_code' => $code,
            'client_id'     => $clientId,
            'branch_id'     => $request->user()->branch_id,
            'created_by'    => $request->user()->id,
            'primary_email' => $data['primary_address']['cp_email'] ?? null,  // mirror
        ]);

        // 3. addresses — one is_primary=true, the rest locations
        $customer->addresses()->create([...$data['primary_address'], 'is_primary' => true]);
        foreach ($data['locations'] ?? [] as $loc)
            $customer->addresses()->create([...$loc, 'is_primary' => false]);

        return response()->json(['data' => $this->shapeCustomer($customer->fresh())], 201);
    });
}
```

### 3.3 `nextCustomerCode()` (730)
```php
$seq = Customer::withTrashed()->where('client_id', $clientId)
        ->get()->map(fn($c) => (int) preg_replace('/^C-0*(\d+)$/', '$1', $c->customer_code))
        ->max() + 1;
return 'C-' . str_pad($seq, 4, '0', STR_PAD_LEFT);   // C-0001, C-0002, …
```

### 3.4 `validatePayload()` (584)
Field rules + these cross-cutting checks:
- **legal_name** unique per tenant (`LOWER(legal_name)`; skipped if blank).
- **primary_email** unique per tenant (regex + `Rule::unique('customers','primary_email')`).
- **primary cp_contact** unique per tenant (primary addresses only).
- **within-customer** uniqueness — maintain `$seenEmails` / `$seenPhones`, error keyed `locations.{i}.cp_email` / `.cp_contact`.
- **pin** `^\d{6}$`; **phone** `^\+?[0-9\s-]{7,15}$`.

---

## 4. VIEWING A CUSTOMER (`show`)

### 4.1 `CustomerController::show()` (149)
```php
public function show(Customer $customer)              // route-model binding (scoped by forUser)
{
    return response()->json([
        'data'            => $this->shapeCustomer($customer->load('addresses','consignees')),
        'documents'       => $customer->documents,          // dd + tl
        'owners'          => $customer->owners,
        'segment_uploads' => /* grouped uploaded segment-rule docs */,
        'gst_scrutiny'    => $customer->gstScrutiny->map(fn($g) => $this->shapeGst($g)),
    ]);
}
```
The SPA hydrates the whole edit modal from this single call (customer + documents + owners + segment uploads + GST rows).

---

## 5. UPDATING A CUSTOMER

### 5.1 Backend: `CustomerController::update()` (281)
```php
public function update(Request $request, Customer $customer)
{
    if ($deny = MasterVisibility::hierarchicalDenial($request->user(), $customer, 'edit'))
        return response()->json(['message' => $deny], 403);

    $data = $this->validatePayload($request, $customer->id);   // uniqueness ->ignore(id)

    // segment-removal guard: block if docs already uploaded for a removed segment
    $blocked = SegmentGuard::blockedRemovals(Customer::class, $customer->id,
                   $customer->client_id, $customer->segment, $data['segment']);
    if ($blocked) return response()->json(['message'=>"Cannot remove the segment(s): …",
                                           'errors'=>['segment'=>[…]]], 422);

    return DB::transaction(function () use ($request, $customer, $data) {
        $customer->update($data + ['primary_email' => $data['primary_address']['cp_email'] ?? null]);

        // replace-all address strategy
        $customer->addresses()->delete();
        $customer->addresses()->create([...$data['primary_address'], 'is_primary' => true]);
        foreach ($data['locations'] ?? [] as $loc)
            $customer->addresses()->create([...$loc, 'is_primary' => false]);

        // keep "Same as Customer" consignees in sync (core fields + addresses)
        try { app(ConsigneeKycMirror::class)->syncCoreFromCustomer($customer, $request->user()->id); }
        catch (\Throwable $e) { Log::warning('consignee core sync failed: '.$e->getMessage()); }  // non-fatal

        return response()->json(['data' => $this->shapeCustomer($customer->fresh())]);
    });
}
```

---

## 6. GST SCRUTINY (domestic customers)

### 6.1 Frontend (`AddCustomerModal.tsx` → `GstScrutinyManagePopup`)
- Header **GST Scrutiny** button is enabled only when GST Applicable = *Yes*; shows a count badge.
- The manage popup lists rows (5/page, newest first). **+ Add GST Scrutiny** opens a stacked add-form popup (`z-index 1300`).
- Rows are held locally until the customer exists, then flushed (`flushLocalGst`) via `POST /customers/{id}/gst-scrutiny`.
- Once ≥1 entry exists, the **GST Applicable** dropdown is locked to Yes (a transparent overlay intercepts clicks and toasts).

### 6.2 Backend: `storeGstScrutiny()` (389) + `validateGst()` (444)
```php
private function validateGst(Request $request, int $customerId, ?int $ignoreId = null): array
{
    $request->merge(['gst_number' => strtoupper((string) $request->input('gst_number'))]);
    return $request->validate([
        'gst_number' => ['required','string',
            'regex:/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/',
            Rule::unique('customer_gst_scrutiny','gst_number')            // ONE customer per GSTIN
                ->where(fn($q) => $q->where('customer_id','!=',$customerId)->whereNull('deleted_at')),
        ],
        'status' => ['nullable', Rule::in(['Active','Inactive'])],
        'last_filing_date' => 'nullable|date',
        'prev_non_gst_2a_invoice' => 'nullable|string|max:255',
        'red_flags' => 'nullable|string|max:2000',
    ], [
        'gst_number.regex'  => 'Invalid GST format. Expected 15 characters …',
        'gst_number.unique' => 'This GST number is already registered to another customer.',
    ]);
}
```
`updateGstScrutiny()` passes `ignoreId`; `destroyGstScrutiny()` **force-deletes** the row (after `hierarchicalDenial`).

---

## 7. STAGE 2 — KYC / DUE DILIGENCE

> **Two stores.** Stage 2 writes to two independent places: **segment uploads** (`segment_doc_uploads`, the vault store, auto-code driven) and **ad-hoc KYC** (`customer_documents` / `customer_owners`, free-form). §7.1–7.2 cover segment uploads; §7.3–7.4 cover the ad-hoc store.

### 7.1 Segment rules drive the reference tables
When segment(s) are selected, the SPA fetches per-segment rules + the trade-doc library, and the already-uploaded files:
```tsx
await api.get(`/clm/segment-rules/for-segment/${segmentId}`);   // doc_selections per category (M/O)
await api.get('/clm/trade-doc-library/for-party/buyer');         // trade docs (party = Buyer)
await api.get(`/segment-uploads/customer/${customerId}`);        // { data, by_category, count }
```
Requirements are merged across segments and de-duped by code (**Mandatory wins**). The **reference table** renders one row per required code (`DD-001`, `KYC-002`, `TL-003`…), status **Verified** if a matching `segment_doc_uploads` row exists, else **Pending**.

### 7.2 Uploading against a reference row (`persistUpload` → segment uploads)
`SegmentRefRowActions` picks a file (pdf/jpg/png ≤ 2 MB) and posts by code:
```tsx
const fd = new FormData();
fd.append('category', 'dd');            // kyc|dd|tl|td|qc
fd.append('doc_code', 'DD-001');
fd.append('doc_name', 'Certificate of Incorporation');
fd.append('attachment', file);
await api.post(`/segment-uploads/customer/${customerId}`, fd);   // upsert by (type,id,category,doc_code)
```
Backend `SegmentDocUploadController::store()` is **upsert-by-code** — a re-upload deletes the old file and updates the row; `doc_name`/`requirement` are snapshotted so later rule edits don't rewrite history. **No verification step exists** — the presence of the row is what the vault renders as "Verified".

### 7.3 Ad-hoc documents: `CustomerDocumentController` (store 43 / update 62 / destroy 86)
```php
// store — kind dd|tl, attachment ≤2MB (jpg/png/pdf/doc/docx)
$path = $file->store("customer_documents/{$customer->id}", 'public');
$doc  = $customer->documents()->create([...$data, 'attachment_path' => $path]);
app(ConsigneeKycMirror::class)->resyncForCustomer($customer, $request->user()->id);  // re-mirror KYC
```
`update` supports `remove_attachment`; `destroy` deletes the on-disk file. Every create/update/delete calls `resyncForCustomer`.

### 7.4 Ad-hoc owners: `CustomerOwnerController` (store 36 / update 54 / destroy 75)
Same pattern with 3 identity proofs (`id_proof`, `address_proof`, `photograph`) and `remove_*` flags; also re-mirrors on change.

### 7.5 Evidence Vault composition — `SegmentDocUploadController::vault()`
`GET /segment-uploads/customer/{id}/vault` builds the read model server-side:
```
1. resolve segment ids (customer parses the comma-joined segment string)
2. load ClmSegmentRule → union each category's doc_selections (M beats O)
3. load master docs (Kyc/Dd/TradeLicense/TradeDocLibrary) for name/authority/expiry
4. load segment_doc_uploads keyed "category::doc_code"
5. row per required code → status = upload ? 'Verified' : 'Pending'
6. KPIs (verified_signed, pending) + a "core" count (mandatory DD+KYC+TL only)
7. buildShipmentAgreements(): leads + shipment_orders + clm_signature_requests
   → per-shipment coverage ratios + risk badge (PI prepended on the buyer side)
```
The SPA then overlays **live Zoho status** on the Trade Documents tab by fetching `GET /clm/signature-requests?party_id=&model_name=Customer&sync=1` and merging (`mergeTradeDocuments`). A `same_as_customer` consignee vault transparently reads the parent customer's uploads + requests.

---

## 8. THE CONSIGNEE MIRROR (`ConsigneeKycMirror`)

Two responsibilities on "Same as Customer" consignees (`Consignee::where('customer_id',$id)->where('same_as_customer',true)`):

```php
// syncCoreFromCustomer(Customer, ?actingUserId) — after customer update() (line 352)
//   copies core fields (company/legal/segment/classification/risk/website/primary_email/status)
//   + the full address book (primary + locations). NOT documents/owners.

// resyncForCustomer(Customer, ?actingUserId) — after any doc/owner create/update/delete
//   wipes the consignee's docs/owners (+ on-disk files) and re-copies the customer's,
//   storing files as consignee_documents/{id}/cloned-*.ext (owner proofs owner-clone-*).
```
Indexed by `(customer_id, same_as_customer)`. Failures are logged, never fatal to the customer save.

---

## 9. THE MODEL LAYER

### 9.1 `Customer` (`app/Models/Customer.php`)
```php
class Customer extends Model {
    use SoftDeletes;
    // addresses() primaryAddress() documents() owners() gstScrutiny() consignees()
    // client() branch() creator()
    public function scopeForUser($q, $user, ?int $branchFilter = null) {
        return MasterVisibility::applyReadScope($q, $user, $branchFilter);
    }
}
```
`primary_email` is a mirror column (kept in step with the primary address's `cp_email`). Segments are stored as a comma-separated `varchar(1024)` string.

### 9.2 Attachment URLs
`CustomerDocument` appends `attachment_url`; `CustomerOwner` appends `id_proof_url` / `address_proof_url` / `photograph_url` — all via the `file_url()` helper which resolves legacy `/storage/` prefixes to the public disk.

---

## 10. CROSS-CUTTING PATTERNS

| Pattern | Where | Why |
|---|---|---|
| Row-locked code allocation | `store()` / `nextCustomerCode()` | Race-free per-client `C-####`, never reuses soft-deleted codes |
| Primary-email mirror | `store()`/`update()` | `customers.primary_email` kept from the primary address for fast search/uniqueness |
| Replace-all addresses | `update()` | Simplest correct sync of a variable address set |
| Segment-removal guard | `update()` / `SegmentGuard` | Protects uploaded compliance docs |
| Consignee mirror | `ConsigneeKycMirror` | Keeps "Same as Customer" consignees in lock-step |
| Cross-customer GSTIN unique | `validateGst()` | One GSTIN ↔ one customer; repeats allowed within |
| Auto-save between stages | `AddCustomerModal` `persistStage1` | Real customer id before Stage-2 uploads |
| Tenant read scope | `Customer::forUser` | Server-side isolation on every query |
| Per-user cached bundle | `masterBundle()` + sessionStorage | Fewer round-trips on the form |

---

## 11. NOTES & CAVEATS

- **DB is PostgreSQL** — `ilike` search; soft-delete scans use `whereNull('deleted_at')`.
- **Address IDs are not preserved** on update (delete-all + recreate).
- **Segments are a comma-separated string**, not a join table — no referential integrity to the segment master.
- **GSTIN uniqueness is cross-customer**; deleting all GST entries is required before switching GST Applicable back to *No*.
- **Consignee mirror is best-effort** on update (logged on failure, doesn't roll back the customer).
- **Trade Documents / Evidence Vault** depend on CLM segment rules + Zoho Sign; status is polled (~15 s) and can lag the webhook.
- **Two document stores** — `segment_doc_uploads` (vault, auto-code, polymorphic) vs. `customer_documents`/`customer_owners` (ad-hoc, per-customer). Only segment uploads appear in the vault.
- **"Verified" is display-only** — there is no `verified`/`verified_at`/`verified_by`; an upload row = Verified, absence = Pending. "Signed" comes from a completed `clm_signature_requests` row.
- **Shipment matrix** needs real leads + `shipment_orders`; a customer with none has an empty Agreements/Shipments tab.

---

*Related documents: CUSTOMER_TECHNICAL_DOCUMENTATION.md · CUSTOMER_FUNCTIONAL_DOCUMENTATION.md · CUSTOMER_API_DOCUMENTATION.md*
