<?php
/**
 * Extract validation field keys (+ a rule hint) from every Api controller's
 * inline `$request->validate([...])` / `Validator::make(..., [...])` calls.
 * Output: { "App\\Http\\Controllers\\Api\\FooController@method": { "field": "ruleText" } }
 * so the Postman generator can turn each into an example JSON body.
 */

$root  = $argv[1] ?? 'app/Http/Controllers/Api';
$out   = [];   // "FQN@method" => [field => ruleText]
$calls = [];   // "FQN@method" => ["validateHelper", ...]  (same-class validate* calls)

$rii = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS));
foreach ($rii as $f) {
    if ($f->getExtension() !== 'php') continue;
    $code   = file_get_contents($f->getPathname());
    $tokens = token_get_all($code);
    $n      = count($tokens);

    // ── namespace + class → FQN
    $ns = ''; $class = '';
    for ($i = 0; $i < $n; $i++) {
        $t = $tokens[$i];
        if (is_array($t) && $t[0] === T_NAMESPACE) {
            $j = $i + 1; $parts = '';
            while (isset($tokens[$j]) && $tokens[$j] !== ';') { if (is_array($tokens[$j])) $parts .= $tokens[$j][1]; $j++; }
            $ns = trim($parts);
        }
        if (is_array($t) && $t[0] === T_CLASS) {
            $j = $i + 1;
            while (isset($tokens[$j]) && !(is_array($tokens[$j]) && $tokens[$j][0] === T_STRING)) $j++;
            $class = $tokens[$j][1] ?? '';
            break;
        }
    }
    if (!$class) continue;
    $fqn = ($ns ? $ns . '\\' : '') . $class;

    // ── walk methods + validate() arrays
    $curMethod = null;
    for ($i = 0; $i < $n; $i++) {
        $t = $tokens[$i];
        if (is_array($t) && $t[0] === T_FUNCTION) {
            $j = $i + 1;
            while (isset($tokens[$j]) && !(is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) && $tokens[$j] !== '(') $j++;
            $curMethod = (isset($tokens[$j]) && is_array($tokens[$j]) && $tokens[$j][0] === T_STRING) ? $tokens[$j][1] : null;
            continue;
        }
        // record calls to same-class validate* HELPERS (e.g. $this->validatePayload($request, ...))
        if (is_array($t) && $t[0] === T_STRING && preg_match('/^validate.+/', $t[1]) && $curMethod) {
            $p = $i - 1;
            while ($p >= 0 && is_array($tokens[$p]) && $tokens[$p][0] === T_WHITESPACE) $p--;
            $q = $i + 1;
            while (isset($tokens[$q]) && is_array($tokens[$q]) && $tokens[$q][0] === T_WHITESPACE) $q++;
            if (is_array($tokens[$p]) && $tokens[$p][0] === T_OBJECT_OPERATOR && isset($tokens[$q]) && $tokens[$q] === '(') {
                $calls[$fqn . '@' . $curMethod][] = $t[1];
            }
        }
        if (is_array($t) && $t[0] === T_STRING && ($t[1] === 'validate' || $t[1] === 'make') && $curMethod) {
            // must be a ->validate / ::make call
            $p = $i - 1;
            while ($p >= 0 && is_array($tokens[$p]) && $tokens[$p][0] === T_WHITESPACE) $p--;
            if (!(is_array($tokens[$p]) && in_array($tokens[$p][0], [T_OBJECT_OPERATOR, T_DOUBLE_COLON], true))) continue;

            // find first '[' after the opening '('
            $k = $i + 1;
            while (isset($tokens[$k]) && $tokens[$k] !== '(') $k++;
            $k++;
            while (isset($tokens[$k]) && $tokens[$k] !== '[') {
                // stop if we run off the call (a ')' at paren depth 0)
                if ($tokens[$k] === ')') break;
                $k++;
            }
            if (!isset($tokens[$k]) || $tokens[$k] !== '[') continue;

            // capture the balanced [...] and parse depth-1 pairs
            $fields = parse_rules_array($tokens, $k);
            if ($fields) {
                $key = $fqn . '@' . $curMethod;
                $out[$key] = array_merge($out[$key] ?? [], $fields);
            }
        }
    }
}

foreach ($calls as $k => $v) $calls[$k] = array_values(array_unique($v));
echo json_encode(['fields' => $out, 'calls' => $calls], JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);

/** Parse `[ 'key' => rules, ... ]` starting at the '[' index; return [key => ruleText]. */
function parse_rules_array(array $toks, int $start): array {
    $fields  = [];
    $depth   = 0;
    $curKey  = null;
    $ruleTxt = '';
    for ($i = $start, $n = count($toks); $i < $n; $i++) {
        $t   = $toks[$i];
        $val = is_array($t) ? $t[1] : $t;

        if ($val === '[') { $depth++; continue; }
        if ($val === ']') {
            $depth--;
            if ($depth === 0) { if ($curKey !== null) $fields[$curKey] = trim($ruleTxt); break; }
            continue;
        }

        if ($depth === 1) {
            // new top-level key?  'string' =>
            if (is_array($t) && $t[0] === T_CONSTANT_ENCAPSED_STRING) {
                $j = $i + 1;
                while (isset($toks[$j]) && is_array($toks[$j]) && $toks[$j][0] === T_WHITESPACE) $j++;
                if (isset($toks[$j]) && is_array($toks[$j]) && $toks[$j][0] === T_DOUBLE_ARROW) {
                    if ($curKey !== null) $fields[$curKey] = trim($ruleTxt);
                    $curKey  = trim($t[1], "'\"");
                    $ruleTxt = '';
                    $i = $j;                       // skip past '=>'
                    continue;
                }
            }
            if ($val === ',') {                   // end of this pair
                if ($curKey !== null) { $fields[$curKey] = trim($ruleTxt); $curKey = null; $ruleTxt = ''; }
                continue;
            }
            if (is_array($t) && $t[0] === T_CONSTANT_ENCAPSED_STRING) $ruleTxt .= ' ' . trim($t[1], "'\"") . ' ';
        } elseif ($depth >= 2) {
            // rules given as an array — collect the string rules for the hint
            if (is_array($t) && $t[0] === T_CONSTANT_ENCAPSED_STRING) $ruleTxt .= ' ' . trim($t[1], "'\"") . ' ';
        }
    }
    return $fields;
}
