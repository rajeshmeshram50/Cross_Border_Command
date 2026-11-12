# CredVault Recycle Bin — Functional Documentation

Jira: **GT-74**

## 1. The feature in one paragraph

When someone deletes a credential in CredVault it is not erased. It goes to
the **Recycle Bin**, where it waits for a set number of days — the
**retention period**, 30 days unless changed. During that time it can be
**restored** to the vault it came from with every field, owner, attachment
and setting intact. When the period runs out it is **deleted permanently**
and automatically. A Vault Admin (the company's client admin or a Branch
Admin) can also delete an item early, empty the bin, and change the period.
Credentials from the **Critical Vault** follow a stricter rule: once in the
bin, only the **Branch Admin** of that credential's branch can restore or
delete them.

---

## 2. Where it lives

| | |
|---|---|
| Menu | CredVault mega-menu → **Vault Administration & Security → Recycle Bin**, and the **Quick Actions** row → Recycle Bin |
| URL | `/credentials-vault/recycle-bin` |
| Screen title | **Recycle Bin** |
| Who can open it | Client admins always; anyone else needs *View* on the **Credentials Vault** module in Permissions |
| Also reached from | Dashboard KPI **In Recycle Bin** (click opens the bin) |

Moving a credential **into** the bin happens on the vault screens: My Vault,
Team Vault, Critical Vault, and the View drawer — each row's bin icon opens
the **Move to Recycle Bin** confirm.

---

## 3. Moving a credential to the bin

### 3.1 The confirm popup

Title **Move to Recycle Bin**, sub-line
`You can restore it any time within {days} days`. It shows the credential
(icon, name, ID, type, URL, risk) and three points:

| Point | Text |
|---|---|
| Removed from … | `Removed from My Vault` / `Team Vault` / `Critical Vault`; below it `Access for N shared people is paused` if it is shared, else `It will no longer appear in any list` |
| Restorable for N days | `From the Recycle Bin, with all its details` — for a critical credential `From the Recycle Bin, by the Branch Admin only, with all its details` |
| Permanently deleted on {date} | `Unless you restore it before then` |

A tick box `Yes, move {name} to the recycle bin` must be ticked before
**Move to Bin** is enabled. While it runs the button reads
**Moving to Bin…** and, on My Vault and Critical Vault, Cancel and × are
locked. On success a yellow toast repeats the server message, e.g.:

```
“Gmail admin” moved to the Recycle Bin. It can be restored for 30 days.
“Prod DB root” moved to the Recycle Bin. It can be restored for 30 days — by the Branch Admin.
```

On failure: toast **Could not move it to the bin** with the reason.

### 3.2 A credential someone shared with you

There is no bin for it — you do not own it. The popup is **Remove from your
vault?** (`The original stays with its owner.`), tick
`I understand and want to remove it.`, button **Remove**. Only your own
access ends. If it reached you through a **team** share you are told:

```
This credential is shared with your whole team. Ask the owner to remove the team share.
```

### 3.3 Who may move a credential to the bin

| Credential | Who may bin it |
|---|---|
| Normal Vault, personal | The owner (or a person with a Full share — but see 3.2: a share always *removes*, never bins) |
| Normal Vault, team | Owner, client admin, the Branch Admin of the owner's/credential's branch, a manager above the owner, the department HOD over someone below them |
| Critical Vault, team | Owner, client admin, Branch Admin of the branch. **Not** managers or HODs |
| Critical Vault, personal | **The owner only** |

> **Say what is not true:** a Branch Admin can **not** bin an employee's
> personal Critical credential — this was observed (403) and the code
> agrees: on a personal credential the Branch Admin only has *View*
> access. The same Branch Admin **can** restore or delete that credential
> once the owner has binned it. See the Technical document §6.

### 3.4 What happens to a binned credential

- It disappears from every vault list, search, share list and health check.
- Any **access request in progress** on it (Critical Vault unlock) is
  cancelled.
- Its **shares are paused, not ended** — recipients lose it now and get it
  back on restore, as long as the share has not expired in the meantime.
- The audit log records **Moved to bin**.

---

## 4. The Recycle Bin screen

