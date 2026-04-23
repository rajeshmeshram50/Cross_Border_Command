<?php
/**
 * End-to-end smoke test for all 50 master APIs.
 * Boots Laravel, and for every registered master slug:
 *   1. counts existing rows
 *   2. creates a row with minimal valid payload derived from schema
 *   3. re-reads it (show)
 *   4. updates it
 *   5. deletes it
 * Failures are printed inline.
 *
 * Run:  php scripts/smoke-masters.php
 */

require __DIR__ . '/../vendor/autoload.php';

$app = require_once __DIR__ . '/../bootstrap/app.php';
$app->make(\Illuminate\Contracts\Console\Kernel::class)->bootstrap();

// Pull MODELS + SCHEMAS maps via reflection.
$ref = new ReflectionClass(\App\Http\Controllers\Api\MasterController::class);
$MODELS  = $ref->getConstant('MODELS');
$SCHEMAS = $ref->getConstant('SCHEMAS');

$pass = 0;
$fail = 0;
$errors = [];

function sampleFor(array $f, int $seed): mixed {
    $n = $f['n'];
    $t = $f['t'];
    // Enum-constrained select fields must use a listed opt (DB has a CHECK constraint).
    if ($t === 'select' && empty($f['ref'] ?? null)) {
        $opts = $f['opts'] ?? null;
        if (!empty($opts)) return $opts[0]; // pick the first valid option
        // ref-less select with no opts shouldn't exist, but be safe:
        return 'Active';
    }
    switch ($t) {
        case 'number': return $seed + 0.5;
        case 'date':   return '2026-04-22';
        case 'email':  return "smoke{$seed}+{$n}@test.local";
        default:       return 'SMOKE_' . strtoupper($n) . '_' . $seed;
    }
}

echo "Running CRUD smoke on " . count($MODELS) . " masters...\n\n";

$i = 0;
foreach ($MODELS as $slug => $modelClass) {
    $i++;
    $schema  = $SCHEMAS[$slug] ?? ['fields' => [], 'uFields' => []];
    $fields  = $schema['fields'];
    $padSlug = str_pad($slug, 28);

    try {
        // Payload: all fields populated (safer than "only required").
        $payload = [];
        foreach ($fields as $f) {
            $payload[$f['n']] = sampleFor($f, $i);
        }
        $payload['created_by'] = null;

        // COUNT
        $before = $modelClass::count();

        // CREATE
        $row = $modelClass::create($payload);
        $id = $row->id;

        // SHOW
        $fetched = $modelClass::find($id);
        if (!$fetched) throw new RuntimeException("show() returned null for id={$id}");

        // UPDATE — flip one field
        if (count($fields)) {
            $first = $fields[0]['n'];
            $newVal = sampleFor($fields[0], $i + 1000);
            $fetched->update([$first => $newVal]);
            $reread = $modelClass::find($id);
            $got = $reread->{$first};
            $match = is_numeric($got) && is_numeric($newVal)
                ? ((float) $got === (float) $newVal)
                : ((string) $got === (string) $newVal);
            if (!$match) {
                throw new RuntimeException("update() did not persist {$first}: got=" . var_export($got, true) . " expected=" . var_export($newVal, true));
            }
        }

        // DELETE
        $reread->delete();
        if ($modelClass::find($id)) throw new RuntimeException("destroy() left row behind");

        // COUNT SAME AS BEFORE
        $after = $modelClass::count();
        if ($after !== $before) {
            throw new RuntimeException("count drift before={$before} after={$after}");
        }

        echo "  ✓  [{$i}] {$padSlug} OK\n";
        $pass++;
    } catch (\Throwable $e) {
        $fail++;
        $errors[] = "[{$slug}] " . $e->getMessage();
        echo "  ✗  [{$i}] {$padSlug} FAIL — " . $e->getMessage() . "\n";
    }
}

echo "\n----\n";
echo "Pass: {$pass} / " . count($MODELS) . "\n";
echo "Fail: {$fail}\n";

if ($fail > 0) {
    echo "\nErrors:\n";
    foreach ($errors as $err) echo "  - {$err}\n";
    exit(1);
}
exit(0);
