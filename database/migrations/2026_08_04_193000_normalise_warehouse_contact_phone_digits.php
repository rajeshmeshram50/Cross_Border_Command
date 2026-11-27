<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        foreach (DB::table('master_warehouse_master')->get(['id', 'contact_phone']) as $row) {
            $raw = trim((string) $row->contact_phone);
            if ($raw === '') continue;
            if (preg_match('/^[0-9]{7,15}$/', $raw)) continue;

            $digits = preg_replace('/\D/', '', $raw);
            if (!preg_match('/^[0-9]{7,15}$/', (string) $digits)) continue;

            DB::table('master_warehouse_master')->where('id', $row->id)
                ->update(['contact_phone' => $digits]);
        }
    }

    public function down(): void
    {
    }
};
