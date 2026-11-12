# CredVault Team Vault — Functional Documentation

| | |
|---|---|
| **Jira** | GT-99 (parent GT-76 — CredVault Team Vault Documentation) |
| **Module** | CredVault → Vault Management → Team Vault |
| **Audience** | Product owners, QA, support, trainers, business analysts |
| **Companion documents** | Technical Documentation · API Documentation · Code Walkthrough |
| **Version** | 1.0 · 12 Nov 2026 · System |

---

## 1. Introduction

### 1.1 Purpose of this document

This document explains what the Team Vault does from the user's point of view. It covers every screen, button, rule and message, and who is allowed to do what. It does not explain how the code works. For that, see the Technical Documentation and the Code Walkthrough.

### 1.2 The feature in one paragraph

The Team Vault is where a company keeps the **logins, API keys and accounts a team uses together** — the GST portal, the shipping-line booking login, the shared sales inbox — instead of passing them around in chats or spreadsheets.

The page has two halves. On the left, **Team Details** shows the company's departments and, inside each one, the team hierarchy built from HR. On the right, **Credentials** lists the credentials in two tabs, **My Credentials** and **Team Credentials**. Opening a department narrows the list to that department. Clicking a person in the hierarchy narrows it to that person.

From the list, a user can view, copy, edit, share and bin a credential, and export a whole tab as a CSV file. Every view, reveal, copy, share, change and export is written to the Audit Log.

Team Vault credentials are Normal Vault credentials (**CRD-** numbers). Critical credentials live in the Critical Vault and never appear here.

### 1.3 Key ideas to understand first

| Idea | What it means |
|---|---|
| Team credential | A credential with scope **Team**, filed under one **department**. It is visible to the owner, the Vault Admin, the department's HOD and the owner's managers — never to plain department members, unless shared. |
| Personal credential | A credential with scope **Personal**. Only its owner can open it, unless they share it. |
| Department | A department from HR. Team credentials are filed under one. |
| Hierarchy level | Where a person sits, taken from their HR designation: **HOD → Team Lead → Executive → Employee → Intern**. |
| Vault Admin | The **Branch User** of a branch. They administer CredVault for **their own branch only**. |
| Overseeing | Being above someone: their Branch User (Vault Admin), their HOD, or anyone above them in the HR reporting line. |
| Access level | How much a person may do with a credential: **Use Only → View → Copy → Full Access**. |
| Share | Access given to a person or a whole department, for a limited time. |

---

## 2. Where It Lives

### 2.1 Navigation

| | |
|---|---|
| **Menu** | Top bar → **CredVault** → **Vault Management** → **Team Vault** (*Credentials shared within your team.*) |
| **URL** | `/credentials-vault/team-vault` |
| **Who sees the menu** | Anyone with **view** permission on the module *Credentials Vault* in Permissions |

> **Explanation.** Without that permission, every CredVault call is refused with *"You do not have access to Credentials Vault. Ask your admin to grant it in Permissions."*

### 2.2 Screens

| Screen | Opens from |
|---|---|
| Team Vault page (Team Details + Credentials) | The menu |
| Department view (hero, level chips, hierarchy tree) | A department card's **View team**, or the admin card's **View all** |
| View drawer (slides in from the right) | **View** on a row |
| Edit form | **Edit** on a row, or **Edit Credential** in the drawer |
| Share Credential popup | **Share** in the drawer |
| Move to Recycle Bin / Remove from your vault? confirmation | The bin icon |
| Export Credentials popup | **Export Credentials** in the header |

The View drawer, the form, the Share popup and the bin confirmation are the same ones My Vault uses. Their full behaviour is in the My Vault documents.

---

## 3. The Page Header

- **Title:** Team Vault
- **Subtitle:** *"Shared credentials for your team — everyone with access uses the same login, with every view and copy recorded."*
- **Button:** **Export Credentials**
- **Brief** (open by default): *"Keeping your team's shared logins in one place, giving each member the right access, and tracking how they are used."* — four steps:

| Step | Text |
|---|---|
| Add Team Credentials | Save logins, API keys and accounts the whole team uses, instead of passing them around in chats or sheets. |
| Control Member Access | Decide who can use, view, copy or fully manage each credential, and for how long. |
| Keep Them Secure | Rotate passwords on schedule, turn on 2FA, and fix weak or expiring credentials. |
| Review Activity | Every view, copy, share and change is recorded, so you always know who used what. |

