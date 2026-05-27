<?php
$roots = [
    __DIR__ . '/..', // Cross_Border_Command
    realpath(__DIR__ . '/../../New_IDIMS_6.0'),
];
$results = [];
foreach ($roots as $root) {
    if (!$root || !is_dir($root)) continue;
    $results[$root] = [
        'controllers' => 0,
        'models' => 0,
        'migrations' => 0,
        'route_declarations' => 0,
        'schema_create_calls' => 0,
    ];

    $rii = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root));
    foreach ($rii as $file) {
        if (!$file->isFile()) continue;
        $path = $file->getPathname();
        $lower = strtolower($path);
        if (strpos($lower, DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'http' . DIRECTORY_SEPARATOR . 'controllers') !== false && substr($path, -4) === '.php') {
            $results[$root]['controllers']++;
        }
        if (strpos($lower, DIRECTORY_SEPARATOR . 'app' . DIRECTORY_SEPARATOR . 'models') !== false && substr($path, -4) === '.php') {
            $results[$root]['models']++;
        }
        if (strpos($lower, DIRECTORY_SEPARATOR . 'database' . DIRECTORY_SEPARATOR . 'migrations') !== false && substr($path, -4) === '.php') {
            $results[$root]['migrations']++;
            $contents = file_get_contents($path);
            if ($contents !== false) {
                $results[$root]['schema_create_calls'] += preg_match_all('/Schema::create\s*\(/i', $contents, $m);
            }
        }
        if (strpos($lower, DIRECTORY_SEPARATOR . 'routes' . DIRECTORY_SEPARATOR) !== false && substr($path, -4) === '.php') {
            $contents = file_get_contents($path);
            if ($contents !== false) {
                $results[$root]['route_declarations'] += preg_match_all('/Route::(get|post|put|patch|delete|apiResource|resource|match|any)\s*\(/i', $contents, $m);
            }
        }
    }
}

echo json_encode($results, JSON_PRETTY_PRINT), PHP_EOL;
