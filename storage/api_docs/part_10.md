# Part 10 — HR Document Signatures, Advances, Expenses, Announcements, Billing (Payments/Plans/Subscription/Razorpay)

Base URL: `http://127.0.0.1:8000`

All endpoints require `Authorization: Bearer {{token}}` **except** `POST /api/razorpay/webhook`, which is a Public, signature-verified server-to-server callback.

---

## HrDocumentSignatureController

### GET /api/employees/{slug}/signed-documents
**Action:** `HrDocumentSignatureController@forEmployee` — list signature runs targeting one employee.
**Auth:** Bearer token required
**Path params:** `{slug}` = Employee numeric id OR `emp_code` (e.g. `EMP-001`)
**Query params:** `status` (default `Completed`; pass `all` to include in-flight runs)

```bash
curl -X GET 'http://127.0.0.1:8000/api/employees/EMP-001/signed-documents?status=all' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hr-document-signatures
**Action:** `HrDocumentSignatureController@index` — list signature runs (tenant-scoped).
**Auth:** Bearer token required
**Query params:** `employee_id` (int), `status` (Pending|In Progress|Completed|Rejected|Cancelled), `template_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures?status=In%20Progress&employee_id=5' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hr-document-signatures
**Action:** `HrDocumentSignatureController@store` — send a template into its signing workflow against one employee. Resolves signers to real users and freezes the body HTML at send time.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "template_id": 3,
  "employee_id": 5
}'
```

**Body fields:**
- `template_id` (int, required) — must exist in `hr_document_templates`.
- `employee_id` (int, required) — must exist in `employees`.

### GET /api/hr-document-signatures/inbox
**Action:** `HrDocumentSignatureController@inbox` — signature runs where the current user is the next pending signer.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures/inbox' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/hr-document-signatures/{id}
**Action:** `HrDocumentSignatureController@show` — one run with audit log + resolved HTML.
**Auth:** Bearer token required
**Path params:** `{id}` = `hr_document_signatures.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures/12' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/hr-document-signatures/{id}/action
**Action:** `HrDocumentSignatureController@action` — current signer signs / approves / acknowledges; advances the workflow. For `Sign` steps a typed `signed_name` is mandatory and an optional drawn signature image is baked into the doc.
**Auth:** Bearer token required (must be the current signer)
**Path params:** `{id}` = signature run id

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures/12/action' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "action": "Sign",
  "signed_name": "Rajesh Meshram",
  "signature_image": "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "note": "Reviewed and signed"
}'
```

**Body fields:**
- `action` (string, required) — one of `Sign`, `Approve`, `Acknowledge`.
- `signed_name` (string, optional, max 120) — required at runtime when the current signer's step is a `Sign` step (else 422).
- `signature_image` (string, optional, max 5,600,000 chars) — base64 PNG/JPG/GIF/WEBP/SVG data URL from the signature pad; ≤ 4 MB decoded or it's silently dropped to the typed cursive fallback.
- `note` (string, optional, max 500) — stored on non-Sign (Approve/Acknowledge) steps.

### POST /api/hr-document-signatures/{id}/cancel
**Action:** `HrDocumentSignatureController@cancel` — sender (or admin) cancels the entire run.
**Auth:** Bearer token required (creator, `super_admin`, or `client_admin`)
**Path params:** `{id}` = signature run id

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures/12/cancel' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none.

### GET /api/hr-document-signatures/{id}/download
**Action:** `HrDocumentSignatureController@downloadSigned` — stream the run's current content as a DOCX (final signed copy when completed).
**Auth:** Bearer token required
**Path params:** `{id}` = signature run id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures/12/download' \
  --header 'Authorization: Bearer {{token}}' \
  --output signed.docx
```

### GET /api/hr-document-signatures/{id}/download-pdf
**Action:** `HrDocumentSignatureController@downloadSignedPdf` — DomPDF render of the signed document (A4), images inlined as data URIs.
**Auth:** Bearer token required
**Path params:** `{id}` = signature run id

```bash
curl -X GET 'http://127.0.0.1:8000/api/hr-document-signatures/12/download-pdf' \
  --header 'Authorization: Bearer {{token}}' \
  --output signed.pdf
```

