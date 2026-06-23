# Bulk Sourcing — Frontend API contract

All endpoints are **tenant-scoped** (derive `client_id`/`branch_id` from the
authenticated user — never trust the body). Standard envelope:
`{ "status": true, "data": ... }` for success, `{ "message", "errors" }` (422)
for validation. Auth: `auth:sanctum` + `user.active`.

> Frontend already calls these (static data removed). Until the backend exists
> the screens show loading → empty/error states gracefully.

---

## 1. List — `GET /p2p/sourcing-targets`
Drives the two tabs on the main page.
```jsonc
// response.data
{
  "assigned": [SourcingRow],   // targets assigned TO the current user
  "created":  [SourcingRow]    // targets the current user created
}
// SourcingRow
{ "id":"SRC-002", "source":"Product Master"|"Manual Entry",
  "start":"2026-01-05", "due":"2026-03-31",
  "createdBy":"Admin", "assignee":"Parth Lakare",
  "products":13, "completed":8 }
```

## 2. Product master — `GET /p2p/products`
For the "From Product Master" picker in Assign.
```jsonc
"data": [ { "id":1, "code":"P-001", "name":"...", "segment":"Rice", "hsn":"10063020" } ]
```

## 3. Team members — `GET /p2p/team-members`
Assignable people (SAME branch only). For "Assign to Team Member".
```jsonc
"data": [ { "id":"u1", "name":"Arjun Mehta", "role":"Procurement Lead" } ]
```

## 4. Create — `POST /p2p/sourcing-targets`
```jsonc
// body
{ "due_date":"2026-07-01", "source":"master"|"manual",
  "assignee_id":"u1"|null,
  "products":[
    { "from":"master", "product_id":1, "target_price":"89.25",
      "clarity": { "type":"text"|"link"|"pdf", "value":"..." } | null },
    { "from":"manual", "name":"Office Printer A4", "target_price":"1200", "clarity":null }
  ] }
// response.data → { "id":"SRC-035" }
```

## 5. Get one (edit pre-fill) — `GET /p2p/sourcing-targets/{id}`
```jsonc
"data": {
  "id":"SRC-002", "source":"Product Master", "start":"...", "due":"...",
  "assignee":"Parth Lakare",
  "masterRows":[ { "code","name","segment","hsn","price","clarity" } ],
  "manualRows":[ { "name","price","clarity" } ]
}
```

## 6. Update — `PUT /p2p/sourcing-targets/{id}`
Same body as create (without changing `source`).

## 7. Report — `GET /p2p/sourcing-targets/{id}/report`
Drives the Sourcing Report modal.
```jsonc
"data": {
  "id","source","start","due","createdBy","assignee",
  "products":[
    { "type":"master"|"manual", "code":"P-011", "name":"...", "segment":"Instrumentation",
      "hsn":"90262090", "price":"₹1,517", "status":"Completed"|"In Progress",
      "supplierCount":1, "clarity": "<file/text>"|null }
  ]
}
```

## 8. Toggle product status — `PATCH /p2p/sourcing-targets/{id}/products/{productId}/status`
```jsonc
// body → { "status":"Completed"|"In Progress" }   response.data → updated product
```

## 9. Supplier master — `GET /p2p/suppliers`
For the Map Supplier "Supplier Master" dropdown.
```jsonc
"data": [ { "id":"S-001", "name":"...", "segment":"Mechanical",
            "contact":"Rahul Shah", "mobile":"9876543210", "email":"rahul@techparts.in" } ]
```

## 10. Map supplier to a product — `POST /p2p/sourcing-targets/{id}/products/{productId}/suppliers`
```jsonc
// body (one of)
{ "supplier_id":"S-004" }                       // from master
{ "new_supplier": { "name","contact","mobile","segment","email","gmaps",
                    "address","country","state","state_code","city" } }  // new
// response.data → { "supplierCount":2 }
```

## 11. Mapped suppliers for a product — `GET /p2p/sourcing-targets/{id}/products/{productId}/suppliers`
Drives the Mapped Suppliers popup.
```jsonc
"data": [ { "id":"S-007","name":"...","segment":"Valves","contact":"...",
            "mobile":"...","email":"...","source":"Master"|"New Supplier" } ]
```

## 12. States (reference, EXISTING) — `GET /master/states`
Used by the New Supplier form's State dropdown. Reuse the existing master if available.

---

### Suggested DB tables (for backend phase)
- `p2p_sourcing_targets` — id, code (SRC-###), client_id, branch_id, source, start_date, due_date, created_by, assignee_id, status, timestamps.
- `p2p_sourcing_products` — id, target_id, source(master/manual), product_id(nullable), name, segment, hsn, target_price, clarity_type, clarity_value, status, timestamps.
- `p2p_sourcing_product_suppliers` — id, sourcing_product_id, supplier_id(nullable), name, segment, contact, mobile, email, source(master/new), timestamps.
- (suppliers can reuse the existing **vendors** master, or a dedicated `p2p_suppliers`.)
