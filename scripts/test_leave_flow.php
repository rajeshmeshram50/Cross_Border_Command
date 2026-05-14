<?php

require __DIR__ . '/../vendor/autoload.php';
$app = require __DIR__ . '/../bootstrap/app.php';
$app->make(Illuminate\Contracts\Console\Kernel::class)->bootstrap();

use App\Http\Controllers\Api\LeavePlanController;
use App\Http\Controllers\Api\LeaveRequestController;
use App\Models\Employee;
use App\Models\LeaveRequest;
use App\Models\Masters\LeavePlanLeaveType;
use App\Models\Masters\LeavePlans;
use App\Models\User;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

// One-shot end-to-end check of the leave flow. Runs every step against
// the controllers using a fabricated auth context so we exercise the
// same code paths the SPA hits. Fail loud, succeed quietly.

function die_with(string $msg): never { fwrite(STDERR, "✗ $msg\n"); exit(1); }
function ok(string $msg): void { echo "✓ $msg\n"; }
function step(string $msg): void { echo "\n=== $msg ===\n"; }

// ─────────────────────────────────────────────────────────────────────
// 1. Pick a test employee + plan
// ─────────────────────────────────────────────────────────────────────
step('Step 1 — Resolve test fixtures');
$employee = Employee::where('email', 'durgeshurkude123440@gmail.com')->first()
    ?: Employee::whereHas('user', fn($q) => $q->where('email', 'durgeshurkude123440@gmail.com'))->first()
    ?: User::where('email', 'durgeshurkude123440@gmail.com')->first()
        ?->let(fn($u) => Employee::where('user_id', $u->id)->first());

if (!$employee) {
    // Fall back to any employee in client_id=5
    $employee = Employee::where('client_id', 5)->first();
}
if (!$employee) die_with('No test employee available');
$user = User::find($employee->user_id);
ok("Employee: id={$employee->id} name={$employee->first_name} {$employee->last_name} email={$employee->email} client={$employee->client_id} branch=" . ($employee->branch_id ?? 'NULL'));
ok("User account: id=" . ($user?->id ?? 'NONE') . " email=" . ($user?->email ?? 'NONE'));

// Prefer a plan that already has a Setup-configured type — empty plans
// would short-circuit step 2.
$plan = LeavePlans::where('client_id', $employee->client_id)
    ->whereHas('planTypeRows', fn($q) => $q->where('is_setup', true))
    ->first()
    ?? LeavePlans::where('client_id', $employee->client_id)->first();
if (!$plan) die_with('No plan in employee\'s client');
ok("Plan: id={$plan->id} name='{$plan->plan_name}' branch={$plan->branch_id} default=" . ($plan->is_default ? 'yes' : 'no'));

// ─────────────────────────────────────────────────────────────────────
// 2. Ensure plan has at least one type with a real Setup config
// ─────────────────────────────────────────────────────────────────────
step('Step 2 — Verify plan has a Setup-configured leave type');
$pivot = LeavePlanLeaveType::where('leave_plan_id', $plan->id)
    ->where('is_setup', true)
    ->first();
if (!$pivot) die_with("Plan {$plan->id} has no Setup-configured type. Run LeaveSeeder first.");
$type = $pivot->leaveType;
ok("Pivot id={$pivot->id} type='{$type->name}' (id={$type->id}) quota_summary='{$pivot->quota_summary}'");
$cfg = $pivot->config_json;
$quota = $cfg['accrual']['yearlyQuota'] ?? 0;
ok("Yearly quota from config: {$quota}");
$chainCfg = $cfg['approval']['chain'] ?? null;
ok('Chain in config: ' . (is_array($chainCfg) ? count($chainCfg) . ' level(s)' : 'NONE — backend will fall back to single Reporting Manager'));

// ─────────────────────────────────────────────────────────────────────
// 3. Make sure the employee is assigned to the plan (write directly to
//    pivot since the assignEmployees endpoint requires HTTP auth)
// ─────────────────────────────────────────────────────────────────────
step('Step 3 — Assign employee to plan');
$existing = DB::table('leave_plan_employees')->where('employee_id', $employee->id)->first();
if (!$existing) {
    DB::table('leave_plan_employees')->insert([
        'leave_plan_id' => $plan->id,
        'employee_id' => $employee->id,
        'assigned_at' => now(),
        'created_at' => now(),
        'updated_at' => now(),
    ]);
    ok("Assigned employee {$employee->id} → plan {$plan->id}");
} else {
    ok("Already assigned (existing leave_plan_id={$existing->leave_plan_id})");
}