### POST /api/hr-document-signatures/{id}/email-employee
**Action:** `HrDocumentSignatureController@emailToEmployee` — email the signed DOCX to the subject employee. Only valid for `Completed` runs.
**Auth:** Bearer token required
**Path params:** `{id}` = signature run id

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures/12/email-employee' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none (recipient resolved from the employee's email on file; 422 if missing or run not Completed).

### POST /api/hr-document-signatures/{id}/reject
**Action:** `HrDocumentSignatureController@reject` — current signer rejects the run; sets status `Rejected`.
**Auth:** Bearer token required (must be the current signer)
**Path params:** `{id}` = signature run id

```bash
curl -X POST 'http://127.0.0.1:8000/api/hr-document-signatures/12/reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "reason": "Wrong designation listed on the offer letter."
}'
```

**Body fields:**
- `reason` (string, required, max 500).

---

## AdvanceRequestController

Two-stage approval (manager → HR/Finance). Advance numbers are `ADV-0001` per (client, branch). Attachments uploaded as multipart `files[]`.

### GET /api/advance-requests
**Action:** `AdvanceRequestController@index` — list advance requests, role-scoped.
**Auth:** Bearer token required
**Query params:** `scope` (`mine`|`team`|`all`, default `mine`; `all` needs HR `can_view`), `status` (`pending`|`approved`|`rejected`), `employee_id` (int or EMP code), `employee_code` (string), `branch_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/advance-requests?scope=team&status=pending' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/advance-requests
**Action:** `AdvanceRequestController@store` — file an advance request (under your own employee record unless super_admin). Multipart for attachments.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'advance_type=Travel Advance' \
  --form 'amount=25000' \
  --form 'requested_date=2026-06-03' \
  --form 'recovery_start=2026-07-01' \
  --form 'recovery_mode=emi' \
  --form 'recovery_months=5' \
  --form 'monthly_emi=5000' \
  --form 'reason=Advance for upcoming client visit to Dubai.' \
  --form 'files[]=@C:\temp\itinerary.pdf'
```

**Body fields:**
- `advance_type` (string, required) — one of `Travel Advance`, `Salary Advance`, `Medical Advance`, `Other`.
- `advance_type_other` (string, optional, max 255) — required when `advance_type=Other`.
- `amount` (numeric, required, min 0, max 9999999999999.99).
- `requested_date` (date, required).
- `recovery_start` (date, required, ≥ `requested_date`).
- `recovery_mode` (string, required) — one of `emi`, `lumpsum`, `bimonthly`.
- `recovery_months` (int, optional, 1–120) — required when `recovery_mode=emi`.
- `monthly_emi` (numeric, optional, min 0, max 9999999999999.99) — meaningful only for `emi`.
- `reason` (string, required, max 2000).
- `employee_id` / `employee_code` (optional) — target another employee (super_admin only).
- `files[]` (file, optional, repeatable) — attachments stored on the public disk.

### GET /api/advance-requests/{id}
**Action:** `AdvanceRequestController@show` — one advance request (tenant-checked).
**Auth:** Bearer token required
**Path params:** `{id}` = `advance_requests.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/advance-requests/8' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/advance-requests/{id}/attachments/{index}
**Action:** `AdvanceRequestController@downloadAttachment` — stream one attachment by array index. Supports `?token=` query-token auth for direct browser opens.
**Auth:** Bearer token required (header or `?token=`)
**Path params:** `{id}` = advance request id; `{index}` = zero-based attachment index

```bash
curl -X GET 'http://127.0.0.1:8000/api/advance-requests/8/attachments/0?token={{token}}' \
  --output attachment.pdf
```

### POST /api/advance-requests/{id}/hr-approve
**Action:** `AdvanceRequestController@hrApprove` — HR/Finance approves (final). Requires manager already approved and HR `can_approve` permission.
**Auth:** Bearer token required
**Path params:** `{id}` = advance request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests/8/hr-approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Approved by Finance. Recovery starts next cycle."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/advance-requests/{id}/hr-reject
**Action:** `AdvanceRequestController@hrReject` — HR/Finance rejects (closes the request).
**Auth:** Bearer token required
**Path params:** `{id}` = advance request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests/8/hr-reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Budget unavailable this quarter."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/advance-requests/{id}/manager-approve
**Action:** `AdvanceRequestController@managerApprove` — assigned reporting manager approves stage 1.
**Auth:** Bearer token required (must be the assigned manager or super_admin)
**Path params:** `{id}` = advance request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests/8/manager-approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Justified — approving."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/advance-requests/{id}/manager-reject
**Action:** `AdvanceRequestController@managerReject` — manager rejects (closes the request).
**Auth:** Bearer token required (assigned manager or super_admin)
**Path params:** `{id}` = advance request id

```bash
curl -X POST 'http://127.0.0.1:8000/api/advance-requests/8/manager-reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Not needed for this trip."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

