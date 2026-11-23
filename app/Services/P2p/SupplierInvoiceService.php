<?php

namespace App\Services\P2p;

use App\Models\P2p\SpiActivity;
use App\Models\P2p\SpiPoFulfilment;
use App\Models\P2p\SupplierInvoice;
use App\Models\P2p\SupplierInvoiceItem;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

class SupplierInvoiceService
{
    public function financialYear(?Carbon $on = null): string
    {
        $d = $on ?: now();
        $start = $d->month >= 4 ? $d->year : $d->year - 1;

        return $start . '-' . substr((string) ($start + 1), -2);
    }

    public function nextCode(int $clientId, int $branchId): string
    {
        return $this->allocate($clientId, $branchId, true);
    }

    public function previewCode(int $clientId, int $branchId): string
    {
        return $this->allocate($clientId, $branchId, false);
    }

    private function allocate(int $clientId, int $branchId, bool $lock): string
    {
        $fy = $this->financialYear();

        if ($lock) {
            DB::table('branches')->where('id', $branchId)->lockForUpdate()->first();
        }

        $max = 0;
        $codes = SupplierInvoice::withoutGlobalScope('tenant')->withTrashed()
            ->where('client_id', $clientId)
            ->where('branch_id', $branchId)
            ->where('code', 'like', "SPI/{$fy}/%")
            ->pluck('code');

        foreach ($codes as $code) {
            if (preg_match('#^SPI/' . preg_quote($fy, '#') . '/(\d+)$#', (string) $code, $m)) {
                $max = max($max, (int) $m[1]);
            }
        }

        return sprintf('SPI/%s/%03d', $fy, $max + 1);
    }

    public function splitBalance(float $balance): array
    {
        return [
            'open'   => max(0.0, round($balance, 3)),
            'over'   => max(0.0, round(-$balance, 3)),
            'closed' => $balance <= 0,
        ];
    }

    public function openQtyByPoItem(int $poId, ?int $ignoreSpiId = null): array
    {
        $ordered = DB::table('p2p_purchase_order_items')
            ->where('purchase_order_id', $poId)
            ->pluck('quantity', 'id');

        $invoiced = DB::table('p2p_supplier_invoice_items as sii')
            ->join('p2p_supplier_invoices as spi', 'spi.id', '=', 'sii.supplier_invoice_id')
            ->whereIn('sii.po_item_id', $ordered->keys())
            ->whereNull('sii.deleted_at')
            ->whereNull('spi.deleted_at')
            ->where('spi.status', '<>', SupplierInvoice::STATUS_CANCELLED)
            ->when($ignoreSpiId, fn($q) => $q->where('sii.supplier_invoice_id', '<>', $ignoreSpiId))
            ->groupBy('sii.po_item_id')
            ->selectRaw('sii.po_item_id, SUM(sii.qty_spi) AS billed')
            ->pluck('billed', 'po_item_id');

        return $ordered
            ->map(fn($qty, $id) => round((float) $qty - (float) ($invoiced[$id] ?? 0), 3))
            ->all();
    }

    public function packingSummary(int $spiId): array
    {
        $items = SupplierInvoiceItem::where('supplier_invoice_id', $spiId)->get();

        $packed = DB::table('p2p_spi_box_items')
            ->whereIn('supplier_invoice_item_id', $items->pluck('id'))
            ->whereNull('deleted_at')
            ->groupBy('supplier_invoice_item_id')
            ->selectRaw('supplier_invoice_item_id, SUM(quantity) AS packed')
            ->pluck('packed', 'supplier_invoice_item_id');

        return $items->map(function ($i) use ($packed) {
            $done = (float) ($packed[$i->id] ?? 0);

            return [
                'supplier_invoice_item_id' => $i->id,
                'qty_spi'     => (float) $i->qty_spi,
                'qty_packed'  => $done,
                'qty_pending' => round((float) $i->qty_spi - $done, 3),
            ];
        })->all();
    }

