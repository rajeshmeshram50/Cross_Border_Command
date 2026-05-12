<?php

namespace App\Services;

use App\Mail\AnnouncementPublishedMail;
use App\Models\Announcement;
use App\Models\Branch;
use App\Models\Client;
use App\Models\Employee;
use App\Models\User;
use App\Support\Settings;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;

/**
 * Resolves recipients for a published announcement and dispatches the
 * AnnouncementPublishedMail to each one. Recipient logic mirrors the
 * tenant scoping used elsewhere in the announcement flow:
 *
 *   - Branch-scoped announcement (branch_id is set, e.g. created by a
 *     branch_user) → mail goes to every employee of THAT branch only,
 *     filtered by the audience selection.
 *
 *   - Client-scoped announcement (client_id set, branch_id null,
 *     e.g. created by a client_admin/client_user) → mail goes to every
 *     employee under that client AND each branch's contact email,
 *     filtered by the audience selection.
 *
 *   - Platform-scoped (both null, super_admin) → every matching employee
 *     across all clients.
 *
 * Audience filter (roles / designations / exclusions) is honoured for
 * employees only — branch contact emails always receive client-wide
 * announcements so the branch ops team is in the loop.
 *
 * Failures are logged but never re-thrown — the announcement was already
 * persisted before this is called, and a transient SMTP issue must not
 * roll back the publish.
 */
class AnnouncementMailer
{
    public function sendForAnnouncement(Announcement $announcement, ?User $publisher = null): void
    {
        if (!$announcement->notify_email) {
            return;
        }
        if (!Settings::shouldSendMail()) {
            Log::info('Announcement mail skipped — master emailNotif is OFF', [
                'announcement_id' => $announcement->id,
            ]);
            return;
        }

        try {
            $announcement->loadMissing(['client:id,org_name,email', 'branch:id,name,email,client_id']);

            $orgName = $announcement->client?->org_name
                ?? config('mail.from.name', 'Cross Border Command');
            $publisherName = $publisher?->name ?: 'Broadcast Centre';

            $recipients = $this->resolveRecipients($announcement);
            if (empty($recipients)) {
                Log::info('Announcement mail skipped — no recipients resolved', [
                    'announcement_id' => $announcement->id,
                ]);
                return;
            }

            foreach ($recipients as $email => $name) {
                try {
                    Mail::to($email)->send(new AnnouncementPublishedMail(
                        $announcement,
                        $name ?: 'there',
                        $publisherName,
                        $orgName,
                    ));
                } catch (\Throwable $perRecipient) {
                    // One bad address shouldn't sink the rest of the blast.
                    Log::warning('Announcement mail failed for recipient', [
                        'announcement_id' => $announcement->id,
                        'email'           => $email,
                        'error'           => $perRecipient->getMessage(),
                    ]);
                }
            }
        } catch (\Throwable $e) {
            Log::error('Announcement mail dispatch failed', [
                'announcement_id' => $announcement->id ?? null,
                'error'           => $e->getMessage(),
            ]);
        }
    }

    /**
     * Build a [email => name] map of unique recipients for this
     * announcement, deduped by lowercase email so a person who has the
     * same address as a branch contact doesn't get two copies.
     */
    private function resolveRecipients(Announcement $announcement): array
    {
        $clientId = $announcement->client_id;
        $branchId = $announcement->branch_id;

        // Employees matching the audience filter.
        $employees = $this->fetchEmployees(
            $clientId,
            $branchId,
            $announcement->audience_type ?: 'all_employees',
            $announcement->audience_role_ids ?? [],
            $announcement->audience_designation_ids ?? [],
            $announcement->exclude_employee_ids ?? [],
        );

        $out = [];
        foreach ($employees as $emp) {
            $email = $emp->email ?: null;
            if (!$email) continue;
            $key = strtolower($email);
            if (isset($out[$key])) continue;
            $name = $emp->display_name
                ?: trim(($emp->first_name ?? '') . ' ' . ($emp->last_name ?? ''))
                ?: 'there';
            $out[$key] = ['email' => $email, 'name' => $name];
        }

        // Branch contact emails — only when the announcement is client-wide
        // (branch_id null). For branch-scoped announcements the branch user
        // already has the announcement; flooding the same inbox would
        // duplicate the message.
        if ($clientId && !$branchId) {
            $branches = Branch::where('client_id', $clientId)
                ->whereNotNull('email')
                ->get(['id', 'name', 'email']);
            foreach ($branches as $b) {
                $email = $b->email ?: null;
                if (!$email) continue;
                $key = strtolower($email);
                if (isset($out[$key])) continue;
                $out[$key] = ['email' => $email, 'name' => $b->name ?: 'Branch'];
            }
        }

        // Flatten to [email => name].
        $flat = [];
        foreach ($out as $row) {
            $flat[$row['email']] = $row['name'];
        }
        return $flat;
    }

    /**
     * Mirror of AnnouncementController::computeAudienceCount but returning
     * the actual rows (with email + display name) rather than a count.
     */
    private function fetchEmployees(
        $clientId,
        $branchId,
        string $audienceType,
        array $roleIds,
        array $designationIds,
        array $excludeEmployeeIds,
    ) {
        $q = Employee::query()
            ->select(['id', 'first_name', 'last_name', 'display_name', 'email']);

        if ($clientId === null) {
            $q->whereNull('client_id');
        } else {
            $q->where(function ($w) use ($clientId) {
                $w->whereNull('client_id')->orWhere('client_id', $clientId);
            });
        }
        if ($branchId !== null) {
            $q->where(function ($w) use ($branchId) {
                $w->whereNull('branch_id')->orWhere('branch_id', $branchId);
            });
        }

        if ($audienceType === 'roles' && !empty($roleIds)) {
            $q->where(function ($w) use ($roleIds) {
                $w->whereIn('primary_role_id', $roleIds)
                  ->orWhereIn('ancillary_role_id', $roleIds);
            });
        } elseif ($audienceType === 'designations' && !empty($designationIds)) {
            $q->whereIn('designation_id', $designationIds);
        }

        if (!empty($excludeEmployeeIds)) {
            $q->whereNotIn('id', $excludeEmployeeIds);
        }

        return $q->whereNotNull('email')->get();
    }
}
