# BROADCAST CENTRE MODULE — TECHNICAL DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Broadcast Centre (company-wide announcements)

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial technical documentation |

---

## 1. SYSTEM ARCHITECTURE

### 1.1 What the module is
Broadcast Centre pushes company-wide **announcements** to a targeted audience (all employees / roles / designations, with exclusions) and delivers them by **email**. Each announcement has a lifecycle (Draft → Scheduled → Active → Expired → Archived) that the server derives authoritatively; an audience count is computed from the employee master.

> **Architectural note:** the `announcements` domain is **separate from** the generic `notifications` (bell) domain. Publishing does **not** create notifications and does **not** appear in `Inbox.tsx`. Only `notify_email` is functional; `notify_in_app/sms/whatsapp` are schema columns hard-wired off.

### 1.2 High-Level Architecture Diagram

```
┌───────────────────────────────────────────────────────────────────────┐
│                           CLIENT LAYER                                 │
│  HrBroadcastCentre.tsx (list + 4-step create wizard + live preview)    │
│  (Inbox.tsx is unrelated — no announcement code)                      │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │ auth JSON (multipart for attachment)
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                        APPLICATION LAYER (Laravel 12)                  │
│  AnnouncementController: index/show/stats/nextCode/store/update/destroy│
│    permission hr.broadcast; lazy lifecycle refresh; audience count     │
│  AnnouncementMailer → AnnouncementPublishedMail (email only)          │
└───────────────────────────────┬───────────────────────────────────────┘
                                 │
                                 ▼
┌───────────────────────────────────────────────────────────────────────┐
│                          DATA LAYER (PostgreSQL c_b_c)                 │
│  announcements (soft deletes; no DB FKs; all-nullable recreate)        │
│  (notifications = separate Laravel bell, not written by this module)   │
└───────────────────────────────────────────────────────────────────────┘
```

### 1.3 Module structure
```
app/Http/Controllers/Api/AnnouncementController.php  (+ NotificationController — separate)
app/Services/AnnouncementMailer.php · app/Mail/AnnouncementPublishedMail.php
app/Models/Announcement.php
database/migrations/2026_05_29_100000_recreate_announcements_table_all_nullable.php (+ earlier)
resources/js/pages/hrms/HrBroadcastCentre.tsx
```

---

## 2. TECHNOLOGY STACK
| Layer | Tech |
|---|---|
| Backend | PHP 8.2 · Laravel 12 · PostgreSQL (`c_b_c`) · Sanctum |
| Delivery | Email via `AnnouncementMailer` (inline; gated by `Settings::shouldSendMail`) |
| Frontend | React 19 · TS · reactstrap/Bootstrap/Tailwind (Velzon) |

---

## 3. DATABASE SCHEMA

### 3.1 `announcements` (SoftDeletes; no DB FKs; all columns nullable)
Tenancy (`client_id`/`branch_id`/`created_by`/`updated_by`), `code` (`ANN-####`), `title`, `description`, `type` (General/Policy/Urgent, default General), `priority` (Normal/High/Critical), `attachment_path`/`attachment_original_name`, **audience:** `audience_type` (all_employees/roles/designations), `audience_role_ids`/`audience_designation_ids`/`exclude_employee_ids` (json), `audience_count`, **scheduling:** `publish_type` (immediate/scheduled), `publish_at`, `expires_at`, **ack:** `ack_required`/`ack_mode`/`ack_reminder_frequency`/`ack_escalation_days`, **notify:** `notify_email` (true), `notify_in_app`/`notify_sms`/`notify_whatsapp` (default false, unused), **`status`** (Draft/Scheduled/Active/Expired/Archived, default Draft). Composite index `(client_id, branch_id, status)`.

---

## 4. MODEL (`app/Models/Announcement.php`)
```php
class Announcement extends Model {
    use SoftDeletes;
    protected $appends = ['attachment_url'];   // file_url(attachment_path)
    // casts: *_ids → array; audience_count/ack_escalation_days → integer;
    //        publish_at/expires_at → datetime; ack_required/notify_* → boolean
    public function client(); public function branch(); public function creator(); public function updater();
}
```
No enum casts — type/priority/status are strings validated at the controller.

