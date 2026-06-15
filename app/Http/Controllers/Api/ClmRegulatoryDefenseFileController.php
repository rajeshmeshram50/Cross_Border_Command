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
        // SHP code → {supplier, po, proc, db id} from the supplier transaction tables.
        $bySupShip = [];
        foreach (['txn_ws_mat', 'txn_ws_logi'] as $key) {
            foreach ($supplier[$key] ?? [] as $r) {
                $shp = (string) ($r['shpId'] ?? '');
                if ($shp === '') continue;
                $bySupShip[$shp] = [
                    'supplier' => (string) ($r['supplier'] ?? '—'),
                    'po'       => (string) ($r['po'] ?? '—'),
                    'proc'     => (string) ($r['procId'] ?? '—'),
                    'supDbId'  => (int) ($r['supDbId'] ?? 0),
                ];
            }
        }

        $rows = [];
        $sr = 0;
        foreach (['ws_eq', 'ws_neq'] as $key) {
            foreach ($buyer[$key] ?? [] as $r) {
                $sr++;
                $shp = (string) ($r['shp'] ?? '');
                $sup = $bySupShip[$shp] ?? ['supplier' => '—', 'po' => '—', 'proc' => '—', 'supDbId' => 0];
                // Evidence-Vault party targets: buyer, (separate) consignee, supplier.
                $vault = [];
                if (!empty($r['custId'])) $vault[] = ['key' => 'buyer', 'label' => 'Buyer', 'type' => 'customer', 'id' => (int) $r['custId']];
                if (!empty($r['consId'])) $vault[] = ['key' => 'consignee', 'label' => 'Consignee', 'type' => 'consignee', 'id' => (int) $r['consId']];
                if (!empty($sup['supDbId'])) $vault[] = ['key' => 'supplier', 'label' => 'Supplier', 'type' => 'supplier', 'id' => (int) $sup['supDbId']];
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
                    'vault'     => $vault,
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
                $supDbId = (int) ($r['supDbId'] ?? 0);
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
                    'vault'    => $supDbId ? [['key' => 'supplier', 'label' => 'Supplier', 'type' => 'supplier', 'id' => $supDbId]] : [],
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
                $target = $this->resolveVaultTarget(
                    (string) ($first['source_type'] ?? ''),
                    $first['source_id'] ?? null,
                    (int) $c->client_id
                );
                return [
                    'rdf'          => 'RDF-C-' . str_pad((string) $sr, 3, '0', STR_PAD_LEFT),
                    'ctc'          => $c->code,
                    'title'        => $c->title ?: '—',
                    'counterparty' => (string) ($first['name'] ?? '—') ?: '—',
                    'role'         => $this->normaliseRole((string) ($first['badge'] ?? $first['source_type'] ?? '')),
                    'vault'        => $target ? [$target] : [],
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

    /**
     * Resolve a CTC counterparty reference to an Evidence-Vault target
     * {key,label,type,id}. source_id may be a numeric PK or a party code
     * ("C-009" / vendor_code / consignee_code); returns null when the party
     * type isn't vault-backed or the reference can't be resolved.
     */
    private function resolveVaultTarget(string $sourceType, $sourceId, int $clientId): ?array
    {
        if ($sourceId === null || $sourceId === '') return null;
        $t = mb_strtolower(trim($sourceType));

        [$type, $label, $model, $codeCol] = match (true) {
            str_contains($t, 'buy') || $t === 'customer'  => ['customer',  'Buyer',     \App\Models\Customer::class,  'customer_code'],
            str_contains($t, 'consign')                    => ['consignee', 'Consignee', \App\Models\Consignee::class, 'consignee_code'],
            str_contains($t, 'supp') || $t === 'vendor'    => ['supplier',  'Supplier',  \App\Models\Vendor::class,    'vendor_code'],
            default                                        => [null, null, null, null],
        };
        if (!$type) return null;

        $id = null;
        if (is_numeric($sourceId)) {
            $id = (int) $sourceId;
        } else {
            $row = $model::where('client_id', $clientId)->where($codeCol, (string) $sourceId)->first(['id']);
            $id = $row ? (int) $row->id : null;
        }
        return $id ? ['key' => $type, 'label' => $label, 'type' => $type, 'id' => $id] : null;
    }
}
