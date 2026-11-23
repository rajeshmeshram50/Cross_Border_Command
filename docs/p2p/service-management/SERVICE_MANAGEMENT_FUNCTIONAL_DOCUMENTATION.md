# P2P Service Management — Functional Documentation

## 1. The feature in one paragraph

Service Management is the catalogue of everything the company **buys that is
not a trade product**: laptops and stationery for its own use, software
subscriptions, and services such as audit, housekeeping or AC maintenance. Each
entry is a **service** with a code (`SVC-001`, `SVC-002`, …), a type, a GST rate
and the descriptive fields that type needs. A service is then **mapped to the
suppliers who can deliver it**, each at a price — a Domestic supplier in ₹ with
the service's GST added, or an International supplier in its own currency with
an exchange rate and no GST. A service is created in two stages (core details,
then suppliers) and is only **Active** once Stage 2 has been completed.

---

## 2. Where it lives

| | |
|---|---|
| Menu | **Procure to Pay (P2P) → P2P Master Management → Service Management** |
| URL | `/p2p/service-management` |
| Menu permission key | `p2p.service` |
| Screens | The service list (3 type tabs, sub-tabs) · **Add Service** type picker · the two-stage **Add / Edit** form · the **Mapped Service Suppliers** popup |

The page header reads **Service Management** — *"Manage the service catalogue,
service classification, SLA & pricing terms, and supplier mapping for service
procurement."* — with an **Add Service** button.

The collapsible **What We Are Doing Here** strip shows four steps:

| Step | Title | Text |
|---|---|---|
| 01 | Create Service | Define service name, code, scope and description. |
| 02 | Service Classification | Classify as Self-Consumable, Soft / Digital or Other Operational. |
| 03 | SLA & Pricing Terms | Set SLAs, billing cycle, renewal and pricing terms. |
| 04 | Supplier Mapping | Link services with eligible service providers. |

> The strip is descriptive. There is no separate SLA screen — billing frequency
> and contract terms are fields on the form (section 5).

---

## 3. The three service types

Every service belongs to exactly one type. The type decides which fields the
form shows and which suppliers can be mapped.

| Type | Tab label | Sub-types (classification) | What it covers |
|---|---|---|---|
| **Self-Consumable** | Self-Consumable Services | **Trackable Material / Goods** · **Consumable Material / Goods** | Physical goods for internal use. Trackable = laptops, printers, furniture, tracked one by one. Consumable = stationery, pantry, cleaning, tracked by quantity. |
| **Soft / Digital** | Soft / Digital Services | *none* | Software, platforms, subscriptions, APIs, licences, cloud. |
| **Other Operational** | Other Operational Services | **Professional** · **Utility** · **Facility** · **Maintenance** · **Outsourcing** | CA / legal / HR consultancy · electricity, water, internet · housekeeping, security, pantry · AC maintenance, repairs, AMC · recruitment, payroll, courier. |

---

## 4. The service list

### 4.1 Tabs

- **Type tabs** across the top — Self-Consumable Services, Soft / Digital
  Services, Other Operational Services — each with its count.
- **Sub-tabs** under the type, when it has sub-types:
  - Self-Consumable: *All Self-Consumable Services* · *Trackable Material / Goods* · *Consumable Material / Goods*
  - Other Operational: *All Other Operational Services* · *Professional Services* · *Utility Services* · *Facility Services* · *Maintenance Services* · *Outsourcing Services*
  - Soft / Digital has none.

Counts come from the server and respect the current search, so a tab shows how
many services *match*, not how many exist.

### 4.2 Columns

