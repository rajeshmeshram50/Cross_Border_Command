# Email storage & uniqueness — how it works

Where email addresses live in Cross_Border_Command, what stops the same address
being used twice, and how to change the rules.

*Written 2026-09-08. Figures below were measured against the live `c_b_c`
schema, not estimated.*

---

## 1. The short version

| Question | Answer |
|---|---|
| How many tables hold an email address? | **29 tables, 34 columns** |
| How many are protected against duplicates? | **9 columns, across 6 identity scopes** |
| Where are the rules written? | **`config/email_uniqueness.php`** — one file |
| What does the user see on a duplicate? | HTTP **422**, *"This email address is already used by another customer in the system."* |
| What does one check cost? | **~0.7 ms, one database query** |
| Do I have to change controllers to add a rule? | **No.** One line of config + the trait on the model |

---

## 2. Every table that stores an email address

41 columns are named `*email*`. They fall into three groups.

### 2a. Real addresses — 33 text columns in 29 tables

**Identity & auth**

| Table | Column(s) | Protected? |
|---|---|---|
| `users` | `email` | ✅ scope `login` |
| `employees` | `email`, `official_email` | ✅ scope `employee` |
| `password_reset_otps` | `email` | — transient |
| `password_reset_tokens` | `email` | — transient |

**Tenancy**

| Table | Column(s) | Protected? |
|---|---|---|
| `clients` | `email` | — org contact, not an identity |
| `branches` | `email` | — org contact, not an identity |

**Customers & consignees**

| Table | Column(s) | Protected? |
|---|---|---|
| `customers` | `primary_email` | ✅ scope `customer` |
| `customer_owners` | `official_email` | — child of customer |
| `customer_addresses` | `cp_email` | — child of customer |
| `consignees` | `primary_email` | ✅ scope `consignee` |
| `consignee_owners` | `official_email` | — child of consignee |
| `consignee_addresses` | `cp_email` | — child of consignee |

**Vendors & suppliers**

| Table | Column(s) | Protected? |
|---|---|---|
| `vendors` | `primary_email` | ✅ scope `vendor` |
| `p2p_suppliers` | `email` | ✅ scope `vendor` |
| `vendor_addresses` | `email` | — child of vendor |
| `product_vendor_maps` | `email` | — mapping copy |
| `p2p_sourcing_product_suppliers` | `email` | — mapping copy |
| `master_vendor_directory` | `email_id` | — lookup master |

**Sales**

| Table | Column(s) | Protected? |
|---|---|---|
| `leads` | `sender_email`, `sender_email_alt` | — inbound, duplicates expected |
| `lead_task_managers` | `email` | — task contact |
| `sales_meetings` | `email` | — meeting contact |
| `debit_notes` | `email` | — document copy |

**HR**

| Table | Column(s) | Protected? |
|---|---|---|
| `candidates` | `email` | ✅ scope `candidate` |
| `employee_onboarding_invites` | `invitee_email` | ✅ scope `candidate` |
| `previous_employments` | `hr_email_1`, `hr_email_2` | — third-party referee |

**Masters & logs**

| Table | Column(s) | Protected? |
|---|---|---|
| `master_company` | `email` | — lookup master |
| `master_departments` | `email` | — lookup master |
| `email_logs` | `from_email`, `to_email` | — audit of mail sent |
| `ctc_contracts` | `primary_approver_email` | — document copy |

### 2b. One JSON column

`ctc_contracts.approver_emails` is a **JSON array**, not a string.

> ⚠️ Any "find this address everywhere" job — GDPR erasure, a bad-address
> sweep, a bulk update — will silently miss this column unless it casts. A
> plain `WHERE ... = ?` errors on it.

### 2c. Named `*email*` but NOT addresses — 7 columns

Flags and timestamps. Never treat these as addresses.

| Column | Type | Meaning |
|---|---|---|
| `users.email_active` | boolean | login slot in use |
| `users.email_verified_at` | timestamp | verification time |
| `announcements.notify_email` | boolean | "send mail?" flag |
| `employees.probation_completion_emailed_at` | timestamp | mail sent at |
| `expense_claims.reimbursement_emailed_at` | timestamp | mail sent at |
| `quotations.emailed_at` | timestamp | mail sent at |
| `proforma_invoices.emailed_at` | timestamp | mail sent at |

---

## 3. Why it is NOT "unique across every table"

The original request was: *if the address exists in any table, refuse it.*
**That cannot work**, and the data proves it. Verified on live records:

