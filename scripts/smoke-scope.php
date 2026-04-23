<?php
/**
 * Scope test — verifies that client_id / branch_id are correctly
 *   (a) stamped on create from the authenticated user
 *   (b) used to filter list/show/update/delete results
 *
 * Uses the 'countries' master because it has the simplest schema
 * (name + iso_code + status).
 *
 * Run: php scripts/smoke-scope.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);

use App\Models\User;
use App\Models\Masters\Countries;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Auth;

function call(string $method, string $uri, array $payload = []): array {
    $req = Request::create('/api' . $uri, $method, $payload);
    $req->headers->set('Accept', 'application/json');
    global $kernel;
    $resp = $kernel->handle($req);
    return [$resp->getStatusCode(), json_decode($resp->getContent(), true)];
}

// Clean slate for countries — isolated test table.
Countries::query()->delete();

// Fabricate three users in-memory. We don't persist — Auth::login accepts any
// Authenticatable, and the controller only reads ->id / ->user_type / ->client_id /
// ->branch_id / ->branch->is_main.
$super    = new User(['name' => 'S', 'email' => 's@t', 'user_type' => 'super_admin']);   $super->id = 9001;
$clientA  = new User(['name' => 'CA', 'email' => 'ca@t', 'user_type' => 'client_admin', 'client_id' => 101]); $clientA->id = 9002;
$clientB  = new User(['name' => 'CB', 'email' => 'cb@t', 'user_type' => 'client_admin', 'client_id' => 102]); $clientB->id = 9003;
$branchA1 = new User(['name' => 'BA1','email' => 'ba1@t','user_type' => 'branch_user', 'client_id' => 101, 'branch_id' => 201]); $branchA1->id = 9004;
$branchA2 = new User(['name' => 'BA2','email' => 'ba2@t','user_type' => 'branch_user', 'client_id' => 101, 'branch_id' => 202]); $branchA2->id = 9005;

$pass = 0; $fail = 0; $errors = [];

function assertTrue(bool $cond, string $msg) {
    global $pass, $fail, $errors;
    if ($cond) { echo "  ✓ {$msg}\n"; $pass++; }
    else       { echo "  ✗ {$msg}\n"; $fail++; $errors[] = $msg; }
}

function asUser($u, callable $fn) {
    // Replace current user — works across successive calls without needing logout.
    Auth::setUser($u);
    $fn();
}

echo "Scope test — /api/master/countries\n\n";

// (1) super_admin creates with explicit client_id/branch_id — it should be honored.
asUser($super, function () {
    [$s, $row] = call('POST', '/master/countries', [
        'name' => 'SuperLand', 'iso_code' => 'SL', 'status' => 'Active',
        'client_id' => 101, 'branch_id' => 201,
    ]);
    global $superRowId;
    $superRowId = $row['id'] ?? null;
    assertTrue($s === 201, "super_admin create status=201 (got {$s})");
    assertTrue(($row['client_id'] ?? null) == 101, "super_admin row.client_id stamped from request");
    assertTrue(($row['branch_id'] ?? null) == 201, "super_admin row.branch_id stamped from request");
});

// (2) client_admin creates — client_id stamped from user; branch_id null.
asUser($clientA, function () {
    [$s, $row] = call('POST', '/master/countries', [
        'name' => 'ClientALand', 'iso_code' => 'CA', 'status' => 'Active',
        'client_id' => 999, 'branch_id' => 999,  // attempt to spoof
    ]);
    assertTrue($s === 201, "client_admin create status=201 (got {$s})");
    assertTrue(($row['client_id'] ?? null) == 101, "client_admin row.client_id = 101 (user's client, ignore spoof)");
    assertTrue($row['branch_id'] === null, "client_admin row.branch_id = null");
});

// (3) branch_user creates — both stamped from user.
asUser($branchA1, function () {
    [$s, $row] = call('POST', '/master/countries', [
        'name' => 'Branch201Land', 'iso_code' => 'B1', 'status' => 'Active',
    ]);
    assertTrue($s === 201, "branch_user create status=201 (got {$s})");
    assertTrue(($row['client_id'] ?? null) == 101, "branch_user row.client_id = user's client 101");
    assertTrue(($row['branch_id'] ?? null) == 201, "branch_user row.branch_id = user's branch 201");
});

asUser($branchA2, function () {
    [$s, $row] = call('POST', '/master/countries', [
        'name' => 'Branch202Land', 'iso_code' => 'B2', 'status' => 'Active',
    ]);
    assertTrue(($row['branch_id'] ?? null) == 202, "branch_user from branch 202 stamps branch_id=202");
});

asUser($clientB, function () {
    [$s, $row] = call('POST', '/master/countries', [
        'name' => 'ClientBLand', 'iso_code' => 'CB', 'status' => 'Active',
    ]);
    assertTrue(($row['client_id'] ?? null) == 102, "client_admin clientB row.client_id=102");
});

// Expected state in DB:
//   SuperLand       client=101 branch=201
//   ClientALand     client=101 branch=null
//   Branch201Land   client=101 branch=201
//   Branch202Land   client=101 branch=202
//   ClientBLand     client=102 branch=null

// (4) client_admin of A sees rows for client 101 only.
asUser($clientA, function () {
    [, $rows] = call('GET', '/master/countries');
    $names = array_column($rows, 'name');
    sort($names);
    $expected = ['Branch201Land', 'Branch202Land', 'ClientALand', 'SuperLand'];
    sort($expected);
    assertTrue($names === $expected, "clientA sees rows for client 101 only: [" . implode(',', $names) . "]");
});

// (5) client_admin of B sees only ClientBLand.
asUser($clientB, function () {
    [, $rows] = call('GET', '/master/countries');
    $names = array_column($rows, 'name');
    assertTrue(count($rows) === 1 && ($rows[0]['name'] ?? null) === 'ClientBLand',
        "clientB sees 1 row (ClientBLand): [" . implode(',', $names) . "]");
});

// (6) branch_user A1 (not main) sees only branch 201 rows.
asUser($branchA1, function () {
    [, $rows] = call('GET', '/master/countries');
    $names = array_column($rows, 'name');
    sort($names);
    $expected = ['Branch201Land', 'SuperLand']; // both client=101 branch=201
    sort($expected);
    assertTrue($names === $expected, "branchA1 sees only branch 201 rows: [" . implode(',', $names) . "]");
});

// (7) super_admin sees everything.
asUser($super, function () {
    [, $rows] = call('GET', '/master/countries');
    assertTrue(count($rows) === 5, "super_admin sees all 5 rows (got " . count($rows) . ")");
});

// (8) client B cannot update client A's row.
$aRow = Countries::where('name', 'ClientALand')->first();
asUser($clientB, function () use ($aRow) {
    [$s, ] = call('PUT', "/master/countries/{$aRow->id}", ['name' => 'Hacked', 'iso_code' => 'HK', 'status' => 'Active']);
    assertTrue($s === 404, "clientB cannot update clientA row (got {$s})");
});

// (9) client B cannot delete client A's row.
asUser($clientB, function () use ($aRow) {
    [$s, ] = call('DELETE', "/master/countries/{$aRow->id}");
    assertTrue($s === 404, "clientB cannot delete clientA row (got {$s})");
});

// Cleanup
Countries::query()->delete();

echo "\n----\n";
echo "Pass: {$pass}  Fail: {$fail}\n";
if ($fail > 0) {
    foreach ($errors as $e) echo "  - {$e}\n";
    exit(1);
}
exit(0);