---

## ExpenseClaimController

Two-stage approval (manager → HR/Finance). Claim numbers are `EXP-0001` per (client, branch). Attachments uploaded as multipart `files[]`.

### GET /api/expense-claims
**Action:** `ExpenseClaimController@index` — list expense claims, role-scoped.
**Auth:** Bearer token required
**Query params:** `scope` (`mine`|`team`|`all`, default `mine`; `all` needs HR `can_view`), `status` (`pending`|`approved`|`rejected`), `employee_id` (int or EMP code), `employee_code` (string), `branch_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/expense-claims?scope=mine&status=approved' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/expense-claims
**Action:** `ExpenseClaimController@store` — file an expense claim (your own employee record unless super_admin). Multipart for receipts.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'title=Client dinner in Mumbai' \
  --form 'amount=4500' \
  --form 'expense_date=2026-06-01' \
  --form 'category_id=2' \
  --form 'currency=INR' \
  --form 'project=Q2 Rice Export' \
  --form 'payment_method=Personal Card' \
  --form 'vendor=Trident Hotel' \
  --form 'purpose=Business development dinner with buyer.' \
  --form 'files[]=@C:\temp\receipt.jpg'
```

**Body fields:**
- `title` (string, required, max 255).
- `amount` (numeric, required, min 0, max 9999999999999.99).
- `expense_date` (date, required).
- `category_id` (int, optional) — `ExpenseCategories` id (e.g. Travel, Medical); name auto-resolved.
- `currency` (string, optional, max 8; default `INR`).
- `project` (string, optional, max 64).
- `payment_method` (string, optional, max 64).
- `vendor` (string, optional, max 255).
- `purpose` (string, optional).
- `employee_id` / `employee_code` (optional) — target another employee (super_admin only).
- `files[]` (file, optional, repeatable) — receipts stored on the public disk.

### GET /api/expense-claims/{id}
**Action:** `ExpenseClaimController@show` — one claim (tenant-checked).
**Auth:** Bearer token required
**Path params:** `{id}` = `expense_claims.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/expense-claims/14' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/expense-claims/{id}/attachments/{index}
**Action:** `ExpenseClaimController@downloadAttachment` — stream one receipt by array index. Supports `?token=` query-token auth.
**Auth:** Bearer token required (header or `?token=`)
**Path params:** `{id}` = claim id; `{index}` = zero-based attachment index

```bash
curl -X GET 'http://127.0.0.1:8000/api/expense-claims/14/attachments/0?token={{token}}' \
  --output receipt.jpg
