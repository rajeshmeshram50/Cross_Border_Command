# IGC GROUP — Client & Branches

> Generated on 2026-05-11 from the live local DB.

---

## Client

| Field | Value |
|---|---|
| **ID** | 12 |
| **Org Name** | IGC GROUP |
| **Org Email** | igc@gmail.com |
| **Phone** | 7322121202 |
| **Website** | _(not set)_ |
| **Status** | active |
| **Plan** | Enterprise |
| **Plan Expires** | 2026-06-09 |

## Client Admin

| Field | Value |
|---|---|
| **Name** | IGC Admin |
| **Email** | igc@mailinator.com |
| **Password** | Test@123 |
| **User Type** | client_admin |
| **Status** | active |

---

## Branches (5 total)

| ID | Name | Main? | Status | Branch User Email | Password |
|---|---|---|---|---|---|
| 16 | IGC GROUP — Head Office | — | active | _(auto-stamped, no login user)_ | — |
| 17 | Agriculture | no  | active | agriculture@gmail.com | test@123 |
| 18 | Healthcare | **YES** | active | healthcare@gmail.com | test@123 |
| 19 | Purvi | no  | active | purvi@gmail.com | test@123 |
| 20 | Vortex | no  | active | vortex@gmail.com | test@123 |

### Notes

- **Head Office (id=16)** is the auto-created placeholder stamped on signup. It has no login user attached and is hidden from the Branches list by default (visible with `?include_head_office=true`).
- **Healthcare (id=18)** is the **main branch**. Its user (`healthcare@gmail.com`) has visibility across all sibling branches under IGC.
- **Agriculture / Purvi / Vortex** are sub-branches. Their users see only their own branch's data.

---

## Login URLs

| Role | URL | Email | Password |
|---|---|---|---|
| Client Admin | https://www.mailinator.com/v4/public/inboxes.jsp?to=igc | igc@mailinator.com | Test@123 |
| Main Branch (Healthcare) | _(real Gmail)_ | healthcare@gmail.com | test@123 |
| Sub Branch (Agriculture) | _(real Gmail)_ | agriculture@gmail.com | test@123 |
| Sub Branch (Purvi) | _(real Gmail)_ | purvi@gmail.com | test@123 |
| Sub Branch (Vortex) | _(real Gmail)_ | vortex@gmail.com | test@123 |

---

## Tenant scope (what each user sees)

| User | Sees |
|---|---|
| `igc@mailinator.com` (client_admin) | All 5 branches + all employees under IGC |
| `healthcare@gmail.com` (main branch) | All sibling branches (Agriculture / Purvi / Vortex / Healthcare) + their data |
| `agriculture@gmail.com` (sub branch) | Only Agriculture branch data |
| `purvi@gmail.com` (sub branch) | Only Purvi branch data |
| `vortex@gmail.com` (sub branch) | Only Vortex branch data |