| Self-Consumable | Soft / Digital | Other Operational |
|---|---|---|
| Sr. No | Sr. No | Sr. No |
| Service Name *(with the code under it)* | Service Code *(with the created date)* | Service Code |
| Service Description | Service Name | Service Name |
| Service Category *(Trackable / Consumable badge)* | Service Description | Service Description |
| HSN / SAC Code | Service Category | Service Type *(Professional, Utility, …)* |
| Service Provider / Brand | HSN / SAC Code | Service Category |
| Segment | Service Provider / Brand | HSN / SAC Code |
| UOM | Service Segment | Service Provider / Vendor |
| Condition | Service Delivery Type | Billing Frequency |
| Mapped Suppliers | UOM | UOM |
| Action | Contract Required | Contract Required |
| | Mapped Supplier | Mapped Supplier |
| | Action | Action |

Long text in any column is clamped to two lines; the full value is in the
tooltip.

**Mapped Supplier(s)** shows the number of *active* supplier mappings as a
button. Its tooltip reads `Mapped Suppliers: N`. At **0** the button is
disabled, with the tooltip *"No suppliers mapped yet — use the Map Suppliers
button in Action"*.

### 4.3 Row actions

| Button | Does | Disabled when |
|---|---|---|
| **Edit** (pencil) | Opens the Edit form at Stage 1 | The service is inactive — tooltip *"Activate this service to edit it"* |
| **Map Suppliers** | Opens the Mapped Service Suppliers popup | The service is inactive — *"Activate this service to map suppliers"* |
| **Status switch** | Activate / deactivate, after a confirmation | The service is a **Draft** — *"Draft — map suppliers (Stage 2) to activate"* |

The confirmation for the switch:

- **Activate service?** — *"Service SVC-001 — … will be active again and can be edited and mapped to suppliers."*
- **Deactivate service?** — *"Service SVC-001 — … will be marked inactive. It stays in the list, but it can't be edited or mapped to suppliers until it's activated again."*

Inactive rows stay in the list, dimmed.

### 4.4 Search

One box: *"Search by service ID, name, category or supplier…"*. It matches the
code, name, description, provider / brand, delivery type, billing frequency,
category, segment, HSN code, UOM (title or short code), condition, and the name
or code of any **actively mapped** supplier. Case-insensitive.

### 4.5 Paging and layout

10, 25 or 50 rows per page. The table scrolls inside its card; the header, tabs
and pager stay in place. On a short screen (150 % zoom on a 1080p display) the
card still fills down to the footer.

### 4.6 Empty states

| Situation | Title | Line |
|---|---|---|
| No match for the search | No services match your search | Try a different code, name, category or supplier. |
| Nothing in this tab | No *trackable services* yet (etc.) | Services added with Add Service will be listed here. |

---

## 5. Adding a service

### 5.1 The type picker

**Add Service** opens a picker with three cards:

| No. | Card | Chips |
|---|---|---|
| 01 | Self-Consumable Services | Trackable · Consumable |
| 02 | Soft / Digital Services | Licences · SaaS · Cloud · APIs |
| 03 | Other Operational Services | Professional · Utility · Facility · +2 |

Self-Consumable and Other Operational then ask for the sub-type. The form opens
with the next code already shown (e.g. `SVC-108`) — a **preview**; the real
code is allocated when Stage 1 is saved.

### 5.2 The form

Title: **Add / Edit Trackable Self-Consumable Service** (or *Consumable …*,
*Soft / Digital Service*, *Other Operational Service*). A two-step stepper:

1. **Service Core Information**
2. **Map Service Suppliers** — *Link suppliers with price & GST*

The header carries a **GST (%)** button (section 5.4). The footer shows
*"Fields marked \* are required"* and the service code.

### 5.3 Stage 1 — fields by type

**Self-Consumable (Trackable and Consumable)** — *Service Core Information*,
*General Information*, *Attachment & Confidential Info*:

