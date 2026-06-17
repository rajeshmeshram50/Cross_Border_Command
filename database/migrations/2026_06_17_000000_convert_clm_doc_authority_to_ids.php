<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Convert the authority reference on the CLM document masters (KYC / DD /
 * Trade-License / QC) from a copied authority NAME to the authority ID.
 *
 * Values are comma-joined (a document can map to several authorities). For each
 * row, each name token is matched (case-insensitively, within the same tenant)
 * against clm_authorities and replaced with that authority's id. Tokens that
 * are already numeric ids, or that don't match any authority, are left as-is so
 * nothing is lost. After this, the name is resolved live on read — so renaming
 * an authority propagates everywhere automatically.
 */
return new class extends Migration
{
    /** table => authority column */
    private array $targets = [
        'clm_kyc_documents'  => 'authority',
        'clm_dd_documents'   => 'authority',
        'clm_trade_licenses' => 'authority',
        'clm_qc_documents'   => 'issued_by',
    ];

    public function up(): void
    {
        // [client_id][lower(name)] => id
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
                    if (ctype_digit($tok)) { $out[] = $tok; continue; } // already an id
                    $id = $byClientName[$r->client_id][mb_strtolower($tok)] ?? null;
                    $out[] = $id !== null ? (string) $id : $tok;        // matched → id; else passthrough
                }

                $new = implode(', ', $out);
                if ($new !== (string) $val) {
                    DB::table($table)->where('id', $r->id)->update([$col => $new]);
                }
            }
        }
    }

    /**
     * Reverse: turn ids back into names (best-effort). Unknown tokens pass
     * through unchanged.
     */
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
