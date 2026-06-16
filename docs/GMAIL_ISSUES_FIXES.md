# Gmail Module — Issues & Fixes (QA Verification Sheet)

> 7 issues reported on the **Gmail** screen (Profile dropdown → **Gmail**) and how each was fixed. Use this to re-test.
>
> **Files touched**
> - Frontend: [Gmail.tsx](../resources/js/pages/Gmail.tsx)
> - Backend: [EmailController.php](../app/Http/Controllers/Api/EmailController.php)
>
> Fixed on branch `saas`, 2026-06-13. **Not yet committed/pushed** at time of writing.

---

## 1. Sent Items Sync Failure ✅

**Issue:** Sent emails do not appear inside the "Sent" folder.

**Root cause:** The "Sent" folder filtered only `category = 'composed'`, so anything not tagged composed never showed.

**Fix:** "Sent" now = everything the signed-in user actually dispatched (`where('user_id', $user->id)`) — [EmailController.php:90](../app/Http/Controllers/Api/EmailController.php#L90). New `mine` stat drives the count — [EmailController.php:166](../app/Http/Controllers/Api/EmailController.php#L166); frontend folder uses `stats.mine`.

**QA:** Compose & send a mail → it appears under **Sent** immediately. System mail you didn't trigger (OTP etc.) stays out of Sent (correct).

---

## 2. Attachment Render & Preview Failure ✅

**Issue:** Uploaded files/PDFs show no preview; recipient sees only the raw name, no downloadable file.

**Fix:** Reading-pane attachments are now click-to-preview. A lightbox renders **images** and **PDFs** inline (with Download / Open) instead of just a filename + icon — [Gmail.tsx:450](../resources/js/pages/Gmail.tsx#L450), [:548](../resources/js/pages/Gmail.tsx#L548), `AttachmentPreview` at [:556](../resources/js/pages/Gmail.tsx#L556). (Actual outbound attachments were already attached to the email via `ComposedEmail::attachments()`.)

**QA:** Open a composed mail that has a PDF/image attachment → click the thumbnail → preview opens; Download works. Requires the storage symlink (`php artisan storage:link`, already present).
> Note: only **composed** mails persist attachment files; transactional mails (payslip/sales docs) flag `has_attachments` but don't store the file bytes — existing design, unchanged.

---

## 3. Sidebar Filter Multi-Selection State ✅

**Issue:** Clicking folder tabs leaves "All Mail" and "Unread only" both highlighted.

**Fix:** `switchFolder` now resets `unreadOnly = false`, so only one nav item is active at a time — [Gmail.tsx:170](../resources/js/pages/Gmail.tsx#L170).

**QA:** Turn on **Unread only**, then click any folder → "Unread only" de-highlights; only the chosen folder is active.

---

## 4. System Announcements Missing From Sent Box ✅

**Issue:** Broadcast announcements don't show in the sender's outbox.

**Fix:** Same redefinition as #1. Announcements are logged with the publisher's `user_id`, so they now appear in **Sent** for whoever broadcast them.

**QA:** Publish an announcement (Broadcast Centre) → it appears under **Sent** for the publishing user, and in **All Mail** for in-scope viewers.

---

## 5. Lagging Page Refresh on Mark-as-Unread ✅

**Issue:** Marking read→unread triggers a full-page reload spinner.

**Fix:** read / unread / star / unstar are now **optimistic** — the row is patched in memory and only the counts refresh; no list reload — `PATCH` map + `runBulk` at [Gmail.tsx:190](../resources/js/pages/Gmail.tsx#L190). Rows that fall out of the current view (read mail in "Unread only", unstarred in "Starred") drop instantly.

**QA:** Mark an email unread (row action or toolbar) → instant toggle, no spinner.

---

## 6. Background Scrolling When Compose Modal is Active ✅

**Issue:** Scrolling inside the open Compose dock scrolls the inbox behind it.

**Fix:** `overscroll-behavior: contain` (+ scrollable `max-height`) on the compose body and textarea — [Gmail.tsx:955](../resources/js/pages/Gmail.tsx#L955), [:973](../resources/js/pages/Gmail.tsx#L973).

**QA:** Open Compose, scroll inside the message box → the inbox behind it stays put.

---

## 7. Search Box Forces Full-Page Reload on Every Input ✅

**Issue:** Typing in search shows a full-page spinner instead of live filtering.

**Fix:** Shimmers now appear only on the first/empty load (`loading && rows.length === 0`); search/paging refetches keep the existing rows visible behind a thin `.gm-loading-bar` progress strip — [Gmail.tsx:374-375](../resources/js/pages/Gmail.tsx#L374). Search stays debounced (350 ms).

**QA:** Type in **Search mail** → the list filters under a thin top progress bar; it never blanks to shimmer rows.

---

## Summary

| # | Issue | Status | Key location |
|---|---|---|---|
| 1 | Sent items sync | ✅ | EmailController.php:90 |
| 2 | Attachment preview | ✅ | Gmail.tsx:556 (`AttachmentPreview`) |
| 3 | Sidebar multi-select | ✅ | Gmail.tsx:170 |
| 4 | Announcements in Sent | ✅ | EmailController.php:90 (+ #1) |
| 5 | Mark-unread reload | ✅ | Gmail.tsx:190 |
| 6 | Compose background scroll | ✅ | Gmail.tsx:955 / 973 |
| 7 | Search full reload | ✅ | Gmail.tsx:374 |

All changes type-check clean. No backend behavior changed except the "Sent" folder definition (now `user_id = me`) and a new `mine` stat.
