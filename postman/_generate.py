"""
Generates the Cross_Border_Command Postman collection (v2.1) from a structured
endpoint map transcribed from routes/api.php. Run: python _generate.py
Outputs Cross_Border_Command.postman_collection.json next to this script.
"""
import json, os

# ---------------------------------------------------------------------------
# Each endpoint: (METHOD, path, name, body_or_None)
# path uses :param style; {{base_url}} is prepended automatically.
# body: dict -> raw JSON body; "form" -> multipart hint; None -> no body.
# ---------------------------------------------------------------------------

J = lambda d: d  # readability marker for json bodies

folders = []

def folder(name, items):
    folders.append({"name": name, "item": items})

def ep(method, path, name, body=None, query=None, desc=None):
    return {"_m": method, "_p": path, "_n": name, "_b": body, "_q": query, "_d": desc}

# ----------------------------- AUTH ----------------------------------------
folder("Auth", [
    ep("POST", "/login", "Login (captures token)",
       J({"email": "ceo@inhpl.com", "password": "password", "client_id": None}),
       desc="On success the test script stores `token` as a collection variable used by every other request."),
    ep("POST", "/login/face", "Face Login",
       J({"email": "ceo@inhpl.com", "descriptor": [0.01, -0.02, "...128 floats from face-api.js..."]})),
    ep("POST", "/google-login", "Google Login",
       J({"credential": "<google-id-token>"})),
    ep("POST", "/forgot-password/send-otp", "Forgot Password - Send OTP",
       J({"email": "ceo@inhpl.com"})),
    ep("POST", "/forgot-password/verify-otp", "Forgot Password - Verify OTP",
       J({"email": "ceo@inhpl.com", "otp": "123456"})),
    ep("POST", "/forgot-password/reset", "Forgot Password - Reset",
       J({"email": "ceo@inhpl.com", "otp": "123456", "password": "NewPass@123", "password_confirmation": "NewPass@123"})),
    ep("GET", "/me", "Me (current user)"),
    ep("POST", "/logout", "Logout"),
    ep("POST", "/change-password", "Change Password",
       J({"current_password": "password", "password": "NewPass@123", "password_confirmation": "NewPass@123"})),
    ep("POST", "/me/branding", "Update My Branding (multipart)", "form"),
    ep("POST", "/me/profile", "Update My Profile (multipart)", "form"),
])

# --------------------------- DASHBOARD -------------------------------------
folder("Dashboard", [
    ep("GET", "/dashboard/admin-stats", "Admin Stats"),
    ep("GET", "/dashboard/client-stats", "Client Stats"),
    ep("GET", "/dashboard/employee-stats", "Employee Stats"),
])

# ----------------------------- TENANCY -------------------------------------
folder("Clients", [
    ep("GET", "/clients/stats", "Stats"),
    ep("GET", "/clients/form-bundle", "Form Bundle"),
    ep("GET", "/clients", "List"),
    ep("POST", "/clients", "Create",
       J({"org_name": "Acme Exports Pvt Ltd", "email": "admin@acme.test", "password": "Pass@1234",
          "phone": "9876543210", "status": "active", "organization_type_id": 1})),
    ep("GET", "/clients/:id", "Show"),
    ep("PUT", "/clients/:id", "Update", J({"org_name": "Acme Exports Pvt Ltd", "status": "active"})),
    ep("DELETE", "/clients/:id", "Delete"),
])
folder("Branches", [
    ep("GET", "/branches/next-code", "Next Code"),
    ep("GET", "/branches/form-bundle", "Form Bundle"),
    ep("GET", "/branches", "List"),
    ep("POST", "/branches", "Create",
       J({"name": "Mumbai HQ", "code": "BR-001", "email": "mumbai@acme.test", "phone": "9876543210",
          "city": "Mumbai", "state_id": 1, "country_id": 1, "status": "active"})),
    ep("GET", "/branches/:id", "Show"),
    ep("PUT", "/branches/:id", "Update", J({"name": "Mumbai HQ", "status": "active"})),
    ep("DELETE", "/branches/:id", "Delete"),
])

# ----------------------------- PRODUCTS ------------------------------------
folder("Products", [
    ep("GET", "/products/stats", "Stats"),
    ep("GET", "/products/owners", "Owners"),
    ep("GET", "/products/master-bundle", "Master Bundle"),
    ep("GET", "/products", "List"),
    ep("GET", "/products/:id", "Show"),
    ep("GET", "/products/:id/vendor-maps", "Vendor Maps"),
    ep("POST", "/products/step/core", "Step: Core",
       J({"name": "Basmati Rice 1121", "hsn_code": "10063020", "uom_id": 1, "category": "Rice",
          "description": "Premium long grain", "core_status": "completed"})),
    ep("PUT", "/products/:id/step/sales", "Step: Sales",
       J({"selling_price": 1200, "currency_id": 1, "min_order_qty": 100, "sales_status": "completed"})),
    ep("PUT", "/products/:id/step/quality", "Step: Quality",
       J({"quality_specs": "Moisture < 12%", "quality_status": "completed"})),
    ep("PUT", "/products/:id/step/vendors", "Step: Vendors",
       J({"vendor_ids": [1, 2], "vendors_status": "completed"})),
    ep("DELETE", "/products/:id", "Delete"),
])

# ----------------------------- VENDORS -------------------------------------
folder("Vendors", [
    ep("GET", "/vendors", "List"),
    ep("GET", "/vendors/master-bundle", "Master Bundle"),
    ep("GET", "/vendors/:id", "Show"),
    ep("POST", "/vendors/step/identity", "Step: Identity",
       J({"name": "Global Suppliers Co", "vendor_type_id": 1, "country_id": 1, "identity_status": "completed"})),
    ep("PUT", "/vendors/:id/step/contacts", "Step: Contacts",
       J({"contact_name": "John Doe", "email": "john@globalsup.test", "phone": "9876543210", "contacts_status": "completed"})),
    ep("POST", "/vendors/:id/contacts", "Add Contact",
       J({"name": "Jane Roe", "designation": "Manager", "email": "jane@globalsup.test", "phone": "9876500000"})),
    ep("PUT", "/vendors/:id/contacts/:contact", "Update Contact",
       J({"name": "Jane Roe", "designation": "Sr Manager"})),
    ep("DELETE", "/vendors/:id/contacts/:contact", "Delete Contact"),
    ep("POST", "/vendors/:id/bank-accounts", "Add Bank Account",
       J({"bank_name": "HDFC", "account_no": "123456789", "ifsc": "HDFC0001234", "account_holder": "Global Suppliers Co"})),
    ep("PUT", "/vendors/:id/bank-accounts/:bank", "Update Bank Account",
       J({"bank_name": "HDFC", "account_no": "123456789", "ifsc": "HDFC0001234"})),
    ep("DELETE", "/vendors/:id/bank-accounts/:bank", "Delete Bank Account"),
    ep("POST", "/vendors/:id/gst-scrutiny", "Add GST Scrutiny",
       J({"gstin": "27ABCDE1234F1Z5", "status": "active", "remarks": "Verified"})),
    ep("PUT", "/vendors/:id/gst-scrutiny/:gst", "Update GST Scrutiny",
       J({"gstin": "27ABCDE1234F1Z5", "status": "active"})),
    ep("DELETE", "/vendors/:id/gst-scrutiny/:gst", "Delete GST Scrutiny"),
    ep("POST", "/vendors/:id/step/kyc", "Step: KYC (multipart)", "form"),
    ep("POST", "/vendors/:id/step/products", "Step: Products",
       J({"product_ids": [1, 2], "vendors_status": "completed"})),
    ep("DELETE", "/vendors/:id", "Delete"),
])

