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
- **Healthcare (id=18)** is one of the branches. Every branch is an equal, isolated peer — its user (`healthcare@gmail.com`) sees only the Healthcare branch's data.
- **Agriculture / Purvi / Vortex** are the other branches. Their users likewise see only their own branch's data. Only the client admin sees across all branches.

---

## Login URLs

| Role | URL | Email | Password |
|---|---|---|---|
| Client Admin | https://www.mailinator.com/v4/public/inboxes.jsp?to=igc | igc@mailinator.com | Test@123 |
| Branch (Healthcare) | _(real Gmail)_ | healthcare@gmail.com | test@123 |
| Branch (Agriculture) | _(real Gmail)_ | agriculture@gmail.com | test@123 |
| Branch (Purvi) | _(real Gmail)_ | purvi@gmail.com | test@123 |
| Branch (Vortex) | _(real Gmail)_ | vortex@gmail.com | test@123 |

---

## Tenant scope (what each user sees)

| User | Sees |
|---|---|
| `igc@mailinator.com` (client_admin) | All 5 branches + all employees under IGC |
| `healthcare@gmail.com` (branch user) | Only Healthcare branch data |
| `agriculture@gmail.com` (branch user) | Only Agriculture branch data |
| `purvi@gmail.com` (branch user) | Only Purvi branch data |
| `vortex@gmail.com` (branch user) | Only Vortex branch data |
