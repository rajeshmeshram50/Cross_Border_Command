<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * SPI box codes become BOX-001 rather than BOX-01.
 *
 * A box code is issued once and never reused — deleting BOX-003 leaves a
 * permanent gap, because that label was printed, stuck on a carton and may
 * already have been scanned at put-away. The sequence is therefore the highest
 * number ever issued, not the live count, so an invoice that packs and repacks
 * passes 99 long before it holds 99 cartons. Two digits is too narrow.
 *
 * Only unprinted boxes are renamed. A printed one is physically on a carton:
 * changing its code would point the floor at a box that no longer answers.
 * Mixed widths on one invoice are harmless — the sequence regex reads both.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->rewrite('/^BOX-(\d{1,2})$/', fn (int $n) => sprintf('BOX-%03d', $n));
    }

    public function down(): void
    {
        // Only the ones that fit back into two digits; BOX-100 has no old form.
        $this->rewrite('/^BOX-(\d{3})$/', function (int $n) {
            return $n <= 99 ? sprintf('BOX-%02d', $n) : null;
        });
    }

    /**
     * Rename every unprinted box whose code matches, one invoice at a time so a
     * collision inside an invoice can be skipped rather than aborting the run.
     */
    private function rewrite(string $pattern, callable $format): void
    {
        $rows = DB::table('p2p_spi_boxes')
            ->whereNull('sticker_printed_at')
            ->orderBy('supplier_invoice_id')
            ->orderBy('id')
            ->get(['id', 'supplier_invoice_id', 'box_code']);

        foreach ($rows as $row) {
            if (!preg_match($pattern, (string) $row->box_code, $m)) continue;

            $want = $format((int) $m[1]);
            if ($want === null || $want === $row->box_code) continue;

            // The unique index covers soft-deleted rows, so the target has to
            // be free among ALL of this invoice's boxes, not just the live ones.
            $taken = DB::table('p2p_spi_boxes')
                ->where('supplier_invoice_id', $row->supplier_invoice_id)
                ->where('box_code', $want)
                ->exists();
            if ($taken) continue;

            DB::table('p2p_spi_boxes')->where('id', $row->id)->update(['box_code' => $want]);
        }
    }
};
