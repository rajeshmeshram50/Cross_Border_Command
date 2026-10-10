<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

/**
 * SPI box codes become B-001 rather than BOX-001.
 *
 * Runs after 000007, which widened the number to three digits, so between them
 * BOX-01 -> BOX-001 -> B-001. Kept as a second migration rather than folded
 * into the first because 000007 is already pushed and may have run elsewhere.
 *
 * Only unprinted boxes are renamed. A printed label is physically on a carton
 * and may already have been scanned at put-away; changing its code would point
 * the floor at a box that no longer answers. Mixed prefixes on one invoice are
 * harmless - the sequence regex in SpiBoxController reads BOX- and B- alike.
 */
return new class extends Migration
{
    public function up(): void
    {
        $this->rewrite('/^BOX-(\d+)$/', fn (string $digits) => 'B-' . $digits);
    }

    public function down(): void
    {
        $this->rewrite('/^B-(\d+)$/', fn (string $digits) => 'BOX-' . $digits);
    }

    /** Rename every unprinted box whose code matches, skipping any collision. */
    private function rewrite(string $pattern, callable $format): void
    {
        $rows = DB::table('p2p_spi_boxes')
            ->whereNull('sticker_printed_at')
            ->orderBy('supplier_invoice_id')
            ->orderBy('id')
            ->get(['id', 'supplier_invoice_id', 'box_code']);

        foreach ($rows as $row) {
            if (!preg_match($pattern, (string) $row->box_code, $m)) continue;

            $want = $format($m[1]);
            if ($want === $row->box_code) continue;

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
