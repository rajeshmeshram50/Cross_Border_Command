<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CtcContract;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

/**
 * CLM Command Center → Regulatory Defense File (RDF).
 *
 * Read-only repository view. Composes the three tabs from the already-scoped
 * Buyer / Supplier profile aggregations (so compliance progress + tenant
 * isolation are inherited) plus the Case-to-Case contracts:
 *
 *   with_shipment    — shipment-linked records (buyer ⨝ supplier by SHP code)
 *   without_shipment — procurement-wise supplier records + compliance
 *   case_to_case     — per-deal agreement records mapped to counterparties
 *
 * The per-record Evidence Vault is served by the existing
 * /segment-uploads/{type}/{id}/vault endpoint — this controller only builds
 * the three index lists.
 */
class ClmRegulatoryDefenseFileController extends Controller
{
    public function index(
        Request $request,
        ClmBuyerProfileController $buyer,
        ClmSupplierProfileController $supplier
    ): JsonResponse {
        $user = $request->user();
        if (!$user) abort(401);

        $b = $buyer->index($request)->getData(true)['data'] ?? [];
        $s = $supplier->index($request)->getData(true)['data'] ?? [];

        return response()->json([
            'status' => true,
            'data'   => [
                'with_shipment'    => $this->withShipment($b, $s),
                'without_shipment' => $this->withoutShipment($s),
                'case_to_case'     => $this->caseToCase((int) ($user->client_id ?? 0)),
            ],
        ]);
    }

    /**
     * Shipment-linked RDF rows: take the buyer transaction rows that carry a
     * shipment (ws_eq + ws_neq) and overlay the supplier + PO procured under
     * the same shipment (matched on the SHP code).
     */
    private function withShipment(array $buyer, array $supplier): array
    {
        // SHP code → {supplier, po, proc} from the supplier transaction tables.
        $bySupShip = [];
        foreach (['txn_ws_mat', 'txn_ws_logi'] as $key) {
            foreach ($supplier[$key] ?? [] as $r) {
                $shp = (string) ($r['shpId'] ?? '');
                if ($shp === '') continue;
                $bySupShip[$shp] = [
                    'supplier' => (string) ($r['supplier'] ?? '—'),
                    'po'       => (string) ($r['po'] ?? '—'),
                    'proc'     => (string) ($r['procId'] ?? '—'),
                ];
            }
        }

        $rows = [];
        $sr = 0;
        foreach (['ws_eq', 'ws_neq'] as $key) {
            foreach ($buyer[$key] ?? [] as $r) {
                $sr++;
                $shp = (string) ($r['shp'] ?? '');
                $sup = $bySupShip[$shp] ?? ['supplier' => '—', 'po' => '—', 'proc' => '—'];
                $rows[] = [
                    'rdf'       => 'RDF-' . str_pad((string) $sr, 3, '0', STR_PAD_LEFT),
                    'ship'      => $shp ?: '—',
                    'opp'       => (string) ($r['opp'] ?? '—'),
                    'proc'      => $sup['proc'],
                    'customer'  => (string) ($r['customer'] ?? '—'),
                    'consignee' => (string) ($r['consignee'] ?? ($r['customer'] ?? '—')),
                    'supplier'  => $sup['supplier'],
                    'pi'        => (string) ($r['pi'] ?? '—') ?: '—',
                    'po'        => $sup['po'],
                ];
            }
        }
        return $rows;
    }

    /**
     * Procurement-wise RDF rows from the supplier "without shipment"
     * transaction tables, carrying the per-supplier compliance fractions.
     */
    private function withoutShipment(array $supplier): array
    {
        $rows = [];
        $sr = 0;
        foreach (['txn_wos_mat', 'txn_wos_logi', 'txn_wos_svc'] as $key) {
            foreach ($supplier[$key] ?? [] as $r) {
                $sr++;
                $rows[] = [
                    'rdf'      => 'RDF-' . str_pad((string) $sr, 3, '0', STR_PAD_LEFT),
                    'proc'     => (string) ($r['procId'] ?? '—'),
                    'supplier' => (string) ($r['supplier'] ?? '—'),
                    'po'       => (string) ($r['po'] ?? '—'),
                    'vti'      => (string) ($r['inv'] ?? '—'),
                    'kyc'      => $r['kyc'] ?? ['d' => 0, 't' => 0],
                    'dd'       => $r['dd']  ?? ['d' => 0, 't' => 0],
                    'tl'       => $r['tl']  ?? ['d' => 0, 't' => 0],
                    'td'       => $r['td']  ?? ['d' => 0, 't' => 0],
                    'agr'      => $r['agr'] ?? ['d' => 0, 't' => 0],
                ];
            }
        }
        return $rows;
    }

    /** Per-deal agreement RDF rows mapped to their primary counterparty. */
    private function caseToCase(int $clientId): array
    {
        if (!$clientId) return [];

        $sr = 0;
        return CtcContract::where('client_id', $clientId)
            ->orderByDesc('id')
            ->get(['id', 'code', 'title', 'counterparties'])
            ->map(function (CtcContract $c) use (&$sr) {
                $sr++;
                $cps  = is_array($c->counterparties) ? $c->counterparties : [];
                $first = $cps[0] ?? [];
                return [
                    'rdf'          => 'RDF-C-' . str_pad((string) $sr, 3, '0', STR_PAD_LEFT),
                    'ctc'          => $c->code,
                    'title'        => $c->title ?: '—',
                    'counterparty' => (string) ($first['name'] ?? '—') ?: '—',
                    'role'         => $this->normaliseRole((string) ($first['badge'] ?? $first['source_type'] ?? '')),
                ];
            })
            ->all();
    }

    /** Map a stored badge / source_type to one of Buyer | Supplier | Partner. */
    private function normaliseRole(string $raw): string
    {
        $r = mb_strtolower(trim($raw));
        if (str_contains($r, 'buy') || $r === 'customer') return 'Buyer';
        if (str_contains($r, 'supp') || $r === 'vendor')  return 'Supplier';
        return 'Partner';
    }
}