# ----------------------------- PLANS ---------------------------------------
folder("Plans", [
    ep("GET", "/plans", "List"),
    ep("POST", "/plans", "Create",
       J({"name": "Pro", "price": 4999, "billing_cycle": "monthly", "module_ids": [1, 2, 3], "status": "active"})),
    ep("GET", "/plans/:id", "Show"),
    ep("PUT", "/plans/:id", "Update", J({"name": "Pro", "price": 4999, "status": "active"})),
    ep("DELETE", "/plans/:id", "Delete"),
])

# ----------------------------- CUSTOMERS -----------------------------------
folder("Customers", [
    ep("GET", "/customers/master-bundle", "Master Bundle"),
    ep("GET", "/customers", "List"),
    ep("POST", "/customers", "Create",
       J({"name": "Overseas Buyer LLC", "customer_type_id": 1, "country_id": 1, "email": "buyer@overseas.test",
          "phone": "9876543210", "segment_id": 1, "status": "active"})),
    ep("GET", "/customers/:id", "Show"),
    ep("PUT", "/customers/:id", "Update", J({"name": "Overseas Buyer LLC", "status": "active"})),
    ep("DELETE", "/customers/:id", "Delete"),
    ep("GET", "/customers/:customer/documents", "Documents: List"),
    ep("POST", "/customers/:customer/documents", "Documents: Create (multipart)", "form"),
    ep("GET", "/customers/:customer/documents/:document", "Documents: Show"),
    ep("POST", "/customers/:customer/documents/:document", "Documents: Update (multipart)", "form"),
    ep("DELETE", "/customers/:customer/documents/:document", "Documents: Delete"),
    ep("GET", "/customers/:customer/owners", "Owners: List"),
    ep("POST", "/customers/:customer/owners", "Owners: Create (multipart)", "form"),
    ep("GET", "/customers/:customer/owners/:owner", "Owners: Show"),
    ep("POST", "/customers/:customer/owners/:owner", "Owners: Update (multipart)", "form"),
    ep("DELETE", "/customers/:customer/owners/:owner", "Owners: Delete"),
])

# ---------------------------- CONSIGNEES -----------------------------------
folder("Consignees", [
    ep("GET", "/consignees", "List"),
    ep("POST", "/consignees", "Create",
       J({"name": "Consignee Co", "customer_id": 1, "country_id": 1, "email": "consignee@test.test", "status": "active"})),
    ep("GET", "/consignees/:id", "Show"),
    ep("PUT", "/consignees/:id", "Update", J({"name": "Consignee Co", "status": "active"})),
    ep("DELETE", "/consignees/:id", "Delete"),
    ep("POST", "/consignees/:consignee/clone-from-customer", "Clone From Customer",
       J({"customer_id": 1})),
    ep("GET", "/consignees/:consignee/documents", "Documents: List"),
    ep("POST", "/consignees/:consignee/documents", "Documents: Create (multipart)", "form"),
    ep("GET", "/consignees/:consignee/documents/:document", "Documents: Show"),
    ep("POST", "/consignees/:consignee/documents/:document", "Documents: Update (multipart)", "form"),
    ep("DELETE", "/consignees/:consignee/documents/:document", "Documents: Delete"),
    ep("GET", "/consignees/:consignee/owners", "Owners: List"),
    ep("POST", "/consignees/:consignee/owners", "Owners: Create (multipart)", "form"),
    ep("GET", "/consignees/:consignee/owners/:owner", "Owners: Show"),
    ep("POST", "/consignees/:consignee/owners/:owner", "Owners: Update (multipart)", "form"),
    ep("DELETE", "/consignees/:consignee/owners/:owner", "Owners: Delete"),
])

# ------------------------------- CLM ---------------------------------------
def crud4(base, name, body):
    return [
        ep("GET", base, name + ": List"),
        ep("POST", base, name + ": Create", body),
        ep("PUT", base + "/:id", name + ": Update", body),
        ep("DELETE", base + "/:id", name + ": Delete"),
    ]

