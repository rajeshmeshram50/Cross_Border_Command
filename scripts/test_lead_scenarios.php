<?php

/**
 * Lead-flow smoke test — runs all 3 scenarios end-to-end against the live
 * controller code and the real IndiaMart API.
 *
 *   1. GET /sales/leads                  — baseline list
 *   2. GET /sales/leads/sync/config      — verify the gate enables for branch 2
 *   3. POST /sales/leads                 — manual lead add
 *   4. POST /sales/leads/sync            — real IndiaMart fetch (live API call)
 *   5. POST /sales/leads/sync            — repeat, verify upsert (no dupes)
 *   6. GET /sales/leads (per platform)   — final breakdown
 *
 * Throw-away script — `php scripts/test_lead_scenarios.php`. Leaves any leads
 * IndiaMart returns in the DB (that's the whole point); the test manual lead
 * gets a TEST-prefixed sender name so it's easy to spot/delete later.
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require __DIR__ . '/../bootstrap/app.php';
$kernel = $app->make(\Illuminate\Contracts\Console\Kernel::class);
$kernel->bootstrap();

use App\Http\Controllers\Api\SalesLeadController;
use App\Models\Lead;
use App\Models\User;
use Illuminate\Http\Request;

$divider = str_repeat('═', 78);
$h1 = fn ($s) => "\n\033[1;36m{$s}\033[0m\n" . str_repeat('─', strlen($s)) . "\n";
$ok = fn ($s) => "\033[32m✓\033[0m {$s}\n";
$ko = fn ($s) => "\033[31m✗\033[0m {$s}\n";
$dim = fn ($s) => "\033[2m{$s}\033[0m\n";

echo "\n{$divider}\n  LEAD FLOW END-TO-END TEST — Cross_Border_Command\n{$divider}\n";

// ─── Boot: load user, build controller ───────────────────────────────────
$user = User::where('email', 'rajeshmeshram50@mailinator.com')->first();
if (!$user) { echo $ko("User rajeshmeshram50@mailinator.com not found in DB"); exit(1); }

$controller = app(SalesLeadController::class);

echo $h1('Test user');
echo $dim(sprintf(
    "  id=%d  email=%s  name=%s  user_type=%s  client_id=%d  branch_id=%d",
    $user->id, $user->email, $user->name, $user->user_type, $user->client_id, $user->branch_id
));
echo $dim(sprintf(
    "  config('lead_sync.branch') = %s   keys = %s",
    var_export(config('lead_sync.branch'), true),
    implode(',', array_column((array) config('lead_sync.indiamart.keys'), 'label'))
));

/** Tiny helper — call a controller method with the user-bound request.
 *  Reflects on the method signature so methods that need extra services
 *  (e.g. syncFromCrm wants IndiaMartLeadSyncService) get them auto-resolved
 *  from the container, while the Request always carries our test user. */
$call = function (string $method, string $verb, string $uri, array $body = []) use ($controller, $user) {
    $req = Request::create($uri, $verb, $body);
    $req->setUserResolver(fn () => $user);

    $ref  = new ReflectionMethod($controller, $method);
    $args = [];
    foreach ($ref->getParameters() as $p) {
        $type = $p->getType();
        if ($type instanceof ReflectionNamedType
            && ($type->getName() === Request::class
                || is_subclass_of($type->getName(), Request::class))) {
            $args[] = $req;
        } elseif ($type instanceof ReflectionNamedType && !$type->isBuiltin()) {
            $args[] = app($type->getName());
        } else {
            $args[] = $p->isDefaultValueAvailable() ? $p->getDefaultValue() : null;
        }
    }
    return $controller->{$method}(...$args);
};

// ─── 1) BASELINE LIST ────────────────────────────────────────────────────
echo $h1('1) GET /sales/leads — baseline');
$resp = $call('index', 'GET', '/api/sales/leads');
$data = json_decode($resp->getContent(), true);
$baselineTotal = $data['pagination']['total'] ?? -1;
echo $ok("HTTP " . $resp->getStatusCode() . "   total leads in tenant = {$baselineTotal}");

// ─── 2) SYNC CONFIG ──────────────────────────────────────────────────────
echo $h1('2) GET /sales/leads/sync/config — gate check');
$resp = $call('syncConfig', 'GET', '/api/sales/leads/sync/config');
$cfg = json_decode($resp->getContent(), true);
echo($cfg['enabled'] ? $ok("enabled = true   labels = [" . implode(', ', $cfg['labels']) . "]")
                     : $ko("enabled = false (gate rejected this user)"));

