# BROADCAST CENTRE MODULE — FUNCTIONAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Broadcast Centre

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial functional documentation |

---

## 1. MODULE OVERVIEW

### 1.1 Purpose
Broadcast Centre lets HR send company-wide announcements (policies, notices, urgent updates) to a targeted audience, delivered by email. Announcements have a type/priority, an optional attachment, and a lifecycle status.

### 1.2 Business value
| Benefit | Description |
|---|---|
| Targeted comms | Reach all employees, specific roles, or designations (with exclusions) |
| Prioritised | Type + priority frame urgency in the subject line |
| Audit-friendly | Coded, timestamped, soft-deletable records |
| Attachments | Attach a policy PDF or image |

### 1.3 Key features
- **4-step create wizard** (Basic Details → Audience → Notifications → Review) with live preview.
- **Audience targeting** with a live employee count.
- **Email delivery** to the audience (+ branch contacts for client-wide broadcasts).
- **Lifecycle** (Draft / Active / Expired / Archived).

---

## 2. ROLES & ACCESS
Gated by **`hr.broadcast`** (view/add/edit/delete). Super-admin bypasses; branch users are branch-scoped.

---

## 3. BUSINESS PROCESS FLOW

```
┌───────────────────────────────────────────────────────────────────┐
│                     ANNOUNCEMENT LIFECYCLE                         │
└───────────────────────────────────────────────────────────────────┘
   HR creates (Draft) → 4-step wizard
     • Basic: title, description, type, priority, attachment
     • Audience: all / roles / designations (+ exclusions) → live count
     • Notifications: email toggle
     • Review → Save Draft or Publish
        │
        ▼ Publish (immediate)
   ACTIVE → emails sent to the audience (+ branch contacts if client-wide)
        │
        ▼
   EXPIRED (past expiry) / ARCHIVED
   (Draft rows can be edited/published/deleted; published rows are view-only)
```

> The backend also supports **Scheduled** (publish later) and lazy Scheduled→Active promotion, but the current UI always publishes immediately.

---

## 4. SCREEN SPECIFICATIONS

### 4.1 Broadcast Centre (`HrBroadcastCentre.tsx`)
```
┌───────────────────────────────────────────────────────────────────┐
│  Broadcast Centre                                  [+ New]         │
│  [Total][Draft][Published][High Priority]                         │
│  Sr│ANN ID│Title│Type│Priority│Audience│Publish Date│Actions       │
│  Actions: Edit/View · Publish Now (drafts) · Delete (drafts)      │
└───────────────────────────────────────────────────────────────────┘
```
Create wizard: Basic Details (title ≤191, description, type, priority, attachment ≤20MB png/jpg/jpeg/pdf), Audience (type + role/designation pickers + exclusions + live count), Notifications (email), Review. Published rows open read-only.

---

## 5. BUSINESS RULES

| # | Rule |
|---|---|
| 1 | Codes `ANN-####` (auto) |
| 2 | Publishing to Active requires title + description |
| 3 | Audience: all_employees / roles / designations (+ exclude); count = onboarded-active staff |
| 4 | Email is the only working channel (gated by the mail setting) |
| 5 | Lifecycle: Draft → Active → Expired / Archived (server-derived) |
| 6 | Draft rows editable/deletable; published rows are records (view-only) |
| 7 | Announcements don't create in-app notifications (email only) |

---

## 6. STATUS MODEL
Draft · Scheduled · Active · Expired · Archived. The UI produces Draft/Active; Scheduled arises only via the API.

---

## 7. KNOWN LIMITATIONS (client-facing)

| Area | Limitation |
|---|---|
| Channels | Only email works (in-app/SMS/WhatsApp are non-functional) |
| Scheduling / ack | Present in the backend but disabled in the wizard |
| Recipient vs count | The displayed audience count can differ from actual email recipients (multi-role / half-onboarded) |
| Inbox | Announcements do not appear in the personal Inbox |
| Automation | Email sent inline (no queue worker); failures are logged, not surfaced |

---

*Related documents: BROADCAST_TECHNICAL_DOCUMENTATION.md · BROADCAST_CODE_WALKTHROUGH.md · BROADCAST_API_DOCUMENTATION.md*
