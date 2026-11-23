<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private function norm(?string $name): string
    {
        $n = mb_strtolower(trim((string) $name));
        $n = preg_replace('/\s*\/\s*/', '/', $n);
        return preg_replace('/\s+/', ' ', $n);
    }

    public function up(): void
    {
        $canonical = [];
        foreach (DB::table('master_vendor_types')->whereNull('client_id')->where('is_system', true)->get(['id', 'name']) as $g) {
            $canonical[$this->norm($g->name)] = (int) $g->id;
        }
        if (empty($canonical)) return;

        $dupes = DB::table('master_vendor_types')->whereNotNull('client_id')->get(['id', 'client_id', 'name']);

        foreach ($dupes as $row) {
            $globalId = $canonical[$this->norm($row->name)] ?? null;
            if (!$globalId) continue;

            DB::table('vendors')
                ->where('vendor_type_id', $row->id)
                ->update(['vendor_type_id' => $globalId, 'updated_at' => now()]);

            DB::table('master_vendor_types')
                ->where('id', $row->id)
                ->update(['status' => 'Inactive', 'updated_at' => now()]);
        }
    }

    public function down(): void
    {
        $canonical = [];
        foreach (DB::table('master_vendor_types')->whereNull('client_id')->where('is_system', true)->get(['id', 'name']) as $g) {
            $canonical[$this->norm($g->name)] = (int) $g->id;
        }

        foreach (DB::table('master_vendor_types')->whereNotNull('client_id')->where('status', 'Inactive')->get(['id', 'name']) as $row) {
            if (isset($canonical[$this->norm($row->name)])) {
                DB::table('master_vendor_types')->where('id', $row->id)
                    ->update(['status' => 'Active', 'updated_at' => now()]);
            }
        }
    }
};
