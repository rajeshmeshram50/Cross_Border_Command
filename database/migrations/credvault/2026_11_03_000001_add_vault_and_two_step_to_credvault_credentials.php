<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Normal and Critical Vault in one table.
 *
 *   vault            normal (CRD-0001 …) | critical (CCRD-0001 …) — each its own code series
 *   twofa_method     critical vault only: google (authenticator app) | email (a code sent by mail)
 *   twofa_email      the inbox the email codes go to
 *   twofa_linked_at  when the 2-step method was verified — set for either method
 *
 * In the Normal Vault 2-step is only recorded (twofa yes/no); it adds no unlock
 * step. Existing rows: risk critical → critical vault, recoded CCRD-; normal rows
 * lose any authenticator lock they had.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::table('credvault_credentials', function (Blueprint $t) {
            if (!Schema::hasColumn('credvault_credentials', 'vault')) {
                $t->string('vault', 10)->default('normal')->after('code');
            }
            if (!Schema::hasColumn('credvault_credentials', 'twofa_method')) {
                $t->string('twofa_method', 10)->nullable()->after('twofa');
                $t->string('twofa_email', 191)->nullable()->after('twofa_method');
                $t->timestamp('twofa_linked_at')->nullable()->after('totp_linked_at');
            }
        });

        Schema::table('credvault_credentials', function (Blueprint $t) {
            $t->index(['client_id', 'vault']);
        });

        DB::table('credvault_credentials')->where('risk', 'critical')->update(['vault' => 'critical']);
        DB::table('credvault_credentials')->where('vault', 'critical')->where('lock_otp', true)->whereNotNull('totp_linked_at')
            ->update(['twofa_method' => 'google', 'twofa_linked_at' => DB::raw('totp_linked_at')]);
        DB::table('credvault_credentials')->where('vault', 'normal')
            ->update(['lock_admin' => false, 'lock_manager' => false, 'lock_otp' => false, 'totp_secret' => null, 'totp_linked_at' => null]);

        // Critical rows take their own series, in the order they were added.
        foreach (DB::table('credvault_credentials')->where('vault', 'critical')->where('code', 'not like', 'CCRD-%')
                     ->orderBy('client_id')->orderBy('id')->get(['id', 'client_id']) as $row) {
            $last = DB::table('credvault_credentials')->where('client_id', $row->client_id)->where('code', 'like', 'CCRD-%')
                ->orderByDesc('code')->value('code');
            $code = sprintf('CCRD-%04d', ($last ? (int) substr($last, 5) : 0) + 1);
            DB::table('credvault_credentials')->where('id', $row->id)->update(['code' => $code]);
            DB::table('credvault_audit_logs')->where('credential_id', $row->id)->update(['credential_code' => $code]);
        }

        if (DB::getDriverName() === 'pgsql') {
            DB::statement("alter table credvault_credentials add constraint credvault_cred_vault_check check (vault in ('normal','critical'))");
            DB::statement("alter table credvault_credentials add constraint credvault_cred_twofa_method_check check (twofa_method is null or twofa_method in ('google','email'))");
            // A critical-vault row is always critical risk; a normal one never is.
            DB::statement("alter table credvault_credentials add constraint credvault_cred_vault_risk_check check ((vault = 'critical') = (risk = 'critical'))");
        }
    }

    public function down(): void
    {
        if (DB::getDriverName() === 'pgsql') {
            foreach (['credvault_cred_vault_check', 'credvault_cred_twofa_method_check', 'credvault_cred_vault_risk_check'] as $c) {
                DB::statement("alter table credvault_credentials drop constraint if exists {$c}");
            }
        }
        Schema::table('credvault_credentials', function (Blueprint $t) {
            $t->dropIndex(['client_id', 'vault']);
            $t->dropColumn(['vault', 'twofa_method', 'twofa_email', 'twofa_linked_at']);
        });
    }
};
