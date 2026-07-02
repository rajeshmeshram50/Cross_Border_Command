# BROADCAST CENTRE MODULE — API DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Broadcast Centre
> Base URL: `{APP_URL}/api` · Requires `Authorization: Bearer <sanctum_token>`

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial API documentation |

---

## 1. CONVENTIONS
- Auth: `auth:sanctum` + `user.active`. Permission slug **`hr.broadcast`** (view/add/edit/delete). Super-admin bypasses; branch-scoped.
- List/show return **bare** arrays/objects (not `{data}`).
- Status codes: 200/201 · 401 · 403 · 404 · 422 (validation / publish without content).

---

## 2. ENDPOINT INDEX

| # | Method | Path | Purpose |
|---|---|---|---|
| 1 | GET | `/announcements` | List (+ lazy lifecycle refresh) |
| 2 | GET | `/announcements/stats` | Status counts |
| 3 | GET | `/announcements/next-code` | Next `ANN-####` |
| 4 | POST | `/announcements` | Create (draft or publish) |
| 5 | GET | `/announcements/{id}` | Show |
| 6 | PUT | `/announcements/{id}` | Update / publish |
| 7 | DELETE | `/announcements/{id}` | Soft delete |

(Separate bell: `/notifications`, `/notifications/unread-count`, `/notifications/read-all`, `/notifications/{id}/read` — unrelated to announcements.)

---

## 3. ENDPOINT DETAIL

### GET `/announcements?search=&type=&status=&branch_id=`
Bare array `[{ id, code, title, type, priority, status, audience_type, audience_count, publish_at, expires_at, attachment_url, … }]`. Runs the lazy lifecycle refresh first.

### GET `/announcements/stats`
```json
{ "total": 12, "active": 5, "scheduled": 0, "draft": 4, "expired": 2, "archived": 1 }
```

### POST `/announcements` (multipart)
```json
{ "title": "New Leave Policy", "description": "<p>…</p>", "type": "Policy", "priority": "High",
  "audience_type": "roles", "audience_role_ids": [3,7], "exclude_employee_ids": [88],
  "publish_type": "immediate", "notify_email": true, "status": "Active",
  "attachment": <file png/jpg/jpeg/pdf ≤20MB> }
```
Validation: `title`/`description` required unless Draft; `type` (General/Policy/Urgent); `priority` (Normal/High/Critical); `audience_type` (all_employees/roles/designations); id arrays cast to ints; `expires_at` ≥ `publish_at`.
**Behaviour:** computes `audience_count` + `ANN-####`; derives status; stores attachment; **emails the audience if the resulting status is Active**.
**Response 201:** the announcement row.
**Errors:** 403 · 422.

### PUT `/announcements/{id}`
Update; recomputes audience count if audience changed. **Publishing to Active requires title + description** (422 otherwise). Emails on !Active→Active.

### DELETE `/announcements/{id}`
Soft delete (hierarchy-guarded) → `{ "message": "Announcement removed." }`.

---

## 4. ERROR EXAMPLES
**422 — publish without content**
```json
{ "message": "…", "errors": { "title": ["The title is required to publish."], "description": ["The description is required to publish."] } }
```

---

## 5. QUICK REFERENCE
```
GET  /announcements/next-code        # ANN-#### preview
POST /announcements (status=Draft)   # save draft
PUT  /announcements/{id} status=Active  # publish → emails audience
GET  /announcements/stats            # KPIs
```

---

## 6. NOTES (caveats)
1. Email is the only working channel (gated by the mail setting); in-app/SMS/WhatsApp unused.
2. Scheduling & acknowledgement are backend-supported but disabled in the UI.
3. Audience count (display) can differ from actual email recipients.
4. Announcements don't create notifications / appear in the Inbox.
5. No DB FKs; mail sent inline (best-effort). List/show are bare (not `{data}`).

---

*Related documents: BROADCAST_TECHNICAL_DOCUMENTATION.md · BROADCAST_FUNCTIONAL_DOCUMENTATION.md · BROADCAST_CODE_WALKTHROUGH.md*