```

### POST /api/expense-claims/{id}/hr-approve
**Action:** `ExpenseClaimController@hrApprove` — HR/Finance approves (final). Requires manager approved + HR `can_approve`.
**Auth:** Bearer token required
**Path params:** `{id}` = claim id

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims/14/hr-approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Reimbursed in this month payroll."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/expense-claims/{id}/hr-reject
**Action:** `ExpenseClaimController@hrReject` — HR/Finance rejects (closes claim).
**Auth:** Bearer token required
**Path params:** `{id}` = claim id

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims/14/hr-reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Missing valid GST receipt."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/expense-claims/{id}/manager-approve
**Action:** `ExpenseClaimController@managerApprove` — assigned manager approves stage 1.
**Auth:** Bearer token required (assigned manager or super_admin)
**Path params:** `{id}` = claim id

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims/14/manager-approve' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Legitimate business expense."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

### POST /api/expense-claims/{id}/manager-reject
**Action:** `ExpenseClaimController@managerReject` — manager rejects (closes claim).
**Auth:** Bearer token required (assigned manager or super_admin)
**Path params:** `{id}` = claim id

```bash
curl -X POST 'http://127.0.0.1:8000/api/expense-claims/14/manager-reject' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "comment": "Personal expense, not claimable."
}'
```

**Body fields:**
- `comment` (string, optional, max 1000).

---

## AnnouncementController

Broadcast Centre. Codes are `ANN-0001` per (client, branch). Gated by `hr.broadcast` module permissions. Attachment uploaded as multipart `attachment`. Lifecycle status (Draft/Scheduled/Active/Expired/Archived) is server-resolved.

### GET /api/announcements
**Action:** `AnnouncementController@index` — list announcements (refreshes lifecycle statuses on read). Needs `can_view`.
**Auth:** Bearer token required
**Query params:** `search` (title/code/description), `type` (`General`|`Policy`|`Urgent`), `status` (Draft|Scheduled|Active|Expired|Archived), `branch_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/announcements?status=Active&type=Policy' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/announcements
**Action:** `AnnouncementController@store` — create an announcement. Needs `can_add`. If it resolves to `Active`, the email blast fires immediately. Multipart for the attachment.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/announcements' \
  --header 'Authorization: Bearer {{token}}' \
  --form 'title=Office closed for Eid' \
  --form 'description=The office will remain closed on June 17.' \
  --form 'type=General' \
  --form 'priority=High' \
  --form 'audience_type=all_employees' \
  --form 'publish_type=immediate' \
  --form 'expires_at=2026-06-18' \
  --form 'ack_required=1' \
  --form 'ack_mode=Mandatory' \
  --form 'ack_reminder_frequency=Daily' \
  --form 'ack_escalation_days=2' \
  --form 'notify_email=1' \
  --form 'notify_in_app=1' \
  --form 'status=Active' \
  --form 'attachment=@C:\temp\holiday-notice.pdf'
```

**Body fields:** (most are `required` only when publishing — i.e. not `status=Draft` and not an update)
- `title` (string, max 191) — required unless Draft/update.
- `description` (string) — required unless Draft/update.
- `type` (optional) — `General`|`Policy`|`Urgent`.
- `priority` (optional) — `Normal`|`High`|`Critical`.
- `attachment` (file, optional) — mimes `png,jpg,jpeg,pdf`, max 20 MB.
- `audience_type` (optional) — `all_employees`|`roles`|`designations`.
- `audience_role_ids` (int[], optional); `audience_designation_ids` (int[], optional); `exclude_employee_ids` (int[], optional).
- `publish_type` (optional) — `immediate`|`scheduled`.
- `publish_at` (date, optional); `expires_at` (date, optional, ≥ `publish_at`).
- `ack_required` (bool, optional); `ack_mode` (`Mandatory`|`Optional`); `ack_reminder_frequency` (`Daily`|`Weekly`|`Never`); `ack_escalation_days` (int 0–365).
- `notify_email` / `notify_in_app` / `notify_sms` / `notify_whatsapp` (bool, optional).
- `status` (optional) — `Draft`|`Scheduled`|`Active`|`Expired`|`Archived` (server may override based on dates).

### GET /api/announcements/next-code
**Action:** `AnnouncementController@nextCode` — peek the next `ANN-####` code for the caller's tenant.
**Auth:** Bearer token required (needs `can_view`)

```bash
curl -X GET 'http://127.0.0.1:8000/api/announcements/next-code' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/announcements/stats
**Action:** `AnnouncementController@stats` — KPI counts (total/active/scheduled/draft/expired/archived).
**Auth:** Bearer token required (needs `can_view`)
**Query params:** `branch_id` (int)

```bash
curl -X GET 'http://127.0.0.1:8000/api/announcements/stats' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/announcements/{announcement}
**Action:** `AnnouncementController@show` — one announcement (tenant-scoped). Needs `can_view`.
**Auth:** Bearer token required
**Path params:** `{announcement}` = `announcements.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/announcements/7' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/announcements/{announcement}
**Action:** `AnnouncementController@update` — update an announcement. Needs `can_edit`. Publishing (Draft/Scheduled → Active) fires the email once; editing an already-Active row does not re-blast.
**Auth:** Bearer token required
**Path params:** `{announcement}` = announcement id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/announcements/7' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "title": "Office closed for Eid (updated)",
  "description": "Closure extended to June 18.",
  "type": "General",
  "priority": "High",
  "expires_at": "2026-06-19",
  "status": "Active"
}'
```