> **Known problem: there is no way to add a team credential.** The brief says *Add Team Credentials*, but the page has no Add button, and the add form elsewhere offers no Team scope. Today a team credential can only be created through the API (`scope: team` on create; the import API accepts it too, but the Import screen never sends it). The Team Vault can view, edit, share and export existing ones.

---

## 4. The Team Details Pane (left)

### 4.1 Header and panel toggle

- **Title:** Team Details · *Select a department* (changes to *Team structure by designation* once a department is open)
- The **‹** button (*Hide panel*) folds the pane into a thin rail. Clicking the rail (*Show Team Details*) opens it again.

### 4.2 Search

The search box reads *"Search department or HOD..."*. It matches the department name or the HOD's name. The meta row under it shows *‹n› Departments* · *‹n› Members*.

### 4.3 The cards

| Card | Shown to | Content |
|---|---|---|
| **Admin card** | The Branch User (Vault Admin) | **Admin**, the Branch User's name, *Vault Administrator*, members, *Departments*, *HODs*, and **View all** |
| **You card** | Anyone who is not the Vault Admin | **You**, your name, *Your team · everyone reporting to you*, members, *Departments*, and **View all** |
| **Department card** | Everyone | Department name, *‹HOD› · HOD* (or *No HOD assigned* / *Your team*), *Members*, a level bar, and **View team** |

A department card appears only when the department has active members or team credentials.

### 4.4 The department view

Pressing **View team** (or **View all**) opens:

| Part | Content |
|---|---|
| Hero | *Department* (or *Organisation*) and its name, with *Members · Levels · Teams* (for the organisation: *Members · Departments · HODs*) |
| Level chips | One chip per level present: Admin, HOD, TL, Executive, Employee, Intern |
| Team Hierarchy | The tree, with **Expand** / **Collapse**. Each person shows initials, name, level and designation, plus a badge with their number of direct reports. |

A department opens **fully expanded**. The organisation view (**View all**) opens with every top-level branch **folded**. The back arrow (*All departments*) returns to the cards and clears the department filter.

### 4.5 Who appears in the tree

| Rule | Detail |
|---|---|
| Who is shown | Employees who are **Active**, have finished onboarding (all 6 stages) and have not exited |
| Level | From the HR designation: *Head of Department / HOD*, *Team Lead*, *Executive*, *Intern / Trainee*. Anything else is *Employee*. |
| HOD | The card shows the head name stored on the department; *No HOD assigned* only when no head is entered (a scoped viewer sees *Your team* unless the HOD is in their reporting line). **HOD rights** go only to an HR employee whose name matches the head **exactly once** |
| Position | Each person sits under their reporting manager from HR. Someone with no reporting manager sits at the top of the tree. |
| Scoped view | The Vault Admin sees their **whole branch**. Anyone else sees only **themselves and the people reporting to them**. |

> **Common misunderstanding.** "Someone is missing from the tree, so the Team Vault is broken." The tree comes from HR. A person without a department, or who has not finished onboarding, does not appear. Fix the HR record and they appear.

### 4.6 Empty and error states

| Situation | Text |
|---|---|
| No departments | *No departments with active members yet. Departments come from HR.* |
| Search finds nothing | *No department matches "‹search›"* |
| You are not in the HR tree (scoped view) | *You are not in the team hierarchy yet. Your department and reporting manager come from HR.* |
| A department with no members | *No active members in this department yet.* (scoped view: *Nobody reports to you in this department yet.*) |
| The department list failed to load | The error, with a **Try again** button |
| The tree failed to load | The error only, with no button |

---

## 5. The Credential List (right)

### 5.1 Pane header

**Credentials** · *Credentials shared within the selected team*. When a department is open it reads *Credentials shared within ‹department›*, and *· ‹person›* is added when a person is picked.

### 5.2 Tabs

The page opens on **Team Credentials**. Each tab shows a count of its rows, and the counts follow the search box.

| Tab | Shows |
|---|---|
| **My Credentials** | Only credentials **you own** |
| **Team Credentials** | Team-scope credentials you reach as Vault Admin, HOD or manager, plus **any** credential (any scope) of the people you oversee — not your own, not those shared with you. The count follows the open department and the person filter; **My Credentials** ignores them |

> **Common misunderstanding: "Where is the credential my colleague shared with me?"** It is **not in the Team Vault at all**. **My Credentials** shows only credentials you own, and **Team Credentials** deliberately leaves out credentials shared with you or your department. To see them, open **My Vault → Shared With Me**. The only exception: when you pick a person in the Team Hierarchy, the list shows that person's credentials as they are, so a credential they shared with you can appear there.

### 5.3 Search

There is one search box: *"Search by credential ID, name, category, username or owner..."*.

