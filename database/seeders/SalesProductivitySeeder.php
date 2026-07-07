<?php

namespace Database\Seeders;

use App\Models\Employee;
use App\Models\SalesMeeting;
use App\Models\SalesReminder;
use App\Models\User;
use Illuminate\Database\Seeder;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Seeds the Sales Matrix → Productivity Tracker with realistic Meeting +
 * Reminder rows for QA. The dataset is shaped to exercise the known bugs:
 *
 *   - Completed physical meetings (status = Done)          → edit-lock bug
 *   - A double-booked pair (same date + venue + start_time) → conflict bug
 *   - Many meetings on ONE date                            → calendar overflow
 *   - opp_id + customer + email populated from real leads  → opportunity auto-fill
 *   - Every lifecycle status present                        → status search filter
 *
 * Tenant / owner ids resolve from the first tenant-scoped user, so it works
 * on any seeded database without hard-coded ids. Idempotent: skips if the
 * tenant already has productivity-tracker rows.
 */
class SalesProductivitySeeder extends Seeder
{
    public function run(): void
    {
        // Seed the MOST ACTIVE sales tenant (the client with the most leads) so
        // the Productivity Tracker has data where the QA actually works, not
        // whichever tenant happens to have the lowest user id.
        $topClientId = DB::table('leads')
            ->whereNotNull('client_id')
            ->select('client_id', DB::raw('count(*) as c'))
            ->groupBy('client_id')
            ->orderByDesc('c')
            ->value('client_id');

        $user = $topClientId
            ? User::where('client_id', $topClientId)->orderBy('id')->first()
            : null;
        $user ??= User::whereNotNull('client_id')->orderBy('id')->first();

        if (!$user) {
            $this->command?->warn('SalesProductivitySeeder: no tenant-scoped user found — skipping.');
            return;
        }

        $this->seedForUser($user);
    }