**Body fields:** same rule set as `store`, but all fields are `nullable` on update (file attachment must use multipart). See store body fields for types/enums.

### DELETE /api/announcements/{announcement}
**Action:** `AnnouncementController@destroy` — soft-delete an announcement. Needs `can_delete`; blocked if created by a higher-privileged user.
**Auth:** Bearer token required
**Path params:** `{announcement}` = announcement id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/announcements/7' \
  --header 'Authorization: Bearer {{token}}'
```

---

## PaymentController

Manual payment records + invoice PDFs. `index`/`stats`/`show`/invoice scoped to super_admin (any) or client_admin (own client). Create/update/delete/reminder are super_admin only.

### GET /api/payments
**Action:** `PaymentController@index` — paginated payment list.
**Auth:** Bearer token required (super_admin = all; client_admin = own client; others get empty)
**Query params:** `search` (txn_id/order_id/invoice_number/org_name), `status` (pending|success|failed|refunded), `client_id` (int), `from` (date), `to` (date), `per_page` (default 15)

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments?status=success&per_page=20' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/payments
**Action:** `PaymentController@store` — record a manual payment (auto-generates `INV-...`). Sends invoice email when `status=success`.
**Auth:** Bearer token required (super_admin only)

```bash
curl -X POST 'http://127.0.0.1:8000/api/payments' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "client_id": 12,
  "plan_id": 2,
  "txn_id": "pay_Nabc123XyZ",
  "order_id": "order_Nabc123XyZ",
  "amount": 10000,
  "gst": 1800,
  "discount": 0,
  "total": 11800,
  "currency": "INR",
  "method": "net_banking",
  "gateway": "manual",
  "status": "success",
  "billing_cycle": "yearly",
  "valid_from": "2026-06-03",
  "valid_until": "2027-06-03",
  "auto_renew": false,
  "notes": "Offline NEFT received."
}'
```

**Body fields:**
- `client_id` (int, required) — exists in `clients`.
- `plan_id` (int, optional) — exists in `plans`.
- `txn_id` (string, optional, max 100); `order_id` (string, optional, max 100).
- `amount` (numeric, required, min 0); `gst` (numeric, optional); `discount` (numeric, optional).
- `total` (numeric, required, min 0).
- `currency` (string, optional, max 10).
- `method` (string, required) — `upi`|`credit_card`|`debit_card`|`net_banking`|`wallet`|`cash`|`cheque`.
- `gateway` (string, optional) — `razorpay`|`stripe`|`paytm`|`manual`.
- `status` (string, required) — `pending`|`success`|`failed`|`refunded`.
- `billing_cycle` (string, optional) — `monthly`|`quarterly`|`yearly`.
- `valid_from` / `valid_until` (date, optional).
- `auto_renew` (bool, optional); `notes` (string, optional).

### GET /api/payments/stats
**Action:** `PaymentController@stats` — revenue + count breakdown by status.
**Auth:** Bearer token required (super_admin = all; client_admin = own client)

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments/stats' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/payments/{payment}
**Action:** `PaymentController@show` — one payment with client/plan/processedBy.
**Auth:** Bearer token required (super_admin or owning client_admin)
**Path params:** `{payment}` = `payments.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments/30' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/payments/{payment}
**Action:** `PaymentController@update` — update a payment record.
**Auth:** Bearer token required
**Path params:** `{payment}` = payment id

> Note: the controller exposes an `update` route but the method is not implemented in this controller body; treat as a standard resource update of the same fields as `store`.

```bash
curl -X PUT 'http://127.0.0.1:8000/api/payments/30' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "status": "refunded",
  "notes": "Refunded on client request."
}'
```

**Body fields:** same shape as `store` (client_id, plan_id, amounts, method, status, etc.).

### DELETE /api/payments/{payment}
**Action:** `PaymentController@destroy` — delete a payment record.
**Auth:** Bearer token required (super_admin only)
**Path params:** `{payment}` = payment id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/payments/30' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/payments/{payment}/invoice/download
**Action:** `PaymentController@downloadInvoice` — download the invoice PDF as an attachment. Supports `?token=` query-token auth.
**Auth:** Bearer token required (header or `?token=`; super_admin or owning client_admin)
**Path params:** `{payment}` = payment id

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments/30/invoice/download?token={{token}}' \
  --output invoice.pdf