---

## 5. API ENDPOINTS CONFIGURATION

```php
Route::middleware(['auth:sanctum','user.active'])->group(function () {
    Route::get('/announcements/stats',     [AnnouncementController::class, 'stats']);      // before {id}
    Route::get('/announcements/next-code', [AnnouncementController::class, 'nextCode']);
    Route::apiResource('announcements', AnnouncementController::class);   // index/store/show/update/destroy
    // (separate bell) /notifications, /notifications/unread-count, /notifications/read-all, /notifications/{id}/read
});
```
Full detail in **BROADCAST_API_DOCUMENTATION.md**.

---

## 6. CONTROLLER ANALYSIS (`AnnouncementController`)

**Permission slug `hr.broadcast`** (view/add/edit/delete). Super-admin bypass; unseeded-module fallback allows client_admin/branch_user. `guardHierarchicalAction` blocks acting on higher-tier rows.

| Method | Purpose |
|---|---|
| `index` | Runs `refreshLifecycleStatuses` first, then lists (search/type/status; honours branch_id). Bare array. |
| `store` | Transaction: audience count + `ANN-####` code + lifecycle status; store attachment; **email if Active** |
| `update` | Recompute audience count if audience changed; publish-guard (title+description required to go Active); email on !Active→Active |
| `destroy` | Soft delete (`guardHierarchicalAction`) |
| `stats` | Status counts |

**Lifecycle (`resolveLifecycleStatus`):** Draft/Archived stay; else Expired if `expires_at < now`; Scheduled if `publish_type=scheduled` and `publish_at > now`; else Active. **`refreshLifecycleStatuses`** (run on index): Active/Scheduled past expiry → Expired; Scheduled past publish → Active.

**`computeAudienceCount`:** counts fully-onboarded active employees in scope; for roles matches `primary_role_id` OR legacy `ancillary_role_id` OR `whereJsonContains('ancillary_role_ids', rid)`; for designations `whereIn`; applies exclusions.

---

## 7. FRONTEND (`HrBroadcastCentre.tsx`)
List (KPI: Total/Draft/Published/High Priority; table: ANN ID, Title, Type, Priority, Audience, Publish Date, Actions). Create wizard (4 steps: Basic Details → Audience → Notifications → Review) with a live preview; always sends `publish_type=immediate` (scheduling/ack steps removed in the UI); email-only notify. Draft vs Publish; published rows are read-only. Loads roles/designations/onboarded employees for targeting; computes a live audience count client-side.

---

## 8. SECURITY & CAVEATS
1. **Announcements ≠ notifications** — publishing writes no notifications and never appears in the Inbox.
2. **Email is the only functional channel** (in-app/SMS/WhatsApp columns are unused); email gated by `Settings::shouldSendMail`.
3. **Scheduling & acknowledgement are dead in the UI** — the wizard always publishes immediately and forces ack off (the backend + lazy Scheduled→Active still support it via direct API).
4. **Audience count (display) can diverge from actual recipients** — the mailer's recipient query doesn't apply the onboarded-active gate or `whereJsonContains` that the count uses.
5. **No DB FKs**; no queue worker (mail sent inline; failures swallowed).
6. List/show return **bare** arrays/objects (unlike the notifications bell which wraps `{data}`).

---

## 9. METRICS
| Metric | Value |
|---|---|
| Controller methods | 7 |
| Permission slug | hr.broadcast |
| Table | announcements (SoftDeletes) |
| Statuses | Draft/Scheduled/Active/Expired/Archived |
| Working channels | email only |
| Test coverage | none automated |

---

*Related documents: BROADCAST_FUNCTIONAL_DOCUMENTATION.md · BROADCAST_CODE_WALKTHROUGH.md · BROADCAST_API_DOCUMENTATION.md*
