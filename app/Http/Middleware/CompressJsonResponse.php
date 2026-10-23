<?php

namespace App\Http\Middleware;

use Closure;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * gzip API JSON responses, when the caller asked for gzip.
 *
 * The CLM list endpoints send documents: /clm/agreement-library is 1.75 MB of
 * JSON across thirteen rows, 99.3% of it the `content` column, and
 * /clm/tnc-library is the same shape. None of it was compressed — DevTools on
 * live reported the transferred size as the raw size — so every list load paid
 * for the whole thing on the wire.
 *
 * Measured on the real rows: 1,750,358 -> 119,120 bytes (6.8%), for 15 ms of
 * CPU. HTML compresses like this because it is mostly repeated tags.
 *
 * This changes nothing a caller can observe. The browser decompresses before
 * JavaScript ever sees the body, so the JSON that reaches the app is identical
 * byte for byte — only fewer bytes crossed the network.
 *
 * Deliberately narrow:
 *   - only when the client advertised gzip in Accept-Encoding
 *   - only JSON, so PDF / DOCX / XLSX downloads are untouched (they are
 *     already compressed formats; re-compressing costs CPU and saves nothing)
 *   - never a streamed or file response, which has no in-memory body to encode
 *   - never a body already carrying Content-Encoding, so if the web server or
 *     PHP's own zlib.output_compression is doing this we do not do it twice
 *   - not below a threshold, where the gzip header can make the body BIGGER
 *     and the saving is not worth a syscall
 *
 * Vary: Accept-Encoding goes out either way, so a cache in front of us never
 * hands a gzipped body to a client that did not ask for one.
 */
class CompressJsonResponse
{
    /** Below this, gzip's own overhead is most of the result. */
    private const MIN_BYTES = 1024;

    /** 6 is zlib's default: ~95% of the saving of 9 for a fraction of the CPU. */
    private const LEVEL = 6;

    public function handle(Request $request, Closure $next): Response
    {
        $response = $next($request);

        if (!$this->shouldCompress($request, $response)) {
            // Still declare it: the uncompressed body is also Accept-Encoding
            // dependent as far as any shared cache is concerned.
            $response->headers->set('Vary', 'Accept-Encoding', false);
            return $response;
        }

        $body = $response->getContent();
        if ($body === false || $body === null || strlen($body) < self::MIN_BYTES) {
            $response->headers->set('Vary', 'Accept-Encoding', false);
            return $response;
        }

        $gz = @gzencode($body, self::LEVEL);
        // A failed encode, or one that did not actually help, leaves the
        // response exactly as it was.
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

        // PHP compressing the output buffer itself would make this a double
        // encode, which browsers reject.
        $ini = (string) ini_get('zlib.output_compression');
        if ($ini !== '' && $ini !== '0' && strtolower($ini) !== 'off') return false;

        if ($response instanceof StreamedResponse || $response instanceof BinaryFileResponse) return false;
        if ($response->headers->has('Content-Encoding')) return false;
        if ($response->isInformational() || $response->isRedirection()) return false;
        // 204 / 304 carry no body.
        if (in_array($response->getStatusCode(), [204, 304], true)) return false;

        if (!str_contains(strtolower((string) $request->headers->get('Accept-Encoding', '')), 'gzip')) return false;

        $type = strtolower((string) $response->headers->get('Content-Type', ''));

        return str_contains($type, 'application/json') || str_contains($type, '+json');
    }
}