clm_items = []
clm_items += crud4("/clm/segments", "Segments", J({"name": "Tobacco", "code": "TOB", "status": "active"}))
clm_items += crud4("/clm/authorities", "Authorities", J({"name": "DGFT", "type": "regulatory", "status": "active"}))
clm_items += crud4("/clm/kyc-documents", "KYC Documents", J({"name": "PAN Card", "party_type": "customer", "is_mandatory": True}))
clm_items += crud4("/clm/dd-documents", "DD Documents", J({"name": "Credit Report", "party_type": "vendor"}))
clm_items += crud4("/clm/trade-licenses", "Trade Licenses", J({"name": "IEC", "authority_id": 1}))
clm_items += crud4("/clm/qc-documents", "QC Documents", J({"name": "FSSAI Cert", "party_type": "vendor"}))
# Trade doc names + library
clm_items += [
    ep("GET", "/clm/trade-doc-names", "Trade Doc Names: List"),
    ep("POST", "/clm/trade-doc-names", "Trade Doc Names: Create", J({"name": "Commercial Invoice"})),
    ep("PUT", "/clm/trade-doc-names/:id", "Trade Doc Names: Update", J({"name": "Commercial Invoice"})),
    ep("DELETE", "/clm/trade-doc-names/:id", "Trade Doc Names: Delete"),
    ep("GET", "/clm/trade-doc-library", "Trade Doc Library: List"),
    ep("POST", "/clm/trade-doc-library", "Trade Doc Library: Create", J({"name": "CI Template", "trade_doc_name_id": 1, "content": "<p>...</p>"})),
    ep("POST", "/clm/docx-to-html", "Docx to HTML Preview (multipart)", "form"),
    ep("POST", "/clm/trade-doc-library/upload-header-logo", "Upload Header Logo (multipart)", "form"),
    ep("GET", "/clm/trade-doc-library/for-party/:party", "Library For Party"),
    ep("GET", "/clm/trade-doc-library/:id/download", "Download DOCX"),
    ep("GET", "/clm/trade-doc-library/:id/download-pdf", "Download PDF"),
    ep("POST", "/clm/trade-doc-library/:id/upload-docx", "Upload DOCX (multipart)", "form"),
    ep("PUT", "/clm/trade-doc-library/:id", "Trade Doc Library: Update", J({"name": "CI Template", "content": "<p>...</p>"})),
    ep("DELETE", "/clm/trade-doc-library/:id", "Trade Doc Library: Delete"),
]
# Signature requests
clm_items += [
    ep("POST", "/clm/signature-requests/preview", "Signature: Preview", J({"document_id": 1, "party_type": "customer", "party_id": 1})),
    ep("POST", "/clm/signature-requests", "Signature: Send", J({"document_id": 1, "party_type": "customer", "party_id": 1, "recipients": [{"name": "John", "email": "john@test.test"}]})),
    ep("GET", "/clm/signature-requests", "Signature: List"),
    ep("GET", "/clm/signature-requests/:id", "Signature: Show"),
    ep("POST", "/clm/signature-requests/:id/remind", "Signature: Remind"),
    ep("POST", "/clm/signature-requests/:id/recall", "Signature: Recall"),
    ep("GET", "/clm/signature-requests/:id/download-file/:index", "Signature: Download File"),
    ep("GET", "/clm/signature-requests/:id/view-file/:index", "Signature: View File"),
    ep("GET", "/clm/signature-requests/:id/certificate", "Signature: View Certificate"),
    ep("POST", "/clm/signature-requests/ctc-preview", "CTC: Preview", J({"ctc_contract_id": 1})),
    ep("POST", "/clm/signature-requests/ctc-send", "CTC: Send", J({"ctc_contract_id": 1, "recipients": [{"name": "John", "email": "john@test.test"}]})),
    ep("GET", "/clm/ctc-contracts/:id/sync-signature", "CTC: Sync Signature Status"),
    ep("POST", "/clm/ctc-contracts/:id/remind-signing", "CTC: Remind Signing"),
    ep("POST", "/clm/signature-requests/agreement-preview", "Agreement: Preview", J({"agreement_id": 1, "party_type": "customer", "party_id": 1})),
    ep("POST", "/clm/signature-requests/agreement-send", "Agreement: Send", J({"agreement_id": 1, "party_type": "customer", "party_id": 1, "recipients": [{"name": "John", "email": "john@test.test"}]})),
    ep("POST", "/clm/signature-requests/sales-doc-send", "Sales Doc: Send", J({"document_id": 1, "lead_id": 1, "recipients": [{"name": "John", "email": "john@test.test"}]})),
]
# TNC
clm_items += [
    ep("GET", "/clm/tnc-categories", "TNC Categories: List"),
    ep("POST", "/clm/tnc-categories", "TNC Categories: Create", J({"name": "Payment Terms"})),
    ep("PUT", "/clm/tnc-categories/:id", "TNC Categories: Update", J({"name": "Payment Terms"})),
    ep("DELETE", "/clm/tnc-categories/:id", "TNC Categories: Delete"),
    ep("GET", "/clm/tnc-library", "TNC Library: List"),
    ep("POST", "/clm/tnc-library", "TNC Library: Create", J({"title": "Net 30", "category_id": 1, "content": "<p>...</p>"})),
    ep("PUT", "/clm/tnc-library/:id", "TNC Library: Update", J({"title": "Net 30", "content": "<p>...</p>"})),
    ep("DELETE", "/clm/tnc-library/:id", "TNC Library: Delete"),
]
# Agreements
clm_items += [
    ep("GET", "/clm/agreement-types", "Agreement Types: List"),
    ep("POST", "/clm/agreement-types", "Agreement Types: Create", J({"name": "NDA"})),
    ep("PUT", "/clm/agreement-types/:id", "Agreement Types: Update", J({"name": "NDA"})),
    ep("DELETE", "/clm/agreement-types/:id", "Agreement Types: Delete"),
    ep("GET", "/clm/agreement-library", "Agreement Library: List"),
    ep("POST", "/clm/agreement-library", "Agreement Library: Create", J({"name": "Standard NDA", "agreement_type_id": 1, "content": "<p>...</p>"})),
    ep("PUT", "/clm/agreement-library/:id", "Agreement Library: Update", J({"name": "Standard NDA", "content": "<p>...</p>"})),
    ep("DELETE", "/clm/agreement-library/:id", "Agreement Library: Delete"),
    ep("GET", "/clm/agreement-library/:id/download", "Agreement: Download DOCX"),
    ep("GET", "/clm/agreement-library/:id/download-pdf", "Agreement: Download PDF"),
    ep("POST", "/clm/agreement-library/:id/upload-docx", "Agreement: Upload DOCX (multipart)", "form"),
    ep("POST", "/clm/agreement-library/upload-header-logo", "Agreement: Upload Header Logo (multipart)", "form"),
    ep("GET", "/clm/leads/:leadId/agreement-applicable", "Agreement Applicable For Lead"),
]
# CTC contracts
clm_items += [
    ep("GET", "/clm/ctc-contracts", "CTC Contracts: List"),
    ep("POST", "/clm/ctc-contracts", "CTC Contracts: Create", J({"title": "Supply Contract", "party_type": "customer", "party_id": 1, "content": "<p>...</p>"})),
    ep("GET", "/clm/ctc-contracts/sent", "CTC Contracts: Sent"),
    ep("GET", "/clm/ctc-contracts/to-approve", "CTC Contracts: To Approve"),
    ep("GET", "/clm/ctc-contracts/approver-candidates", "CTC Contracts: Approver Candidates"),
    ep("GET", "/clm/ctc-contracts/contact-persons", "CTC Contracts: Contact Persons"),
    ep("GET", "/clm/ctc-contracts/placeholder-values", "CTC Contracts: Placeholder Values"),
    ep("GET", "/clm/ctc-contracts/:id", "CTC Contracts: Show"),
    ep("PUT", "/clm/ctc-contracts/:id", "CTC Contracts: Update", J({"title": "Supply Contract", "content": "<p>...</p>"})),
    ep("DELETE", "/clm/ctc-contracts/:id", "CTC Contracts: Delete"),
    ep("POST", "/clm/ctc-contracts/:id/approve", "CTC Contracts: Approve", J({"remarks": "Approved"})),
    ep("POST", "/clm/ctc-contracts/:id/reject", "CTC Contracts: Reject", J({"remarks": "Rejected"})),
    ep("POST", "/clm/ctc-contracts/:id/clarify", "CTC Contracts: Clarify", J({"message": "Please clarify clause 4"})),
    ep("POST", "/clm/ctc-contracts/:id/respond", "CTC Contracts: Respond", J({"message": "Clarified"})),
    ep("POST", "/clm/ctc-contracts/:id/resubmit", "CTC Contracts: Resubmit", J({"content": "<p>...</p>"})),
    ep("POST", "/clm/ctc-contracts/:id/send-for-signing", "CTC Contracts: Send For Signing", J({"recipients": [{"name": "John", "email": "john@test.test"}]})),
    ep("POST", "/clm/ctc-contracts/:id/record-signature", "CTC Contracts: Record Signature (multipart)", "form"),
    ep("POST", "/clm/ctc-contracts/:id/move-to-repository", "CTC Contracts: Move To Repository"),
    ep("GET", "/clm/ctc-contracts/:id/versions", "CTC Contracts: Versions"),
    ep("GET", "/clm/ctc-contracts/:id/versions/:v/download", "CTC Contracts: Download Version"),
]
# Diagnosis / profiles / regulatory
clm_items += [
    ep("GET", "/clm/buyer-profile", "Buyer Profile"),
    ep("GET", "/clm/supplier-profile", "Supplier Profile"),
    ep("GET", "/clm/diagnosis-resolution", "Diagnosis & Resolution"),
    ep("POST", "/clm/diagnosis-resolution/escalate", "Diagnosis: Escalate", J({"case_id": 1, "reason": "Overdue"})),
    ep("GET", "/clm/regulatory-defense", "Regulatory Defense File"),
]
# Clauses
clm_items += [
    ep("GET", "/clm/clause-types", "Clause Types: List"),
    ep("POST", "/clm/clause-types", "Clause Types: Create", J({"name": "Indemnity"})),
    ep("PUT", "/clm/clause-types/:id", "Clause Types: Update", J({"name": "Indemnity"})),
    ep("DELETE", "/clm/clause-types/:id", "Clause Types: Delete"),
    ep("GET", "/clm/clause-library", "Clause Library: List"),
    ep("POST", "/clm/clause-library", "Clause Library: Create", J({"title": "Standard Indemnity", "clause_type_id": 1, "content": "<p>...</p>"})),
    ep("PUT", "/clm/clause-library/:id", "Clause Library: Update", J({"title": "Standard Indemnity", "content": "<p>...</p>"})),
    ep("DELETE", "/clm/clause-library/:id", "Clause Library: Delete"),
]
# Segment rules
clm_items += [
    ep("GET", "/clm/segment-rules/bootstrap", "Segment Rules: Bootstrap"),
    ep("GET", "/clm/segment-rules/for-segment/:segmentId", "Segment Rules: For Segment"),
    ep("GET", "/clm/segment-rules", "Segment Rules: List"),
    ep("POST", "/clm/segment-rules", "Segment Rules: Create", J({"segment_id": 1, "party_type": "customer", "document_ids": [1, 2]})),
    ep("PUT", "/clm/segment-rules/:id", "Segment Rules: Update", J({"document_ids": [1, 2, 3]})),
    ep("DELETE", "/clm/segment-rules/:id", "Segment Rules: Delete"),
]
folder("CLM", clm_items)

# ----------------------- SEGMENT DOC UPLOADS -------------------------------
folder("Segment Uploads", [
    ep("GET", "/segment-uploads/download", "Download", query=[("path", "documents/file.pdf")]),
    ep("GET", "/segment-uploads/:type/:id/summary", "Summary"),
    ep("GET", "/segment-uploads/:type/:id/vault", "Vault"),
    ep("GET", "/segment-uploads/:type/:id", "List"),
    ep("POST", "/segment-uploads/:type/:id", "Upload (multipart)", "form"),
    ep("DELETE", "/segment-uploads/:type/:id/:uploadId", "Delete"),
])