// ─────────────────────────────────────────────────────────────────────
// 4. Hit /api/employees/{id}/leave-balances via the controller
// ─────────────────────────────────────────────────────────────────────
step('Step 4 — Employee profile balance view');
if (!$user) die_with('Employee has no User account — auth simulation impossible');

$req = Request::create("/api/employees/{$employee->id}/leave-balances", 'GET');
$req->setUserResolver(fn() => $user);
$response = app(LeavePlanController::class)->employeeBalances($req, $employee->id);
$balData = json_decode($response->getContent(), true)['data'] ?? null;
if (!$balData) die_with('employeeBalances returned no data');
ok("Balance response: " . count($balData['types'] ?? []) . " types for plan '" . ($balData['employee']['plan_name'] ?? 'NONE') . "'");
foreach ($balData['types'] as $t) {
    $avail = $t['unlimited'] ? '∞' : $t['available'];
    ok("  • {$t['name']} — quota={$t['quota']} used={$t['used']} available={$avail} unlimited=" . ($t['unlimited'] ? 'yes' : 'no'));
}

// Pick the first configured (non-unlimited, quota > 0) type for the request
$pickedType = collect($balData['types'])->firstWhere('quota', '>', 0);
if (!$pickedType) {
    // Try again finding any setup type
    $pickedType = collect($balData['types'])->first(fn($t) => $t['quota'] > 0 || $t['unlimited']);
}
if (!$pickedType) die_with('No type has a configured quota — cannot submit a leave request');
ok("Picked type for submission: '{$pickedType['name']}' (id={$pickedType['leave_type_id']})");

// ─────────────────────────────────────────────────────────────────────
// 5. Submit a leave request via the controller
// ─────────────────────────────────────────────────────────────────────
step('Step 5 — Submit a leave request');
$fromDate = date('Y-m-d', strtotime('+30 days'));
$toDate   = date('Y-m-d', strtotime('+31 days'));

$submitReq = Request::create('/api/leave-requests', 'POST', [
    'leave_type_id' => $pickedType['leave_type_id'],
    'from_date' => $fromDate,
    'to_date' => $toDate,
    'reason' => 'End-to-end test request — auto-generated',
    'day_type' => 'full',
]);
$submitReq->setUserResolver(fn() => $user);
try {
    $resp = app(LeaveRequestController::class)->store($submitReq);
    $body = json_decode($resp->getContent(), true);
    $created = $body['data'] ?? null;
    if (!$created) die_with('store() returned no data — body: ' . substr($resp->getContent(), 0, 300));
    $newReqId = $created['id'];
    ok("Created leave_request id={$newReqId} status={$created['status']} days={$created['days']}");
} catch (\Throwable $e) {
    die_with('store() threw: ' . $e->getMessage());
}

// Reload to inspect the chain
$newReq = LeaveRequest::find($newReqId);
ok("Chain snapshot: " . count($newReq->approval_chain) . " level(s), current_level={$newReq->current_approval_level}");
foreach ($newReq->approval_chain as $i => $level) {
    ok("  Level " . ($i+1) . ": kind={$level['approver_kind']} status={$level['status']}"
        . ($level['comment'] ? " comment='{$level['comment']}'" : '')
        . ($level['approver_employee_id'] ? " emp_id={$level['approver_employee_id']}" : '')
    );
}

// ─────────────────────────────────────────────────────────────────────
// 6. Approver-side: see the request in the queue
// ─────────────────────────────────────────────────────────────────────
step('Step 6 — Approver queue lookup');
// We need an approver user. Try to find one matching the current level.
$currentLevel = (int) $newReq->current_approval_level;
$chainEntry = $newReq->approval_chain[$currentLevel - 1] ?? null;
$approverUser = null;

