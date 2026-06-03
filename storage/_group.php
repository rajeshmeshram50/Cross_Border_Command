<?php
$r = json_decode(file_get_contents(__DIR__ . '/_routes.json'), true);
$byCtrl = [];
foreach ($r as $x) {
    $a = $x['action'];
    if (strpos($a, '@') === false) { $ctrl = '(closure)'; $m = '-'; }
    else {
        [$cls, $m] = explode('@', $a);
        $parts = explode('\\', $cls);
        $ctrl = end($parts);
    }
    $byCtrl[$ctrl][] = $x['method'] . '  /' . $x['uri'] . '  @' . $m;
}
ksort($byCtrl);
$total = 0;
foreach ($byCtrl as $c => $rows) {
    echo $c . ' = ' . count($rows) . "\n";
    $total += count($rows);
}
echo "\nCONTROLLERS=" . count($byCtrl) . " ENDPOINTS=" . $total . "\n";
