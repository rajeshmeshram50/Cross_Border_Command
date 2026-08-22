<?php

namespace App\Support;

use App\Models\Candidate;
use App\Models\Employee;
use App\Models\Recruitment;

/**
 * What the Dev Tools → Load Testing screen can profile.
 *
 * A module has pages; a page has the API calls it fires on open and the React
 * component that renders it. The screen replays those calls with X-Profile: 1
 * and shows what came back — an in-app Network tab scoped to one screen, so you
 * can answer "why is Employee → List slow" without opening browser dev tools and
 * guessing which of the forty requests on the page belong to it.
 *
 * The list is hand-maintained on purpose. Deriving it from the React source
 * would mean parsing every useEffect, and would still miss calls made from
 * shared components — a wrong list that looks authoritative is worse than a
 * short one that is correct.
 */
class DevToolsProfileTargets
{
    /**
     * @return array<int, array{key:string,label:string,pages:array}>
     */
    public static function all(int $clientId, ?int $branchId): array
    {
        // Real ids so detail / edit actions profile a real payload, not a 404.
        $empId = Employee::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))->value('id');
        $recId = Recruitment::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))->value('id');
        $candId = Candidate::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))->value('id');

        /* A write action really runs — really inserts, really updates — and is then
           rolled back by the profiler. That is the only way its query cost is
           honest; a dry run would measure validation and nothing else. Every write
           below therefore carries a payload the controller will actually accept,
           because a 422 would profile the failure path instead of the real one. */
        $w = fn (string $method, string $url, string $label, array $body = []) => [
            'method' => $method, 'url' => $url, 'label' => $label,
            'body' => $body, 'write' => true,
        ];
        $r = fn (string $url, string $label) => [
            'method' => 'GET', 'url' => $url, 'label' => $label, 'write' => false,
        ];

        $masters = [
            $r('/master/departments',  'Departments master'),
            $r('/master/designations', 'Designations master'),
            $r('/master/roles',        'Roles master'),
        ];

        return [
            [
                'key' => 'employee', 'label' => 'Employee', 'group' => 'HR Core',
                'pages' => [
                    [
                        'key' => 'list', 'label' => 'List view',
                        'component' => 'resources/js/pages/hrms/HrEmployees.tsx',
                        'actions' => [
                            /* These have to be the parameters HrEmployees.tsx really
                               sends. `list_view=1` was not one of them — the controller
                               reads ?view=, so the profiler was measuring the full
                               untrimmed payload (417 rows, 1.6 MB, 68 queries) and
                               calling it the list view, which no user has ever loaded. */
                            ['key' => 'load', 'label' => 'Open page', 'kind' => 'read', 'requests' => array_merge(
                                [
                                    $r('/employees?view=list&page=1&per_page=10', 'Employee list'),
                                    $r('/employees/stats', 'KPI cards + tab badges'),
                                ], $masters,
                            )],
                            ['key' => 'search', 'label' => 'Search / filter', 'kind' => 'read', 'requests' => [
                                $r('/employees?view=list&page=1&per_page=10&search=a', 'Search "a"'),
                                $r('/employees/stats?search=a', 'Counts for that search'),
                                // The Active/Disabled tab is ?enabled=, not ?status=.
                                $r('/employees?view=list&page=1&per_page=10&enabled=1', 'Tab: active'),
                            ]],
                            ['key' => 'detail', 'label' => 'Open a row', 'kind' => 'read', 'requests' => array_values(array_filter([
                                $empId ? $r("/employees/{$empId}", 'Employee detail') : null,
                                $empId ? $r("/employees/{$empId}/documents", 'Documents') : null,
                            ]))],
                        ],
                    ],
                    [
                        'key' => 'add', 'label' => 'Add employee', 'component' => 'resources/js/pages/hrms/HrEmployees.tsx',
                        'actions' => [
                            ['key' => 'open', 'label' => 'Open the form', 'kind' => 'read', 'requests' => array_merge($masters, [
                                $r('/master/countries', 'Countries master'),
                                $r('/employees/next-code', 'Next employee code'),
                            ])],
                        ],
                    ],
                    [
                        'key' => 'edit', 'label' => 'Edit employee', 'component' => 'resources/js/pages/hrms/HrEmployees.tsx',
                        'actions' => array_values(array_filter([
                            $empId ? ['key' => 'open', 'label' => 'Open the form', 'kind' => 'read', 'requests' => array_merge(
                                [$r("/employees/{$empId}", 'Employee detail')], $masters,
                            )] : null,
                        ])),
                    ],
                    [
                        'key' => 'profile', 'label' => 'Employee profile',
                        'component' => 'resources/js/pages/employee/EmployeeProfile.tsx',
                        'actions' => array_values(array_filter([
                            $empId ? ['key' => 'load', 'label' => 'Open page', 'kind' => 'read', 'requests' => [
                                $r("/employees/{$empId}", 'Employee detail'),
                                $r("/employees/{$empId}/documents", 'Documents'),
                            ]] : null,
                            ['key' => 'expense', 'label' => 'Expense tab', 'kind' => 'read', 'requests' => [
                                $r('/expense-claims?scope=mine', 'My expense claims'),
                                $r('/advance-requests?scope=mine', 'My advances'),
                            ]],
                        ])),
                    ],
                ],
            ],
            [
                'key' => 'recruitment', 'label' => 'Recruitment', 'group' => 'HR Core',
                'pages' => [
                    [
                        'key' => 'list', 'label' => 'List view',
                        'component' => 'resources/js/pages/recruitment/HrRecruitment.tsx',
                        'actions' => [
                            ['key' => 'load', 'label' => 'Open page', 'kind' => 'read', 'requests' => [
                                $r('/recruitments', 'Recruitment list'),
                                $r('/hiring-requests', 'Hiring requests'),
                            ]],
                            ['key' => 'search', 'label' => 'Filter by status', 'kind' => 'read', 'requests' => [
                                $r('/recruitments?status=In Progress', 'Filter: In Progress'),
                            ]],
                        ],
                    ],
                    [
                        'key' => 'candidates', 'label' => 'Candidates',
                        'component' => 'resources/js/pages/recruitment/HrCandidates.tsx',
                        'actions' => array_values(array_filter([
                            $recId ? ['key' => 'load', 'label' => 'Open page', 'kind' => 'read', 'requests' => [
                                $r("/recruitments/{$recId}", 'Recruitment detail'),
                                $r("/candidates?recruitment_id={$recId}", 'Candidate list'),
                            ]] : null,
                            $candId ? ['key' => 'detail', 'label' => 'Open a candidate', 'kind' => 'read', 'requests' => [
                                $r("/candidates/{$candId}", 'Candidate detail'),
                            ]] : null,
                            $recId ? ['key' => 'create', 'label' => 'Add candidate', 'kind' => 'write', 'requests' => [
                                $w('POST', '/candidates', 'Create candidate', [
                                    'recruitment_id' => $recId,
                                    'name'           => 'Profiler Probe',
                                    'email'          => 'profiler.probe@mailinator.com',
                                    'mobile'         => '9100000000',
                                    'status'         => 'Applied',
                                ]),
                            ]] : null,
                            $candId ? ['key' => 'update', 'label' => 'Change status', 'kind' => 'write', 'requests' => [
                                $w('PUT', "/candidates/{$candId}", 'Move to Shortlisted', [
                                    'status' => 'Shortlisted',
                                ]),
                            ]] : null,
                        ])),
                    ],
                ],
            ],
            [
                'key' => 'onboarding', 'label' => 'Employee Onboarding', 'group' => 'HR Core',
                'pages' => [[
                    'key' => 'list', 'label' => 'List view',
                    'component' => 'resources/js/pages/employee-onboarding/HrEmployeeOnboarding.tsx',
                    'actions' => [['key' => 'load', 'label' => 'Open page', 'kind' => 'read', 'requests' => [
                        $r('/onboarding-invites', 'Onboarding invites'),
                        /* Genuinely unfiltered — HrEmployeeOnboarding.tsx calls
                           api.get('/employees') with no view, so this really is the
                           full payload for every employee. It is the heaviest read
                           left in HR and the obvious next candidate for a ?view=. */
                        $r('/employees', 'Employee list (FULL payload)'),
                    ]]],
                ]],
            ],
            [
                'key' => 'exit', 'label' => 'Exit Management', 'group' => 'HR Core',
                'pages' => [[
                    'key' => 'list', 'label' => 'List view',
                    'component' => 'resources/js/pages/hrms/HrExitManagement.tsx',
                    'actions' => array_values(array_filter([
                        ['key' => 'load', 'label' => 'Open page', 'kind' => 'read', 'requests' => [
                            $r('/employees?view=exit&page=1&per_page=10&exit_status=active', 'Employee list'),
                            $r('/employees/exit-stats', 'KPI cards + tab badges'),
                        ]],
                        $empId ? ['key' => 'case', 'label' => 'Open an exit case', 'kind' => 'read', 'requests' => [
                            $r("/employees/{$empId}/exit", 'Exit case'),
                            $r("/employees/{$empId}/exit/fnf-summary", 'F&F summary'),
                            $r("/employees/{$empId}/exit/direct-reports", 'Direct reports + manager pool'),
                        ]] : null,
                    ])),
                ]],
            ],
            [
                'key' => 'expense', 'label' => 'Expense Management', 'group' => 'Time & Pay',
                'pages' => [
                    [
                        'key' => 'claims', 'label' => 'Expense claims',
                        'component' => 'resources/js/pages/hrms/HrExpenseManagement.tsx',
                        'actions' => [['key' => 'load', 'label' => 'Open page', 'kind' => 'read', 'requests' => [
                            $r('/expense-claims?scope=all', 'All claims'),
                            $r('/master/expense_categories', 'Categories master'),
                        ]]],
                    ],
                    [
                        'key' => 'advances', 'label' => 'Advance requests',
                        'component' => 'resources/js/components/AdvanceRequestsTable.tsx',
                        'actions' => [['key' => 'load', 'label' => 'Open page', 'kind' => 'read', 'requests' => [
                            $r('/advance-requests?scope=all', 'All advances'),
                        ]]],
                    ],
                ],
            ],
        ];
    }

    /**
     * Every JS chunk, stylesheet and static asset the browser downloads for a page.
     *
     * Read out of Vite's own build manifest rather than parsing imports ourselves:
     * the manifest IS the module graph the bundler produced, so it accounts for
     * shared chunks, dynamic imports and asset hashing that a hand-rolled parser
     * would get wrong.
     *
     * A component with no manifest entry was never split into its own chunk — it
     * is inside the main entry, so what it "loads" is the whole app bundle. That
     * is reported honestly (bundled = true) instead of showing a small number
     * that would imply the page is cheap when it is the opposite.
     */
    public static function assetGraph(?string $component): array
    {
        $empty = ['bundled' => null, 'entry' => null, 'js' => [], 'css' => [], 'assets' => [],
                  'totals' => ['js_kb' => 0, 'css_kb' => 0, 'asset_kb' => 0, 'files' => 0]];

        $manifestPath = public_path('build/manifest.json');
        if (!$component || !is_file($manifestPath)) {
            return $empty;
        }
        $manifest = json_decode(file_get_contents($manifestPath), true);
        if (!is_array($manifest)) {
            return $empty;
        }

        $bundled = !isset($manifest[$component]);
        $entry   = $component;
        if ($bundled) {
            // Several rows carry isEntry — the CSS entry sorts first, and taking
            // it would report a stylesheet as the page JS. Pick the JS/TSX entry,
            // which is the one that actually pulls in the module graph.
            foreach ($manifest as $k => $v) {
                if (!empty($v['isEntry']) && preg_match('/[.](tsx|ts|jsx|js)$/i', $k)) { $entry = $k; break; }
            }
            if (!isset($manifest[$entry])) {
                return $empty;
            }
        }

        $seen = [];
        $js = $css = $assets = [];

        $walk = function (string $key) use (&$walk, $manifest, &$seen, &$js, &$css, &$assets) {
            if (isset($seen[$key]) || !isset($manifest[$key])) {
                return;
            }
            $seen[$key] = true;
            $e = $manifest[$key];

            if (!empty($e['file'])) { $js[$e['file']] = true; }
            foreach (($e['css'] ?? []) as $c)    { $css[$c] = true; }
            foreach (($e['assets'] ?? []) as $a) { $assets[$a] = true; }
            // Static imports only. dynamicImports are lazily fetched LATER, on a
            // user action — counting them here would overstate what this page costs
            // to open.
            foreach (($e['imports'] ?? []) as $i) { $walk($i); }
        };
        $walk($entry);

        $describe = function (array $files) {
            $out = [];
            foreach (array_keys($files) as $f) {
                $abs = public_path('build/' . $f);
                $out[] = [
                    'file' => $f,
                    'kb'   => is_file($abs) ? (int) round(filesize($abs) / 1024) : null,
                    'type' => strtolower(pathinfo($f, PATHINFO_EXTENSION)),
                ];
            }
            usort($out, fn ($a, $b) => ($b['kb'] ?? 0) <=> ($a['kb'] ?? 0));
            return $out;
        };

        $jsList  = $describe($js);
        $cssList = $describe($css);
        $asList  = $describe($assets);
        $sum     = fn (array $l) => array_sum(array_map(fn ($x) => $x['kb'] ?? 0, $l));

        return [
            'bundled' => $bundled,
            'entry'   => $entry,
            'js'      => $jsList,
            'css'     => $cssList,
            'assets'  => $asList,
            'totals'  => [
                'js_kb'    => $sum($jsList),
                'css_kb'   => $sum($cssList),
                'asset_kb' => $sum($asList),
                'files'    => count($jsList) + count($cssList) + count($asList),
            ],
        ];
    }

    /**
     * Front-end weight of a page: source size, and the built chunk the browser
     * actually downloads. A 5,000-line component that ships as its own 120 KB
     * chunk is a different problem from one bundled into the main entry.
     */
    public static function frontendInfo(?string $component): array
    {
        if (!$component) {
            return ['lines' => null, 'source_kb' => null, 'chunk' => null, 'chunk_kb' => null];
        }
        $path  = base_path($component);
        $lines = is_file($path) ? count(file($path)) : null;
        $srcKb = is_file($path) ? (int) round(filesize($path) / 1024) : null;

        // Vite names chunks <Component>-<hash>.js; no match means the component
        // is bundled into the main entry rather than split out.
        $base  = pathinfo($component, PATHINFO_FILENAME);
        $hit   = glob(public_path("build/assets/{$base}-*.js"));
        $chunk = $hit ? basename($hit[0]) : null;

        return [
            'lines'     => $lines,
            'source_kb' => $srcKb,
            'chunk'     => $chunk,
            'chunk_kb'  => $chunk ? (int) round(filesize($hit[0]) / 1024) : null,
            'bundled'   => $chunk === null,   // true = rides in the main app chunk
        ];
    }
}
