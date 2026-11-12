# CredVault Password Health — Functional Documentation

> Jira **GT-75**. The end-to-end flow across My Vault, Password Health, the
> Recycle Bin and Import / Export is in `docs/credvault/README.md`.

## 1. The feature in one paragraph

Password Health looks across every credential you own or manage and lists what
is wrong with each one: a password weaker than the company policy allows, the
same password used on two credentials, two-factor authentication switched off
where the policy needs it, a password that is past (or close to) its rotation
date, and a credential shared with too many people. It gives the whole set a
score out of 100, five summary cards, and a list you can filter and search.
Every row has a **Fix** button that takes you straight to the place where the
problem is fixed — the credential's edit form, or the list of shares — and
when you save, the screen tells you how many issues the save resolved. Nothing
is stored by this screen: every time it loads, it checks the credentials again.

---

## 2. Where it lives

| | |
|---|---|
| Menu | **CredVault → Vault Analytics → Password Health** |
| URL | `/credentials-vault/password-health` |
| Menu tooltip | "Spot weak, reused & expiring passwords." |
| Page title | **Password Health** |
| Page subtitle | "Find weak, reused and overdue passwords, missing 2FA and over-shared credentials — and fix them in one click." |
| Header buttons | **Generate Password** (outlined) · **Run Health Check** |

