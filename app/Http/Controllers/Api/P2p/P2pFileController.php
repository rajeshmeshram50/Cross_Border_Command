<?php

namespace App\Http\Controllers\Api\P2p;

use App\Http\Controllers\Controller;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Storage;
use Symfony\Component\HttpFoundation\StreamedResponse;

class P2pFileController extends Controller
{
    private const OWNERS = [
        'p2p/po-payments/'        => ['p2p_po_payments', 'proof_path', 'proof_name'],
        'p2p/refund-recoveries/'  => ['p2p_po_refund_recoveries', 'proof_path', 'proof_name', 'proof_files'],
        'p2p/refund-adjustments/' => ['p2p_po_refund_adjustments', 'attachment_path', 'attachment_name'],
        'p2p/po-documents/'       => ['p2p_purchase_order_documents', 'file_path', 'original_name'],
        'p2p/spi/'               => ['p2p_supplier_invoices', 'invoice_file_path', 'invoice_file_name'],
    ];

    private const ALSO = [
        'p2p/spi/' => ['p2p_supplier_invoices', 'eway_file_path', 'eway_file_name'],
    ];

    public function download(Request $request): StreamedResponse
    {
        $user = $request->user();
        if (!$user) abort(401);

        $path = ltrim((string) $request->query('path', ''), '/');
        if ($path === '') {
            $url = (string) $request->query('url', '');
            if ($url !== '' && preg_match('#(p2p/[^?]+)#i', $url, $m)) $path = urldecode($m[1]);
        }
        $path = explode('?', $path)[0];

        $owner = $prefixHit = null;
        foreach (self::OWNERS as $prefix => $cols) {
            if (str_starts_with($path, $prefix)) { $owner = $cols; $prefixHit = $prefix; break; }
        }
        if ($path === '' || str_contains($path, '..') || !$owner) abort(404, 'File not found.');

        [$table, $pathCol, $nameCol] = $owner;
        $listCol = $owner[3] ?? null;
        $name = null;
        $row = DB::table($table)->where($pathCol, $path)->first();

        if (!$row && isset(self::ALSO[$prefixHit])) {
            [$table, $pathCol, $nameCol] = self::ALSO[$prefixHit];
            $listCol = self::ALSO[$prefixHit][3] ?? null;
            $row = DB::table($table)->where($pathCol, $path)->first();
        }
        if (!$row && $listCol) {
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

        if (!$user->isSuperAdmin() && !empty($row->client_id) && (int) $row->client_id !== (int) $user->client_id) {
            abort(403, 'You are not allowed to download this file.');
        }
        $disk = $this->diskHolding($path);
        if (!$disk) abort(404, 'File is missing on storage.');

        $filename = $name ?: ($row->{$nameCol} ?: basename($path));

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
            Log::warning('P2P file download failed', [
                'path' => $path, 'disk' => $disk, 'error' => $e->getMessage(),
            ]);
            abort(502, 'The file could not be read from storage. Please try again.');
        }
    }

    private function diskHolding(string $path): ?string
    {
        $candidates = array_values(array_unique(array_filter([
            config('filesystems.documents'),
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