### 4.1 Top of the page

- **Strip:** title *Recycle Bin*, sub-line
  `Credentials moved to the bin stay here for {days} days — restore them anytime, or delete them permanently.`
  and the **Empty Bin** button (§6).
- **Brief:** four steps — *Move to Bin*, *Restore Anytime*,
  *Auto-delete After {days} Days*, *Delete Permanently*.
- **Hero card — Retention period:** `{days} days`,
  `Items are permanently deleted {days} days after they are moved to the bin.`
  and the **Change period** button (§7). The button shows for everyone; for a
  non-admin the popup is read-only.

### 4.2 The five cards

| Card | Value | Caption |
|---|---|---|
| Items in bin | Items in the current vault sub-tab | Restorable until purged |
| Deleted by me | Of those, binned by you | Moved to bin by you |
| Expiring soon | Purged within 7 days | Auto-deletes within 7 days |
| Critical items | Risk = Critical | High-risk credentials in bin |
| Next deletion | `N days` | `Deletes {name}` / `Bin is empty` |

The cards are for the **selected vault sub-tab** and **ignore the search**.
On the My Vault sub-tab *Critical items* is always 0 — Normal Vault
credentials are low/medium/high risk only.

### 4.3 Tabs, vault sub-tabs and search

```
 [ All Items 5 ] [ Deleted by Me 2 ] [ Team Credentials 1 ] [ Expiring Soon 1 ]   [search…]
 ( My Vault 4 ) ( Critical Vault 1 )
```

| Tab | Shows |
|---|---|
| All Items | Everything you can see in the bin |
| Deleted by Me | Items you moved to the bin |
| Team Credentials | Items that were in a Team Vault |
| Expiring Soon | Items that will be deleted within 7 days |

- The **tab badges** count **both vaults together**.
- The **sub-tab badges** count the current tab in each vault.
- **Every badge follows the search box.** Search covers credential ID,
  name, category, type, the owner's name and the name of who deleted it.
  Placeholder: `Search by credential ID, name, category or owner...`
- Changing tab, sub-tab or search returns to page 1.

### 4.4 Columns

`Sr. No · Credential ID · Credential Name · Category · Owner · Risk ·
Deleted By · Deleted On · Auto-delete In · Action`

| Column | What it shows |
|---|---|
| Credential ID | `CRD-0001` / `CCRD-0001` pill, type underneath |
| Owner | Initials, name (or *You*), and a *Team* / *Personal* tag |
| Deleted By | Initials and name; *You* when it was you |
| Auto-delete In | Days left, a bar, and `on {date}`; hover: `Deleted permanently on {date}` |
| Action | **Restore** button, and a red **Delete permanently** icon when allowed |

### 4.5 The Auto-delete countdown

| Days left | Colour (`urgency`) |
|---|---|
| 1–3 | Red (`bad`) |
| 4–7 | Amber (`warn`) |
| 8+ | Green (`ok`) |

- Days left is rounded **up** and is **never shown as 0** — an item still in
  the bin goes on its last day.
- The bar is the share of the period left (minimum 3 % width so it stays
  visible).
- Each row counts on **its own branch's** period, so two rows deleted on the
  same day can show different countdowns.

### 4.6 Loading and empty states

| State | What the operator sees |
|---|---|
| First load, or switching tab / vault sub-tab | Shimmer rows |
| Paging or typing in search | The old rows stay until the new ones arrive (no shimmer) |
| Load failed | `Could not load the recycle bin` + reason + **Try again** |
| Nothing found | `No items match your search` / `Try a credential name, ID, owner or category.` |
| Bin empty | `The recycle bin is empty` / `Credentials you move to the bin stay here for {days} days.` |

---

## 5. Restore and permanent delete

### 5.1 Restore

Click **Restore**. While it runs the button reads **Restoring…**. Toast:

```
“Old FTP” restored to Team Vault.
```

(*My Vault*, *Team Vault* or *Critical Vault* — wherever it came from.)
When Restore is greyed out, hovering it shows the reason:
`Only the Branch Admin can restore or delete Critical Vault items in the Recycle Bin.`

### 5.2 Delete permanently

