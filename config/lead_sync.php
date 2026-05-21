<?php

/**
 * Sales Matrix → Lead Sync configuration.
 *
 * Driven entirely by .env. Four states for the branch gate:
 *
 *   branch  = null              sync disabled (LEAD_SYNC_BRANCH_ID blank)
 *   branch  = 'all'             every authenticated user can sync
 *   branch  = <int>             only that one branch can sync
 *   branch  = [<int>, <int>...] any of these branches can sync
 *                               (LEAD_SYNC_BRANCH_ID=1,2,3 in .env)
 *
 * `indiamart.keys` is the live list of IndiaMart accounts to pull from. The
 * key's label becomes the `platform` value on every lead it creates, so the
 * My Workplace "Lead Source" column tells the accounts apart.
 */

$rawBranch = env('LEAD_SYNC_BRANCH_ID');
if ($rawBranch === null || $rawBranch === '') {
    $branch = null;                        // sync disabled
} elseif (strtolower((string) $rawBranch) === 'all') {
    $branch = 'all';                       // every branch allowed
} elseif (str_contains((string) $rawBranch, ',')) {
    // Comma-separated list — e.g. "1,2,3" → [1,2,3]. Empty / non-numeric
    // tokens are dropped so a trailing comma doesn't poison the array.
    $branch = array_values(array_filter(
        array_map(fn ($s) => (int) trim($s), explode(',', (string) $rawBranch)),
        fn ($n) => $n > 0
    ));
} else {
    $branch = (int) $rawBranch;            // single specific branch id
}

return [

    'branch' => $branch,

    'indiamart' => [
        /*
        | Empty keys are filtered out so a tenant with only one configured
        | account doesn't get nuisance "key missing" warnings every sync.
        | The label here is fixed-by-env-var-name on purpose — keeps the
        | config one knob shorter (no separate _LABEL line).
        */
        'keys' => array_values(array_filter([
            ['label' => 'Agrotech', 'crm_key' => env('INDIAMART_AGROTECH_KEY')],
            ['label' => 'Purvee',   'crm_key' => env('INDIAMART_PURVEE_KEY')],
            ['label' => 'Vortex',   'crm_key' => env('INDIAMART_VORTEX_KEY')],
        ], fn ($row) => !empty($row['crm_key']))),
    ],

];