| Field | Required | Source / rule |
|---|---|---|
| Service Name | ✔ | 2–150 characters, must contain a letter |
| Make / Brand / Specifications | ✔ | Up to 255 characters |
| Segment | ✔ | Segment master (shows a High / Less regulatory badge) · **+** quick-add |
| Printable Description | ✔ | Up to 10,000 characters |
| Primary Image | ✔ | One image — PNG or JPG, 2 MB max · upload or **Take photo** |
| Secondary Images | | Up to 10 per save — PNG or JPG, 2 MB each |
| Haz / Non Haz | ✔ | Non Hazardous · Hazardous |
| Haz Class | ✔ *if Hazardous* | Haz Class master · **+** quick-add when Hazardous |
| UOM | ✔ | UOM master · **+** |
| HSN / SAC Code | ✔ | HSN master · **+** |
| Condition | ✔ | Conditions master · **+** |
| Packaging Material | ✔ | Packaging master · **+** |
| Attachment | | One file — PDF, PNG or JPG, 10 MB max · upload or **Take photo** |
| Confidential Info | | Up to 2,000 characters |

**Soft / Digital** — *Service Core Information*, *Attachment & Remarks*:

| Field | Required | Source / rule |
|---|---|---|
| Service Name | ✔ | 2–150 characters, must contain a letter |
| Service Category | ✔ | Service Category master, Soft / Digital rows only · **+** |
| Service Provider / Brand | ✔ | Up to 255 characters |
| Service Segment | ✔ | Segment master · **+** |
| Service Delivery Type | ✔ | Cloud / SaaS · On-Premise · Web / Browser · Mobile App · API · Remote Support · On-site Support · Hybrid |
| HSN / SAC Code | ✔ | HSN master · **+** |
| Unit of Measurement | ✔ | UOM master · **+** |
| Service Description | ✔ | Up to 10,000 characters |
| Contract Required | | Required · Not Required |
| Attachment | | One file — PDF, PNG or JPG, 10 MB max |
| Remarks | | Up to 2,000 characters |

**Other Operational** — the same as Soft / Digital except:

| Field | Required | Source / rule |
|---|---|---|
| Service Type | ✔ | Professional · Utility · Facility · Maintenance · Outsourcing |
| Service Category | ✔ | Only categories of **this** service type *and* sub-type |
| Service Provider / Vendor | ✔ | Up to 255 characters (label differs from Soft) |
| Department / Cost Centre | ✔ | Departments master |
| Billing Frequency | ✔ | Monthly · Quarterly · Half-yearly · Yearly · Per Use · One-time |

There is no Segment or Delivery Type on Other Operational.

**Every dropdown offers Active records only.** A record added through **+** as
Inactive is saved but does not appear — the form says so: *"Saved as Inactive —
Only Active records appear in this dropdown…"*.

### 5.4 GST — mandatory

Every service carries a GST rate. The **GST (%)** button in the form header
opens the GST list, where a rate can be mapped to the service (or added /
removed from the master). **Save & Next** refuses without one:

> *GST is mandatory — Map a GST % to this service before continuing.*

Once a **Domestic** supplier is mapped, the GST button is **locked** — tooltip
*"GST is locked — 1 domestic supplier is mapped to this service"* — because the
domestic prices were computed with it.

### 5.5 Save & Next