- It also matches the type label (e.g. *Credit Card*), the risk word (e.g. *High*) and the strength word (e.g. *Strong*).
- It waits a moment after you stop typing, then searches, and goes back to page 1.

### 5.4 Columns

| Column | Content |
|---|---|
| Sr. No | Row number |
| Credential ID | e.g. **CRD-0012**, with the date it was added |
| Credential Name | The name, with the URL under it |
| Category | The type and its group, e.g. *Login · Logins & Access* |
| Username | The account name |
| Owner | The owner's name (*You* for your own rows), with a **Team** or **Personal** badge, and a *Shared with you* badge when the row reached you through a share |
| Risk | Low / Medium / High |
| Strength | The word (*Weak / Fair / Good / Strong*) with a score in steps of 25. *N/A* when the type has no password. |
| 2FA | Enabled / Disabled / N/A |
| Last Updated | Date and time of the last change |
| Action | Row buttons (see 5.5) |

### 5.5 Row actions

| Button | Enabled when | What it does |
|---|---|---|
| **Edit** | You have Full Access | Opens the form |
| **View** | Always | Opens the View drawer |
| **Copy Password** | You have Copy or Full Access | Copies the main secret. The toast reads *"‹Label› copied — Clipboard clears in 30s."* |
| **Bin** | Full Access, or the credential reached you through a share | **Move to Bin**, or **Remove from your vault** (see 6.3) |

> **Explanation.** A greyed-out button is not a bug. It means your access level does not allow that action. For example, with View access only, Edit and Copy Password are disabled; the bin icon stays enabled as *Remove from your vault* (in the Normal Vault, View access only ever comes from a share).

### 5.6 Filtering by a person

1. Click a person in the Team Hierarchy. The list switches to **Team Credentials** and a chip appears: *Showing credentials owned by ‹name›*, with the person's level, designation and the number of credentials.
2. The list shows that person's credentials, plus credentials shared with them or their department.
3. If you oversee that person, you see their **whole vault**, personal and team — but inside a department view only the ones filed under that department; their personal credentials appear only when the person is picked from **View all**.
4. Opening a department or picking a person switches to **Team Credentials**; the back arrow also clears the person filter.
4. Click **Clear filter** (or the same person again) to remove the filter.

> **Known problem: the chip wording.** The chip says *"Showing credentials owned by"*, but the list also includes credentials *shared with* that person. The wording should say both.

> **Known problem: the admin node.** Clicking the Vault Admin at the top of the tree shows the chip but applies no filter.

If the person has no CredVault login, the list is empty with: *"This person has no CredVault login yet, so nothing is shared with them."*

### 5.7 Paging

The list shows 10 rows per page by default; **Rows per page** changes it. If a page becomes empty (for example after you bin its last row), the list steps back to the last page that has rows.

### 5.8 Empty states

| Case | Title | Sub-text |
|---|---|---|
| Person filter | No credentials owned by ‹name› | ‹name› does not own any team credentials yet. |
| Loading failed | Could not load credentials | The error message |
| Search found nothing | No credentials match your search | Nothing matches "‹search›". Try another ID, name, category, username or owner. |
| My Credentials is empty | No credentials of yours yet | Credentials you own appear here. Add one to keep it in the vault. |
| Team Credentials is empty | No team credentials in ‹department› yet (or *No team credentials yet*) | Save logins, API keys and accounts the whole team uses, instead of passing them around in chats or sheets. |

---

## 6. Working With a Credential

### 6.1 View, reveal and copy

| Action | Result |
|---|---|
| **View** | Opens the drawer with the tabs Overview, *‹Type› Details* (e.g. *Login Details*), Access and Activity. Opening it is logged once. |
| **Reveal** (in the drawer) | Shows the secret (the button then reads **Hide**). It hides again after **30 seconds**. Logged. |
| **Copy Password** (row) / **Copy ‹label›** (drawer) | Copies the secret. The clipboard is cleared after **30 seconds**. Logged. |

### 6.2 Edit and share

