<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use FilesystemIterator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

class DocsGuideController extends Controller
{
    private const TYPES = [
        'functional'  => '_FUNCTIONAL_DOCUMENTATION.md',
        'technical'   => '_TECHNICAL_DOCUMENTATION.md',
        'api'         => '_API_DOCUMENTATION.md',
        'walkthrough' => '_CODE_WALKTHROUGH.md',
    ];

    private const TYPE_LABELS = [
        'functional'  => 'Functional',
        'technical'   => 'Technical',
        'api'         => 'API',
        'walkthrough' => 'Code Walkthrough',
    ];

    private const GROUP_LABELS = [
        'masters'      => 'Masters',
        'hrms'         => 'HRMS',
        'sales-matrix' => 'Sales Matrix',
        'client'       => 'Client',
        'branch'       => 'Branch',
        'plan'         => 'Plan',
        'payment'      => 'Payment',
        'payroll'      => 'Payroll',
        'permission'   => 'Permission',
        'integrations' => 'Integrations',
        'saas'         => 'SaaS Platform',
        'p2p'          => 'Procure to Pay (P2P)',
        'credvault'    => 'CredVault',
    ];

    private const GROUP_ORDER = [
        'saas', 'masters', 'sales-matrix', 'hrms',
        'client', 'branch', 'plan', 'payment', 'payroll', 'permission', 'p2p', 'credvault', 'integrations',
    ];

    private function baseDir(): string
    {
        return base_path('docs');
    }

    private function titleize(string $s): string
    {
        return ucwords(str_replace(['-', '_'], ' ', $s));
    }

    private function groupLabel(string $key): string
    {
        return self::GROUP_LABELS[$key] ?? $this->titleize($key);
    }

    private function collectUnits(): array
    {
        $realBase = realpath($this->baseDir());
        if ($realBase === false) {
            return [];
        }
        $basePosix = str_replace('\\', '/', $realBase);

        $units = [];
        $it = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($realBase, FilesystemIterator::SKIP_DOTS),
        );

        foreach ($it as $file) {
            if (!$file->isFile()) {
                continue;
            }
            $fname = $file->getFilename();
            foreach (self::TYPES as $type => $suffix) {
                if (!str_ends_with($fname, $suffix)) {
                    continue;
                }
                $dirPosix = str_replace('\\', '/', $file->getPath());
                $rel = trim(substr($dirPosix, strlen($basePosix)), '/');
                if ($rel === '') {
                    break;
                }
                if (!isset($units[$rel])) {
                    $segments = explode('/', $rel);
                    $units[$rel] = [
                        'path'  => $rel,
                        'group' => $segments[0],
                        'title' => $this->titleize(end($segments)),
                        'types' => [],
                    ];
                }
                $units[$rel]['types'][$type] = true;
                break;
            }
        }

        return $units;
    }

    private function orderedTypes(array $have): array
    {
        return array_values(array_filter(
            array_keys(self::TYPES),
            fn ($t) => !empty($have[$t]),
        ));
    }

    public function index(): JsonResponse
    {
        $units = $this->collectUnits();

        $groups = [];
        foreach ($units as $u) {
            $g = $u['group'];
            if (!isset($groups[$g])) {
                $groups[$g] = ['key' => $g, 'label' => $this->groupLabel($g), 'items' => []];
            }
            $groups[$g]['items'][] = [
                'path'  => $u['path'],
                'title' => $u['title'],
                'types' => $this->orderedTypes($u['types']),
            ];
        }

        foreach ($groups as &$grp) {
            usort($grp['items'], fn ($a, $b) => strcmp($a['title'], $b['title']));
        }
        unset($grp);

        uksort($groups, function ($a, $b) {
            $ia = array_search($a, self::GROUP_ORDER, true);
            $ib = array_search($b, self::GROUP_ORDER, true);
            $ia = $ia === false ? 999 : $ia;
            $ib = $ib === false ? 999 : $ib;
            return $ia <=> $ib ?: strcmp($a, $b);
        });

        return response()->json([
            'groups' => array_values($groups),
            'types'  => self::TYPE_LABELS,
        ]);
    }

    private function resolveFile(string $path, string $type): ?string
    {
        if (!isset(self::TYPES[$type])) {
            return null;
        }
        $clean = str_replace('\\', '/', trim($path, '/'));
        if ($clean === '' || str_contains($clean, '..')) {
            return null;
        }

        $realBase = realpath($this->baseDir());
        if ($realBase === false) {
            return null;
        }
        $dir     = $realBase . DIRECTORY_SEPARATOR . str_replace('/', DIRECTORY_SEPARATOR, $clean);
        $realDir = realpath($dir);
        if ($realDir === false || !str_starts_with($realDir, $realBase)) {
            return null;
        }

        $matches = glob($realDir . DIRECTORY_SEPARATOR . '*' . self::TYPES[$type]);
        return (!empty($matches) && is_file($matches[0])) ? $matches[0] : null;
    }

    public function show(Request $request): JsonResponse
    {
        $path = (string) $request->query('path', '');
        $type = strtolower((string) $request->query('type', ''));

        $file = $this->resolveFile($path, $type);
        if ($file === null) {
            return response()->json(['message' => 'Document not found.'], 404);
        }

        return response()->json([
            'path'    => trim(str_replace('\\', '/', $path), '/'),
            'type'    => $type,
            'label'   => self::TYPE_LABELS[$type],
            'content' => (string) file_get_contents($file),
        ]);
    }

    public function update(Request $request): JsonResponse
    {
        $data = $request->validate([
            'path'    => 'required|string',
            'type'    => 'required|string',
            'content' => 'present|string',
        ]);

        $file = $this->resolveFile($data['path'], strtolower($data['type']));
        if ($file === null) {
            return response()->json(['message' => 'Document not found.'], 404);
        }

        if (@file_put_contents($file, $data['content']) === false) {
            return response()->json(['message' => 'Could not save the document.'], 500);
        }

        return response()->json([
            'message' => 'Documentation saved.',
            'path'    => trim(str_replace('\\', '/', $data['path']), '/'),
            'type'    => strtolower($data['type']),
        ]);
    }
}