# ----------------------------- P2P -----------------------------------------
folder("P2P Sourcing", [
    ep("GET", "/p2p/products", "Products"),
    ep("GET", "/p2p/team-members", "Team Members"),
    ep("GET", "/p2p/suppliers", "Suppliers"),
    ep("GET", "/p2p/new-suppliers", "New Suppliers"),
    ep("GET", "/p2p/new-suppliers/:supplier/sourcings", "Supplier Sourcings"),
    ep("GET", "/p2p/form-masters", "Form Masters"),
    ep("POST", "/p2p/upload", "Upload (multipart)", "form"),
    ep("GET", "/p2p/sourcing-targets", "Sourcing Targets: List"),
    ep("GET", "/p2p/sourcing-targets/next-code", "Sourcing Targets: Next Code"),
    ep("POST", "/p2p/sourcing-targets", "Sourcing Targets: Create", J({"title": "Q3 Rice Sourcing", "product_ids": [1, 2], "target_date": "2026-09-30"})),
    ep("GET", "/p2p/sourcing-targets/:target", "Sourcing Targets: Show"),
    ep("PUT", "/p2p/sourcing-targets/:target", "Sourcing Targets: Update", J({"title": "Q3 Rice Sourcing", "target_date": "2026-09-30"})),
    ep("GET", "/p2p/sourcing-targets/:target/report", "Sourcing Targets: Report"),
    ep("PATCH", "/p2p/sourcing-targets/:target/products/:product/status", "Set Product Status", J({"status": "sourced"})),
    ep("GET", "/p2p/sourcing-targets/:target/products/:product/suppliers", "Mapped Suppliers"),
    ep("POST", "/p2p/sourcing-targets/:target/products/:product/suppliers", "Map Supplier", J({"supplier_id": 1, "price": 1200})),
])

# --------------------------- SALES: LEADS ----------------------------------
folder("Sales - Leads", [
    ep("GET", "/sales/leads", "List"),
    ep("POST", "/sales/leads", "Create", J({"company_name": "Inbound Buyer", "contact_name": "Sam", "email": "sam@buyer.test", "phone": "9876543210", "source": "manual", "segment_id": 1})),
    ep("GET", "/sales/leads/sync/config", "Sync Config"),
    ep("POST", "/sales/leads/sync", "Sync From CRM (IndiaMart)", J({"from_date": "2026-06-01", "to_date": "2026-06-25"})),
    ep("POST", "/sales/leads/assign", "Assign", J({"lead_ids": [1, 2], "salesperson_id": 5})),
    ep("POST", "/sales/leads/convert-to-qualified", "Convert To Qualified", J({"lead_ids": [1]})),
    ep("GET", "/sales/leads/salespeople", "Salespeople"),
    ep("GET", "/sales/leads/salesperson-summary", "Salesperson Summary"),
    ep("GET", "/sales/leads/filter-options", "Filter Options"),
    ep("GET", "/sales/leads/:id/activity", "Activity"),
    ep("GET", "/sales/leads/:id", "Show"),
    ep("PUT", "/sales/leads/:id", "Update", J({"company_name": "Inbound Buyer", "stage": 2})),
    ep("DELETE", "/sales/leads/:id", "Delete"),
    ep("POST", "/sales/leads/:id/task-manager", "Task Manager (post/put)", J({"task": "Follow up", "due_date": "2026-07-01", "status": "open"})),
    ep("GET", "/sales/leads/:id/acknowledgements", "Acknowledgements: List"),
    ep("POST", "/sales/leads/:id/acknowledgements", "Acknowledgements: Store", J({"acknowledged": True, "reason_id": None, "notes": "ACK email sent"})),
    ep("POST", "/sales/leads/:id/whatsapp", "WhatsApp (post/put)", J({"phone": "9876543210", "message": "Hello"})),
    ep("GET", "/sales/leads/:id/products", "Lead Products: List"),
    ep("POST", "/sales/leads/:id/products", "Lead Products: Store", J({"product_id": 1, "quantity": 100, "uom_id": 1})),
    ep("PUT", "/sales/leads/:id/products/:mapping", "Lead Products: Update", J({"quantity": 150})),
    ep("DELETE", "/sales/leads/:id/products/:mapping", "Lead Products: Delete"),
    ep("PATCH", "/sales/leads/:id/products/:mapping/sourcing-status", "Lead Products: Set Sourcing Status", J({"sourcing_status": "in_progress"})),
    ep("PATCH", "/sales/leads/:id/products/:mapping/mark-sourced", "Lead Products: Mark Sourced", J({"vendor_id": 1, "price": 1200})),
    ep("POST", "/sales/leads/:id/products/:mapping/shared-prices", "Shared Prices: Store", J({"price": 1250, "currency_id": 1, "valid_until": "2026-07-15"})),
    ep("GET", "/sales/leads/:id/shared-prices", "Shared Prices: List"),
    ep("GET", "/sales/leads/:id/products/:mapping/shared-prices", "Shared Prices: List By Product"),
    ep("GET", "/sales/shared-prices/:id/pdf", "Shared Price: PDF"),
])

# --------------------- SALES: QUOTATIONS / PI ------------------------------
folder("Sales - Quotations", [
    ep("GET", "/sales/quotations", "List"),
    ep("GET", "/sales/quotations/preview-code", "Preview Code"),
    ep("POST", "/sales/quotations", "Create", J({"customer_id": 1, "lead_id": 1, "currency_id": 1, "items": [{"product_id": 1, "quantity": 100, "rate": 1200}], "notes": "..."})),
    ep("GET", "/sales/quotations/:id", "Show"),
    ep("PUT", "/sales/quotations/:id", "Update", J({"notes": "Updated", "items": [{"product_id": 1, "quantity": 120, "rate": 1180}]})),
    ep("DELETE", "/sales/quotations/:id", "Delete"),
    ep("POST", "/sales/quotations/:id/duplicate", "Duplicate"),
    ep("POST", "/sales/quotations/:id/convert-to-pi", "Convert To PI (NOTE: stub - use PI/from-quotation)"),
    ep("POST", "/sales/quotations/:id/preview-pdf", "Preview PDF", J({})),
    ep("POST", "/sales/quotations/:id/email", "Email", J({"to": "buyer@overseas.test", "subject": "Your Quotation", "message": "..."})),
    ep("POST", "/sales/quotations/:id/remind", "Remind", J({})),
])
folder("Sales - Proforma Invoices", [
    ep("GET", "/sales/proforma-invoices", "List"),
    ep("GET", "/sales/proforma-invoices/preview-code", "Preview Code"),
    ep("POST", "/sales/proforma-invoices", "Create", J({"customer_id": 1, "currency_id": 1, "items": [{"product_id": 1, "quantity": 100, "rate": 1200}], "notes": "..."})),
    ep("POST", "/sales/proforma-invoices/from-quotation/:quotationId", "From Quotation", J({})),
    ep("GET", "/sales/proforma-invoices/:id", "Show"),
    ep("PUT", "/sales/proforma-invoices/:id", "Update", J({"notes": "Updated"})),
    ep("DELETE", "/sales/proforma-invoices/:id", "Delete"),
    ep("POST", "/sales/proforma-invoices/:id/duplicate", "Duplicate"),
    ep("POST", "/sales/pi/preview-pdf", "Preview PDF (ad-hoc)", J({"customer_id": 1, "items": [{"product_id": 1, "quantity": 100, "rate": 1200}]})),
    ep("POST", "/sales/proforma-invoices/:id/preview-pdf", "Preview PDF", J({})),
    ep("POST", "/sales/proforma-invoices/:id/email", "Email", J({"to": "buyer@overseas.test", "subject": "Your PI", "message": "..."})),
    ep("POST", "/sales/proforma-invoices/:id/remind", "Remind", J({})),
])
folder("Sales - Public PDF (signed)", [
    ep("GET", "/sales/quotations/:id/view", "Public View Quotation (signed URL)", query=[("signature", "<signed>"), ("expires", "<ts>")]),
    ep("GET", "/sales/proforma-invoices/:id/view", "Public View PI (signed URL)", query=[("signature", "<signed>"), ("expires", "<ts>")]),
])

