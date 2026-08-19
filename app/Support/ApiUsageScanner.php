<?php

namespace App\Support;

use Illuminate\Support\Facades\Route;

/**
 * Where an API endpoint is called from, across the whole front end.
 *
 * The Profiler can tell you an endpoint is slow. That only becomes actionable
 * once you know who calls it: an endpoint hit from one rarely-opened screen and
 * one hit from nine screens are the same number on a chart and completely
 * different decisions. This answers "if I change or paginate this, what breaks".
 *
 * Deliberately a source scan rather than runtime tracing. Runtime only sees the
 * paths someone happened to exercise; the source sees every call site, including
 * the ones behind a permission check nobody triggered today.
 */
class ApiUsageScanner
{
    /** Where front-end source lives. */
    private const ROOTS = ['resources/js'];

    /**
     * Directories skipped outright. velzon is the bought-in admin theme — 39 MB
     * of the 54 MB under resources/js, and it never calls our API, so scanning
     * it is most of the cost and none of the answer.
     */
    private const SKIP_DIRS = ['/velzon/', '/node_modules/', '/dist/'];

    /** Files worth scanning. */
    private const EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];

    /**
     * Call sites for one endpoint path.
     *
     * @param  string  $path  e.g. "/employees" or "/employees/20/exit"
     * @return array{path:string,needle:string,backend:array,sites:array,by_file:array,by_method:array,total:int}
     */
    public static function find(string $path): array
    {
        // Strip the query string and any concrete id, so /employees/20/exit also
        // matches the source that builds it as `/employees/${id}/exit`. What is
        // left is the longest literal prefix a developer would actually type.
        $clean  = '/' . ltrim(explode('?', $path)[0], '/');
        $needle = self::literalPrefix($clean);
        // Keeps every literal segment, in order, with an id-shaped gap between —
        // so /employees/20/exit matches `/employees/${id}/exit` in the source but
        // NOT the seventy-odd other lines that merely mention /employees.
        $lineRe = self::lineRegex($clean);

        $sites = [];
        foreach (self::corpus() as $rel => $contents) {
            // Cheap reject first: most files cannot possibly match, and splitting
            // them into lines is the expensive part.
            if (!str_contains($contents, $needle)) {
                continue;
            }
            $lines = explode("\n", $contents);
            foreach ($lines as $i => $line) {
                if (!preg_match($lineRe, $line)) {
                    continue;
                }
                // Only count it when the line is actually an API call — the same
                // string appears in route definitions and comments, and counting
                // those would inflate the number the decision rests on.
                if (!preg_match('/\b(api|axios)\s*\.\s*(get|post|put|patch|delete|request)\b/i', $line)
                    && !preg_match('/\bmethod\s*:\s*[\'"](GET|POST|PUT|PATCH|DELETE)[\'"]/i', $line)) {
                    continue;
                }
                preg_match('/\b(?:api|axios)\s*\.\s*(get|post|put|patch|delete|request)\b/i', $line, $m);

                $sites[] = [
                    'file'    => $rel,
                    'line'    => $i + 1,
                    'method'  => strtoupper($m[1] ?? 'REQUEST'),
                    'snippet' => trim(mb_substr(preg_replace('/\s+/', ' ', $line), 0, 160)),
                ];
            }
        }

        // Group for the summary charts.
        $byFile = $byMethod = [];
        foreach ($sites as $s) {
            $byFile[$s['file']]     = ($byFile[$s['file']] ?? 0) + 1;
            $byMethod[$s['method']] = ($byMethod[$s['method']] ?? 0) + 1;
        }
        arsort($byFile);
        arsort($byMethod);

        return [
            'path'      => $clean,
            'needle'    => $needle,
            'backend'   => self::backend($clean),
            'sites'     => $sites,
            'by_file'   => array_map(fn ($f, $n) => ['file' => $f, 'count' => $n], array_keys($byFile), $byFile),
            'by_method' => array_map(fn ($k, $n) => ['method' => $k, 'count' => $n], array_keys($byMethod), $byMethod),
            'total'     => count($sites),
        ];
    }

    /**
     * The longest leading part of the path with no numeric segment.
     *
     * "/employees/20/exit" → "/employees" — because the source never contains
     * the literal 20; it interpolates. Matching on the prefix finds the call
     * site; matching on the full path would find nothing.
     */
    private static function literalPrefix(string $path): string
    {
        $out = [];
        foreach (array_filter(explode('/', $path), 'strlen') as $seg) {
            if (preg_match('/^\d+$/', $seg) || str_starts_with($seg, '{') || str_starts_with($seg, '$')) {
                break;
            }
            $out[] = $seg;
        }
        return '/' . implode('/', $out ?: ['']);
    }

    /**
     * A regex matching how this path is WRITTEN in the front end.
     *
     * Literal segments must all appear, in order. Between them we allow anything
     * that is not a quote — that is where a template literal puts its \${id}.
     */
    private static function lineRegex(string $path): string
    {
        $parts = [];
        foreach (array_filter(explode('/', $path), 'strlen') as $seg) {
            $parts[] = preg_match('/^\d+$/', $seg) || str_starts_with($seg, '{')
                ? null                       // an id — becomes the gap
                : preg_quote($seg, '#');
        }
        $re = '';
        foreach ($parts as $p) {
            $re .= $p === null ? '/[^\'"`\s]*' : '/' . $p;
        }
        return '#' . $re . '#';
    }

    /** Which controller action serves this path, and what else shares its prefix. */
    private static function backend(string $path): array
    {
        $target  = ltrim($path, '/');
        $matches = [];

        foreach (Route::getRoutes() as $route) {
            $uri = $route->uri();
            if (!str_starts_with($uri, 'api/')) {
                continue;
            }
            $bare = substr($uri, 4);
            // Compare with route parameters collapsed, so api/employees/{employee}
            // lines up with the concrete /employees/20 we were handed.
            // Substitute route parameters BEFORE quoting. Quoting first escapes the
            // braces, and replacing them afterwards leaves the escape behind —
            // \{key\} became \[^/]+, a literal '[', which matched nothing.
            // The sentinel has to survive preg_quote, which escapes NUL to \000 —
            // a NUL placeholder therefore stopped matching silently. Alphanumeric is safe.
            $withHole = preg_replace('/\{[^}]+\}/', 'ZZPARAMZZ', $bare);
            $pattern  = '#^' . str_replace('ZZPARAMZZ', '[^/]+', preg_quote($withHole, '#')) . '$#';

            if (preg_match($pattern, $target) || $bare === $target) {
                foreach ($route->methods() as $m) {
                    if ($m === 'HEAD') {
                        continue;
                    }
                    $matches[] = [
                        'method' => $m,
                        'uri'    => '/' . $bare,
                        'action' => str_replace('App\\Http\\Controllers\\Api\\', '', $route->getActionName()),
                    ];
                }
            }
        }
        return $matches;
    }

    /** Path => contents, read once and reused across lookups in this request. */
    private static ?array $corpus = null;

    /** @return array<string,string> relative path => file contents */
    private static function corpus(): array
    {
        if (self::$corpus !== null) {
            return self::$corpus;
        }
        self::$corpus = [];
        foreach (self::files() as $abs) {
            $rel = str_replace('\\', '/', str_replace(base_path() . DIRECTORY_SEPARATOR, '', $abs));
            $c   = @file_get_contents($abs);
            if ($c === false) {
                continue;
            }
            // Only files that call the API at all can contain a call site.
            if (!str_contains($c, 'api.') && !str_contains($c, 'axios')) {
                continue;
            }
            self::$corpus[$rel] = $c;
        }
        return self::$corpus;
    }

    /** @return string[] absolute paths */
    private static function files(): array
    {
        $out = [];
        foreach (self::ROOTS as $root) {
            $dir = base_path($root);
            if (!is_dir($dir)) {
                continue;
            }
            $it = new \RecursiveIteratorIterator(
                new \RecursiveDirectoryIterator($dir, \FilesystemIterator::SKIP_DOTS)
            );
            foreach ($it as $f) {
                if (!$f->isFile() || !in_array(strtolower($f->getExtension()), self::EXTENSIONS, true)) {
                    continue;
                }
                $norm = str_replace('\\', '/', $f->getPathname());
                foreach (self::SKIP_DIRS as $skip) {
                    if (str_contains($norm, $skip)) { continue 2; }
                }
                $out[] = $f->getPathname();
            }
        }
        return $out;
    }
}
