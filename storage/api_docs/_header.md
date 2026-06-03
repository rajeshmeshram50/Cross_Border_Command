# Cross_Border_Command — Full API Testing Sheet (Postman / curl)

> Complete start-to-end reference of **every** API endpoint in the system, with ready-to-run request samples for manual/Postman testing.
> Generated from the live Laravel route table (`php artisan route:list`) + each controller's validation rules.
> **Generated:** 2026-06-03 · **Base URL:** `http://127.0.0.1:8000`

---

## How to use this sheet

1. **Base URL** — all paths are prefixed with `http://127.0.0.1:8000`. Change the host if testing a deployed env.
2. **Auth token** — most endpoints need a Sanctum bearer token. Get one by calling `POST /api/login` (see Part 01), copy the `token` from the response, and use it as `{{token}}` in every authed request:
   ```
   Authorization: Bearer 12|abcdEFGH....
   ```
   In Postman, set an environment variable `token` and reference it as `{{token}}`.
3. **Branch scope** — authenticated **GET** requests are auto-scoped by branch in the SPA via a `?branch_id=<id>` query param. When testing directly you may add `?branch_id=12` to branch-scoped GETs to mimic the active branch.
4. **Content types**:
   - JSON endpoints → `Content-Type: application/json` with a JSON `--data` body.
   - File-upload endpoints → `multipart/form-data` using `--form 'field=@/path/to/file'` (do **not** set Content-Type manually; curl sets the boundary).
5. **Sample data** — values shown are realistic placeholders that satisfy validation. Replace ids (`product_id`, `customer_id`, etc.) with real ones from your test tenant (e.g. IGC GROUP, client id 12).
6. **Public endpoints** — a handful need **no** token: `login`, `login/face`, `google-login`, `forgot-password/*`, public onboarding (`/api/onboarding/{token}` + `/complete`), signed PDF views (`/sales/quotations/{id}/view`, `/sales/proforma-invoices/{id}/view`), and the Razorpay webhook. These are flagged per-entry.

---

## Endpoint totals

| Metric | Count |
|---|---|
| **Total API endpoints** | **437** |
| GET | 187 |
| POST | 139 |
| PUT | 35 |
| PUT\|PATCH (resource) | 15 |
| PATCH | 9 |
| DELETE | 52 |
| Controllers | 67 |

## Document index (by part)

| Part | Module area | Endpoints |
|---|---|---|
| [Part 01](#part-01--auth-tenancy-settings-permissions-dashboard) | Auth, Tenancy (Clients/Branches), Settings, Permissions, Notifications, Dashboard, My Team | 50 |
| [Part 02](#part-02--sales-leads--acknowledgement-reasons) | Sales Leads (6-stage pipeline) & Ack Reasons | 30 |
| [Part 03](#part-03--quotations-proforma-invoices-sales-pdfemail-procurement-shipment-meetings--reminders) | Quotations, Proforma Invoices, Sales PDF/Email, Procurement, Shipment, Meetings & Reminders | 44 |
| [Part 04](#part-04--customers--consignees-with-documents--owners) | Customers & Consignees (+ Documents & Owners) | 36 |
| [Part 05](#part-05--products-vendorssuppliers-master-data-generic-segment-uploads) | Products, Vendors/Suppliers, Master Data (generic), Segment Uploads | 35 |
| [Part 06](#part-06--clm-agreements-clauses-tc-trade-documents-segments-segment-rules-authorities) | CLM: Agreements, Clauses, T&C, Trade Documents, Segments, Segment Rules, Authorities | 54 |
| [Part 07](#part-07--clm-kyc-due-diligence-qc-trade-licenses-zoho-signature-buyersupplier-profiles) | CLM: KYC, DD, QC, Trade Licenses, Zoho Signature, Buyer/Supplier Profiles | 29 |
| [Part 08](#part-08--hr-employees-documents-onboarding-exit-previous-employment-attendance-leave-plans--requests) | HR: Employees, Documents, Onboarding, Exit, Previous Employment, Attendance, Leave | 55 |
| [Part 09](#part-09--hr-recruitment-hiring-requests-candidates-custom-fields-document-templates-generated-documents-overview) | HR: Recruitment, Hiring, Candidates, Custom Fields, Doc Templates, Generated Docs, Overview | 50 |
| [Part 10](#part-10--hr-document-signatures-advances-expenses-announcements-billing-paymentsplanssubscriptionrazorpay) | HR Signatures, Advances, Expenses, Announcements, Billing (Payments/Plans/Subscription/Razorpay) | 54 |
| | **TOTAL** | **437** |

---