# --------------------- SALES: SHIPMENT / PROCUREMENT -----------------------
folder("Sales - Shipment Orders", [
    ep("GET", "/sales/shipment-orders/next-code", "Next Code"),
    ep("GET", "/sales/shipment-orders", "List"),
    ep("POST", "/sales/shipment-orders", "Create", J({"lead_id": 1, "customer_id": 1, "consignee_id": 1, "port_of_loading_id": 1, "port_of_discharge_id": 1})),
    ep("GET", "/sales/shipment-orders/:id", "Show"),
    ep("POST", "/sales/shipment-orders/:id", "Update (multipart)", "form"),
    ep("GET", "/sales/leads/:leadId/shipment-order", "Get By Lead"),
])
folder("Procurement", [
    ep("GET", "/procurements/next-number", "Next Number"),
    ep("GET", "/procurements", "List"),
    ep("POST", "/procurements", "Create", J({"lead_id": 1, "vendor_id": 1, "products": [{"product_id": 1, "quantity": 100, "rate": 1100}]})),
    ep("GET", "/procurements/:id", "Show"),
])

# --------------------- SALES: TODO (reminders/meetings) --------------------
folder("Sales - Reminders & Meetings", [
    ep("GET", "/sales/reminders", "Reminders: List"),
    ep("POST", "/sales/reminders", "Reminders: Create", J({"title": "Call buyer", "due_at": "2026-07-01 10:00", "lead_id": 1})),
    ep("PUT", "/sales/reminders/:id", "Reminders: Update (put/post)", J({"title": "Call buyer", "due_at": "2026-07-02 10:00"})),
    ep("PATCH", "/sales/reminders/:id/status", "Reminders: Set Status", J({"status": "done"})),
    ep("DELETE", "/sales/reminders/:id", "Reminders: Delete"),
    ep("GET", "/sales/meetings", "Meetings: List"),
    ep("GET", "/sales/meetings/next-code", "Meetings: Next Code"),
    ep("POST", "/sales/meetings", "Meetings: Create", J({"title": "Buyer call", "scheduled_at": "2026-07-01 11:00", "lead_id": 1, "attendees": ["sam@buyer.test"]})),
    ep("PUT", "/sales/meetings/:id", "Meetings: Update", J({"title": "Buyer call", "scheduled_at": "2026-07-02 11:00"})),
    ep("PATCH", "/sales/meetings/:id/status", "Meetings: Set Status", J({"status": "completed"})),
    ep("DELETE", "/sales/meetings/:id", "Meetings: Delete"),
    ep("GET", "/sales/lead-ack-reasons", "Lead Ack Reasons: List"),
    ep("POST", "/sales/lead-ack-reasons", "Lead Ack Reasons: Create", J({"reason": "No response"})),
    ep("PUT", "/sales/lead-ack-reasons/:id", "Lead Ack Reasons: Update", J({"reason": "No response"})),
    ep("DELETE", "/sales/lead-ack-reasons/:id", "Lead Ack Reasons: Delete"),
])

# --------------------------- ORGANIZATION TYPES ----------------------------
folder("Organization Types", [
    ep("GET", "/organization-types", "List"),
    ep("POST", "/organization-types", "Create", J({"name": "Exporter"})),
    ep("GET", "/organization-types/:id", "Show"),
    ep("PUT", "/organization-types/:id", "Update", J({"name": "Exporter"})),
    ep("DELETE", "/organization-types/:id", "Delete"),
])