    public function packingTotals(array $summary): array
    {
        $rows = collect($summary);

        return [
            'lines'        => $rows->count(),
            'qty_spi'      => round((float) $rows->sum('qty_spi'), 3),
            'qty_packed'   => round((float) $rows->sum('qty_packed'), 3),
            'qty_pending'  => round((float) $rows->sum('qty_pending'), 3),
            'lines_done'   => $rows->filter(fn($r) => $r['qty_pending'] <= 0.001)->count(),
            'fully_packed' => $rows->every(fn($r) => $r['qty_pending'] <= 0.001),
        ];
    }

    public function normaliseBoxScenarios(SupplierInvoice $spi): void
    {
        $rows = DB::table('p2p_spi_boxes as b')
            ->join('p2p_spi_box_items as bi', 'bi.box_id', '=', 'b.id')
            ->join('p2p_supplier_invoice_items as i', 'i.id', '=', 'bi.supplier_invoice_item_id')
            ->where('b.supplier_invoice_id', $spi->id)
            ->whereIn('b.scenario', ['s1', 's2'])
            ->whereNull('b.deleted_at')->whereNull('bi.deleted_at')
            ->get(['b.id', 'b.box_code', 'b.scenario', 'bi.supplier_invoice_item_id', 'bi.quantity', 'i.qty_spi']);

        foreach ($rows->groupBy('supplier_invoice_item_id') as $itemId => $group) {
            $only = $group->first();
            if (
                $group->count() !== 1 || $only->scenario !== 's2'
                || abs((float) $only->quantity - (float) $only->qty_spi) >= 0.0005
            ) {
                continue;
            }
            DB::table('p2p_spi_boxes')->where('id', $only->id)->update(['scenario' => 's1', 'updated_at' => now()]);
            $this->log($spi, 'box_scenario_changed', [
                'client_id' => $spi->client_id,
                'branch_id' => $spi->branch_id,
                'box_id' => $only->id,
                'supplier_invoice_item_id' => $itemId,
                'stage' => 3,
                'field' => 'scenario',
                'old_value' => 's2',
                'new_value' => 's1',
                'note' => "{$only->box_code}: s2 → s1",
            ]);
        }
    }

    public function syncPackingStage(SupplierInvoice $spi): int
    {
        $current = (int) $spi->stage_completed;
        if ($current < 2 || $current > 3) return $current;

        $rows = $this->packingSummary($spi->id);
        $packed = $rows && $this->packingTotals($rows)['fully_packed'];
        $target = $packed ? 3 : 2;

        if ($target !== $current) {
            $spi->forceFill(['stage_completed' => $target])->save();
        }

        return $target;
    }

