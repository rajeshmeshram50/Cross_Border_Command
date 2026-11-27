<?php

$rawBranch = env('LEAD_SYNC_BRANCH_ID');
if ($rawBranch === null || $rawBranch === '') {
    $branch = null;
} elseif (strtolower((string) $rawBranch) === 'all') {
    $branch = 'all';
} elseif (str_contains((string) $rawBranch, ',')) {
    $branch = array_values(array_filter(
        array_map(fn ($s) => (int) trim($s), explode(',', (string) $rawBranch)),
        fn ($n) => $n > 0
    ));
} else {
    $branch = (int) $rawBranch;
}

return [
    'branch' => $branch,

    'indiamart' => [
        'keys' => array_values(array_filter([
            ['label' => 'Agrotech', 'crm_key' => env('INDIAMART_AGROTECH_KEY')],
            ['label' => 'Purvee',   'crm_key' => env('INDIAMART_PURVEE_KEY')],
            ['label' => 'Vortex',   'crm_key' => env('INDIAMART_VORTEX_KEY')],
                ['label' => 'Healthcare', 'crm_key' => env('INDIAMART_HEALTHCARE_KEY')],
        ], fn ($row) => !empty($row['crm_key']))),
    ],
];
