<?php
/**
 * HTTP-level smoke test: for every master slug, exercise
 *   GET    /api/master/{slug}
 *   POST   /api/master/{slug}
 *   GET    /api/master/{slug}/{id}
 *   PUT    /api/master/{slug}/{id}
 *   DELETE /api/master/{slug}/{id}
 * through Laravel's kernel (no external HTTP server needed).
 *
 * Run: php scripts/smoke-http.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();
$kernel = $app->make(\Illuminate\Contracts\Http\Kernel::class);

// Authenticate as any user so auth:sanctum passes.
$user = \App\Models\User::query()->first();
if (!$user) {
    fwrite(STDERR, "No users exist — create one first so auth works.\n");
    exit(1);
}
\Illuminate\Support\Facades\Auth::login($user);

$ref = new ReflectionClass(\App\Http\Controllers\Api\MasterController::class);
$MODELS  = $ref->getConstant('MODELS');
$SCHEMAS = $ref->getConstant('SCHEMAS');

function sample(array $f, int $seed): mixed {
    if ($f['t'] === 'select' && empty($f['ref'] ?? null)) {
        $opts = $f['opts'] ?? null;
        if (!empty($opts)) return $opts[0];
        return 'Active';
    }
    switch ($f['t']) {
        case 'number': return $seed + 0.25;
        case 'date':   return '2026-04-22';
        case 'email':  return "http{$seed}@test.local";
        default:       return 'HTTP_' . strtoupper($f['n']) . '_' . $seed;
    }
}

function call(string $method, string $uri, array $payload = []): array {
    $req = \Illuminate\Http\Request::create('/api' . $uri, $method, $payload);
    $req->headers->set('Accept', 'application/json');
    global $kernel;
    $resp = $kernel->handle($req);
    $body = json_decode($resp->getContent(), true);
    return [$resp->getStatusCode(), $body];
}

$pass = 0; $fail = 0; $errors = [];
$i = 0;

foreach ($MODELS as $slug => $modelClass) {
    $i++;
    $schema = $SCHEMAS[$slug] ?? ['fields' => []];
    $payload = [];
    foreach ($schema['fields'] as $f) $payload[$f['n']] = sample($f, $i);

    $pad = str_pad($slug, 28);

    try {
        // LIST
        [$s, $b] = call('GET', "/master/{$slug}");
        if ($s !== 200) throw new RuntimeException("list status={$s} body=" . json_encode($b));

        // CREATE
        [$s, $row] = call('POST', "/master/{$slug}", $payload);
        if ($s !== 201 || empty($row['id'])) throw new RuntimeException("create status={$s} body=" . json_encode($row));
        $id = $row['id'];

        // SHOW
        [$s, $b] = call('GET', "/master/{$slug}/{$id}");
        if ($s !== 200 || ($b['id'] ?? null) !== $id) throw new RuntimeException("show status={$s} body=" . json_encode($b));

        // UPDATE
        if (count($schema['fields'])) {
            $first = $schema['fields'][0]['n'];
            $new = sample($schema['fields'][0], $i + 9000);
            $updatePayload = array_merge($payload, [$first => $new]);
            [$s, $b] = call('PUT', "/master/{$slug}/{$id}", $updatePayload);
            if ($s !== 200) throw new RuntimeException("update status={$s} body=" . json_encode($b));
            if ((string) $b[$first] !== (string) $new && (float) $b[$first] !== (float) $new) {
                throw new RuntimeException("update did not apply {$first}");
            }
        }

        // DESTROY
        [$s, $b] = call('DELETE', "/master/{$slug}/{$id}");
        if ($s !== 200) throw new RuntimeException("destroy status={$s} body=" . json_encode($b));

        echo "  ✓  [{$i}] {$pad} OK\n";
        $pass++;
    } catch (\Throwable $e) {
        $fail++;
        $errors[] = "[{$slug}] " . $e->getMessage();
        echo "  ✗  [{$i}] {$pad} FAIL — " . $e->getMessage() . "\n";
    }
}

echo "\n----\nPass: {$pass} / " . count($MODELS) . "  Fail: {$fail}\n";
if ($fail > 0) { foreach ($errors as $e) echo " - {$e}\n"; exit(1); }
exit(0);