    public function rollupTotals(SupplierInvoice $spi): void
    {
        $t = SupplierInvoiceItem::where('supplier_invoice_id', $spi->id)
            ->selectRaw('COALESCE(SUM(taxable_amount),0) taxable, COALESCE(SUM(cgst_amount),0) cgst,
                         COALESCE(SUM(sgst_amount),0) sgst, COALESCE(SUM(igst_amount),0) igst,
                         COALESCE(SUM(line_total),0) total')
            ->first();

        $spi->forceFill([
            'taxable_total' => $t->taxable,
            'total_cgst'    => $t->cgst,
            'total_sgst'    => $t->sgst,
            'total_igst'    => $t->igst,
            'grand_total'   => $t->total,
        ])->save();
    }

    public function syncFulfilment(SupplierInvoiceItem $item, string $event, ?float $previous = null): void
    {
        if ($item->po_item_id === null) return;

        $poQty = (float) DB::table('p2p_purchase_order_items')->where('id', $item->po_item_id)->value('quantity');
        $now   = $event === SpiPoFulfilment::EVENT_CANCELLED ? 0.0 : (float) $item->qty_spi;

        $balance = $this->openQtyByPoItem((int) $item->invoice->purchase_order_id)[$item->po_item_id] ?? 0;

        SpiPoFulfilment::create([
            'purchase_order_id'        => $item->invoice->purchase_order_id,
            'purchase_order_item_id'   => $item->po_item_id,
            'product_id'               => $item->product_id,
            'supplier_invoice_id'      => $item->supplier_invoice_id,
            'supplier_invoice_item_id' => $item->id,
            'event'                    => $event,
            'po_qty'                   => $poQty,
            'previous_qty'             => $previous,
            'current_qty'              => $now,
            'change_qty'               => round($now - (float) ($previous ?? 0), 3),
            'pending_after'            => $balance,
            'changed_by'               => TenantContext::active() ? auth()->id() : null,
            'created_at'               => now(),
        ]);
    }

    public function saveItems(SupplierInvoice $spi, array $rows, bool $rollUp = true): SupplierInvoice
    {
        return DB::transaction(function () use ($spi, $rows, $rollUp) {
            $before = SupplierInvoiceItem::where('supplier_invoice_id', $spi->id)
                ->pluck('qty_spi', 'id');

            $existing = SupplierInvoiceItem::where('supplier_invoice_id', $spi->id)->get();
            $byId     = $existing->keyBy('id');
            $byLine   = $existing->keyBy('line_no');
            $named    = collect($rows)->contains(fn($r) => !empty($r['id']));

            $packed = collect($this->packingSummary($spi->id))
                ->pluck('qty_packed', 'supplier_invoice_item_id')
                ->filter(fn($q) => $q > 0.0005);
            $refuse = fn(string $message) => abort(response()->json([
                'status' => false,
                'message' => $message,
                'errors' => ['items' => [$message]],
            ], 422));
            $products = DB::table('products')->whereIn('id', $existing->pluck('product_id'))
                ->get(['id', 'product_code', 'name'])->keyBy('id');
            $nameOf = function (SupplierInvoiceItem $i) use ($products) {
                $p = $products[$i->product_id] ?? null;
                return $p ? trim(($p->product_code ? "{$p->product_code} — " : '') . $p->name) : "Line {$i->line_no}";
            };

            $kept = [];

            foreach ($rows as $i => $row) {
                $id = $row['id'] ?? null;
                unset($row['id']);
                $row['line_no'] = $i + 1;

                $item = null;
                if ($id && $byId->has($id)) {
                    $item = $byId[$id];
                } elseif (!$id && !$named && $byLine->has($i + 1)) {
                    $item = $byLine[$i + 1];
                }
                if ($item && in_array($item->id, $kept, true)) $item = null;

                if ($item && isset($packed[$item->id])) {
                    $boxed = round((float) $packed[$item->id], 3);
                    if ((int) $row['product_id'] !== (int) $item->product_id) {
                        $refuse("{$nameOf($item)} is already packed in boxes on Stage 03 — its product cannot be changed.");
                    }
                    if ((float) $row['qty_spi'] < $boxed - 0.0005) {
                        $refuse("{$nameOf($item)} has {$boxed} already packed in boxes on Stage 03 — the quantity can be increased but not reduced below {$boxed}.");
                    }
                }

                if ($item) {
                    $item->fill($row)->save();
                } else {
                    $item = SupplierInvoiceItem::create($row + ['supplier_invoice_id' => $spi->id]);
                }

                $kept[] = $item->id;

                $previous = $before[$item->id] ?? null;
                $this->syncFulfilment(
                    $item,
                    $previous === null ? SpiPoFulfilment::EVENT_INVOICED : SpiPoFulfilment::EVENT_REVISED,
                    $previous === null ? null : (float) $previous
                );
            }

            $dropped = SupplierInvoiceItem::where('supplier_invoice_id', $spi->id)
                ->whereNotIn('id', $kept ?: [0])->get();

            foreach ($dropped as $item) {
                if (isset($packed[$item->id])) {
                    $refuse("{$nameOf($item)} is already packed in boxes on Stage 03 — it cannot be removed from the invoice.");
                }
                $this->syncFulfilment($item, SpiPoFulfilment::EVENT_CANCELLED, (float) $item->qty_spi);
                $this->log($spi, 'item_removed', [
                    'supplier_invoice_item_id' => $item->id,
                    'old_value' => $item->description,
                    'quantity'  => $item->qty_spi,
                    'stage'     => 2,
                ]);
                $item->delete();
            }

            if ($rollUp) $this->rollupTotals($spi);
            $this->log($spi, 'item_updated');

            return $spi->refresh();
        });
    }

    public function log(SupplierInvoice $spi, string $event, array $extra = []): void
    {
        SpiActivity::create($extra + [
            'supplier_invoice_id' => $spi->id,
            'event'               => $event,
            'stage'               => $spi->stage_completed,
            'performed_by'        => auth()->id(),
            'performed_at'        => now(),
        ]);
    }
}
