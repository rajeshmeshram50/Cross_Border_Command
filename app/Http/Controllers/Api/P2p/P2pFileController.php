<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
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
    /** Storage prefix → the row that owns it, so only stored files can be read. */
    private const OWNERS = [
        'p2p/po-payments/'        => ['p2p_po_payments', 'proof_path', 'proof_name'],
        'p2p/refund-recoveries/'  => ['p2p_po_refund_recoveries', 'proof_path', 'proof_name'],
        'p2p/refund-adjustments/' => ['p2p_po_refund_adjustments', 'attachment_path', 'attachment_name'],
        'p2p/po-documents/'       => ['p2p_purchase_order_documents', 'file_path', 'original_name'],
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

        $owner = null;
        foreach (self::OWNERS as $prefix => $cols) {
            if (str_starts_with($path, $prefix)) { $owner = $cols; break; }
        }
        // No traversal, and nothing outside the buckets this endpoint serves.
        if ($path === '' || str_contains($path, '..') || !$owner) abort(404, 'File not found.');

        [$table, $pathCol, $nameCol] = $owner;
        $row = DB::table($table)->where($pathCol, $path)->first();
        if (!$row) abort(404, 'File not found.');

        // Tenant scope — a file is only ever served to its own client.
        if (!$user->isSuperAdmin() && !empty($row->client_id) && (int) $row->client_id !== (int) $user->client_id) {
            abort(403, 'You are not allowed to download this file.');
        }
        if (!Storage::disk('public')->exists($path)) abort(404, 'File is missing on storage.');

        return Storage::disk('public')->download($path, $row->{$nameCol} ?: basename($path));
    }
}
