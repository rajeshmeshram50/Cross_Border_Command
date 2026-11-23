<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

class CompressJsonResponse
{
    private const MIN_BYTES = 1024;

    private const LEVEL = 6;

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (!$this->shouldCompress($request, $response)) {
            $response->headers->set('Vary', 'Accept-Encoding', false);
            return $response;
        }

        $body = $response->getContent();
        if ($body === false || $body === null || strlen($body) < self::MIN_BYTES) {
            $response->headers->set('Vary', 'Accept-Encoding', false);
            return $response;
        }

        $gz = @gzencode($body, self::LEVEL);
        if ($gz === false || strlen($gz) >= strlen($body)) {
            $response->headers->set('Vary', 'Accept-Encoding', false);
            return $response;
        }

        $response->setContent($gz);
        $response->headers->set('Content-Encoding', 'gzip');
        $response->headers->set('Content-Length', (string) strlen($gz));
        $response->headers->set('Vary', 'Accept-Encoding', false);

        return $response;
    }

    private function shouldCompress(Request $request, Response $response): bool
    {
        if (!extension_loaded('zlib')) return false;

        $ini = (string) ini_get('zlib.output_compression');
        if ($ini !== '' && $ini !== '0' && strtolower($ini) !== 'off') return false;

        if ($response instanceof StreamedResponse || $response instanceof BinaryFileResponse) return false;
        if ($response->headers->has('Content-Encoding')) return false;
        if ($response->isInformational() || $response->isRedirection()) return false;
        if (in_array($response->getStatusCode(), [204, 304], true)) return false;

        if (!str_contains(strtolower((string) $request->headers->get('Accept-Encoding', '')), 'gzip')) return false;

        $type = strtolower((string) $response->headers->get('Content-Type', ''));

        return str_contains($type, 'application/json') || str_contains($type, '+json');
    }
}