```

### GET /api/payments/{payment}/invoice/view
**Action:** `PaymentController@viewInvoice` — stream the invoice PDF inline in the browser. Supports `?token=`.
**Auth:** Bearer token required (header or `?token=`; super_admin or owning client_admin)
**Path params:** `{payment}` = payment id

```bash
curl -X GET 'http://127.0.0.1:8000/api/payments/30/invoice/view?token={{token}}'
```

### POST /api/payments/{payment}/send-reminder
**Action:** `PaymentController@sendReminder` — email a plan-expiry reminder to the client (and client_admin). Gated by Settings → Notifications → planExp.
**Auth:** Bearer token required (super_admin only)
**Path params:** `{payment}` = payment id

```bash
curl -X POST 'http://127.0.0.1:8000/api/payments/30/send-reminder' \
  --header 'Authorization: Bearer {{token}}'
```

**Body fields:** none (returns 422 if client email missing, 503 if planExp notifications disabled).

---

## PlanController

Plan tiers + `plan_modules` join. Plan names slugify to a unique `slug`.

### GET /api/plans
**Action:** `PlanController@index` — list plans with client count + modules.
**Auth:** Bearer token required
**Query params:** `search` (plan name)

```bash
curl -X GET 'http://127.0.0.1:8000/api/plans?search=Pro' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/plans
**Action:** `PlanController@store` — create a plan and its included modules.
**Auth:** Bearer token required

```bash
curl -X POST 'http://127.0.0.1:8000/api/plans' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Pro",
  "price": 4999,
  "period": "month",
  "max_branches": 5,
  "max_users": 50,
  "storage_limit": "50GB",
  "support_level": "Priority",
  "is_featured": true,
  "badge": "Popular",
  "color": "#2563eb",
  "description": "For growing export teams.",
  "best_for": "SMB exporters",
  "status": "active",
  "trial_days": 14,
  "yearly_discount": 15,
  "is_custom": false,
  "modules": [
    { "module_id": 1, "access_level": "full" },
    { "module_id": 2, "access_level": "limited" }
  ]
}'
```

**Body fields:**
- `name` (string, required, max 100) — must slugify uniquely.
- `price` (numeric, required, min 0).
- `period` (string, required) — `month`|`quarter`|`year`.
- `max_branches` (int, optional, min 0); `max_users` (int, optional, min 0).
- `storage_limit` (string, optional, max 20); `support_level` (string, optional, max 50).
- `is_featured` (bool); `badge` (string, optional, max 50); `color` (string, optional, max 7, hex).
- `description` (string, optional); `best_for` (string, optional, max 255).
- `status` (string, required) — `active`|`inactive`.
- `trial_days` (int, optional, min 0); `yearly_discount` (numeric, optional, 0–100).
- `is_custom` (bool).
- `modules` (array, optional) — each `{ module_id (exists:modules,id), access_level: full|limited|addon|not_included }`. `not_included` rows are skipped.

### GET /api/plans/{plan}
**Action:** `PlanController@show` — one plan with client count, modules, and planModules.
**Auth:** Bearer token required
**Path params:** `{plan}` = `plans.id`

```bash
curl -X GET 'http://127.0.0.1:8000/api/plans/2' \
  --header 'Authorization: Bearer {{token}}'
```

### PUT /api/plans/{plan}
**Action:** `PlanController@update` — update a plan; replaces all its `plan_modules`.
**Auth:** Bearer token required
**Path params:** `{plan}` = plan id

```bash
curl -X PUT 'http://127.0.0.1:8000/api/plans/2' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "name": "Pro",
  "price": 5499,
  "period": "month",
  "status": "active",
  "modules": [
    { "module_id": 1, "access_level": "full" }
  ]
}'
```

**Body fields:** identical rule set to `store` (see above).

### DELETE /api/plans/{plan}
**Action:** `PlanController@destroy` — delete a plan (422 if any client still uses it).
**Auth:** Bearer token required
**Path params:** `{plan}` = plan id

```bash
curl -X DELETE 'http://127.0.0.1:8000/api/plans/2' \
  --header 'Authorization: Bearer {{token}}'
```

---

## SubscriptionController

Client-admin self-serve subscription via Razorpay: `create-order` → checkout → `verify-payment` (or `cancel-order`).