# ------------------------------ HRMS ---------------------------------------
folder("HRMS - Overview", [
    ep("GET", "/hrms/overview", "Overview"),
])
folder("HRMS - Employees", [
    ep("GET", "/employees/next-code", "Next Code"),
    ep("GET", "/employees/managers", "Managers"),
    ep("GET", "/employees/available-assets", "Available Assets"),
    ep("GET", "/employees/check-mobile", "Check Mobile", query=[("mobile", "9876543210")]),
    ep("POST", "/employees/onboarding-invite", "Create Onboarding Invite", J({"name": "New Hire", "email": "newhire@acme.test", "mobile": "9876543210", "designation_id": 1, "department_id": 1})),
    ep("GET", "/employees", "List"),
    ep("POST", "/employees", "Create (multipart)", "form"),
    ep("GET", "/employees/:id", "Show"),
    ep("PUT", "/employees/:id", "Update (multipart)", "form"),
    ep("DELETE", "/employees/:id", "Delete"),
    ep("PATCH", "/employees/:id/restore", "Restore"),
    ep("DELETE", "/employees/:id/force", "Force Delete"),
    ep("GET", "/employees/:id/holidays", "Holidays"),
    ep("POST", "/employees/:id/set-password", "Set Password", J({"password": "Emp@1234", "password_confirmation": "Emp@1234"})),
    ep("GET", "/employees/:employee/documents", "Documents: List"),
    ep("POST", "/employees/:employee/documents", "Documents: Store (multipart)", "form"),
    ep("GET", "/documents/:document/download", "Documents: Download"),
    ep("PATCH", "/documents/:document/verify", "Documents: Verify"),
    ep("PATCH", "/documents/:document/reject", "Documents: Reject", J({"reason": "Blurry"})),
    ep("DELETE", "/documents/:document", "Documents: Delete"),
    ep("GET", "/employees/:employee/exit", "Exit: Show"),
    ep("PUT", "/employees/:employee/exit", "Exit: Upsert", J({"resignation_date": "2026-07-01", "last_working_day": "2026-07-31", "reason": "Personal"})),
    ep("POST", "/employees/:employee/exit/complete", "Exit: Complete", J({})),
    ep("GET", "/employees/:employee/previous-employments", "Previous Employments: List"),
    ep("POST", "/employees/:employee/previous-employments", "Previous Employments: Store", J({"company": "Prev Co", "designation": "Analyst", "from_date": "2020-01-01", "to_date": "2023-12-31"})),
    ep("PATCH", "/previous-employments/:prev", "Previous Employments: Update", J({"designation": "Sr Analyst"})),
    ep("DELETE", "/previous-employments/:prev", "Previous Employments: Delete"),
    ep("GET", "/employees/:employeeId/leave-balances", "Leave Balances"),
])
folder("HRMS - Recruitment", [
    ep("GET", "/recruitments/next-code", "Recruitments: Next Code"),
    ep("GET", "/recruitments", "Recruitments: List"),
    ep("POST", "/recruitments", "Recruitments: Create", J({"title": "Sales Exec", "department_id": 1, "openings": 2, "status": "open"})),
    ep("GET", "/recruitments/:id", "Recruitments: Show"),
    ep("PUT", "/recruitments/:id", "Recruitments: Update", J({"title": "Sales Exec", "openings": 3})),
    ep("DELETE", "/recruitments/:id", "Recruitments: Delete"),
    ep("GET", "/hiring-requests/next-code", "Hiring Requests: Next Code"),
    ep("GET", "/hiring-requests", "Hiring Requests: List"),
    ep("POST", "/hiring-requests", "Hiring Requests: Create", J({"designation_id": 1, "department_id": 1, "headcount": 1, "justification": "Growth"})),
    ep("GET", "/hiring-requests/:id", "Hiring Requests: Show"),
    ep("PUT", "/hiring-requests/:id", "Hiring Requests: Update", J({"headcount": 2})),
    ep("DELETE", "/hiring-requests/:id", "Hiring Requests: Delete"),
    ep("GET", "/recruitments/:recruitment/candidates/summary", "Candidates: Recruitment Summary"),
    ep("GET", "/candidates/stats", "Candidates: Stats"),
    ep("GET", "/candidates/sample", "Candidates: Sample Import File"),
    ep("POST", "/candidates/import", "Candidates: Import (multipart)", "form"),
    ep("GET", "/candidates/export", "Candidates: Export"),
    ep("GET", "/candidates", "Candidates: List"),
    ep("POST", "/candidates", "Candidates: Create (multipart)", "form"),
    ep("GET", "/candidates/:id", "Candidates: Show"),
    ep("PUT", "/candidates/:id", "Candidates: Update", J({"name": "Cand", "status": "shortlisted"})),
    ep("DELETE", "/candidates/:id", "Candidates: Delete"),
    ep("PATCH", "/candidates/:candidate/status", "Candidates: Update Status", J({"status": "interview"})),
    ep("GET", "/candidates/:candidate/cv", "Candidates: Download CV (public)"),
])
folder("HRMS - Onboarding (public)", [
    ep("GET", "/onboarding/:token", "Show (public, token-gated)"),
    ep("POST", "/onboarding/:token/complete", "Complete (public, multipart)", "form"),
])
folder("HRMS - Expenses & Advances", [
    ep("GET", "/expense-claims", "Expense Claims: List"),
    ep("GET", "/expense-claims/categories", "Expense Claims: Categories"),
    ep("POST", "/expense-claims", "Expense Claims: Create (multipart)", "form"),
    ep("GET", "/expense-claims/:id", "Expense Claims: Show"),
    ep("POST", "/expense-claims/:id/manager-approve", "Expense Claims: Manager Approve", J({"remarks": "OK"})),
    ep("POST", "/expense-claims/:id/manager-reject", "Expense Claims: Manager Reject", J({"remarks": "No"})),
    ep("POST", "/expense-claims/:id/hr-approve", "Expense Claims: HR Approve", J({"remarks": "OK"})),
    ep("POST", "/expense-claims/:id/hr-reject", "Expense Claims: HR Reject", J({"remarks": "No"})),
    ep("GET", "/expense-claims/:id/attachments/:index", "Expense Claims: Download Attachment"),
    ep("GET", "/advance-requests", "Advance Requests: List"),
    ep("POST", "/advance-requests", "Advance Requests: Create (multipart)", "form"),
    ep("GET", "/advance-requests/:id", "Advance Requests: Show"),
    ep("POST", "/advance-requests/:id/manager-approve", "Advance Requests: Manager Approve", J({"remarks": "OK"})),
    ep("POST", "/advance-requests/:id/manager-reject", "Advance Requests: Manager Reject", J({"remarks": "No"})),
    ep("POST", "/advance-requests/:id/hr-approve", "Advance Requests: HR Approve", J({"remarks": "OK"})),
    ep("POST", "/advance-requests/:id/hr-reject", "Advance Requests: HR Reject", J({"remarks": "No"})),
    ep("GET", "/advance-requests/:id/attachments/:index", "Advance Requests: Download Attachment"),
])
folder("HRMS - Payroll", [
    ep("GET", "/payroll", "Index"),
    ep("GET", "/payroll/cycles", "Cycles"),
    ep("GET", "/payroll/history", "History"),
    ep("GET", "/payroll/preflight", "Preflight", query=[("cycle", "2026-06")]),
    ep("GET", "/payroll/export", "Export", query=[("cycle", "2026-06")]),
    ep("POST", "/payroll/finalize-attendance", "Finalize Attendance", J({"cycle": "2026-06"})),
    ep("POST", "/payroll/run", "Run", J({"cycle": "2026-06"})),
    ep("POST", "/payroll/reopen", "Reopen", J({"cycle": "2026-06"})),
    ep("POST", "/payroll/approve", "Approve", J({"cycle": "2026-06"})),
    ep("POST", "/payroll/pay", "Pay", J({"cycle": "2026-06"})),
    ep("GET", "/payroll/payslips/bulk", "Payslips Bulk", query=[("cycle", "2026-06")]),
    ep("POST", "/payroll/payslips/email", "Email Payslips Bulk", J({"cycle": "2026-06"})),
    ep("GET", "/payroll/payslip/:id", "Payslip"),
    ep("GET", "/payroll/payslip/:id/pdf", "Payslip PDF"),
    ep("POST", "/payroll/payslip/:id/email", "Email Payslip", J({})),
    ep("GET", "/payroll/employee/:employeeId/payslips", "Employee Payslips"),
    ep("GET", "/payroll/fnf/:employeeId", "FnF"),
    ep("POST", "/payroll/payment/prepare", "Payment: Prepare", J({"cycle": "2026-06"})),
    ep("GET", "/payroll/payment/:id", "Payment: Show"),
    ep("POST", "/payroll/payment/:id/approve", "Payment: Approve", J({})),
    ep("POST", "/payroll/payment/:id/initiate", "Payment: Initiate", J({})),
    ep("GET", "/payroll/payment/:id/bank-file", "Payment: Bank File"),
    ep("GET", "/payroll/payment/:id/audit", "Payment: Audit Trail"),
    ep("GET", "/payroll-adjustments", "Adjustments: List"),
    ep("POST", "/payroll-adjustments", "Adjustments: Create", J({"employee_id": 1, "cycle": "2026-06", "type": "bonus", "amount": 5000, "reason": "Performance"})),
    ep("POST", "/payroll-adjustments/:id/approve", "Adjustments: Approve", J({})),
    ep("POST", "/payroll-adjustments/:id/reject", "Adjustments: Reject", J({"reason": "No"})),
    ep("DELETE", "/payroll-adjustments/:id", "Adjustments: Delete"),
    ep("GET", "/salary-structures/employees", "Salary Structures: Employees"),
    ep("GET", "/salary-structures", "Salary Structures: List"),
    ep("POST", "/salary-structures", "Salary Structures: Create", J({"employee_id": 1, "ctc": 600000, "components": [{"name": "Basic", "amount": 25000}]})),
    ep("GET", "/salary-structures/:id", "Salary Structures: Show"),
    ep("DELETE", "/salary-structures/:id", "Salary Structures: Delete"),
])
folder("HRMS - Attendance & Face", [
    ep("GET", "/face/status", "Face: Status"),
    ep("POST", "/face/register", "Face: Register", J({"descriptor": [0.01, -0.02, "...128 floats..."]})),
    ep("DELETE", "/face/data", "Face: Revoke"),
    ep("GET", "/attendance", "List"),
    ep("GET", "/attendance/daily-view", "Daily View", query=[("date", "2026-06-25")]),
    ep("GET", "/attendance/my", "My Attendance"),
    ep("GET", "/attendance/today", "Today"),
    ep("GET", "/attendance/employee/:employeeId/summary", "Employee Summary", query=[("month", "2026-06")]),
    ep("POST", "/attendance/face/clock-in", "Face Clock In", J({"descriptor": [0.01, -0.02, "...128 floats..."], "label": "Check In"})),
    ep("POST", "/attendance/face/clock-out", "Face Clock Out", J({"descriptor": [0.01, -0.02, "...128 floats..."], "label": "Check Out"})),
])
folder("HRMS - Leave", [
    ep("GET", "/leave-plans", "Plans: List"),
    ep("POST", "/leave-plans", "Plans: Create", J({"name": "Standard 2026", "year": 2026})),
    ep("GET", "/leave-plans/:id", "Plans: Show"),
    ep("PUT", "/leave-plans/:id", "Plans: Update", J({"name": "Standard 2026"})),
    ep("DELETE", "/leave-plans/:id", "Plans: Delete"),
    ep("POST", "/leave-plans/:id/clone", "Plans: Clone", J({"name": "Standard 2027"})),
    ep("POST", "/leave-plans/:id/make-default", "Plans: Make Default"),
    ep("POST", "/leave-plans/:id/types", "Plans: Assign Types", J({"type_ids": [1, 2]})),
    ep("DELETE", "/leave-plans/:id/types/:typeId", "Plans: Remove Type"),
    ep("PUT", "/leave-plans/:id/types/:typeId/config", "Plans: Save Type Config", J({"annual_quota": 12, "carry_forward": True})),
    ep("POST", "/leave-plans/:id/employees", "Plans: Assign Employees", J({"employee_ids": [1, 2]})),
    ep("DELETE", "/leave-plans/:id/employees/:employeeId", "Plans: Remove Employee"),
    ep("GET", "/leave-balances", "Leave Balances"),
    ep("GET", "/leave-requests", "Requests: List"),
    ep("POST", "/leave-requests", "Requests: Create", J({"leave_type_id": 1, "from_date": "2026-07-01", "to_date": "2026-07-03", "reason": "Vacation"})),
    ep("GET", "/leave-requests/approvals", "Requests: Approvals"),
    ep("GET", "/leave-requests/colleagues", "Requests: Colleagues On Leave"),
    ep("GET", "/leave-requests/:id", "Requests: Show"),
    ep("GET", "/leave-requests/:id/approvers", "Requests: Approvers"),
    ep("POST", "/leave-requests/:id/approve", "Requests: Approve", J({"remarks": "OK"})),
    ep("POST", "/leave-requests/:id/reject", "Requests: Reject", J({"remarks": "No"})),
    ep("POST", "/leave-requests/:id/cancel", "Requests: Cancel", J({})),
])
folder("HRMS - Holidays", [
    ep("GET", "/holiday-groups", "Groups: List"),
    ep("POST", "/holiday-groups", "Groups: Create", J({"name": "India 2026"})),
    ep("GET", "/holiday-groups/:id", "Groups: Show"),
    ep("PUT", "/holiday-groups/:id", "Groups: Update", J({"name": "India 2026"})),
    ep("DELETE", "/holiday-groups/:id", "Groups: Delete"),
    ep("GET", "/holidays/my", "My Holidays"),
    ep("POST", "/holidays/import", "Import (multipart)", "form"),
    ep("GET", "/holidays", "List"),
    ep("POST", "/holidays", "Create", J({"name": "Independence Day", "date": "2026-08-15", "holiday_group_id": 1})),
    ep("GET", "/holidays/:id", "Show"),
    ep("PUT", "/holidays/:id", "Update", J({"name": "Independence Day", "date": "2026-08-15"})),
    ep("DELETE", "/holidays/:id", "Delete"),
])
folder("HRMS - Documents & Templates", [
    ep("GET", "/hr-document-templates/stats", "Templates: Stats"),
    ep("GET", "/hr-document-templates/next-code", "Templates: Next Code"),
    ep("POST", "/hr-document-templates/upload-header-logo", "Templates: Upload Header Logo (multipart)", "form"),
    ep("GET", "/hr-document-templates/match", "Templates: Match For Employee", query=[("employee_id", "1")]),
    ep("GET", "/hr-document-templates/:id/download", "Templates: Download DOCX"),
    ep("GET", "/hr-document-templates/:id/generate", "Templates: Generate For Employee", query=[("employee_id", "1")]),
    ep("GET", "/hr-document-templates/:id/preview", "Templates: Preview For Employee", query=[("employee_id", "1")]),
    ep("POST", "/hr-document-templates/:id/upload-docx", "Templates: Upload DOCX (multipart)", "form"),
    ep("GET", "/hr-document-templates", "Templates: List"),
    ep("POST", "/hr-document-templates", "Templates: Create", J({"name": "Offer Letter", "content": "<p>Dear {{name}}...</p>"})),
    ep("GET", "/hr-document-templates/:id", "Templates: Show"),
    ep("PUT", "/hr-document-templates/:id", "Templates: Update", J({"name": "Offer Letter", "content": "<p>...</p>"})),
    ep("DELETE", "/hr-document-templates/:id", "Templates: Delete"),
    ep("GET", "/hr-custom-fields/stats", "Custom Fields: Stats"),
    ep("GET", "/hr-custom-fields/known-tokens", "Custom Fields: Known Tokens"),
    ep("POST", "/hr-custom-fields/validate-tokens", "Custom Fields: Validate Tokens", J({"tokens": ["{{name}}", "{{designation}}"]})),
    ep("GET", "/hr-custom-fields", "Custom Fields: List"),
    ep("POST", "/hr-custom-fields", "Custom Fields: Create", J({"label": "Blood Group", "token": "blood_group", "type": "text"})),
    ep("GET", "/hr-custom-fields/:id", "Custom Fields: Show"),
    ep("PUT", "/hr-custom-fields/:id", "Custom Fields: Update", J({"label": "Blood Group"})),
    ep("DELETE", "/hr-custom-fields/:id", "Custom Fields: Delete"),
    ep("GET", "/hr-generated-documents", "Generated Docs: List"),
    ep("POST", "/hr-generated-documents/preview", "Generated Docs: Preview", J({"template_id": 1, "employee_id": 1})),
    ep("POST", "/hr-generated-documents", "Generated Docs: Create", J({"template_id": 1, "employee_id": 1})),
    ep("GET", "/hr-generated-documents/:id", "Generated Docs: Show"),
    ep("GET", "/hr-generated-documents/:id/download", "Generated Docs: Download DOCX"),
    ep("GET", "/hr-document-signatures", "Signatures: List"),
    ep("POST", "/hr-document-signatures", "Signatures: Create", J({"generated_document_id": 1, "employee_id": 1})),
    ep("GET", "/hr-document-signatures/inbox", "Signatures: Inbox"),
    ep("GET", "/hr-document-signatures/:id", "Signatures: Show"),
    ep("POST", "/hr-document-signatures/:id/action", "Signatures: Action (multipart)", "form"),
    ep("POST", "/hr-document-signatures/:id/reject", "Signatures: Reject", J({"reason": "No"})),
    ep("POST", "/hr-document-signatures/:id/cancel", "Signatures: Cancel", J({})),
    ep("POST", "/hr-document-signatures/:id/remind", "Signatures: Remind", J({})),
    ep("GET", "/hr-document-signatures/:id/download", "Signatures: Download Signed"),
    ep("GET", "/hr-document-signatures/:id/download-pdf", "Signatures: Download Signed PDF"),
    ep("POST", "/hr-document-signatures/:id/email-employee", "Signatures: Email To Employee", J({})),
    ep("GET", "/employees/:slug/signed-documents", "Employee Signed Documents"),
])
folder("HRMS - My Team", [
    ep("GET", "/my-team/employees", "Employees"),
    ep("GET", "/my-team/approvals", "Approvals"),
    ep("GET", "/my-team/my-updates", "My Updates"),
])

