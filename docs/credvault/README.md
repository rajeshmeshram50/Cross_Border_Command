# CredVault — My Vault, Recycle Bin, Password Health & Import / Export
# End-to-End Flow

> One document, four modules. They are not four features — they are four
> stages in the life of the same credential. **Import / Export** and **My
> Vault** bring it in, **Password Health** keeps checking it while it is live,
> the **Recycle Bin** holds it after deletion until it is restored or purged,
> and **Download backup** takes a copy out.
>
> Read this before the API, Functional, Technical or Code Walkthrough documents
> of each module. Those answer *how*; this one answers *why there are four of
> them and how a credential moves between them*.

| Module | Jira | Folder |
|---|---|---|
| My Vault | GT-73 | `docs/credvault/my-vault/` |
| Recycle Bin | GT-74 | `docs/credvault/recycle-bin/` |
| Password Health | GT-75 | `docs/credvault/password-health/` |
| Import / Export (screen: *Import & Recovery*) | GT-77 | `docs/credvault/import-export/` |

---

## 1. The one-paragraph version

A user stores a credential — a login, an API key, a card, a passport, any of
the **25 credential types** — either one at a time from **My Vault → Add
Credential**, or many at once from **Import & Recovery → Import data**, where a
spreadsheet of one category is checked row by row exactly as the Add form would
check it. Every secret is encrypted at rest and only leaves the server through
a logged reveal or copy. While the credential is live it can be **shared**
(view, copy or full access, for a period), and **Password Health** keeps
checking it for weak, reused, overdue, unprotected and over-shared passwords.
Deleting it moves it to the **Recycle Bin**, where it counts down a retention
period set per branch; it can be restored until then, and is purged
automatically after. At any time a **Download backup** takes a copy of the
vault out as Excel or CSV, optionally locked with a password.

---

## 2. Why four modules and not one

| Concern | Module | Why it is separate |
|---|---|---|
| Keeping and using a credential | My Vault | The everyday surface: list, add, edit, view, reveal, copy, share. Visibility follows ownership, shares and the reporting line. |
| Bringing many in, taking a copy out | Import / Export | Bulk work needs its own review step (accepted / discarded), its own history and its own security rules (file locks, passwords in files). |
| Is what we store any good? | Password Health | A read-across of everything the user manages, not one credential. It computes issues on the fly and sends the user back to My Vault to fix them. |
| Undo of a delete | Recycle Bin | A deleted credential is not gone: it is held, counted down and purged on a policy, by branch. Restoring and purging have their own rules (Critical items: Branch Admin only). |

The separation keeps **the dangerous operations off the everyday screen**:
mass import, files with passwords in them, and permanent deletion each live in
a module with its own confirmation and its own audit trail.

---

## 3. The life of a credential

```
                ┌───────────────────────────┐   ┌──────────────────────────────┐
                │ MY VAULT · Add Credential │   │ IMPORT & RECOVERY · Import   │
                │ type picker → form → Save │   │ category → sheet → review    │
                │ POST /normal-vault/       │   │ → Save N records             │
                │      credentials          │   │ (typed preview, then run)    │
                └─────────────┬─────────────┘   └──────────────┬───────────────┘
                              │      CRD-0001 …                │
                              └───────────────┬────────────────┘
                                              ▼
                       ┌───────────────────────────────────────────┐
                       │            LIVE CREDENTIAL                │
                       │  view · reveal · copy · edit · launch     │
                       │  share (use / view / copy / full, timed)  │
                       └───┬───────────────┬───────────────────┬───┘
                           │               │                   │
         ┌─────────────────▼──┐   ┌────────▼─────────┐   ┌─────▼──────────────────┐
         │ PASSWORD HEALTH    │   │ DOWNLOAD BACKUP  │   │ MOVE TO RECYCLE BIN    │
         │ weak · reused ·    │   │ Excel / CSV      │   │ DELETE /…/credentials  │
         │ 2FA off · rotation │   │ My / Team / All  │   │ deleted_at, deleted_by │
         │ · over-shared      │   │ (never Critical) │   └─────┬──────────────────┘
         │ Fix → edit form ───┼─┐ └──────────────────┘         │
         └────────────────────┘ │                              ▼
                  ▲             │                ┌──────────────────────────────┐
                  └─ resolves ──┘                │ RECYCLE BIN                  │
                     on save                     │ countdown on the branch's    │
                                                 │ retention period             │
                                                 │  ├─ Restore ──► LIVE again   │
                                                 │  ├─ Delete permanently       │
                                                 │  └─ past retention ──► purged│
                                                 │     automatically            │
                                                 └──────────────────────────────┘
```

