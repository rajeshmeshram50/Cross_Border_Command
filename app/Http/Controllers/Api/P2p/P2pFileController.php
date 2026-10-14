<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

/**
 * Streams a P2P attachment back as a download.
 *
 * A link straight at the stored file cannot be saved once the disk is remote:
 * on the server the public disk is Azure Blob, so the file sits on another
 * origin, the browser drops the `download` hint and a client-side fetch is
 * blocked by CORS — the file only OPENS in a new tab. Pulling the bytes through
 * here makes every download same-origin with a download disposition, exactly as
 * the segment uploads and the inspection proofs already do.
 */
class P2pFileController extends Controller
{
    /**
     * Storage prefix → the row that owns it, so only stored files can be read.
     * The fourth entry, where a table has one, is a JSON list of every file on the
     * row ([{ path, name }]) — its first file is also in the plain path column, the
     * rest live only in the list.
     */
    private const OWNERS = [
        'p2p/po-payments/'        => ['p2p_po_payments', 'proof_path', 'proof_name'],
        'p2p/refund-recoveries/'  => ['p2p_po_refund_recoveries', 'proof_path', 'proof_name', 'proof_files'],
        'p2p/refund-adjustments/' => ['p2p_po_refund_adjustments', 'attachment_path', 'attachment_name'],
        'p2p/po-documents/'       => ['p2p_purchase_order_documents', 'file_path', 'original_name'],
        /* The invoice and the e-way bill an SPI was filed with. Two columns on
         * one row, so the bucket is listed twice — the lookup matches on the
         * path column, and a file is only served when some row claims it. The
         * Evidence Vault offers both for download; without this they had no
         * authenticated route at all and only resolved through the local
         * /storage symlink, which Azure does not have. */
        'p2p/spi/'               => ['p2p_supplier_invoices', 'invoice_file_path', 'invoice_file_name'],
    ];

    /** A second claim on the same bucket: the e-way bill shares p2p/spi/. */
    private const ALSO = [
        'p2p/spi/' => ['p2p_supplier_invoices', 'eway_file_path', 'eway_file_name'],
    ];

    /** GET /p2p/files/download?path=|url= */
    public function download(Request $request): StreamedResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $path = ltrim((string) $request->query('path', ''), '/');
        if ($path === '') {
            // Accept the stored URL too — on Azure it is absolute and may carry
            // a SAS token or cache-buster, so only the p2p/… suffix is kept.
            $url = (string) $request->query('url', '');
            if ($url !== '' && preg_match('#(p2p/[^?]+)#i', $url, $m)) $path = urldecode($m[1]);
        }
        $path = explode('?', $path)[0];

        $owner = $prefixHit = null;
        foreach (self::OWNERS as $prefix => $cols) {
            if (str_starts_with($path, $prefix)) { $owner = $cols; $prefixHit = $prefix; break; }
        }
        // No traversal, and nothing outside the buckets this endpoint serves.
        if ($path === '' || str_contains($path, '..') || !$owner) abort(404, 'File not found.');

        [$table, $pathCol, $nameCol] = $owner;
        $listCol = $owner[3] ?? null;
        $name = null;
        $row = DB::table($table)->where($pathCol, $path)->first();

        /* A bucket whose rows hold TWO files in two columns — an SPI keeps its
         * invoice and its e-way bill side by side. The first column did not
         * claim this path, so try the second before giving up. */
        if (!$row && isset(self::ALSO[$prefixHit])) {
            [$table, $pathCol, $nameCol] = self::ALSO[$prefixHit];
            $listCol = self::ALSO[$prefixHit][3] ?? null;
            $row = DB::table($table)->where($pathCol, $path)->first();
        }
        if (!$row && $listCol) {
            // A second, third … file on the row: only the JSON list knows it. The
            // LIKE narrows the rows on the file name alone — the stored JSON escapes
            // its slashes, so the full path would never match — and the decoded list
            // decides the real match.
            foreach (DB::table($table)->whereRaw("{$listCol}::text LIKE ?", ['%' . basename($path) . '%'])->get() as $cand) {
                foreach (json_decode((string) $cand->{$listCol}, true) ?: [] as $f) {
                    if (is_array($f) && ($f['path'] ?? null) === $path) {
                        $row = $cand;
                        $name = $f['name'] ?? null;
                        break 2;
                    }
                }
            }
        }
        if (!$row) abort(404, 'File not found.');

        // Tenant scope — a file is only ever served to its own client.
        if (!$user->isSuperAdmin() && !empty($row->client_id) && (int) $row->client_id !== (int) $user->client_id) {
            abort(403, 'You are not allowed to download this file.');
        }
        $disk = $this->diskHolding($path);
        if (!$disk) abort(404, 'File is missing on storage.');

        $filename = $name ?: ($row->{$nameCol} ?: basename($path));

        /* ONE url, two modes.
         *
         * ?mode=preview opens the file in the tab; ?mode=download (the default)
         * saves it. The same bytes, the same caller check, the same disk — only
         * the Content-Disposition differs, so the two cannot drift apart and the
         * payload carries one link instead of two that must stay in step.
         *
         * ?inline=1 still works: it was the first spelling and something may
         * already hold a link built with it. */
        $inline = $request->boolean('inline')
            || strtolower((string) $request->query('mode')) === 'preview';

        try {
            if ($inline) {
                return Storage::disk($disk)->response($path, $filename, [
                    'Content-Disposition' => 'inline; filename="' . addslashes($filename) . '"',
                ]);
            }

            return Storage::disk($disk)->download($path, $filename);
        } catch (\Throwable $e) {
            /* The row says the file is there and the disk agreed a moment ago,
             * so a failure here is the STORAGE, not the request: a dropped
             * connection to the blob container, a revoked key, a read timeout.
             * 502 says that honestly. A 404 would send whoever is looking to
             * re-upload a document that has not gone anywhere. */
            Log::warning('P2P file download failed', [
                'path' => $path, 'disk' => $disk, 'error' => $e->getMessage(),
            ]);
            abort(502, 'The file could not be read from storage. Please try again.');
        }
    }

    /**
     * The disk that actually holds this path, or null when none does.
     *
     * NOT hard-coded to 'public'. That disk swaps its driver with
     * FILESYSTEM_DISK — local on a dev box, azure-storage-blob in production —
     * and a file written under one setting is still read under another when an
     * environment is migrated. So the candidates are tried in order and the
     * first that holds the path wins.
     *
     * Each probe is guarded: exists() on a REMOTE disk makes a network call and
     * throws when the container is unreachable or the key is wrong. An
     * unreachable disk must not take the request down — it is simply not the
     * disk holding this file, and the next one gets its turn.
     */
    private function diskHolding(string $path): ?string
    {
        $candidates = array_values(array_unique(array_filter([
            config('filesystems.default'),
            'public',
            'local',
        ])));

        foreach ($candidates as $disk) {
            try {
                if (Storage::disk($disk)->exists($path)) return $disk;
            } catch (\Throwable $e) {
                Log::warning('P2P file disk probe failed', [
                    'path' => $path, 'disk' => $disk, 'error' => $e->getMessage(),
                ]);
            }
        }

        return null;
    }
}