# --------------------------- MASTERS ---------------------------------------
folder("Masters (generic)", [
    ep("GET", "/master-counts", "Counts (all masters)"),
    ep("GET", "/master/:slug", "List", query=[("search", "")], desc="slug e.g. countries, states, currencies, uom, departments, designations, payment-terms, incoterms ..."),
    ep("GET", "/master/:slug/next-code", "Next Code"),
    ep("POST", "/master/:slug", "Create", J({"name": "New Item", "code": "NEW", "status": "active"})),
    ep("GET", "/master/:slug/:id", "Show"),
    ep("PUT", "/master/:slug/:id", "Update", J({"name": "New Item", "status": "active"})),
    ep("DELETE", "/master/:slug/:id", "Delete"),
])

# --------------------------- NOTIFICATIONS / EMAIL -------------------------
folder("Notifications", [
    ep("GET", "/notifications", "List"),
    ep("GET", "/notifications/unread-count", "Unread Count"),
    ep("POST", "/notifications/read-all", "Mark All Read", J({})),
    ep("POST", "/notifications/:id/read", "Mark Read", J({})),
])
folder("Emails (Gmail module)", [
    ep("GET", "/emails", "List"),
    ep("GET", "/emails/stats", "Stats"),
    ep("GET", "/emails/recipients", "Recipients"),
    ep("POST", "/emails/bulk", "Bulk Send", J({"to": ["a@test.test"], "subject": "Hi", "body": "<p>...</p>"})),
    ep("GET", "/emails/:id", "Show"),
    ep("POST", "/emails", "Create / Send", J({"to": "a@test.test", "subject": "Hi", "body": "<p>...</p>"})),
])

