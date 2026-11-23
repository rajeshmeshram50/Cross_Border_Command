<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    private array $targets = [
        'clm_kyc_documents'  => 'authority',
        'clm_dd_documents'   => 'authority',
        'clm_trade_licenses' => 'authority',
        'clm_qc_documents'   => 'issued_by',
    ];

    public function up(): void
    {
        $byClientName = [];
        foreach (DB::table('clm_authorities')->get(['id', 'client_id', 'name']) as $a) {
            $byClientName[$a->client_id][mb_strtolower(trim((string) $a->name))] = $a->id;
        }

        foreach ($this->targets as $table => $col) {
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, $col)) continue;

            foreach (DB::table($table)->select('id', 'client_id', $col)->get() as $r) {
                $val = $r->$col;
                if ($val === null || trim((string) $val) === '') continue;

                $out = [];
                foreach (explode(',', (string) $val) as $tok) {
                    $tok = trim($tok);
                    if ($tok === '') continue;
                    if (ctype_digit($tok)) { $out[] = $tok; continue; }
                    $id = $byClientName[$r->client_id][mb_strtolower($tok)] ?? null;
                    $out[] = $id !== null ? (string) $id : $tok;
                }

                $new = implode(', ', $out);
                if ($new !== (string) $val) {
                    DB::table($table)->where('id', $r->id)->update([$col => $new]);
                }
            }
        }
    }

    public function down(): void
    {
        $byId = [];
        foreach (DB::table('clm_authorities')->get(['id', 'name']) as $a) {
            $byId[(string) $a->id] = $a->name;
        }

        foreach ($this->targets as $table => $col) {
            if (!Schema::hasTable($table) || !Schema::hasColumn($table, $col)) continue;

            foreach (DB::table($table)->select('id', $col)->get() as $r) {
                $val = $r->$col;
                if ($val === null || trim((string) $val) === '') continue;

                $out = [];
                foreach (explode(',', (string) $val) as $tok) {
                    $tok = trim($tok);
                    if ($tok === '') continue;
                    $out[] = $byId[$tok] ?? $tok;
                }

                $new = implode(', ', $out);
                if ($new !== (string) $val) {
                    DB::table($table)->where('id', $r->id)->update([$col => $new]);
                }
            }
        }
    }
};