### POST /api/subscription/cancel-order
**Action:** `SubscriptionController@cancelOrder` — mark a pending payment `failed` after the user cancels the Razorpay modal. Idempotent.
**Auth:** Bearer token required (owning client)

```bash
curl -X POST 'http://127.0.0.1:8000/api/subscription/cancel-order' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "razorpay_order_id": "order_Nabc123XyZ",
  "reason": "user_cancelled"
}'
```

**Body fields:**
- `razorpay_order_id` (string, required).
- `reason` (string, optional, max 255).

### POST /api/subscription/create-order
**Action:** `SubscriptionController@createOrder` — create a Razorpay order + pending Payment (or instantly activate free plans). May return a 422 requesting `kept_branch_ids` when downsizing branches.
**Auth:** Bearer token required (must have `client_id`)

```bash
curl -X POST 'http://127.0.0.1:8000/api/subscription/create-order' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "plan_id": 2,
  "payment_method": "upi",
  "billing_cycle": "year",
  "kept_branch_ids": [1, 4]
}'
```

**Body fields:**
- `plan_id` (int, required) — exists in `plans`.
- `payment_method` (string, required) — `upi`|`card`|`net_banking`.
- `billing_cycle` (string, required) — `month`|`quarter`|`year`.
- `kept_branch_ids` (int[], optional) — required (422) only when the new plan's `max_branches` is below the current active branch count; each must exist in `branches` and belong to the caller's client.

### GET /api/subscription/plans
**Action:** `SubscriptionController@plans` — list active plans (with modules) for the subscription picker.
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/subscription/plans' \
  --header 'Authorization: Bearer {{token}}'
```

### GET /api/subscription/status
**Action:** `SubscriptionController@status` — current client's plan state (has_plan / expired / plan / expires_at).
**Auth:** Bearer token required

```bash
curl -X GET 'http://127.0.0.1:8000/api/subscription/status' \
  --header 'Authorization: Bearer {{token}}'
```

### POST /api/subscription/verify-payment
**Action:** `SubscriptionController@verifyPayment` — verify the Razorpay signature, mark the Payment success, and activate the plan (grants module permissions, enforces branch limit). Idempotent.
**Auth:** Bearer token required (owning client)

```bash
curl -X POST 'http://127.0.0.1:8000/api/subscription/verify-payment' \
  --header 'Content-Type: application/json' \
  --header 'Authorization: Bearer {{token}}' \
  --data '{
  "razorpay_order_id": "order_Nabc123XyZ",
  "razorpay_payment_id": "pay_NdEf456GhI",
  "razorpay_signature": "9ef4dffbfd84f1318f6739a3ce19f9d85851857ae648f114332d8401e0949a3d"
}'
```

**Body fields:**
- `razorpay_order_id` (string, required).
- `razorpay_payment_id` (string, required).
- `razorpay_signature` (string, required) — HMAC signature from the Razorpay checkout callback.

---

## RazorpayWebhookController

### POST /api/razorpay/webhook
**Action:** `RazorpayWebhookController@handle` — Razorpay server-to-server event callback. Verifies `X-Razorpay-Signature`, then on `payment.captured`/`order.paid` activates the plan (with amount-tampering and concurrency guards); on `payment.failed` marks the Payment failed.
**Auth:** **Public (webhook, signature-verified).** No Bearer token — authenticity is proven by the `X-Razorpay-Signature` header against the raw request body. An invalid signature returns 400.

```bash
curl -X POST 'http://127.0.0.1:8000/api/razorpay/webhook' \
  --header 'Content-Type: application/json' \
  --header 'X-Razorpay-Signature: {{razorpay_webhook_signature}}' \
  --data '{
  "event": "payment.captured",
  "payload": {
    "payment": {
      "entity": {
        "id": "pay_NdEf456GhI",
        "order_id": "order_Nabc123XyZ",
        "amount": 1180000,
        "method": "upi"
      }
    }
  }
}'
```

**Body fields:** raw Razorpay event envelope (sent by Razorpay, not hand-built):
- `event` (string) — e.g. `payment.captured`, `order.paid`, `payment.failed`.
- `payload.payment.entity` (object) — `id`, `order_id` (matched to the local Payment), `amount` (paise; must equal `total × 100` or activation is refused), `method`, optional `error_description`.
