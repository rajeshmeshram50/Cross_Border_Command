<?php
/**
 * Comprehensive SaaS multi-tenant scope test.
 *
 * Topology:
 *   super_admin
 *   ├── Client A (client_id = 901)
 *   │     ├── Main  Branch A1 (branch_id = 801, is_main = true)  — user "mainA"
 *   │     ├── Sub   Branch A2 (branch_id = 802, is_main = false) — user "subA2"
 *   │     ├── Sub   Branch A3 (branch_id = 803, is_main = false) — user "subA3"
 *   │     └── client_admin A (clientA)
 *   └── Client B (client_id = 902)
 *         ├── Main  Branch B1 (branch_id = 811, is_main = true)  — user "mainB"
 *         └── client_admin B (clientB)
 *
 * Visibility matrix tested against the `countries` master:
 *
 *   Row created by       | super | clientA | clientB | mainA | subA2 | subA3 | mainB
 *   --------------------- | ----- | ------- | ------- | ----- | ----- | ----- | -----
 *   super (client=null)   |   ✓   |    ✓    |    ✓    |   ✓   |   ✓   |   ✓   |   ✓
 *   clientA (branch=null) |   ✓   |    ✓    |    ✗    |   ✓   |   ✓   |   ✓   |   ✗
 *   mainA (branch=801)    |   ✓   |    ✓    |    ✗    |   ✓   |   ✓   |   ✓   |   ✗
 *   subA2 (branch=802)    |   ✓   |    ✓    |    ✗    |   ✓   |   ✓   |   ✗   |   ✗
 *   subA3 (branch=803)    |   ✓   |    ✓    |    ✗    |   ✓   |   ✗   |   ✓   |   ✗
 *   clientB (branch=null) |   ✓   |    ✗    |    ✓    |   ✗   |   ✗   |   ✗   |   ✓
 *   mainB  (branch=811)   |   ✓   |    ✗    |    ✓    |   ✗   |   ✗   |   ✗   |   ✓
 *
 * Run: php scripts/smoke-saas-scope.php
 */

require __DIR__ . '/../vendor/autoload.php';
$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);

use App\Models\User;
use App\Models\Branch;
use App\Models\Client;
use App\Models\Masters\Countries;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;
use Illuminate\Support\Facades\DB;

/** Wipe + seed a clean test setup. */
function seed(): array {
    // We only mess with test ids that are way out of normal range.
    Countries::query()->whereIn('name', ['R_SUPER','R_CLIENTA','R_CLIENTB','R_MAINA','R_SUBA2','R_SUBA3','R_MAINB'])->delete();
    Branch::query()->whereIn('id', [801, 802, 803, 811])->forceDelete();
    Client::query()->whereIn('id', [901, 902])->forceDelete();

    // Clients
    $ca = Client::forceCreate([
        'id' => 901, 'org_name' => 'Client A Test', 'unique_number' => 'T-CA-' . time(),
        'email' => 'ca@test.local', 'status' => 'active',
    ]);
    $cb = Client::forceCreate([
        'id' => 902, 'org_name' => 'Client B Test', 'unique_number' => 'T-CB-' . time(),
        'email' => 'cb@test.local', 'status' => 'active',
    ]);

    // Branches
    Branch::forceCreate(['id' => 801, 'client_id' => 901, 'name' => 'A-Main', 'is_main' => true,  'status' => 'active']);
    Branch::forceCreate(['id' => 802, 'client_id' => 901, 'name' => 'A-Sub2', 'is_main' => false, 'status' => 'active']);
    Branch::forceCreate(['id' => 803, 'client_id' => 901, 'name' => 'A-Sub3', 'is_main' => false, 'status' => 'active']);
    Branch::forceCreate(['id' => 811, 'client_id' => 902, 'name' => 'B-Main', 'is_main' => true,  'status' => 'active']);

    // Users (not persisted — Auth::setUser accepts any Authenticatable-like instance)
    $super   = new User(['name' => 'Super',   'email' => 's@test',    'user_type' => 'super_admin']);            $super->id   = 99001;
    $clientA = new User(['name' => 'ClientA', 'email' => 'ca@test',   'user_type' => 'client_admin', 'client_id' => 901]); $clientA->id = 99002;
    $clientB = new User(['name' => 'ClientB', 'email' => 'cb@test',   'user_type' => 'client_admin', 'client_id' => 902]); $clientB->id = 99003;
    $mainA   = new User(['name' => 'MainA',   'email' => 'ma@test',   'user_type' => 'branch_user',  'client_id' => 901, 'branch_id' => 801]); $mainA->id = 99004;
    $subA2   = new User(['name' => 'SubA2',   'email' => 's2a@test',  'user_type' => 'branch_user',  'client_id' => 901, 'branch_id' => 802]); $subA2->id = 99005;
    $subA3   = new User(['name' => 'SubA3',   'email' => 's3a@test',  'user_type' => 'branch_user',  'client_id' => 901, 'branch_id' => 803]); $subA3->id = 99006;
    $mainB   = new User(['name' => 'MainB',   'email' => 'mb@test',   'user_type' => 'branch_user',  'client_id' => 902, 'branch_id' => 811]); $mainB->id = 99007;

    return compact('super','clientA','clientB','mainA','subA2','subA3','mainB');
}