Validates every field and highlights the ones that fail (*"N fields need
attention — Fix the highlighted fields to continue."*), then saves Stage 1. The
service now exists as a **Draft** with its code. Errors coming back from the
server are attached to the field they belong to.

---

## 6. Stage 2 — mapping suppliers

Stage 2 (and the **Map Suppliers** row action) shows the mapped suppliers and a
**Map Supplier** button.

### 6.1 Which suppliers are offered

Only suppliers whose **Supplier Type serves this kind of service** — a
Trackable service is offered Trackable-service suppliers, a Professional
service Professional-service suppliers, and so on. A supplier already actively
mapped to the service is not offered again.

> If the dropdown is empty, the usual cause is data: no supplier has a Supplier
> Type set to this service's type.

### 6.2 Domestic or International

**Map Supplier** first asks which kind, showing how many of each are available:

| | Domestic Supplier | International Supplier |
|---|---|---|
| Who | Supplier based in India | Supplier based outside India |
| Price | In ₹ | In the supplier's currency |
| GST | The service's GST % is added | None |
| Extra fields | State · GST State Code | Country · City / Region · Currency · Exchange rate (₹ per unit) · ₹ equivalent |

The supplier's **origin is decided by its primary address country**, not by the
choice made here — picking the wrong side is refused (section 8).

The form auto-fills Supplier Code, Supplier Type, location and Contact Person
from the supplier. Only the price (and for International, the currency and
rate) are typed. A **+** beside the supplier opens the Add Supplier form, and a
pencil edits the selected supplier.

### 6.3 Limits

| | Max |
|---|---|
| Price | 9,99,99,99,999.99 |
| Exchange rate | 99,999.9999 |
| Total value (price + GST, or price × rate) | ₹ 999,999,999,999.99 |

### 6.4 Finishing

- **Submit Service** (Add) / **Update Service** (Edit) saves Stage 2 and closes
  the form. The service becomes **Active**.
- **Previous** goes back to Stage 1.
- Mapping and unmapping in the popup save immediately.

---

## 7. Statuses

| Status | Meaning on screen |
|---|---|
| **Draft** | Stage 1 saved, Stage 2 not finished. The switch is disabled. |
| **Active** | Usable. Editable, mappable. |
| **Inactive** | Switched off by a user. Stays in the list, dimmed; Edit and Map Suppliers are disabled until it is activated again. |

A Draft becomes Active when Stage 2 is completed — through **Submit / Update
Service**, or as soon as a first supplier is mapped from the popup.

---

## 8. Business rules QA should never see broken

1. **The code is per company branch, sequential, and never reused.** `SVC-` +
   3 digits, one higher than the highest code ever used in that branch —
   including deleted services.
2. **GST is mandatory** on every service.
3. **A Self-Consumable service must have a primary image.** Removing it without
   uploading a new one is refused: *"A primary image is required for
   Self-Consumable services."*
4. **Haz Class is required only when Haz / Non Haz is Hazardous**, and is
   cleared when it is not.
5. **A Service Category must belong to the service's type** — and for Other
   Operational, to its sub-type: *"The selected service category does not
   belong to this service type."*
6. **Changing a service's type clears every field the new type does not use.**
7. **A service cannot be activated before Stage 2:** *"Complete Stage 2 (Map
   Service Suppliers) before activating this service."*
8. **Domestic suppliers always use the service's GST.** Changing the service's
   GST re-prices every domestic mapping.
9. **The supplier's side is fixed by its country.** *"This supplier is based in
   India — map it as a Domestic supplier."* / *"This supplier is based in UAE —
   map it as an International supplier."*
10. **An International price is never in ₹:** *"Pick the supplier's currency —
    an International price is not in ₹."*
11. **A supplier is mapped to a service once.** *"This supplier is already
    mapped to the service."*
12. **Unmapping deactivates, it does not delete** — the mapping row stays as
    Inactive and is reactivated if the supplier is mapped again.
13. **Counts and search only count active mappings.**
14. **Dropdowns list Active master records only.**

---

## 9. Roles and access

| Who | Sees | Can change |
|---|---|---|
| Super Admin | Every service (filtered by the branch switcher) | Everything |
| Client Admin / Client User | Their company's services and global ones (branch switcher applies) | Rows their tier may change — see the Technical document, §8 |
| Branch User | Their branch's services, company-wide ones and global ones | Same rule |
| Employee | Services of their own branch, company-wide ones and global ones | Services **of their own branch**; otherwise only rows they created |

The menu item is gated by `p2p.service`. The API itself checks the sign-in and
the tenant; it does not re-check `p2p.service`.

---

## 10. What is not in this module

- **No delete.** A service is deactivated, never removed, from the screen.
- **No SLA document.** "SLA & Pricing Terms" in the steps strip means the
  billing frequency, contract flag and supplier prices.
- **Purchasing is elsewhere.** Services are bought through the P2P purchase
  flow; this module only defines what can be bought and from whom.
- **Suppliers are created in Supplier Management.** This module maps them.