1. **A customer writes the same address to two tables in one save.**
   `customers.primary_email` is copied to `customer_addresses.cp_email` in the
   same operation (confirmed on customer #15). A blanket rule fails every
   customer create on its own second row.
2. **Consignee cloning copies it deliberately.** `ConsigneeKycMirror` deep-copies
   a customer's contact details onto its consignee. That is a feature.
3. **An employee's address IS their login.** `employees.email` and `users.email`
   holding the same value is the pairing, not a mistake.
4. **`email_logs` contains every address ever mailed** — by definition.
5. **Leads legitimately repeat.** IndiaMart sends many enquiries from one buyer.

A blanket rule would make it impossible to create a customer, clone a
consignee, or onboard an employee.

**So the rule is: unique per IDENTITY.** Two records *of the same kind* cannot
share an address. A customer who is also a vendor still can.

---

## 4. The six scopes

A **scope** = one identity. Tables in the same scope share one namespace.

| Scope | Covers | Meaning |
|---|---|---|
| `login` | `users.email` | one login per address per client |
| `employee` | `employees.email`, `employees.official_email` | two employees can't share |
| `candidate` | `candidates.email`, `employee_onboarding_invites.invitee_email` | can't invite the same person twice |
| `customer` | `customers.primary_email` | two customers can't share |
| `consignee` | `consignees.primary_email` | two consignees can't share |
| `vendor` | `vendors.primary_email`, `p2p_suppliers.email` | two tables, one real party |

All scopes are **tenant-scoped**: unique *within a client*. The same person may
hold an account at two client organisations — login disambiguates by org. This
matches the existing `users_email_client_unique` database index.

---

## 5. How it works

### The four pieces

```
config/email_uniqueness.php     ← the RULES (the only file you normally edit)
          │
          ▼
app/Support/EmailGuard.php      ← reads the rules, answers "is it taken?"
          │
    ┌─────┴─────┐
    ▼           ▼
EnforcesUniqueEmail        UniqueSystemEmail
(model trait —             (validation rule —
 catches every             nice field-level
 write path)               message on forms)
```

### What happens on a save

```
User submits a form
        │
        ▼
Controller → $model->save()
        │
        ▼
EnforcesUniqueEmail  (fires on "saving")
        │
        ├── Is an email column CHANGED?  ── no ──► save proceeds
        │        (or is this a RESTORE?)
        ▼ yes
EmailGuard::conflict(scope, email, client_id, ignore-self)
        │
        ├── normalise: lower + trim
        ├── for each source table in the scope:
        │      SELECT id WHERE lower(trim(col)) = ?
        │        AND deleted_at IS NULL
        │        AND (client_id = ? OR client_id IS NULL)
        │        AND id <> <the row being edited>
        │      LIMIT 1                       ← stops at first hit
        ▼
   found? ──► throw ValidationException → HTTP 422 on that field
   not found? ──► save proceeds
```

### Key behaviours

| Behaviour | Why |
|---|---|
| Compares `lower(trim(...))` at **both** ends | `" Ravi@X.com "` and `"ravi@x.com"` are one address. Without this, a duplicate slips past a plain `WHERE email = ?` |
| Only **changed** columns are checked | Editing a phone number can't be blocked by a legacy email clash |
| A **restore** re-checks every column | Deleting frees the address; someone may have taken it. Restoring must not resurrect a duplicate |
| A row never collides with **itself** | Re-saving your own address is fine |
| Blank / null are **never** blocked | Not every record has an address |
| Soft-deleted rows are **ignored** | Deleting a record frees its address for reuse |
| Rows with `client_id IS NULL` count for **every** tenant | They belong to no one; treating them as free would let a platform address be claimed twice |

---

## 6. What the user sees

> **This email address is already used by another customer in the system. Please use a different address.**

- HTTP **422**, keyed on the offending field (`primary_email`, `email`, …), so
  the form highlights the right box.
- The `another customer` part changes per scope — *another employee*,
  *another vendor or supplier*, *another user account*, etc.
- It deliberately **does not name the other record**. Telling an operator which
  customer holds the address would leak data across the tenant boundary the
  rest of the app is careful about.

---

## 7. Performance

One check = **one indexed query per source table**, stopping at the first hit.

| | Time |
|---|---|
| Check, address free (customer scope) | **0.556 ms** |
| Check, address taken (stops early) | **0.424 ms** |
| Two-table scope (`vendor`) | **0.799 ms** |
| Two-column scope (`employee`) | **1.178 ms** |
| **Guard's share of a full save** | **0.695 ms** |
| Naive "check all 33 columns" alternative | 12.8 ms (and crashes — see below) |

**Two things make it fast:**

1. **Functional indexes.** Each protected column has a
   `lower(trim(column))` index. Postgres cannot use a plain btree for that
   predicate and would scan the whole table on every save. Confirmed the
   planner uses them: `Index Scan using customers_primary_email_lower_idx`.
2. **Cached schema lookups.** The guard asks whether columns exist
   (`deleted_at`, `client_id`). Those hit `pg_class`/`pg_attribute` and were
   **4 of the 5 queries per check** — 6.8 ms, and 87% of a customer save.
   The column list is now read once per table into memory. Result: **5 queries
   → 1**, 12–15× faster.

> The naive alternative isn't just slower — it **crashes**, because
> `password_reset_tokens` has no `id` column.

Indexes are **non-unique** on purpose: the existing data already contains
legitimate duplicates, so a unique index could not be created without failing
the migration.

---

## 8. How to manage it

### Add a table to an existing rule

**Two steps.**

1. Add the source in `config/email_uniqueness.php`:
   ```php
   'vendor' => [
       'sources' => [
           ['table' => 'vendors',       'column' => 'primary_email', 'soft_deletes' => true],
           ['table' => 'p2p_suppliers', 'column' => 'email',         'soft_deletes' => true],
           ['table' => 'my_new_table',  'column' => 'email',         'soft_deletes' => true],  // ← new
       ],
   ],
   ```
2. Add the trait to that table's model:
   ```php
   use EnforcesUniqueEmail;
   protected static string $emailScope   = 'vendor';
   protected static array  $emailColumns = ['email'];
   ```

Then add an index (copy the pattern in
`2026_09_08_000001_add_lower_email_indexes_for_uniqueness.php`).

> ⚠️ **Step 2 is not optional.** Config alone makes the table *readable* by the
> check but leaves its own writes unguarded — a real bug that was found and
> fixed on `employee_onboarding_invites`.

### Make two entity types share a namespace
Put them in the **same scope**. That is the only knob.

### Let two types share an address
Put them in **different scopes**.

### Turn a rule off
Delete the scope, or remove the trait from the model.

---

## 9. QA test checklist

**Add**
- [ ] New unique address → accepted
- [ ] Exact duplicate → refused
- [ ] Duplicate differing only in CASE → refused
- [ ] Duplicate with leading/trailing spaces → refused
- [ ] Same address in a different client → accepted
- [ ] Blank / null address → accepted

**Edit**
- [ ] Change an unrelated field → saves
- [ ] Re-save your own address (same, or different case) → saves
- [ ] Change to a free address → saves
- [ ] Change to another record's address → refused
- [ ] Clear the address → saves

**Lifecycle**
- [ ] Delete a record → its address becomes reusable
- [ ] Re-take that address on a new record → accepted
- [ ] Restore the deleted record → **refused** (would duplicate)
- [ ] Restore when the address is still free → accepted, row live again

**Message**
- [ ] 422 keyed on the right field
- [ ] Reads "already used by another &lt;type&gt;"
- [ ] Does not name the other record

**Cross-table**
- [ ] A vendor's address blocks a p2p supplier, and vice versa
- [ ] A candidate's address blocks an onboarding invite, and vice versa
- [ ] A customer's address does **not** block a vendor (different scopes)

---

## 10. Known limits

1. **A genuinely simultaneous race can slip through.** The guard is a `SELECT`
   then an `INSERT`. Two requests in the same millisecond can both pass. A
   double-click is caught; true concurrency is not. Only `users.email` has a
   real database unique index. **To close it:** clean the existing duplicates
   per scope, then add partial unique indexes.

2. **Existing duplicates are untouched.** The rule fires only on changed
   columns, so historic clashes don't block unrelated edits. New and edited
   data is clean from here.

3. **Unprotected tables are unprotected by design** — child addresses, logs,
   masters and leads. See §3.

4. **`ctc_contracts.approver_emails` (JSON) takes part in nothing.** Any
   whole-system address sweep must handle it separately.

---

## 11. File map

| File | Role |
|---|---|
| `config/email_uniqueness.php` | **The rules.** Scopes, sources, tenant flag, messages |
| `app/Support/EmailGuard.php` | Answers "is it taken?"; normalisation, schema cache |
| `app/Support/Concerns/EnforcesUniqueEmail.php` | Model trait — enforces on every write |
| `app/Rules/UniqueSystemEmail.php` | Validation rule for field-level form errors |
| `database/migrations/2026_09_08_000001_add_lower_email_indexes_for_uniqueness.php` | The 9 functional indexes |

**Guarded models:** `User`, `Employee`, `Candidate`, `EmployeeOnboardingInvite`,
`Customer`, `Consignee`, `Vendor`, `P2p\Supplier`.
