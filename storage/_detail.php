<?php
$r = json_decode(file_get_contents(__DIR__ . '/_routes.json'), true);
$byCtrl = [];
foreach ($r as $x) {
    $a = $x['action'];
    if (strpos($a, '@') === false) { $ctrl = 'ZZ_closure'; $m = '-'; }
    else {
        [$cls, $m] = explode('@', $a);
        $parts = explode('\\', $cls);
        $ctrl = end($parts);
    }
    $method = explode('|', $x['method'])[0]; // drop HEAD/PATCH alias
    $mw = is_array($x['middleware'] ?? null) ? implode(',', $x['middleware']) : ($x['middleware'] ?? '');
    $byCtrl[$ctrl][] = sprintf('%-6s /%s  @%s', $method, $x['uri'], $m);
}
ksort($byCtrl);
$out = '';
foreach ($byCtrl as $c => $rows) {
    $out .= "## $c (" . count($rows) . ")\n";
    foreach ($rows as $row) $out .= $row . "\n";
    $out .= "\n";
}
file_put_contents(__DIR__ . '/_endpoints.txt', $out);
echo "written " . strlen($out) . " bytes\n";