function call(string $method, string $uri, array $payload = []): array {
    global $kernel;
    $req = Request::create('/api' . $uri, $method, $payload);
    $req->headers->set('Accept', 'application/json');
    $resp = $kernel->handle($req);
    return [$resp->getStatusCode(), json_decode($resp->getContent(), true)];
}

function asUser($u, callable $fn) { Auth::setUser($u); $fn(); }

$pass = 0; $fail = 0; $errors = [];
function ok(bool $cond, string $msg) {
    global $pass, $fail, $errors;
    if ($cond) { echo "  ✓ {$msg}\n"; $pass++; }
    else       { echo "  ✗ {$msg}\n"; $fail++; $errors[] = $msg; }
}

$users = seed();
echo "Seeded 2 clients, 4 branches (1 main each for Client A, plus A's 2 subs, plus 1 main for B).\n\n";

/* -------- Part 1: each role creates a tagged row -------- */
echo "## Create rows as each role ##\n";
foreach ([
    'super'   => 'R_SUPER',
    'clientA' => 'R_CLIENTA',
    'clientB' => 'R_CLIENTB',
    'mainA'   => 'R_MAINA',
    'subA2'   => 'R_SUBA2',
    'subA3'   => 'R_SUBA3',
    'mainB'   => 'R_MAINB',
] as $uk => $label) {
    asUser($users[$uk], function () use ($label, $uk) {
        [$s, $row] = call('POST', '/master/countries', ['name' => $label, 'iso_code' => strtoupper(substr($label, 2, 2)), 'status' => 'Active']);
        ok($s === 201, "create {$label} as {$uk} -> 201 (got {$s})");
    });
}

// Sanity: fetch rows by name for later assertions
$byName = fn (string $n) => Countries::where('name', $n)->first();

// Verify the stamped client_id / branch_id per row
echo "\n## Correct client_id / branch_id stamped ##\n";
ok($byName('R_SUPER')->client_id === null && $byName('R_SUPER')->branch_id === null, "R_SUPER row has client_id=null branch_id=null");
ok($byName('R_CLIENTA')->client_id == 901 && $byName('R_CLIENTA')->branch_id === null, "R_CLIENTA row has client_id=901 branch_id=null");
ok($byName('R_CLIENTB')->client_id == 902 && $byName('R_CLIENTB')->branch_id === null, "R_CLIENTB row has client_id=902 branch_id=null");
ok($byName('R_MAINA')->client_id == 901 && $byName('R_MAINA')->branch_id == 801, "R_MAINA row has client_id=901 branch_id=801");
ok($byName('R_SUBA2')->client_id == 901 && $byName('R_SUBA2')->branch_id == 802, "R_SUBA2 row has client_id=901 branch_id=802");
ok($byName('R_SUBA3')->client_id == 901 && $byName('R_SUBA3')->branch_id == 803, "R_SUBA3 row has client_id=901 branch_id=803");
ok($byName('R_MAINB')->client_id == 902 && $byName('R_MAINB')->branch_id == 811, "R_MAINB row has client_id=902 branch_id=811");

/* -------- Part 2: visibility matrix per role -------- */

$visibilityMatrix = [
    // rows each role MUST see (others MUST be hidden)
    'super'   => ['R_SUPER','R_CLIENTA','R_CLIENTB','R_MAINA','R_SUBA2','R_SUBA3','R_MAINB'],
    'clientA' => ['R_SUPER','R_CLIENTA','R_MAINA','R_SUBA2','R_SUBA3'],
    'clientB' => ['R_SUPER','R_CLIENTB','R_MAINB'],
    'mainA'   => ['R_SUPER','R_CLIENTA','R_MAINA','R_SUBA2','R_SUBA3'],
    'subA2'   => ['R_SUPER','R_CLIENTA','R_MAINA','R_SUBA2'],         // own + client + main, not A3
    'subA3'   => ['R_SUPER','R_CLIENTA','R_MAINA','R_SUBA3'],         // own + client + main, not A2
    'mainB'   => ['R_SUPER','R_CLIENTB','R_MAINB'],
];

