<?php

namespace App\Support;

use App\Models\Candidate;
use App\Models\Employee;
use App\Models\Recruitment;

class DevToolsProfileTargets
{
    public static function all(int $clientId, ?int $branchId): array
    {
        $empId = Employee::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))->value('id');
        $recId = Recruitment::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))->value('id');
        $candId = Candidate::where('client_id', $clientId)
            ->when($branchId, fn ($q) => $q->where('branch_id', $branchId))->value('id');

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
                            ['key' => 'load', 'label' => 'Open page', 'kind' => 'read', 'requests' => array_merge(
                                [
                                    $r('/employees?view=list&page=1&per_page=10', 'Employee list'),
                                    $r('/employees/stats', 'KPI cards + tab badges'),
                                ], $masters,
                            )],
                            ['key' => 'search', 'label' => 'Search / filter', 'kind' => 'read', 'requests' => [
                                $r('/employees?view=list&page=1&per_page=10&search=a', 'Search "a"'),
                                $r('/employees/stats?search=a', 'Counts for that search'),
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

    public static function frontendInfo(?string $component): array
    {
        if (!$component) {
            return ['lines' => null, 'source_kb' => null, 'chunk' => null, 'chunk_kb' => null];
        }
        $path  = base_path($component);
        $lines = is_file($path) ? count(file($path)) : null;
        $srcKb = is_file($path) ? (int) round(filesize($path) / 1024) : null;

        $base  = pathinfo($component, PATHINFO_FILENAME);
        $hit   = glob(public_path("build/assets/{$base}-*.js"));
        $chunk = $hit ? basename($hit[0]) : null;

        return [
            'lines'     => $lines,
            'source_kb' => $srcKb,
            'chunk'     => $chunk,
            'chunk_kb'  => $chunk ? (int) round(filesize($hit[0]) / 1024) : null,
            'bundled'   => $chunk === null,
        ];
    }
}