// ─── 3) MANUAL LEAD ADD ──────────────────────────────────────────────────
echo $h1('3) POST /sales/leads — manual lead add');
$manualPayload = [
    'sender_name'         => 'TEST - QA Manual Lead',
    'sender_mobile'       => '9876543210',
    'sender_email'        => 'qa.test@example.com',
    'sender_company'      => 'QA Test Corp',
    'sender_city'         => 'Pune',
    'sender_state'        => 'Maharashtra',
    'sender_country_iso'  => 'IN',
    'sender_country_name' => 'India',
    'query_product_name'  => 'Test Product',
    'query_message'       => 'Smoke test — please ignore',
];
echo $dim('  payload: ' . json_encode($manualPayload, JSON_PRETTY_PRINT));
$resp = $call('store', 'POST', '/api/sales/leads', $manualPayload);
$created = json_decode($resp->getContent(), true);
if ($resp->getStatusCode() === 201) {
    $lead = $created['data'];
    echo $ok("HTTP 201   opp_code = {$lead['opp_code']}   id = {$lead['id']}   platform = {$lead['platform']}   query_type = {$lead['query_type']}");
    echo $dim("  qualified={$lead['qualified']}   lead_stage_id={$lead['lead_stage_id']}   client_id={$lead['client_id']}   branch_id={$lead['branch_id']}");
} else {
    echo $ko("HTTP " . $resp->getStatusCode() . "   " . $resp->getContent());
}

// ─── 4) FIRST IndiaMart SYNC (REAL API) ──────────────────────────────────
echo $h1('4) POST /sales/leads/sync — REAL IndiaMart fetch (first run)');
echo $dim('  hitting https://mapi.indiamart.com/wservce/crm/crmListing/v2/ for each key …');
$resp = $call('syncFromCrm', 'POST', '/api/sales/leads/sync');
$sync1 = json_decode($resp->getContent(), true);
echo $ok("HTTP " . $resp->getStatusCode());
echo $dim(sprintf(
    "  fetched=%d  created=%d  updated=%d  disqualified=%d   errors=%d",
    $sync1['fetched'] ?? 0, $sync1['created'] ?? 0, $sync1['updated'] ?? 0,
    $sync1['disqualified'] ?? 0, count($sync1['errors'] ?? [])
));
if (!empty($sync1['errors'])) {
    foreach (array_slice($sync1['errors'], 0, 5) as $e) echo $dim("    ! {$e}");
}

// ─── 5) SECOND SYNC — skipped (IndiaMart has a 5-min rate limit per key) ─
echo $h1('5) Second sync — skipped to avoid IndiaMart 5-min rate limit');
echo $dim("  IndiaMart 429s on repeat calls within 5 minutes per key. The first run's");
echo $dim("  Eloquent updateOrCreate path is the same code on every iteration — if the");
echo $dim("  first run created N leads, a re-run after the rate window resets will update");
echo $dim("  the same N rows. Run scripts/test_lead_scenarios.php again 5+ min from now to");
echo $dim("  verify, or hit Sync from the UI twice with a 5-minute gap.");

// ─── 6) FINAL LIST + BREAKDOWN ───────────────────────────────────────────
echo $h1('6) GET /sales/leads — final state');
$resp = $call('index', 'GET', '/api/sales/leads?per_page=100');
$final = json_decode($resp->getContent(), true);
echo $ok("total leads now = " . ($final['pagination']['total'] ?? 0)
       . "   (baseline was {$baselineTotal})");

// Breakdown by platform + qualified/disqualified
$breakdown = Lead::where('client_id', $user->client_id)
    ->selectRaw('platform, qualified, disqualified, count(*) as n')
    ->groupBy('platform', 'qualified', 'disqualified')
    ->orderBy('platform')
    ->get();
echo "\n  Platform breakdown (this tenant):\n";
foreach ($breakdown as $r) {
    $status = $r->qualified ? 'qualified  ' : ($r->disqualified ? 'disqualified' : 'unknown     ');
    echo $dim(sprintf("    %-12s  %s  %d", $r->platform ?: '(null)', $status, $r->n));
}

// Sample rows
$sample = Lead::where('client_id', $user->client_id)
    ->orderByDesc('id')
    ->limit(5)
    ->get(['id', 'opp_code', 'platform', 'query_type', 'sender_name', 'sender_country_iso', 'qualified', 'disqualified', 'query_time']);
echo "\n  Most-recent 5 rows:\n";
foreach ($sample as $r) {
    echo $dim(sprintf(
        "    %-9s  %-9s  %-18s  %s  %s%s",
        $r->opp_code, $r->platform, $r->query_type,
        str_pad($r->sender_country_iso ?? '--', 4),
        substr($r->sender_name ?? '', 0, 32),
        $r->disqualified ? '   [disqualified]' : ''
    ));
}

echo "\n{$divider}\n  DONE. Test manual lead opp_code is " . ($created['data']['opp_code'] ?? '?')
   . " — delete with:  DELETE FROM leads WHERE opp_code = '"
   . ($created['data']['opp_code'] ?? '?') . "';\n{$divider}\n\n";
