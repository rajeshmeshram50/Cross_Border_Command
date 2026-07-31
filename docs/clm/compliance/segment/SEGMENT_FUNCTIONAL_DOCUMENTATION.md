# SEGMENT — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · CLM → Compliance & Regulatory → **Segment**
> Route `/clm/segment` (also reachable as `/master/segments` — same table, same screen)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-31 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
A **Segment** is a line of trade — Tobacco, Rice, Food Grade Ethanol, Pharma. It is the root key of the entire CLM: every compliance rule, every required document, every applicable agreement and every T&C entry is scoped by segment. Customers, consignees, suppliers and products all carry one or more segments, and that is what decides which papers they owe.

Each segment declares two things beyond its name:
- **Regulatory status** — `Highly Regulated` or `Less Regulated`. This tier is matched against agreements, trade documents and T&C entries, so a highly-regulated segment only ever pulls highly-regulated paperwork.
- **Buyer ≠ Consignee** — whether a shipment in this segment may be delivered to a consignee different from the named buyer.

### 1.2 Business value
| Benefit | Description |
|---|---|
| One key for everything | Define a trade line once; every rule, document and agreement hangs off it |
| Tiering | Highly vs Less Regulated splits the whole compliance burden in two |
| Delivery control | Blocks buyer≠consignee shipments where the segment forbids it |
| Safe renames | A rename cascades into every customer / consignee record automatically |
| Cannot rot | A referenced segment freezes its name and tier so history stays valid |

### 1.3 Key features
- Add / edit / delete with a per-branch `SG-NNN` code.
- Tab counts — **All / Highly Regulated / Less Regulated**.
- Per-row **in-use badge** listing exactly where the segment is referenced.
- Name + regulatory-status **freeze** once referenced.
- Rename **cascade** into `customers.segment` and `consignees.segment`.
- Picker-cache bump so new/renamed/deleted segments reach the party forms immediately.

---

## 2. ROLES & ACCESS

| Role | Access |
|---|---|
| Super Admin | All segments, all tenants |
| Client Admin / Client User | The client's segments + globals; Branch Switcher narrows the view |
| Branch User | Globals + client-level + **own branch only** |
| Employee | **Reads the whole branch's** segments; may edit/delete only the ones they created |

Menu slug: `clm.segment`.

---

## 3. BUSINESS PROCESS FLOW

```
   Add Segment
     ├─ name                        (unique within your branch, case-insensitive)
     ├─ regulatory status           highly | less
     ├─ buyer ≠ consignee allowed?  allowed | not_allowed
     └─ status                      active | inactive
        │
        ▼  code SG-NNN allocated (restarts at 001 per branch)
   Segment saved → picker cache bumped
        │
        ├─→ Document Control Panel: build the (segment × domestic|international) rule
        ├─→ Customers / Consignees / Suppliers / Products: pick the segment
        ├─→ Agreements / Trade Docs / T&C: tag content to the segment (CSV)
        └─→ Evidence Vault: the party's required-document checklist
        │
        ▼  once referenced anywhere
   NAME and REGULATORY STATUS are frozen; DELETE is blocked (409 + used_in)
```

### 3.1 Why the freeze
Customers, consignees, the T&C library and the agreement library all store the segment **by name** (a comma-joined string), not by id. Renaming a referenced segment would orphan every one of those rows. The tier freeze exists because DCP rules and required-document sets are built against the tier — flipping it mid-life would silently invalidate compliance that has already been collected.

### 3.2 Why the picker only shows some segments
The Customer / Consignee / Supplier segment dropdown only lists segments whose **DCP rule has at least one document**. A brand-new segment therefore stays invisible in those forms until you configure its rule.

---

## 4. SCREEN SPECIFICATION (`ClmSegmentPage.tsx`)

| Element | Behaviour |
|---|---|
| Header | Page title + "What We Are Doing Here" collapsible brief box |
| Tabs | **All** · **Highly Regulated** · **Less Regulated** with live counts |
| Search | Client-side across code + name |
| Table | CODE · SEGMENT NAME · REGULATORY STATUS (pill) · BUYER ≠ CONSIGNEE (pill) · STATUS · ACTIONS |
| Row actions | Edit · Delete. Delete is **disabled with a tooltip** when `in_use` is true, listing the referencing areas |
| Add/Edit modal | Name, Regulatory Status, Buyer ≠ Consignee, Status. On an in-use row, Name and Regulatory Status render read-only |
| Ordering | Newest first (`id DESC`) so a freshly added segment appears at the top |
| Pager | Shared `WorklistPager` |

Validation messages arrive as `errors.name` / `errors.regulatory_status` so they render **inline under the field**, not as a global toast.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Segment name is unique **within your visibility scope**, case-insensitive; sibling branches may reuse it |
| 2 | `code` is immutable once allocated |
| 3 | `SG-NNN` restarts at 001 per branch; legacy `S-NNN` codes are still recognised by the allocator |
| 4 | Name is frozen while referenced (409) |
| 5 | Regulatory status is frozen while referenced (422) |
| 6 | Delete is blocked while referenced (409 + `used_in[]`) |
| 7 | A rename cascades into `customers.segment` / `consignees.segment`, whole tokens only — `Rice` never rewrites `Rice Bran` |
| 8 | Every create / update / delete bumps the cached master bundle |
| 9 | Employees may only edit or delete segments they created themselves |

### 5.1 Where "in use" is detected
| By segment **id** | By segment **name** |
|---|---|
| `clm_segment_rules.segment_id` | `customers.segment` |
| `vendors.segment_id` | `consignees.segment` |
| `products.segment_id` | `clm_tnc_library.segment` |
| `customers.segment_id` | `clm_agreement_library.segment` |
| `master_vendor_directory.segment_id` (string id **or** name) | |

---

## 6. STATUS MODEL

`active` \| `inactive`. An inactive segment stays in history but drops out of the pickers on the next cache refresh.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Rename cascade | Covers `customers` and `consignees` only — the T&C and Agreement libraries keep the old name until re-saved (though the freeze normally prevents the rename in the first place) |
| Delete | Hard delete, not soft — there is no restore |
| Legacy directory | `master_vendor_directory` stores the segment as a string that may be an id *or* a name; both are checked, but the data itself is inconsistent |
| Picker visibility | A segment without a DCP rule containing ≥ 1 document never appears in the party forms — this surprises new users |

---

*Related documents: SEGMENT_TECHNICAL_DOCUMENTATION.md · SEGMENT_CODE_WALKTHROUGH.md · SEGMENT_API_DOCUMENTATION.md*