---

## 4. Module by module

### 4.1 My Vault (GT-73)

- **What it holds:** the Normal Vault credentials the user can see, in five
  tabs — All Credentials, My Credentials, Team Credentials, Shared With Me,
  Shared By Me.
- **How a row gets in:** Add Credential (one), Import (many), or someone shares
  it with you, or it is a Team credential of someone below you in the
  reporting line.
- **What you can do:** view, reveal and copy (logged), edit, share (Full
  Access needed), revoke your shares, move to the bin, generate a password.
- **How a row leaves:** moved to the Recycle Bin; a credential shared with you
  can be removed from your vault without touching the owner's copy.

### 4.2 Password Health (GT-75)

- **What it holds:** nothing of its own. It reads every credential the user
  owns or manages and lists **issues**, one row per issue.
- **How a row gets in:** computed on each load from the credential and the
  CredVault policy — strength below the minimum, the same password elsewhere,
  2FA off where the policy needs it, rotation overdue or due soon, too many
  active shares.
- **What you can do:** filter by issue type (tabs or the summary cards), Fix
  (opens the edit form, or Shared By Me for over-sharing), view, generate.
- **How a row leaves:** the credential is fixed and saved — the save reports
  which issues it resolved.

### 4.3 Recycle Bin (GT-74)

- **What it holds:** soft-deleted credentials, split into My Vault and Critical
  Vault sub-tabs, with tabs All Items, Deleted by Me, Team Credentials and
  Expiring Soon.
- **How a row gets in:** Move to Bin on a credential (owner, Full Access,
  Vault Admin; Critical items by owner, Vault Admin or Branch Admin).
- **What you can do:** restore, delete permanently, empty the bin (Vault
  Admin), change the retention period (Vault Admin: client admin for the
  company, Branch Admin for the branch).
- **How a row leaves:** restored, deleted permanently, or purged automatically
  when its period ends — checked whenever the bin is opened.

### 4.4 Import / Export (GT-77)

- **What it holds:** the history of imports and backups.
- **How a row gets in:** Import data (pick a category, upload its Excel or CSV
  sheet, review, save) or Download backup (format, vault, passwords, lock).
- **What you can do:** download per-category samples, review accepted and
  discarded rows before anything is saved, page and search the history.
- **How a row leaves:** history rows stay; imported credentials continue their
  life in My Vault.

---

## 5. The hand-offs

| From | To | What crosses | Rule at the border |
|---|---|---|---|
| Import | My Vault | New credentials, one per accepted row | Every row is validated as the Add form validates it; duplicates are skipped, never merged. |
| My Vault | Password Health | Every saved change | Health is recomputed on read — there is no stored "issue" to fall out of date. |
| Password Health | My Vault | The Fix button | Fixing is editing: only someone with Full Access gets a working Fix. |
| My Vault | Recycle Bin | A deleted credential | Soft delete: `deleted_at` and `deleted_by` are set; shares and secrets stay until purge. |
| Recycle Bin | My Vault | A restored credential | Comes back with all its details; Critical items only through the Branch Admin. |
| My Vault | Backup | A copy of the vault | Never shared-only items and never Critical Vault items; passwords only when asked for. |

---

## 6. The rules that hold it together

1. **A secret never leaves the server except through a logged action** — a
   reveal, a copy, or a backup that was asked to include passwords.
2. **Visibility goes down the reporting line, never sideways.** A manager or
   HOD sees the Team credentials of the people below them; a colleague at the
   same level does not.
3. **Sharing needs Full Access**, never goes back to the owner or to the person
   who shared it with you, and — for individual shares — stays inside the
   sharer's branch (the client admin shares company-wide).
4. **Deletion is reversible until the retention period ends**, and the period
   is set per branch for both vaults together.
5. **Shortening the retention period deletes immediately** what is already
   older than the new period — the change asks for confirmation and lists
   every credential it will delete.
6. **The Critical Vault is a separate vault with stricter rules** (unlock
   steps, Branch Admin restores). These four modules touch it only at the
   edges: the bin's Critical sub-tab, and Password Health, which currently also
   checks Critical credentials.

---

## 7. What these documents do not cover

The rest of CredVault — **Critical Vault** (and its unlock approvals), **Team
Vault**, **Access Requests**, **Policies** and **Audit Logs** — is outside
these four tickets. It appears here only where a credential crosses into or out
of one of the four modules.
