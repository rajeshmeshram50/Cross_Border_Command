<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use FilesystemIterator;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use RecursiveDirectoryIterator;
use RecursiveIteratorIterator;

/**
 * Serves — and lets users edit — the project documentation guide.
 *
 * Every module keeps its docs under docs/<group>/<entity>/ as a set of up to four
 * markdown files, one per doc type (functional / technical / api / walkthrough).
 * This controller scans that whole tree, groups the entities by their top-level
 * folder (masters, hrms, sales-matrix, …) and serves the markdown, plus a PUT to
 * save edits straight back to the file.
 *
 * These docs are the same for the whole product (not tenant data), so the routes
 * live in the plain auth:sanctum group with no permission/branch scoping — any
 * signed-in user of any role can read and, by request, edit the sheets. Every
 * path is realpath-checked to stay inside docs/, so there is no traversal surface.
 */
class DocsGuideController extends Controller
{
    /** Doc-type key => filename suffix that identifies the file inside an entity folder. */
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

    /** Nice labels for the top-level groups; anything else is title-cased on the fly. */
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
    ];

    /** Preferred group ordering; unlisted groups fall to the end, alphabetically. */
    private const GROUP_ORDER = [
        'saas', 'masters', 'sales-matrix', 'hrms',
        'client', 'branch', 'plan', 'payment', 'payroll', 'permission', 'integrations',
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

    /**
     * Walk docs/ and collect every folder that holds a doc set, keyed by its
     * path relative to docs/ (posix). Loose files at the docs root are ignored —
     * the canonical SaaS overview lives under docs/saas/.
     *
     * @return array<string, array{path:string, group:string, title:string, types:array<string,bool>}>
     */
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
                    break; // skip root-level loose docs
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

    /** Order a unit's available types by the canonical tab order. */
    private function orderedTypes(array $have): array
    {
        return array_values(array_filter(
            array_keys(self::TYPES),
            fn ($t) => !empty($have[$t]),
        ));
    }

    /**
     * GET /docs-guide
     * Returns the doc entities grouped by module, ready for the sidebar.
     */
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

    /**
     * Resolve a (relative path, type) pair to an absolute file, or null.
     * Guards against traversal by requiring the resolved folder to sit inside docs/.
     */
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

    /**
     * GET /docs-guide/content?path=hrms/leave&type=api
     * Returns the raw markdown for one entity + doc type.
     */
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

    /**
     * PUT /docs-guide/content  { path, type, content }
     * Saves edited markdown straight back to the source file. Open to any authed
     * user by product request; the path is validated the same way as reads.
     */
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