# --------------------------- BILLING ---------------------------------------
folder("Billing - Subscription", [
    ep("GET", "/subscription/plans", "Plans"),
    ep("GET", "/subscription/status", "Status"),
    ep("POST", "/subscription/create-order", "Create Order", J({"plan_id": 1, "billing_cycle": "monthly"})),
    ep("POST", "/subscription/verify-payment", "Verify Payment", J({"razorpay_order_id": "order_x", "razorpay_payment_id": "pay_x", "razorpay_signature": "sig_x"})),
    ep("POST", "/subscription/cancel-order", "Cancel Order", J({"order_id": "order_x"})),
])
folder("Billing - Payments", [
    ep("GET", "/payments/stats", "Stats"),
    ep("GET", "/payments", "List"),
    ep("POST", "/payments", "Create", J({"plan_id": 1, "amount": 4999, "method": "manual", "reference": "TXN123"})),
    ep("GET", "/payments/:id", "Show"),
    ep("PUT", "/payments/:id", "Update", J({"status": "paid"})),
    ep("DELETE", "/payments/:id", "Delete"),
    ep("POST", "/payments/:payment/send-reminder", "Send Reminder", J({})),
    ep("GET", "/payments/:payment/invoice/download", "Invoice: Download (public)"),
    ep("GET", "/payments/:payment/invoice/view", "Invoice: View (public)"),
    ep("POST", "/razorpay/webhook", "Razorpay Webhook (public)", J({"event": "payment.captured", "payload": {}})),
])

# ---------------------- PERMISSIONS / SETTINGS -----------------------------
folder("Permissions", [
    ep("GET", "/modules", "Modules"),
    ep("GET", "/permissions/users", "Manageable Users"),
    ep("GET", "/permissions/user/:userId", "Get User Permissions"),
    ep("POST", "/permissions/user/:userId", "Save Permissions", J({"permissions": [{"module": "sales", "can_view": True, "can_edit": True}]})),
])
folder("Settings", [
    ep("GET", "/settings", "Index"),
    ep("PUT", "/settings/:section", "Update Section", J({"key": "value"}), desc="section e.g. general, security, appearance, sales, hr ..."),
    ep("POST", "/settings/appearance/asset", "Upload Appearance Asset (multipart)", "form"),
])

# --------------------------- MISC ------------------------------------------
folder("Misc", [
    ep("GET", "/dummy-items", "Dummy Items: List"),
    ep("POST", "/dummy-items", "Dummy Items: Create", J({"name": "Test"})),
    ep("GET", "/dummy-items/:id", "Dummy Items: Show"),
    ep("PUT", "/dummy-items/:id", "Dummy Items: Update", J({"name": "Test"})),
    ep("DELETE", "/dummy-items/:id", "Dummy Items: Delete"),
    ep("GET", "/tools/attendance-backfill", "TEMP: Attendance Backfill", query=[("key", "<guard-key>")]),
])

# ===========================================================================
# Build Postman v2.1 structure
# ===========================================================================

def build_url(path, query):
    segs = [s for s in path.split("/") if s != ""]
    raw = "{{base_url}}/" + "/".join(segs)
    url = {
        "raw": raw,
        "host": ["{{base_url}}"],
        "path": segs,
    }
    if query:
        url["raw"] = raw + "?" + "&".join(f"{k}={v}" for k, v in query)
        url["query"] = [{"key": k, "value": str(v)} for k, v in query]
    # variables for :params
    pvars = [s[1:] for s in segs if s.startswith(":")]
    if pvars:
        url["variable"] = [{"key": v, "value": "1"} for v in pvars]
    return url

def build_request(e):
    method = e["_m"]
    req = {
        "method": method,
        "header": [],
        "url": build_url(e["_p"], e["_q"]),
    }
    if e["_d"]:
        req["description"] = e["_d"]
    body = e["_b"]
    if body == "form":
        req["header"].append({"key": "Accept", "value": "application/json"})
        req["body"] = {
            "mode": "formdata",
            "formdata": [
                {"key": "field", "value": "value", "type": "text"},
                {"key": "file", "src": [], "type": "file"},
            ],
        }
    elif isinstance(body, dict):
        req["header"].append({"key": "Content-Type", "value": "application/json"})
        req["header"].append({"key": "Accept", "value": "application/json"})
        req["body"] = {
            "mode": "raw",
            "raw": json.dumps(body, indent=2),
            "options": {"raw": {"language": "json"}},
        }
    else:
        req["header"].append({"key": "Accept", "value": "application/json"})
    return req

login_test = (
    "// Auto-capture the Sanctum token on a successful login\n"
    "try {\n"
    "  const json = pm.response.json();\n"
    "  if (json && json.token) {\n"
    "    pm.collectionVariables.set('token', json.token);\n"
    "    console.log('Saved token to {{token}}');\n"
    "  } else if (json && json.needs_org_selection) {\n"
    "    console.log('Multiple orgs — resend login with a client_id from json.organizations');\n"
    "  }\n"
    "} catch (e) { console.log('No JSON token in response'); }\n"
)

def build_item(e):
    item = {"name": f"{e['_m']} {e['_n']}", "request": build_request(e)}
    if e["_p"] == "/login":
        item["event"] = [{"listen": "test", "script": {"type": "text/javascript", "exec": login_test.split("\n")}}]
    return item

out_items = []
for f in folders:
    out_items.append({
        "name": f["name"],
        "item": [build_item(e) for e in f["item"]],
    })

count = sum(len(f["item"]) for f in folders)

collection = {
    "info": {
        "name": "Cross_Border_Command API",
        "_postman_id": "cbc-collection-0001",
        "description": (
            f"Auto-generated from routes/api.php. {count} requests across {len(folders)} folders.\n\n"
            "## Setup\n"
            "1. Set the `base_url` collection variable (default `http://127.0.0.1:8000/api`).\n"
            "2. Run **Auth > POST Login** — the token is captured automatically into `{{token}}`.\n"
            "3. Every other request inherits Bearer `{{token}}` auth from the collection.\n\n"
            "## Notes\n"
            "- `branch_id` is auto-appended by the SPA on GETs; add `?branch_id={{branch_id}}` manually where you need branch scoping.\n"
            "- Requests marked *(multipart)* use form-data — attach files via the Body tab.\n"
            "- Path params (`:id`, `:customer`, ...) are exposed as URL variables (default `1`); edit per request.\n"
            "- JSON bodies are sample stubs — adjust field values to your tenant's data.\n"
        ),
        "schema": "https://schema.getpostman.com/json/collection/v2.1.0/collection.json",
    },
    "auth": {
        "type": "bearer",
        "bearer": [{"key": "token", "value": "{{token}}", "type": "string"}],
    },
    "event": [],
    "variable": [
        {"key": "base_url", "value": "http://127.0.0.1:8000/api", "type": "string"},
        {"key": "token", "value": "", "type": "string"},
        {"key": "branch_id", "value": "", "type": "string"},
    ],
    "item": out_items,
}

here = os.path.dirname(os.path.abspath(__file__))
out_path = os.path.join(here, "Cross_Border_Command.postman_collection.json")
with open(out_path, "w", encoding="utf-8") as fh:
    json.dump(collection, fh, indent=2)
print(f"Wrote {out_path}")
print(f"{count} requests in {len(folders)} folders")