Below the header, an explainer band ("Checking every credential you own or
manage against the password policy, and helping you fix what is at risk.")
shows four steps: *Scan Credentials*, *Prioritise by Severity*, *Fix in One
Click*, *Re-check Any Time*.

The Vault Dashboard's "Password hygiene" card links here.

---

## 3. Who can open it, and what each person sees

Anyone who can open CredVault can open Password Health: the client admin
always, everyone else when Permissions grants **view** on *Credentials Vault*.
Without it the API answers *"You do not have access to Credentials Vault. Ask
your admin to grant it in Permissions."*

What is **checked** differs by person:

| You are | Checked |
|---|---|
| Any user | Every credential **you own** — personal and team, My Vault and Critical Vault |
| Client admin (Vault Admin) | + every **team** credential in the company |
| Branch Admin | + team credentials of the employees of your branch |
| Reporting manager | + team credentials of everyone below you, at any depth |
| HOD | + team credentials of the departments you head |

**Not checked:**

- credentials that are only **shared with you** — you cannot fix them;
- other people's **personal** credentials;
- credentials in the **Recycle Bin**;
- Critical Vault credentials of your branch that you can only *see* (View,
  through the branch rule).

**Critical Vault credentials are checked** when you own them or reach them as
a team credential. The screen does not separate them; their codes start with
`CCRD-`.

**The branch switcher has no effect on this screen.**

Because each person's set is different, **the same credential can show
different results for different people.** Reuse is the clearest case: two
credentials with the same password are flagged only for someone who can see
both of them.

---

## 4. The summary — score card and five cards

### 4.1 The score card

| Element | Shows |
|---|---|
| Ring | the score, `NN/100` |
| Small label | "Vault health score" |
| Level | **Good** (80 or more) · **Fair** (60–79) · **At risk** (under 60) |
| Line | "N of M credentials are healthy" |
| Badge | "N need attention" — the only badge on the card |

- A credential is **healthy** when it has no issue at all; it **needs
  attention** when it has at least one.
- **Score = healthy ÷ checked × 100**, rounded. With nothing to check the score
  is 100.
- A credential with three issues counts once.

### 4.2 The five cards

| Card | Big number | Out of | Line under it |
|---|---|---|---|
| **Weak passwords** | credentials below the policy strength | credentials with a password | "N of M passwords below policy" |
| **Reused passwords** | credentials whose password is used elsewhere | credentials with a password | "N of M share a password" |
| **Missing 2FA** | credentials with 2FA off that need it | credentials at a risk level the policy needs 2FA for (and 2FA is not *N/A*) | "N of M credentials that need 2FA have it off" |
| **Rotation due** | overdue **or** due soon | credentials with a password and a rotation period | "N of M passwords past or near policy age" |
| **Over-shared** | credentials shared too widely | every credential checked | "N of M credentials shared too widely" |

Each card also shows a percentage badge and a bar (big number ÷ out of).

**The five numbers usually add up to more than "need attention"**, because one
credential can fail several checks.

### 4.3 Cards filter the list

| Action | Result |
|---|---|
| Click a card (or Enter / Space on it) | the list switches to that card's tab; page 1; toast **"Filtered to Weak passwords"** (card name); the list scrolls into view |
| Click the active card again | back to **All Issues**; toast **"Filter cleared — showing all issues"** |
| Hover | the card lifts; hint "Click to filter list" |
| Active card | outlined; hint "Showing — click to clear"; tooltip "Clear filter — show all issues" |

The score card is not clickable.

**The summary never follows the search box.** Typing a search changes the
list and the tab badges, never the score or the cards.

---

## 5. The list

### 5.1 Tabs

**All Issues · Weak · Reused · 2FA Off · Rotation Due · Over-shared**

Each tab has a count badge. The badges **do** follow the search: each shows
how many rows that tab would list for the term typed.

There is **no Resolved / Fixed tab** any more. The server still counts
resolutions in the background (see §9, rule 14), but the screen does not show
them.

### 5.2 Search

Placeholder: *"Search by credential, owner or issue..."*. It waits ~350 ms
after typing stops, then returns to page 1. It matches the credential ID,
name, type, category, owner name and the issue title (e.g. "Rotation
overdue"). It does **not** match the detail text or the suggested action.

### 5.3 Columns

| # | Column | Aligned | Shows |
|---|---|---|---|
| 1 | Sr. No | centre | running number across pages |
| 2 | Credential ID | centre | the code pill (`CRD-0004` / `CCRD-0002`), type below it |
| 3 | Credential Name | left | type icon, name, URL below it |
| 4 | Owner | left | initials, owner name, **Team** or **Personal** tag |
| 5 | Issue | left | icon + issue title |
| 6 | Severity | centre | **Critical** · **High** · **Medium** pill — see §6.3 |
| 7 | Details | left | per issue type, §6.2 |
| 8 | Suggested Action | left | the server's suggestion text |
| 9 | Action | centre | **Fix** (wrench) · **View** (eye) |

One credential with two problems takes **two rows**.

### 5.4 Order

Rows arrive sorted by the server's severity (critical first) and then by
credential ID. Because the Severity column shows a different, fixed value per
type (§6.3), **the column will not always look sorted.**

### 5.5 Paging

10 rows a page by default; the page size can be changed at the bottom. If the
list shrinks under the current page (for example after a fix), the screen moves
to the last page that exists.

### 5.6 Empty and error states

| State | Title | Line |
|---|---|---|
| Search matches nothing | "No issues match your search" | "Try a credential name, ID, owner or issue." |
| No issues on this tab | "All clear — no issues" / "All clear — no weak issues" (tab name) | "Every credential in this check is healthy." |
| The request failed | "Could not run the health check" | the error, with a **Try again** button |

---

## 6. The five checks

### 6.1 The rules

| Check | Flagged when | Issue title | Suggested action |
|---|---|---|---|
| **Weak** | the password is below the policy's minimum strength | "Weak password" (Fair) · "Password below the policy minimum" (Good, when the policy needs Strong) | "Replace with a generated password (20 characters)" |
| **Reused** | another credential *in your set* has exactly the same password | "Password reused" | "Change to a unique password" |
| **2FA Off** | 2FA is switched **off** and the credential's risk level is one the policy needs 2FA for | "2FA not enabled" | "Enable two-factor authentication" |
| **Rotation** | the password is older than its rotation period | "Rotation overdue" | "Rotate the password now" |
| | …or will be within the policy's reminder window | "Rotation due soon" | "Rotate the password before the due date" |
| **Over-shared** | it has at least the policy's limit of live shares, **or** it is critical-risk and has any live Full Access share | "Shared too widely" | "Review and revoke access that is no longer needed" |

**Password strength** (one rule for every password in CredVault):

| Level | Rule |
|---|---|
| **Strong** | 12+ characters with letters, numbers **and** a special character |
| **Good** | 8+ characters with all three |
| **Fair** | anything else — counts as weak |

A space is not a special character. No numeric score is ever shown — only the
level name. "Weak" is no longer given as a level.

**Which credentials have a password** (so can be Weak, Reused or due Rotation):
Login, Password, Email, Bank Account (net-banking password), Rewards, Database,
Server, Certificate (key password), Wireless Router, Membership. The other 15
types — cards, API keys, SSH keys, IDs, notes, … — are only ever checked for
2FA and over-sharing.

**What 2FA means:** a credential type either has a 2FA switch (Login, Password,
Email, Passkey, Bank Account, Crypto Wallet) or its 2FA is *N/A* and never
flagged. In the Critical Vault, a type without its own switch counts the
2-step code step as its 2FA.

**Rotation age** counts from the last time the password was changed. "Due
soon" covers the reminder window up to and including the due day itself; the
day after, it is overdue.

**Over-sharing counts shares, not people:** a share to one person and a share
to one team are one each. Revoked and expired shares do not count.

### 6.2 The Details column

| Check | Shows |
|---|---|
| Weak | the strength meter with its level (Fair / Good) |
| Reused | "Same password as" and a pill + name for every other credential |
| 2FA Off | **"2FA is turned off"** — "Login needs only the password — no phone or app code to confirm it is really you" |
| Rotation | **"N days old"** — "Policy N days · **overdue by N days**" (red) or "Policy N days · due 05 Dec 2026" |
| Over-shared | **"N active shares"** — "2 View · 1 Full Access" (Use Only, View, Copy, Full Access) |

The 2FA text is the screen's own; the server sends a different one-line text
("Password-only sign-in — anyone with the password can get in") that the
screen does not display.

### 6.3 Severity — what the screen shows vs what the server uses

**The Severity column is fixed per issue type.** The screen ignores the
server's severity and shows:

| Check | Screen shows |
|---|---|
| Weak | **Critical** |
| Reused | **High** |
| 2FA Off | **Medium** |
| Rotation (overdue *and* due soon) | **Critical** |
| Over-shared | **Medium** |

The server works out its own severity from the credential's risk level, and
**sorts the list by it**:

| Check | Server severity |
|---|---|
| Weak | Critical if the credential is critical-risk or the password is Fair; else High |
| Reused | Critical if critical-risk; else High |
| 2FA Off | Critical if critical- or high-risk; else High |
| Rotation overdue | Critical if critical-risk; else High |
| Rotation due soon | Medium, always |
| Over-shared | High if critical-risk; else Medium |

What this means on screen:

- A **2FA Off** row is almost always *Critical* to the server (the default
  policy needs 2FA for critical and high risk only), so it sorts near the top,
  yet it is badged **Medium**.
- A **Rotation due soon** row is *Medium* to the server, so it sorts near the
  bottom, yet it is badged **Critical**.
- The explainer step "Critical issues on high-risk credentials appear first"
  describes the **server's** order, not the badges.

This is a known mismatch, not a display bug to be fixed in isolation: the code
comment reads *"Fixed severity per issue type — not raised or lowered by the
credential's risk level."* Testers should expect it.

---

## 7. Fixing an issue

### 7.1 The Fix button

| Issue | Fix does | Tooltip |
|---|---|---|
| Weak | opens the **Edit Credential** form | "Fix — Opens the credential form to set a strong password" |
| Reused | opens the Edit Credential form | "Fix — Opens the credential form to set a unique password" |
| Rotation | opens the Edit Credential form | "Fix — Opens the credential form to rotate the password" |
| 2FA Off | opens the Edit Credential form | "Fix — Opens the credential form to switch on 2FA" |
| Over-shared | goes to **My Vault → Shared By Me**, filtered to this credential; toast "Showing who has access to {name}" — "Revoke what is no longer needed." | "Fix — Opens Shared By Me to revoke extra access" |

**Fix is disabled** when you cannot edit the credential — an HOD looking at a
team credential of someone at or above their own level (they have Copy access
only). Tooltip: *"You can only use this credential — ask its owner to fix it"*.

A Critical Vault credential opens in its own edit form and is saved through
the Critical Vault, with its protection rules (at least one protection step;
the authenticator code where the form asks for it).

**Shared By Me lists shares on credentials you own and shares you made.** An
admin fixing over-sharing on someone else's credential will see only the
shares they made themselves there. *Not verified end to end — worth testing.*

### 7.2 Saving the edit

When the edited credential is saved, two toasts appear:

1. From the form: **"CRD-0004 · Gmail updated"**, with the server's message
   underneath — "1 health issue resolved", "2 health issues resolved", or
   "Credential updated.".
2. From Password Health:
   - **"1 health issue resolved"** / **"N health issues resolved"** (success), or
   - **"Saved — the issue is still open"** (warning) when the save resolved nothing.

The list then reloads in place (no shimmer) and the row disappears if fixed.

A save **resolves an issue when its type is gone** after the save. Changing a
"Rotation due soon" into a "Rotation overdue" is not a resolution, and editing
the name of a credential with a weak password leaves the weak issue open.

Saving with no changes does not reach the server: the form says **"No changes
to update"**.

A password below the minimum cannot be saved at all: *"Policy requires a Good
or stronger password — use the generate button."* (the level is the policy's).

### 7.3 View

The eye opens the credential's View drawer. Its Edit button opens the same
edit form as Fix; any change made in the drawer reloads the list.

---

## 8. Run Health Check and Generate Password

**Run Health Check** reloads the list — it is the same request as opening the
page; there is no separate server scan.

1. Toast **"Scanning N credentials…"** (N = credentials checked; "Scanning your
   credentials…" before the first load).
2. The table shows its loading shimmer; the button is disabled.
3. Toast **"Health check complete · N open issues"** — N is every open issue,
   whatever tab or search is active — or **"Health check failed"** — "Please
   try again."

**Generate Password** opens the same generator as My Vault. The password is
made in the browser and never sent anywhere. **Use in New Credential** (only
enabled when the result meets the policy minimum) opens **Add Credential** with
the password filled in. Adding a credential gives no health toast; the list
reloads quietly. If the chosen type has no password field: *"{Type} has no
password field — generated password not used"*.

---

## 9. Business rules QA should never see broken

1. A credential shared with you (and nothing else) never appears.
2. A credential in the Recycle Bin never appears, and does not count as a
   reuse partner.
3. Healthy + need attention = credentials checked, always.
4. Score = round(healthy ÷ checked × 100); 100 when nothing is checked.
5. Level: 80+ Good, 60–79 Fair, under 60 At risk.
6. Each card's number equals its tab badge when the search is empty.
7. Typing a search changes the tab badges but never the score or the cards.
8. With the policy minimum at **Fair**, no Weak issue can exist.
9. 2FA set to *N/A* is never flagged; 2FA *off* is flagged only at the risk
   levels ticked in Policies → Two-Factor.
10. A password exactly `rotation_days` old is "due soon"; one day older is
    "overdue".
11. Over-shared fires at the limit, not above it (3 live shares with limit 3).
12. A critical-risk credential with one live Full Access share is over-shared.
13. Fix is disabled for Copy access, enabled for every Full Access route.
14. A save that removes an issue returns `health.resolved`, shows "N health
    issues resolved" and writes one *Health issue resolved* audit entry per
    issue. Creating a credential never does.
15. Over-shared Fix lands on My Vault → Shared By Me filtered to that credential.
16. Clicking the active card clears the filter back to All Issues.

---

## 10. What this screen does not do

- It does not store issues, snooze them, or mark them "accepted".
- It does not change any credential by itself — every fix is an ordinary edit
  or revoke elsewhere.
- It does not show the **Resolved** history any more, though the API can.
- It does not show the server's severity, the per-card "critical" counts, or
  the "N of them fail more than one check" note.
- It does not use the one-row-per-credential view (`/health/attention`).