- **Edit** needs **Full Access**. Only the owner or the Vault Admin (Branch User) may move a credential between Personal and Team, or to another department. Anyone else with Full Access can change the details only. The form itself has **no** scope or department control — this rule is enforced by the server. For anyone but the owner, the 2FA switch is locked with *Only the owner or a Vault Admin can change this.*
- **Share** is in the **drawer**, not on the row, and needs **Full Access**. In the popup you choose **Individual** or **Team**, the person or department, the permission (**Use Only**, **View**, **Copy**, **Full Access**), the **Access Duration** (1 day, 7 days, 30 days, or an end date no later than 30 days — there is no *No expiry*), and a **Reason for Sharing** (always required, at least 5 characters). Defaults: **View**, **7 days**.
- **Individual** lists only active users in **your branch** (*No other active users in your branch.*); **Team** lists every company department with active employees, and notifies its members in any branch. The owner and the person who shared it with you are left out (*‹name› shared this with you… can't be shared back*).
- Sharing again with the same person shows *Already shared with ‹name› — … Saving updates this share*, and the button becomes **Update Share**. A share passed on through your own Full share is cut to your end date: *It ends on dd/mm/yyyy, when your own access does.*
- The recipient (or every member of the team) gets a bell notification and an email. The email never contains the secret.
- Sharing again with the same person or team **updates** the existing share instead of adding a second one.

### 6.3 Removing a credential

| Your relation | Button | Result |
|---|---|---|
| Full Access, not through a share | **Move to Bin** | Dialog **Move to Recycle Bin** — *You can restore it any time within ‹n› days*: *Removed from Team Vault* (or *My Vault*), how many shares are paused (or *It will no longer appear in any list*), *Restorable for ‹n› days* and the permanent-delete date; tick *Yes, move ‹name› to the recycle bin*. Toast: *"‹name›" moved to the Recycle Bin. It can be restored for ‹n› days.* |
| It reached you through a share to **you** | **Remove from your vault** | Dialog **Remove from your vault?**, tick *I understand and want to remove it.*, button **Remove**. Toast: *"‹name›" removed from your vault. The owner's copy is unchanged.* |
| It reached you only through a share to your **whole team** | — | Refused: *"This credential is shared with your whole team. Ask the owner to remove the team share."* |

The credential is kept for **30 days**, unless the branch's Branch User set a different period in the Recycle Bin.

---

## 7. Export Credentials

### 7.1 The popup

| Part | Content |
|---|---|
| Title | **Export Credentials** · *Download your credentials* (or *‹department› team credentials*) *as a file.* |
| What to export | *Choose the categories to include* — one chip per category with its count, *‹n› of ‹total› credentials selected*, and **Select all** / **Clear all** |
| File format & contents | *A CSV file · choose what each row contains* — **CSV** (*Opens in Excel or Sheets*) is the only format. **Include passwords** is off by default; its sub-text is *Exported as plain, readable text*. |
| Password warning (Include passwords on) | *"Passwords will be readable by anyone with the file. Store it safely and delete it once you are done. Protected credentials are written as a placeholder."* Then the tick *"I understand the risk and want to export passwords."* and **Account password** (*Enter your login password to confirm*). |
| Footer | *Every export is recorded in the audit log* · **Cancel** · **Export ‹n› Credentials** |

### 7.2 What gets exported

- The **current tab** (My Credentials or Team Credentials) and, on the Team tab, the **open department**. The Team export holds only **team-scope** credentials you reach — the personal credentials of people you oversee, which the tab lists, are left out.
- Notes are included (empty for protected credentials).
- File: `team-credentials-YYYYMMDD.csv` or `my-credentials-YYYYMMDD.csv`. Errors: *Your account password is incorrect.* and *No credentials match this selection.*; buttons read *Loading…* / *Exporting…*.
- The toast *Protected secrets withheld* counts every placeholder, including *[No copy permission]*.
- With **Include passwords** on, a credential that opens only through an unlock is written as *[Protected — unlock in CredVault]*, and one you cannot copy is written as *[No copy permission]*. A toast then says how many were withheld: *"‹n› protected credential(s) open only through an unlock, so the file shows a placeholder."*
- On success: *"‹n› credentials exported as CSV"*, with the file name. On failure: *Export failed* with the reason.
- Nothing to export: *"You have no credentials to export yet."* / *"There are no team credentials to export yet."*

> **Common misunderstanding.** "I searched, so only my search results will be exported." No. The export ignores the search box and the person filter, and exports the whole tab (and the open department).

> **Known problem: Critical credentials in the export.** The Team Credentials export can include Critical Vault team credentials. Their secrets are withheld while an unlock step guards them, but the rows themselves appear.

---

## 8. Who Sees What

| Person | Team Details shows | Team Credentials lists | Access on a team credential |
|---|---|---|---|
| **Vault Admin** (the Branch User, shown as *Vault Administrator*) | Every department of their branch, and the whole branch as one tree | Every team credential of their branch, plus anything else the branch's users own | **Full** on every team credential of their branch, except ones owned by another admin login |
| **HOD** | Themselves and everyone reporting to them (so they cannot pick a department member who does not report to them) | **Every** credential, any scope, of everyone in the departments they head, plus their reporting line | **Full** over people below them; **Copy** over peers and seniors |
| **Reporting manager** (any depth) | Themselves and everyone reporting to them | Credentials owned by their reporting line | **Full** on team credentials of people below them |
| **Employee** | Themselves only | **Nothing** — colleagues' team credentials are not visible, even in the same department, unless shared (then they are in My Vault → Shared With Me). The empty state's *Save logins…* text is expected for them | What a share gives |
| **Owner** | — | Their own credentials are in **My Credentials** | **Full** |

**Personal credentials stay private.** A personal credential gives nobody but the owner any access, unless it has been shared. A credential you cannot reach reads as *"Credential not found."* — the system never confirms that it exists.

> **Known problem: personal credentials listed but not openable.** The Vault Admin, HODs and managers see other people's **personal** credentials listed under Team Credentials. Edit, Copy and Bin are greyed out on those rows; **View** is still clickable and fails with *Credential not found*.

> **Worth testing.** The tree data for the whole organisation reaches every CredVault user; only the Vault Admin is narrowed to their branch on the server. The "me and everyone below me" view is trimmed in the browser.

---

## 9. Business Rules

The rules the system must always follow. Each rule has an ID so that test cases and code changes can refer to it (for example, *"TC-14 checks BR-05"*).

| ID | Rule |
|---|---|
| BR-01 | The Team Vault lists only **Normal Vault** credentials (CRD-nnnn). A Critical credential never appears in the list. |
| BR-02 | A user without *Credentials Vault* view permission gets *"You do not have access to Credentials Vault…"*. |
| BR-03 | The page opens on the **Team Credentials** tab. |
| BR-04 | Your own credentials appear only under **My Credentials**, never under Team Credentials — except when you pick yourself in the hierarchy |
| BR-05 | Credentials shared with you are **not** under Team Credentials. |
| BR-06 | Opening a department narrows the list to that department; the back arrow clears it. |
| BR-07 | Clicking a person narrows the list and shows the chip; **Clear filter** removes it. |
| BR-08 | Someone else's **personal** credential never opens (*Credential not found*) unless it was shared — even for the Vault Admin. |
| BR-09 | An HOD gets **Full** on a team credential of someone below them, and only **Copy** on one owned by a peer or a senior. |
| BR-10 | The Vault Admin has rights only inside **their own branch**. A team credential of another branch gives them nothing. |
| BR-11 | **Edit**, **Share** and **Move to Bin** need Full Access; **Copy Password** needs Copy or Full Access; **View** is always enabled. |
| BR-12 | Only the owner or the Vault Admin can move a credential between Personal and Team, or to another department (enforced by the server; the form has no control for it). |
| BR-13 | A share cannot go to the owner or to yourself. Sharing twice to the same recipient leaves one live share. |
| BR-14 | Every share ends within **30 days** and needs a reason of at least 5 characters. |
| BR-15 | A re-share never outlives the re-sharer's own access. When someone loses Full Access, every share they passed on ends. |
| BR-16 | A revealed value hides after **30 seconds**; a copied value is cleared from the clipboard after **30 seconds**. |
| BR-17 | **Remove from your vault** ends only your share; the owner still has the credential. |
| BR-18 | A credential that reached you only through a **team** share cannot be removed by you. |
| BR-19 | Moving to the bin pauses the shares; the credential can be restored within the retention period (30 days, or the branch's own period). |
| BR-20 | Exporting readable passwords needs **both** the risk tick and the correct account password. |
| BR-21 | The export ignores the search box and the person filter; it exports the tab's team-scope credentials (and the open department). |
| BR-22 | Every export is recorded in the Audit Log. |
| BR-23 | The tree shows only Active, fully onboarded, not-exited employees. |

---

## 10. Roles and Glossary

| Term in the UI | Who it is in the system |
|---|---|
| Vault Administrator / Admin / Vault Admin | The Branch User (`user_type = branch_user`) of a branch, for that branch only |
| Branch Admin | Another name for the Vault Admin — the branch user (`user_type = branch_user`) |
| HOD | The employee named as head of a department in HR, matched by name to exactly one active employee |
| TL | Team Lead — an employee whose HR designation is *Team Lead* |
| Manager | Anyone above the owner in the HR reporting line, at any depth |
| Team | A department |
| Team credential | A credential with scope Team, filed under one department |
| Live share | A share that is neither revoked nor expired |
| Downline | Everyone who reports to a person, directly or indirectly |