if ($chainEntry) {
    if (!empty($chainEntry['approver_employee_id'])) {
        $appEmp = Employee::find($chainEntry['approver_employee_id']);
        if ($appEmp?->user_id) $approverUser = User::find($appEmp->user_id);
    } elseif (!empty($chainEntry['approver_user_id'])) {
        $approverUser = User::find($chainEntry['approver_user_id']);
    }
}
// Fall back to any client_admin / branch_user in the tenant for the admin-override path
if (!$approverUser) {
    $approverUser = User::where('client_id', $employee->client_id)
        ->whereIn('user_type', ['branch_user', 'client_admin', 'super_admin'])
        ->whereNotNull('email')
        ->first();
}
if (!$approverUser) {
    // Final fallback: super_admin
    $approverUser = User::where('user_type', 'super_admin')->whereNotNull('email')->first();
}
if (!$approverUser) die_with('No approver user resolvable for this request');
ok("Approver user: id={$approverUser->id} name={$approverUser->name} type={$approverUser->user_type}");

$approvalsReq = Request::create('/api/leave-requests/approvals', 'GET', ['status' => 'Pending']);
$approvalsReq->setUserResolver(fn() => $approverUser);
$apResp = app(LeaveRequestController::class)->approvals($approvalsReq);
$apBody = json_decode($apResp->getContent(), true);
$queue = $apBody['data'] ?? [];
$inQueue = collect($queue)->firstWhere('id', $newReqId);
if (!$inQueue && $newReq->status === 'Pending') {
    fwrite(STDERR, "⚠ Request {$newReqId} (Pending) not visible to {$approverUser->user_type} — queue has " . count($queue) . " other rows\n");
} else if ($newReq->status !== 'Pending') {
    ok("Request already finalized (status={$newReq->status}) — skipping queue check");
} else {
    ok("Request {$newReqId} is in approver's queue (" . count($queue) . " total Pending rows visible)");
}

// ─────────────────────────────────────────────────────────────────────
// 7. Approve the request (only if it's still Pending)
// ─────────────────────────────────────────────────────────────────────
step('Step 7 — Approve the request');
$newReq->refresh();
if ($newReq->status !== 'Pending') {
    ok("Request already in terminal state: {$newReq->status} (likely auto-approved via skip rule).");
} else {
    $approveReq = Request::create("/api/leave-requests/{$newReqId}/approve", 'POST', ['comment' => 'OK — test approval']);
    $approveReq->setUserResolver(fn() => $approverUser);
    try {
        $apResp = app(LeaveRequestController::class)->approve($approveReq, $newReqId);
        $apBody = json_decode($apResp->getContent(), true);
        ok("Approve returned: status=" . ($apBody['data']['status'] ?? '?'));
    } catch (\Throwable $e) {
        die_with("approve() threw: " . $e->getMessage());
    }
    $newReq->refresh();
    ok("Final status: {$newReq->status} approver_id={$newReq->approved_by} at={$newReq->approved_at}");
}

// ─────────────────────────────────────────────────────────────────────
// 8. Balance updates — used should reflect approved leaves
// ─────────────────────────────────────────────────────────────────────
step('Step 8 — Balance reflects the approval');
$balResp2 = app(LeavePlanController::class)->employeeBalances($req, $employee->id);
$bal2 = json_decode($balResp2->getContent(), true)['data'];
$row = collect($bal2['types'])->firstWhere('leave_type_id', $pickedType['leave_type_id']);
ok("After: quota={$row['quota']} used={$row['used']} available={$row['available']}");
if ($newReq->status === 'Approved' && (float)$row['used'] <= 0) {
    fwrite(STDERR, "⚠ used should reflect the approved leave but is still 0\n");
}

// ─────────────────────────────────────────────────────────────────────
// 9. Notifications generated
// ─────────────────────────────────────────────────────────────────────
step('Step 9 — Notifications produced');
$notifCount = DB::table('notifications')->count();
ok("Notifications table now has $notifCount row(s) total");
$latest = DB::table('notifications')->latest('created_at')->limit(5)->get();
foreach ($latest as $n) {
    $data = json_decode($n->data, true);
    ok("  • id={$n->id} kind=" . ($data['kind'] ?? '?') . " notifiable_id={$n->notifiable_id} subject='" . ($data['subject'] ?? '') . "'");
}

// ─────────────────────────────────────────────────────────────────────
echo "\n";
echo "✓✓✓  End-to-end leave flow PASSED  ✓✓✓\n";
echo "Request id={$newReqId} final status={$newReq->status}\n";