    /**
     * Seed meetings + reminders owned by (and scoped to) a specific user's
     * client + branch. Branch users only see their own branch's rows, so the
     * skip-check is per (client_id, branch_id) — call this with the exact user
     * whose branch needs data. Public so it can be invoked directly:
     *   (new SalesProductivitySeeder)->seedForUser(User::find(19));
     */
    public function seedForUser(User $user): void
    {
        $clientId = $user->client_id;
        $branchId = $user->branch_id;
        $empId    = Employee::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))
            ->orderBy('id')->value('id')
            ?? Employee::where('client_id', $clientId)->orderBy('id')->value('id');

        $exists = SalesMeeting::where('client_id', $clientId)
            ->when($branchId === null, fn ($q) => $q->whereNull('branch_id'), fn ($q) => $q->where('branch_id', $branchId))
            ->exists();
        if ($exists) {
            $this->command?->info("SalesProductivitySeeder: client {$clientId} branch " . ($branchId ?? 'null') . ' already has data — skipping.');
            return;
        }

        // Real leads give lifelike customer / email / opportunity values (and
        // make the "auto-fill from Opportunity ID" bug testable). Fallback list
        // used when the tenant has too few leads.
        $leads = DB::table('leads')
            ->where('client_id', $clientId)
            ->whereNotNull('opp_code')
            ->whereNotNull('sender_company')->where('sender_company', '!=', '')
            ->orderByDesc('id')
            ->limit(12)
            ->get(['opp_code', 'sender_company', 'sender_email', 'sender_mobile'])
            ->all();

        $fallback = [
            (object) ['opp_code' => 'OPP-9001', 'sender_company' => 'Apex Agro Pvt Ltd',   'sender_email' => 'contact@apexagro.com',    'sender_mobile' => '+91-9876543210'],
            (object) ['opp_code' => 'OPP-9002', 'sender_company' => 'NorthStar Trading',    'sender_email' => 'sales@northstar.com',     'sender_mobile' => '+91-9811122233'],
            (object) ['opp_code' => 'OPP-9003', 'sender_company' => 'GreenHarvest Global',  'sender_email' => 'hello@greenharvest.com',  'sender_mobile' => '+91-9700011122'],
            (object) ['opp_code' => 'OPP-9004', 'sender_company' => 'Bharat Agro Traders',  'sender_email' => 'info@bharatagro.com',     'sender_mobile' => '+91-9822233344'],
        ];
        if (count($leads) < 4) {
            $leads = array_merge($leads, $fallback);
        }
        $pick = function (int $i) use ($leads) {
            $l = $leads[$i % count($leads)];
            return [
                'opp_id'   => $l->opp_code,
                'customer' => $l->sender_company,
                'email'    => $l->sender_email ?: 'na@example.com',
                'contact'  => $l->sender_mobile ?: null,
            ];
        };

        $today = Carbon::today();
        $mSeq = 0; $pSeq = 0;
        $code = function (string $type) use (&$mSeq, &$pSeq): string {
            return $type === SalesMeeting::TYPE_VIRTUAL
                ? sprintf('M-%03d', ++$mSeq)
                : sprintf('P-%03d', ++$pSeq);
        };

        // ── Meetings ──────────────────────────────────────────────────────
        // date offsets are relative to today so the calendar always has
        // "today" populated (overflow test) plus spread across the month.
        $meetingSpecs = [
            // ── 7 meetings on TODAY → calendar-cell overflow (bugs 15-17) ──
            ['type' => 'virtual',  'off' => 0, 'start' => '09:00', 'end' => '09:30', 'status' => 'In Progress', 'platform' => 'Zoom',        'place' => 'https://zoom.us/j/1001',        'agenda' => 'Kick-off call'],
            ['type' => 'virtual',  'off' => 0, 'start' => '10:00', 'end' => '10:30', 'status' => 'Done',        'platform' => 'Google Meet',  'place' => 'https://meet.google.com/abc',   'agenda' => 'Price negotiation'],
            ['type' => 'physical', 'off' => 0, 'start' => '11:00', 'end' => '12:00', 'status' => 'In Progress', 'platform' => 'Office Visit', 'place' => 'IGC HQ, Andheri East, Mumbai',  'agenda' => 'Sample review'],
            ['type' => 'physical', 'off' => 0, 'start' => '12:00', 'end' => '13:00', 'status' => 'Done',        'platform' => 'Client Site',  'place' => 'Client Warehouse, Bhiwandi',    'agenda' => 'Quality inspection'],  // Done physical → bug 13
            // ── Double-booked pair: same date + venue + start_time (bug 14) ──
            ['type' => 'physical', 'off' => 0, 'start' => '14:00', 'end' => '15:00', 'status' => 'In Progress', 'platform' => 'Trade Fair',   'place' => 'Trade Fair Hall A, BKC',        'agenda' => 'Booth walkthrough'],
            ['type' => 'physical', 'off' => 0, 'start' => '14:00', 'end' => '15:00', 'status' => 'In Progress', 'platform' => 'Trade Fair',   'place' => 'Trade Fair Hall A, BKC',        'agenda' => 'Conflicting booking (same venue/time)'],
            ['type' => 'virtual',  'off' => 0, 'start' => '16:00', 'end' => '16:30', 'status' => 'Postponed',   'platform' => 'Microsoft Teams','place' => 'https://teams.microsoft.com/x','agenda' => 'Contract terms'],

            // ── Spread across the month, all statuses (bugs 13 & 19) ──
            ['type' => 'physical', 'off' => -2, 'start' => '10:30', 'end' => '11:30', 'status' => 'Done',        'platform' => 'Office Visit', 'place' => 'Regional Office, Pune',         'agenda' => 'Onboarding'],           // Done physical → bug 13
            ['type' => 'virtual',  'off' => -1, 'start' => '15:00', 'end' => '15:45', 'status' => 'Cancelled',   'platform' => 'Zoom',         'place' => 'https://zoom.us/j/1002',        'agenda' => 'Follow-up (cancelled)'],
            ['type' => 'physical', 'off' => 1,  'start' => '09:30', 'end' => '10:30', 'status' => 'In Progress', 'platform' => 'Client Site',  'place' => 'Buyer Office, Ahmedabad',       'agenda' => 'Deal closure'],
            ['type' => 'virtual',  'off' => 2,  'start' => '11:00', 'end' => '11:30', 'status' => 'Done',        'platform' => 'Google Meet',  'place' => 'https://meet.google.com/def',   'agenda' => 'Documentation'],
            ['type' => 'physical', 'off' => 3,  'start' => '13:00', 'end' => '14:00', 'status' => 'Cancelled',   'platform' => 'Trade Fair',   'place' => 'Expo Center, Delhi',            'agenda' => 'Networking (cancelled)'],
            ['type' => 'virtual',  'off' => 5,  'start' => '16:30', 'end' => '17:00', 'status' => 'In Progress', 'platform' => 'Microsoft Teams','place' => 'https://teams.microsoft.com/y','agenda' => 'Renewal discussion'],
            ['type' => 'physical', 'off' => 7,  'start' => '12:00', 'end' => '13:00', 'status' => 'Postponed',   'platform' => 'Office Visit', 'place' => 'IGC HQ, Andheri East, Mumbai',  'agenda' => 'Compliance review'],
        ];

        foreach ($meetingSpecs as $i => $m) {
            $party = $pick($i);
            SalesMeeting::create([
                'client_id'          => $clientId,
                'branch_id'          => $branchId,
                'created_by_user_id' => $user->id,
                'employee_id'        => $empId,
                'code'               => $code($m['type']),
                'opp_id'             => $party['opp_id'],
                'customer'           => $party['customer'],
                'email'              => $party['email'],
                'contact'            => $party['contact'],
                'platform'           => $m['platform'],
                'date'               => $today->copy()->addDays($m['off'])->toDateString(),
                'start_time'         => $m['start'],
                'end_time'           => $m['end'],
                'link'               => $m['type'] === 'virtual'  ? $m['place'] : null,
                'venue'              => $m['type'] === 'physical' ? $m['place'] : null,
                'agenda'             => $m['agenda'],
                'status'             => $m['status'],
                'type'               => $m['type'],
            ]);
        }

        // ── Reminders ─────────────────────────────────────────────────────
        $reminderSpecs = [
            ['off' => 0,  'subject' => 'Send updated quotation',        'tat' => '24 Hours', 'status' => 'In Progress', 'remark' => 'Awaiting buyer confirmation'],
            ['off' => 0,  'subject' => 'Chase signed PI',               'tat' => '48 Hours', 'status' => 'In Progress', 'remark' => 'PI shared last week'],
            ['off' => 0,  'subject' => 'Share product catalogue',       'tat' => '24 Hours', 'status' => 'Done',        'remark' => 'Catalogue emailed'],
            ['off' => -1, 'subject' => 'Payment follow-up',             'tat' => '1 Week',   'status' => 'In Progress', 'remark' => 'Advance pending'],
            ['off' => 1,  'subject' => 'Confirm shipment schedule',     'tat' => '48 Hours', 'status' => 'In Progress', 'remark' => null],
            ['off' => 2,  'subject' => 'Collect KYC documents',         'tat' => '1 Week',   'status' => 'Done',        'remark' => 'Received via email'],
            ['off' => 3,  'subject' => 'Re-share revised T&C',          'tat' => '24 Hours', 'status' => 'In Progress', 'remark' => 'Legal reviewing'],
            ['off' => 5,  'subject' => 'Schedule sample dispatch',      'tat' => '48 Hours', 'status' => 'In Progress', 'remark' => null],
        ];

        foreach ($reminderSpecs as $i => $r) {
            $party = $pick($i);
            SalesReminder::create([
                'client_id'          => $clientId,
                'branch_id'          => $branchId,
                'created_by_user_id' => $user->id,
                'employee_id'        => $empId,
                'opp_id'             => $party['opp_id'],
                'opp_date'           => $today->copy()->subDays(3)->toDateString(),
                'subject'            => $r['subject'],
                'set_date'           => $today->copy()->addDays($r['off'])->toDateString(),
                'tat'                => $r['tat'],
                'remark'             => $r['remark'],
                'status'             => $r['status'],
            ]);
        }

        $this->command?->info('SalesProductivitySeeder: seeded ' . count($meetingSpecs) . ' meetings + ' . count($reminderSpecs) . ' reminders for client ' . $clientId . '.');
    }
}
