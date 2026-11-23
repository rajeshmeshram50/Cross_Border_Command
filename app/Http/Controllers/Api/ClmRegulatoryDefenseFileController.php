<?php

namespace App\Http\Controllers\Api;

use App\Http\Controllers\Controller;
use App\Models\CtcContract;
use App\Models\Procurement;
use App\Models\ProcurementProduct;
use App\Models\Vendor;
use App\Models\VendorProductMapping;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

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
                'with_shipment'    => $this->withShipment($b, (int) ($user->client_id ?? 0)),
                'without_shipment' => $this->withoutShipment($s),
                'case_to_case'     => $this->caseToCase((int) ($user->client_id ?? 0)),
            ],
        ]);
    }

    private function withShipment(array $buyer, int $cid): array
    {
        $wsRows = array_merge($buyer['ws_eq'] ?? [], $buyer['ws_neq'] ?? []);
        $leadIds = array_values(array_unique(array_filter(array_map(
            static fn ($r) => (int) ($r['leadId'] ?? 0),
            $wsRows
        ))));

        $procByLead = [];
        $procIds = [];
        if ($cid && $leadIds) {
            foreach (Procurement::where('client_id', $cid)->whereIn('lead_id', $leadIds)->orderBy('id')->get(['id', 'lead_id']) as $p) {
                $procByLead[(int) $p->lead_id][] = (int) $p->id;
                $procIds[] = (int) $p->id;
            }
        }

        $productsByProc = [];
        $productIds = [];
        if ($procIds) {
            foreach (ProcurementProduct::whereIn('procurement_id', $procIds)->whereNotNull('product_id')->get(['procurement_id', 'product_id']) as $pp) {
                $productsByProc[(int) $pp->procurement_id][] = (int) $pp->product_id;
                $productIds[] = (int) $pp->product_id;
            }
        }

        $vendorsByProduct = [];
        $vendorIds = [];
        if ($productIds) {
            foreach (VendorProductMapping::whereIn('product_id', array_values(array_unique($productIds)))->get(['vendor_id', 'product_id']) as $m) {
                $vendorsByProduct[(int) $m->product_id][] = (int) $m->vendor_id;
                $vendorIds[] = (int) $m->vendor_id;
            }
        }
        $vendorById = $vendorIds
            ? Vendor::whereIn('id', array_values(array_unique($vendorIds)))->get(['id', 'company_name', 'vendor_code'])->keyBy('id')
            : collect();

        $suppliersForProc = function (int $procId) use ($productsByProc, $vendorsByProduct, $vendorById): array {
            $seen = [];
            $out = [];
            foreach ($productsByProc[$procId] ?? [] as $pid) {
                foreach ($vendorsByProduct[$pid] ?? [] as $vid) {
                    if (isset($seen[$vid])) continue;
                    $v = $vendorById->get($vid);
                    if (!$v) continue;
                    $seen[$vid] = true;
                    $out[] = [
                        'id'    => (int) $v->id,
                        'name'  => (string) $v->company_name,
                        'code'  => $v->vendor_code ?: ('S-' . str_pad((string) $v->id, 3, '0', STR_PAD_LEFT)),
                    ];
                }
            }
            return $out;
        };

        $rows = [];
        $sr = 0;
        foreach ($wsRows as $r) {
            $sr++;
            $lead = (int) ($r['leadId'] ?? 0);

            $procs = [];
            $vendorSeen = [];
            $vault = [];
            if (!empty($r['custId'])) $vault[] = ['key' => 'buyer', 'label' => 'Customer', 'type' => 'customer', 'id' => (int) $r['custId']];
            if (!empty($r['consId'])) $vault[] = ['key' => 'consignee', 'label' => 'Consignee', 'type' => 'consignee', 'id' => (int) $r['consId']];

            foreach ($procByLead[$lead] ?? [] as $procId) {
                $sups = $suppliersForProc($procId);
                $procs[] = [
                    'proc'      => 'PROC-' . str_pad((string) $procId, 3, '0', STR_PAD_LEFT),
                    'suppliers' => $sups,
                    'po'        => '—',
                ];
                foreach ($sups as $s) {
                    if (isset($vendorSeen[$s['id']])) continue;
                    $vendorSeen[$s['id']] = true;
                    $vault[] = ['key' => 'supplier-' . $s['id'], 'label' => count($vendorSeen) > 1 ? ('Supplier · ' . $s['name']) : 'Supplier', 'type' => 'supplier', 'id' => $s['id']];
                }
            }

            $rows[] = [
                'rdf'       => 'RDF-' . str_pad((string) $sr, 3, '0', STR_PAD_LEFT),
                'ship'      => (string) ($r['shp'] ?? '—') ?: '—',
                'opp'       => (string) ($r['opp'] ?? '—'),
                'customer'  => (string) ($r['customer'] ?? '—'),
                'consignee' => (string) ($r['consignee'] ?? ($r['customer'] ?? '—')),
                'pi'        => (string) ($r['pi'] ?? '—') ?: '—',
                'procs'     => $procs,
                'vault'     => $vault,
            ];
        }
        return $rows;
    }

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

    private function caseToCase(int $clientId): array
    {
        if (!$clientId) return [];

        $sr = 0;
        return CtcContract::where('client_id', $clientId)
            ->orderByDesc('id')
            ->get(['id', 'branch_id', 'code', 'title', 'counterparties'])
            ->map(function (CtcContract $c) use (&$sr, $clientId) {
                $sr++;
                $cps  = is_array($c->counterparties) ? $c->counterparties : [];
                $first = $cps[0] ?? [];

                $vault = [];
                $seen = [];
                foreach ($cps as $cp) {
                    $t = $this->resolveVaultTarget(
                        (string) ($cp['source_type'] ?? ''),
                        $cp['source_id'] ?? null,
                        $clientId,
                        $cp['source_db_id'] ?? null,
                        $c->branch_id
                    );
                    if (!$t) continue;
                    $dedupe = $t['type'] . '#' . $t['id'];
                    if (isset($seen[$dedupe])) continue;
                    $seen[$dedupe] = true;
                    $name = trim((string) ($cp['name'] ?? ''));
                    $t['label'] = $name !== '' ? $name : $t['label'];
                    $t['key']   = $dedupe;
                    $vault[] = $t;
                }

                return [
                    'rdf'          => 'RDF-C-' . str_pad((string) $sr, 3, '0', STR_PAD_LEFT),
                    'ctc'          => $c->code,
                    'title'        => $c->title ?: '—',
                    'counterparty' => (string) ($first['name'] ?? '—') ?: '—',
                    'role'         => $this->normaliseRole((string) ($first['badge'] ?? $first['source_type'] ?? '')),
                    'vault'        => $vault,
                ];
            })
            ->all();
    }

    private function normaliseRole(string $raw): string
    {
        $r = mb_strtolower(trim($raw));
        if (str_contains($r, 'buy') || $r === 'customer') return 'Buyer';
        if (str_contains($r, 'supp') || $r === 'vendor')  return 'Supplier';
        return 'Partner';
    }

    private function resolveVaultTarget(string $sourceType, $sourceId, int $clientId, $sourceDbId = null, $branchId = null): ?array
    {
        if (($sourceId === null || $sourceId === '') && ($sourceDbId === null || $sourceDbId === '')) return null;
        $t = mb_strtolower(trim($sourceType));

        [$type, $label, $model, $codeCol] = match (true) {
            str_contains($t, 'buy') || $t === 'customer'  => ['customer',  'Buyer',     \App\Models\Customer::class,  'customer_code'],
            str_contains($t, 'consign')                    => ['consignee', 'Consignee', \App\Models\Consignee::class, 'consignee_code'],
            str_contains($t, 'supp') || $t === 'vendor'    => ['supplier',  'Supplier',  \App\Models\Vendor::class,    'vendor_code'],
            default                                        => [null, null, null, null],
        };
        if (!$type) return null;

        $id = null;
        if ($sourceDbId !== null && $sourceDbId !== '' && (int) $sourceDbId > 0) {
            $id = (int) $sourceDbId;
        } elseif (is_numeric($sourceId)) {
            $id = (int) $sourceId;
        } elseif ($sourceId !== null && $sourceId !== '') {
            $row = $branchId !== null
                ? $model::where('client_id', $clientId)->where('branch_id', $branchId)->where($codeCol, (string) $sourceId)->first(['id'])
                : null;
            $row = $row ?: $model::where('client_id', $clientId)->where($codeCol, (string) $sourceId)->first(['id']);
            $id = $row ? (int) $row->id : null;
        }
        return $id ? ['key' => $type, 'label' => $label, 'type' => $type, 'id' => $id] : null;
    }
}
