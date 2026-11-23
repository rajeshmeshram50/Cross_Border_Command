<?php

namespace App\Support;

use Illuminate\Support\Facades\Route;

class ApiUsageScanner
{
    private const ROOTS = ['resources/js'];

    private const SKIP_DIRS = ['/velzon/', '/node_modules/', '/dist/'];

    private const EXTENSIONS = ['tsx', 'ts', 'jsx', 'js'];

    public static function find(string $path): array
    {
        $clean  = '/' . ltrim(explode('?', $path)[0], '/');
        $needle = self::literalPrefix($clean);
        $lineRe = self::lineRegex($clean);

        $sites = [];
        foreach (self::corpus() as $rel => $contents) {
            if (!str_contains($contents, $needle)) {
                continue;
            }
            $lines = explode("\n", $contents);
            foreach ($lines as $i => $line) {
                if (!preg_match($lineRe, $line)) {
                    continue;
                }
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

    private static function lineRegex(string $path): string
    {
        $parts = [];
        foreach (array_filter(explode('/', $path), 'strlen') as $seg) {
            $parts[] = preg_match('/^\d+$/', $seg) || str_starts_with($seg, '{')
                ? null
                : preg_quote($seg, '#');
        }
        $re = '';
        foreach ($parts as $p) {
            $re .= $p === null ? '/[^\'"`\s]*' : '/' . $p;
        }
        return '#' . $re . '#';
    }

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

    private static ?array $corpus = null;

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
            if (!str_contains($c, 'api.') && !str_contains($c, 'axios')) {
                continue;
            }
            self::$corpus[$rel] = $c;
        }
        return self::$corpus;
    }

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
