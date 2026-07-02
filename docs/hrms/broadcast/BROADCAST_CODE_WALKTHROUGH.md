# BROADCAST CENTRE MODULE — CODE WALKTHROUGH DOCUMENTATION

> Cross_Border_Command SaaS ERP · HRMS → Broadcast Centre
> Execution-order trace of the real code paths.

---

## DOCUMENT CONTROL

| Version | Date | Author | Description |
|---|---|---|---|
| 1.0 | 2026-07-01 | System | Initial code walkthrough |

---

## 0. HOW TO READ
Traces: create → publish → email delivery → lifecycle refresh. Files: `AnnouncementController.php`, `AnnouncementMailer.php`, `Announcement.php`, `HrBroadcastCentre.tsx`.

---

## 1. CREATE / PUBLISH

### `AnnouncementController::store()`
```php
$this->authorize($request, 'can_add');                     // hr.broadcast
$data = $this->validatePayload($request);                  // title/description required unless Draft; attachment mimes/20MB
return DB::transaction(function () {
    [$clientId,$branchId] = $this->resolveOwnership($request);
    $data['audience_count'] = $this->computeAudienceCount(audience_type, role_ids, designation_ids, exclude_ids, $clientId, $branchId);
    $row = Announcement::create($data + ['client_id'=>$clientId,'branch_id'=>$branchId,'created_by'=>$auth->id,
        'code'=>$this->allocateCode(...),                   // ANN-#### under lock
        'status'=>$this->resolveLifecycleStatus($data)]);
    if ($request->hasFile('attachment')) $row->update(['attachment_path'=>..., 'attachment_original_name'=>...]);
    if ($row->status === 'Active') $this->announcementMailer->sendForAnnouncement($row, $auth);   // email now
    return response()->json($row, 201);
});
```

### `update()` — publish guard
```php
// recompute audience_count only if an audience field changed
$data['status'] = $this->resolveLifecycleStatus($merged);
if ($row->status !== 'Active' && $data['status'] === 'Active') {
    if (empty title || empty description) throw ValidationException;    // publish requires content
}
$row->update($data);
if ($prev !== 'Active' && $row->status === 'Active') $this->announcementMailer->sendForAnnouncement($row, $user);
```

### `resolveLifecycleStatus()`
```php
if (status ∈ [Draft,Archived]) return status;
if (expires_at && expires_at < now) return 'Expired';
if (publish_type==='scheduled' && publish_at > now) return 'Scheduled';
return 'Active';
```

---

## 2. AUDIENCE COUNT
```php
computeAudienceCount(): Employee where status='Active' and onboarding_stage_completed >= 6, tenant-scoped;
  roles → primary_role_id OR ancillary_role_id OR whereJsonContains('ancillary_role_ids', rid);
  designations → whereIn(designation_id); minus exclude_employee_ids; return count
```

---

## 3. EMAIL DELIVERY (`AnnouncementMailer`)
```php
sendForAnnouncement($ann, $publisher):
  if (!$ann->notify_email || !Settings::shouldSendMail()) return;         // gated
  $recipients = resolveRecipients($ann);                                  // [email=>name]
  foreach ($recipients as $email=>$name) try { Mail::to($email)->send(new AnnouncementPublishedMail(...)); }
                                          catch (\Throwable $e) { Log::warning(...); }   // never rethrows
resolveRecipients(): audience employees + (client-wide only) branch contact emails, deduped by lowercase email
// NOTE: fetchEmployees() here does NOT apply the onboarded-active gate or whereJsonContains,
//       so the actual recipient set can differ from the displayed audience_count.
```

---

## 4. LAZY LIFECYCLE REFRESH
```php
refreshLifecycleStatuses($user):   // run at the start of index()
  Active|Scheduled with expires_at < now  → Expired   (scoped bulk update)
  Scheduled with publish_at <= now        → Active     (scoped bulk update)
```

---

## 5. FRONTEND (`HrBroadcastCentre.tsx`)
```tsx
GET /announcements + GET /announcements/stats
// 4-step wizard: buildPayload always sends publish_type='immediate';
//   forces ack_* off and notify_in_app/sms/whatsapp='0'; notify_email from toggle
POST /announcements (multipart)  or  POST /announcements/{savedId}?_method=PUT
PUT /announcements/{id} {status:'Active', publish_type:'immediate'}   // Publish Now
DELETE /announcements/{id}   // drafts only
```

---

## 6. CROSS-CUTTING PATTERNS
| Pattern | Where | Why |
|---|---|---|
| Server-authoritative status | resolveLifecycleStatus | UI can't publish past expiry |
| Lazy lifecycle | refreshLifecycleStatuses | No scheduler |
| Audience count | computeAudienceCount | Preview reach |
| Best-effort email | AnnouncementMailer | Publish never fails on SMTP |
| Row-locked code | allocateCode | Unique ANN-#### |

---

## 7. NOTES & CAVEATS
- Announcements are **not** notifications; nothing writes to the bell / Inbox.
- Only email works; in-app/SMS/WhatsApp columns unused; scheduling/ack disabled in the UI.
- Audience count vs actual recipients can diverge (mailer query drift).
- No DB FKs; no queue worker (inline mail).
- DB is PostgreSQL.

---

*Related documents: BROADCAST_TECHNICAL_DOCUMENTATION.md · BROADCAST_FUNCTIONAL_DOCUMENTATION.md · BROADCAST_API_DOCUMENTATION.md*