The red icon opens **Delete permanently?** — *This cannot be undone.* — with
the credential card and two points (*All saved data is erased*,
*No way back*). Tick `I understand this credential cannot be restored.`
then **Delete Permanently**. Toast: `“Old FTP” deleted permanently.`

### 5.3 Who may do what in the bin

| | Normal Vault item | Critical Vault item |
|---|---|---|
| See it | Owner · who binned it · client admin (team items) · Branch Admin (branch's team items) | The same · **Branch Admin sees every Critical item of the branch** |
| Restore | Anyone who sees it | **Branch Admin of the item's branch only** |
| Delete permanently | Client admin or Branch Admin, if *Allow permanent delete* is on | Branch Admin of the branch, if *Allow permanent delete* is on |

An employee can always **restore** what they can see in My Vault's bin, but
can never delete permanently — they wait for the period to run out.

---

## 6. Empty Bin

**Empty Bin** (top right) empties **the vault sub-tab you are on** — not
both. Popup: **Empty the recycle bin?**,
`All {n} {My Vault|Critical Vault} items will be erased`,
`Every … item in the bin will be permanently deleted. The other vault's bin is not touched.`
Tick `I understand none of these credentials can be restored.` →
**Empty Bin**.

| Button disabled because | Hover text |
|---|---|
| Permanent delete is off in Policies | `Permanent delete is turned off in CredVault Policies` |
| You are a client admin on the Critical Vault sub-tab | `Only the Branch Admin can empty the Critical Vault bin` |
| You are not a Vault Admin | `Only a Vault Admin (client admin or Branch Admin) can empty the bin` |
| The sub-tab is empty | — |

If some items cannot be deleted by you, the rest go and the toast says so:
`3 items deleted permanently · 1 Critical Vault item left for the Branch Admin.`

---

## 7. The retention period

### 7.1 The rule

- **One period covers My Vault and Critical Vault.** (Older notes and the
  vault-screen code still talk about a "fixed" Critical period; there is
  none.)
- Options: **7, 15, 30, 60 or 90 days**. Company default **30**.
- The period is **per branch**: a branch may have its own; a branch without
  one uses the company default.
- Which branch an item follows: the branch it is filed under, else its
  owner's branch. An item with neither follows the company default.

| Who | What *Change period* changes |
|---|---|
| Branch Admin | Their own branch's period — everyone in the branch, both vaults |
| Client admin | The company default (every branch without its own) |
| Employee | Nothing — sees their branch's period, read-only |

A client admin can also set one branch's period, but **only through the
API** (`branch_id`); the screen always saves the company default.

> **Worth testing:** a client admin who has a branch selected in the branch
> switcher may see *that branch's* period in the popup ("for everyone in
> {branch}") while Save changes the company default. Found by reading the
> code, not reproduced — see Technical §8. The
company default can also be changed on **CredVault Policies → Recycle Bin →
Retention period**.

### 7.2 The Change period popup

Title **Retention period**:
`Choose how long credentials stay in the recycle bin before they are permanently deleted.`
followed by `One period for My Vault and Critical Vault, for everyone in {branch}.`
or `… — the company default, for every branch without its own period.`

- While it loads: shimmer tiles in place of the options, Save disabled.
- Five tiles, the current one highlighted. Locked for non-admins with the
  note `Only a Vault Admin (client admin or Branch Admin) can change the retention period.`
- Otherwise the note reads
  `One period for My Vault and Critical Vault. Items already older than the new period are deleted right away.`
- **Save** with the same value just closes. While saving, the popup is
  covered by a **Saving…** lock and Cancel is disabled.
- Toast on success: `Retention set to 7 days for Pune, for My Vault and Critical Vault · 2 items past the new period deleted.`

### 7.3 A shorter period that deletes things — Confirm & Delete

If the new period is shorter and some binned items are already older than
it, a second popup replaces the first:

```
 Change retention to 7 days?
 3 credentials will be permanently deleted. This cannot be undone.
  · Older than 7 days — These credentials have been in the bin longer than
    7 days, so the new period deletes them right away.
  · Everything else stays — Other items stay in the bin and are counted on
    the new 7-day period.
  ┌ CRD-0012  Old FTP                      23 days in bin ┐
  │ CRD-0019  Staging mail   Ravi's bin    19 days in bin │
  └ CCRD-0004 Root key       Asha's bin    12 days in bin ┘
  [x] I understand these 3 credentials will be deleted permanently.
                                   [Cancel] [Confirm & Delete]
```

- The list shows **every** credential the change deletes — yours and other
  people's. Another person's is tagged **{owner}'s bin**.
- While deleting: **Deleting…**, and Cancel / × / the tick are locked.
- Items deleted this way are logged as
  `Deleted automatically after {days} days in the bin`.

---

## 8. Automatic deletion

- Expired items are deleted **when anyone in the company opens the
  Recycle Bin** — there is no nightly job. Until somebody opens it, an
  expired item still exists in the database (invisible everywhere else).
- One person opening the bin deletes expired items of **every branch**, not
  only their own.
- When something was deleted on open, a toast says
  `{n} item(s) permanently deleted after {days} days`. *{n}* is
  company-wide and *{days}* is the viewer's period, so the sentence can be
  approximate for a client admin.
- Shortening the period (here or on Policies) deletes items past the new
  period immediately.

---

## 9. Business rules QA should never see broken

1. Deleting a credential from any vault puts it in the bin; it is not
   erased and disappears from every vault list.
2. A credential shared with you is **removed from your vault**, never
   binned; the owner's copy is unchanged.
3. Only the owner may bin a **personal Critical** credential; a Branch
   Admin gets 403.
4. Managers and HODs with Full access can bin a team **Normal** credential
   but not a team **Critical** one.
5. Binning cancels any open access request on that credential.
6. A restored credential returns to the vault it came from, with the same
   ID (`CRD-…`/`CCRD-…`), fields and attachments.
7. Shares on a binned credential come back after restore (unless expired).
8. Only the **Branch Admin of the item's branch** can restore or delete a
   Critical Vault item — not the owner, not the client admin.
9. An employee can restore Normal Vault items they see, but permanent
   delete and Empty Bin return 403.
10. With *Allow permanent delete* off, no one can delete or empty — restore
    and auto-delete still work.
11. Every tab and sub-tab badge follows the search; the cards do not.
12. *Auto-delete In* is never 0; red at ≤ 3 days, amber at ≤ 7.
13. Expiring Soon lists exactly the items purged within 7 days.
14. Each item counts down on **its own branch's** period.
15. A Branch Admin's period change affects only their branch, both vaults.
16. A shorter period that would delete items asks **Confirm & Delete**
    first and lists every affected credential.
17. Emptying an already empty bin returns *The Recycle Bin is already
    empty.*
18. A permanently deleted credential's ID is never issued again.

---

## 10. Roles and access — summary

| Action | Employee | Branch Admin | Client admin |
|---|---|---|---|
| Open the bin | with module View | with module View | always |
| Restore Normal item | ✓ (what they see) | ✓ | ✓ |
| Restore Critical item | ✗ | ✓ (own branch) | ✗ |
| Delete permanently / Empty — Normal | ✗ | ✓ | ✓ |
| Delete permanently / Empty — Critical | ✗ | ✓ (own branch) | ✗ |
| Change period | read-only | own branch | company default (screen), any branch (API) |

---

## 11. Audit entries

| Event | Audit action | Detail |
|---|---|---|
| Move to bin | `bin` (Moved to bin, warn) | `Moved to Recycle Bin` |
| Restore | `restore` (Restored, info) | `Restored from Recycle Bin` |
| Delete one | `purge` (Deleted permanently, critical) | `Deleted permanently` |
| Empty Bin | `purge` | `Deleted permanently (Empty Bin)` |
| Auto-delete | `purge`, no actor | `Deleted automatically after {days} days in the bin` |
| Branch period | `policy`, module Recycle Bin | `Retention period for {branch}: {from} days → {to} days` |
| Company period | `policy`, module CredVault Policies | `Retention period: 30 days → 7 days` (`Policy::format`) |
| Period change that deletes | `purge`, actor = the admin | `Deleted automatically after {days} days in the bin` |
