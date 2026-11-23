<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

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

            $taken = DB::table('p2p_spi_boxes')
                ->where('supplier_invoice_id', $row->supplier_invoice_id)
                ->where('box_code', $want)
                ->exists();
            if ($taken) continue;

            DB::table('p2p_spi_boxes')->where('id', $row->id)->update(['box_code' => $want]);
        }
    }
};
