<?php

namespace App\Services\P2p;

use App\Models\P2p\SpiActivity;
use App\Models\P2p\SpiPoFulfilment;
use App\Models\P2p\SupplierInvoice;
use App\Models\P2p\SupplierInvoiceItem;
use App\Support\TenantContext;
use Carbon\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Rules shared by the SPI endpoints: numbering, how much of a PO line is still
 * uninvoiced, the totals rollup, the packing summary, and the two append-only
 * trails.
 *
 * Six kinds of work live here, and nothing else does:
 *
 *   1. NUMBERING      a code allocated under a lock, so two saves never collide
 *   2. GUARDS         a rule that must hold before a write (open quantity)
 *   3. DERIVED READS  an aggregate more than one screen needs (packed/pending)
 *   4. ROLLUPS        child rows summed onto the parent inside the save
 *   5. WRITE PATHS    the single door to a table nothing else may touch
 *   6. TRAILS         the audit rows that must share the caller's transaction
 *
 * What does NOT live here: HTTP (that is the controller) and anything about a
 * single row (that is the model).
 */
class SupplierInvoiceService
{
    /* ═══════════════ 1 · NUMBERING ═══════════════
       Shared by the form preview and the save, and it takes a row lock. Both
       reasons on their own would justify being here. */

    /** Indian financial year label, e.g. 2026-27 for any date Apr 2026 – Mar 2027. */
    public function financialYear(?Carbon $on = null): string
    {
        $d = $on ?: now();
        $start = $d->month >= 4 ? $d->year : $d->year - 1;

        return $start . '-' . substr((string) ($start + 1), -2);
    }

    /**
     * Next SPI/<FY>/<SEQ>, one sequence PER BRANCH. Call inside a transaction.
     *
     * A new branch therefore starts again at 001, and two branches of the same
     * client each hold their own SPI/2026-27/001 — so every lookup by code must
     * carry the branch, never the client alone.
     *
     * The global scope is lifted and the branch filtered by hand: the scope
     * also lets through rows with a NULL branch_id, which would pull another
     * branch's numbers into this one's sequence. Trashed rows still count —
     * a deleted invoice must not hand its number to the next one.
     */
    public function nextCode(int $clientId, int $branchId): string
    {
        return $this->allocate($clientId, $branchId, true);
    }

    /** What the next invoice WOULD get. Read only — nothing locked or reserved. */
    public function previewCode(int $clientId, int $branchId): string
    {
        return $this->allocate($clientId, $branchId, false);
    }

    private function allocate(int $clientId, int $branchId, bool $lock): string
    {
        $fy = $this->financialYear();

        /* Lock the BRANCH row, not the client: two branches numbering at the
           same moment are independent sequences and must not block each other,
           while two saves within one branch must. */
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


    public function openQtyByPoItem(int $poId, ?int $ignoreSpiId = null): array
    {
        // No deleted_at filter: p2p_purchase_order_items is hard-deleted, it has
        // no such column. Only the SPI side is soft-deleted.
        $ordered = DB::table('p2p_purchase_order_items')
            ->where('purchase_order_id', $poId)
            ->pluck('quantity', 'id');

        $invoiced = DB::table('p2p_supplier_invoice_items as sii')
            ->join('p2p_supplier_invoices as spi', 'spi.id', '=', 'sii.supplier_invoice_id')
            ->whereIn('sii.po_item_id', $ordered->keys())
            ->whereNull('sii.deleted_at')
            ->whereNull('spi.deleted_at')
            ->where('spi.status', '<>', SupplierInvoice::STATUS_CANCELLED)
            // An invoice being edited must not count its own old quantity.
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

    /**
     * The TOTALS row under the packing grid — one object for the whole invoice,
     * summed from the per-line rows the caller already holds. No extra query.
     */
    public function packingTotals(array $summary): array
    {
        $rows = collect($summary);

        return [
            'lines'        => $rows->count(),
            'qty_spi'      => round((float) $rows->sum('qty_spi'), 3),
            'qty_packed'   => round((float) $rows->sum('qty_packed'), 3),
            'qty_pending'  => round((float) $rows->sum('qty_pending'), 3),
            'lines_done'   => $rows->filter(fn ($r) => $r['qty_pending'] <= 0.001)->count(),
            'fully_packed' => $rows->every(fn ($r) => $r['qty_pending'] <= 0.001),
        ];
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
        if ($item->po_item_id === null) return;   // standalone or unmapped: consumes no PO quantity

        $poQty = (float) DB::table('p2p_purchase_order_items')->where('id', $item->po_item_id)->value('quantity');
        $open  = $this->openQtyByPoItem((int) $item->invoice->purchase_order_id)[$item->po_item_id] ?? 0;
        $now   = $event === SpiPoFulfilment::EVENT_CANCELLED ? 0.0 : (float) $item->qty_spi;

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
            'pending_after'            => $open,
            'changed_by'               => TenantContext::active() ? auth()->id() : null,
            'created_at'               => now(),
        ]);
    }


    /**
     * Save the whole Stage 02 grid: items, the ledger, the header totals and
     * the trail — all of it or none of it.
     *
     * DB::transaction() IS the error handling here. Any exception thrown
     * inside rolls every write back. A try/catch would instead leave items
     * saved with no ledger row, which is the one state that corrupts pending
     * quantity silently. Let it throw — the controller turns it into a 422.
     *
     * $rollUp false when the caller posted its own totals: the Stage 02 grid
     * computes them, and recomputing here would overwrite the figures the user
     * actually saw on screen with ours.
     */
    public function saveItems(SupplierInvoice $spi, array $rows, bool $rollUp = true): SupplierInvoice
    {
        return DB::transaction(function () use ($spi, $rows, $rollUp) {
            $before = SupplierInvoiceItem::where('supplier_invoice_id', $spi->id)
                ->pluck('qty_spi', 'id');

            $kept = [];

            foreach ($rows as $i => $row) {
                $item = SupplierInvoiceItem::updateOrCreate(
                    ['supplier_invoice_id' => $spi->id, 'line_no' => $i + 1],
                    $row
                );
                $kept[] = $item->id;

                $previous = $before[$item->id] ?? null;
                $this->syncFulfilment(
                    $item,
                    $previous === null ? SpiPoFulfilment::EVENT_INVOICED : SpiPoFulfilment::EVENT_REVISED,
                    $previous === null ? null : (float) $previous
                );
            }

            /* The grid is sent whole, so a line that is no longer in it was
               deleted on screen. Without this, saving 3 lines and then 1 would
               leave lines 2 and 3 alive, still holding PO quantity that nobody
               can see. Each one gives its quantity back to the order first. */
            $dropped = SupplierInvoiceItem::where('supplier_invoice_id', $spi->id)
                ->whereNotIn('id', $kept ?: [0])->get();

            foreach ($dropped as $item) {
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