echo "\n## Visibility matrix (list endpoint) ##\n";
foreach ($visibilityMatrix as $role => $expected) {
    asUser($users[$role], function () use ($role, $expected) {
        [, $rows] = call('GET', '/master/countries');
        $seen = array_values(array_filter(array_column((array) $rows, 'name'), fn ($n) => str_starts_with((string) $n, 'R_')));
        sort($seen); sort($expected);
        $diffMissing = array_diff($expected, $seen);
        $diffExtra   = array_diff($seen, $expected);
        $msg = "role={$role}: sees=[" . implode(',', $seen) . "]";
        ok(empty($diffMissing) && empty($diffExtra), $msg
            . (empty($diffMissing) ? '' : ' missing=[' . implode(',', $diffMissing) . ']')
            . (empty($diffExtra)   ? '' : ' extra=['   . implode(',', $diffExtra)   . ']'));
    });
}

/* -------- Part 3: cross-tenant write protection -------- */
echo "\n## Cross-tenant write protection ##\n";
$rowA = $byName('R_CLIENTA');
$rowMainA = $byName('R_MAINA');
$rowSubA2 = $byName('R_SUBA2');
$rowSubA3 = $byName('R_SUBA3');
$rowB = $byName('R_CLIENTB');

// Client B cannot touch Client A's rows
asUser($users['clientB'], function () use ($rowA) {
    [$s] = call('PUT',    "/master/countries/{$rowA->id}", ['name' => 'HACK', 'iso_code' => 'HK', 'status' => 'Active']);
    ok($s === 404, "clientB cannot update clientA row (404)");
    [$s] = call('DELETE', "/master/countries/{$rowA->id}");
    ok($s === 404, "clientB cannot delete clientA row (404)");
});

// SubA3 (branch-only) cannot touch SubA2's row (even though same client)
asUser($users['subA3'], function () use ($rowSubA2) {
    [$s] = call('PUT',    "/master/countries/{$rowSubA2->id}", ['name' => 'HACK', 'iso_code' => 'HK', 'status' => 'Active']);
    ok($s === 404, "subA3 cannot update subA2 row (404) — branch isolation within client");
    [$s] = call('DELETE', "/master/countries/{$rowSubA2->id}");
    ok($s === 404, "subA3 cannot delete subA2 row (404) — branch isolation within client");
});

// But subA3 CAN see subA2's row? No — per matrix, subA3 should NOT see subA2's row. Already covered above.

// Main branch CAN update/delete any row under its client (main-branch privilege)
asUser($users['mainA'], function () use ($rowSubA2) {
    [$s] = call('PUT', "/master/countries/{$rowSubA2->id}", ['name' => 'R_SUBA2', 'iso_code' => 'S2', 'status' => 'Active']);
    ok($s === 200, "mainA CAN update sub-branch row under same client (200) — main-branch privilege");
});

// Client admin CAN update any row under its client
asUser($users['clientA'], function () use ($rowMainA) {
    [$s] = call('PUT', "/master/countries/{$rowMainA->id}", ['name' => 'R_MAINA', 'iso_code' => 'MA', 'status' => 'Active']);
    ok($s === 200, "clientA CAN update main-branch row under same client (200)");
});

// Sub branch cannot reach global (super_admin) rows' mutations either — they only appear in list; writes by non-owners fail silently via findOrFail scoping
// Verify: super_admin's row has client_id=null, so applyScope still includes it in reads. But a non-super user trying to UPDATE it — let's see:
$rowSuper = $byName('R_SUPER');
asUser($users['clientA'], function () use ($rowSuper) {
    [$s] = call('PUT', "/master/countries/{$rowSuper->id}", ['name' => 'R_SUPER', 'iso_code' => 'SU', 'status' => 'Active']);
    ok($s === 200, "clientA CAN update a super-admin global row (200) — global rows are in scope for everyone");
});

/* -------- Part 4: cleanup -------- */
Countries::query()->whereIn('name', ['R_SUPER','R_CLIENTA','R_CLIENTB','R_MAINA','R_SUBA2','R_SUBA3','R_MAINB'])->delete();
Branch::query()->whereIn('id', [801, 802, 803, 811])->forceDelete();
Client::query()->whereIn('id', [901, 902])->forceDelete();

echo "\n----\nPass: {$pass}  Fail: {$fail}\n";
if ($fail > 0) {
    echo "\nFailures:\n";
    foreach ($errors as $e) echo "  - {$e}\n";
    exit(1);
}
exit(0);
