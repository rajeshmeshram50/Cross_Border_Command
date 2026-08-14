<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Rule 9 — state-wise Professional Tax slabs.
 *
 * Until now the PT slab was hardcoded Maharashtra inside PayrollService, so an
 * employee working out of a Bengaluru or Kolkata office was taxed on the wrong
 * table and the tenant's `state_id` was read by nothing. This makes the slab a
 * master: one row per (state, gender band, gross band), seeded globally
 * (client_id NULL) so every tenant inherits the statutory tables, and
 * overridable per client/branch exactly like master_overtime_rates.
 *
 * Matching is by state NAME, lower-cased. The tenant's master_states rows,
 * branches.state and employees' addresses all carry the state as free text at
 * different times, and a name match works across all three without forcing a
 * backfill of IDs that do not exist in every tenant.
 *
 * `amount` is the monthly deduction for the band; `feb_amount`, when set, is
 * charged in February instead — that is how Maharashtra collects the ₹300
 * top-up that brings the annual total to the ₹2,500 statutory cap.
 *
 * A state that levies NO professional tax gets an explicit 0-amount row rather
 * than no rows at all. The distinction matters: "seeded, and the answer is
 * zero" is silent, while "no slab on file" raises a warning and falls back to
 * Maharashtra, which is what should happen for a state nobody has configured.
 */
return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_pt_slabs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('state', 120);
            // 'any' | 'male' | 'female' — most states do not split by gender.
            $table->string('gender', 10)->default('any');
            $table->decimal('min_gross', 12, 2)->default(0);
            // NULL = no upper bound (the top band).
            $table->decimal('max_gross', 12, 2)->nullable();
            $table->decimal('amount', 10, 2)->default(0);
            // Charged in February in place of `amount` when set (MH top-up).
            $table->decimal('feb_amount', 10, 2)->nullable();
            $table->string('status', 20)->default('Active');
            $table->unsignedBigInteger('created_by')->nullable();
            $table->timestamps();

            $table->index(['state', 'gender']);
        });

        DB::table('master_pt_slabs')->insert($this->seedRows());
    }

    public function down(): void
    {
        Schema::dropIfExists('master_pt_slabs');
    }

    /**
     * Statutory monthly PT tables as at FY 2025-26. Bands are on monthly gross
     * and are inclusive of `min_gross`, exclusive of nothing — `max_gross` is
     * the last rupee still in the band.
     */
    private function seedRows(): array
    {
        $now = now();
        $rows = [];

        $add = function (string $state, string $gender, float $min, ?float $max, float $amount, ?float $feb = null)
            use (&$rows, $now) {
            $rows[] = [
                'client_id'  => null,
                'branch_id'  => null,
                'state'      => $state,
                'gender'     => $gender,
                'min_gross'  => $min,
                'max_gross'  => $max,
                'amount'     => $amount,
                'feb_amount' => $feb,
                'status'     => 'Active',
                'created_by' => null,
                'created_at' => $now,
                'updated_at' => $now,
            ];
        };

        // ── Maharashtra — the legacy hardcoded table, preserved exactly ──────
        // Women are exempt to ₹25,000; men pay ₹175 from ₹7,501 and ₹200 above
        // ₹10,000, with the February ₹300 top-up capping the year at ₹2,500.
        $add('Maharashtra', 'female', 0, 25000, 0);
        $add('Maharashtra', 'female', 25000.01, null, 200, 300);
        $add('Maharashtra', 'male', 0, 7500, 0);
        $add('Maharashtra', 'male', 7500.01, 10000, 175);
        $add('Maharashtra', 'male', 10000.01, null, 200, 300);

        // ── Karnataka — ₹200 above ₹25,000, nil below ───────────────────────
        $add('Karnataka', 'any', 0, 24999.99, 0);
        $add('Karnataka', 'any', 25000, null, 200);

        // ── West Bengal ─────────────────────────────────────────────────────
        $add('West Bengal', 'any', 0, 10000, 0);
        $add('West Bengal', 'any', 10000.01, 15000, 110);
        $add('West Bengal', 'any', 15000.01, 25000, 130);
        $add('West Bengal', 'any', 25000.01, 40000, 150);
        $add('West Bengal', 'any', 40000.01, null, 200);

        // ── Tamil Nadu (Greater Chennai half-yearly table, per month) ────────
        $add('Tamil Nadu', 'any', 0, 21000, 0);
        $add('Tamil Nadu', 'any', 21000.01, 30000, 135);
        $add('Tamil Nadu', 'any', 30000.01, 45000, 315);
        $add('Tamil Nadu', 'any', 45000.01, 60000, 690);
        $add('Tamil Nadu', 'any', 60000.01, 75000, 1025);
        $add('Tamil Nadu', 'any', 75000.01, null, 1250);

        // ── Gujarat — nil to ₹12,000, ₹200 above ────────────────────────────
        $add('Gujarat', 'any', 0, 12000, 0);
        $add('Gujarat', 'any', 12000.01, null, 200);

        // ── Andhra Pradesh & Telangana (identical tables) ────────────────────
        foreach (['Andhra Pradesh', 'Telangana'] as $s) {
            $add($s, 'any', 0, 15000, 0);
            $add($s, 'any', 15000.01, 20000, 150);
            $add($s, 'any', 20000.01, null, 200);
        }

        // ── Madhya Pradesh ──────────────────────────────────────────────────
        $add('Madhya Pradesh', 'any', 0, 18750, 0);
        $add('Madhya Pradesh', 'any', 18750.01, 25000, 125);
        $add('Madhya Pradesh', 'any', 25000.01, 33333, 167);
        $add('Madhya Pradesh', 'any', 33333.01, null, 208, 212);

        // ── Odisha ──────────────────────────────────────────────────────────
        $add('Odisha', 'any', 0, 13304, 0);
        $add('Odisha', 'any', 13304.01, 25000, 125);
        $add('Odisha', 'any', 25000.01, null, 200, 300);

        // ── Assam ───────────────────────────────────────────────────────────
        $add('Assam', 'any', 0, 10000, 0);
        $add('Assam', 'any', 10000.01, 15000, 150);
        $add('Assam', 'any', 15000.01, 25000, 180);
        $add('Assam', 'any', 25000.01, null, 208);

        // ── Kerala (half-yearly statute, expressed per month) ────────────────
        $add('Kerala', 'any', 0, 1999, 0);
        $add('Kerala', 'any', 1999.01, 2999, 20);
        $add('Kerala', 'any', 2999.01, 4999, 30);
        $add('Kerala', 'any', 4999.01, 7499, 50);
        $add('Kerala', 'any', 7499.01, 9999, 75);
        $add('Kerala', 'any', 9999.01, 12499, 100);
        $add('Kerala', 'any', 12499.01, 16666, 125);
        $add('Kerala', 'any', 16666.01, 20833, 166);
        $add('Kerala', 'any', 20833.01, null, 208);

        // ── Bihar / Jharkhand / Chhattisgarh ────────────────────────────────
        $add('Bihar', 'any', 0, 25000, 0);
        $add('Bihar', 'any', 25000.01, 41666, 83.33);
        $add('Bihar', 'any', 41666.01, 83333, 166.67);
        $add('Bihar', 'any', 83333.01, null, 208.33);

        $add('Jharkhand', 'any', 0, 25000, 0);
        $add('Jharkhand', 'any', 25000.01, 41666, 100);
        $add('Jharkhand', 'any', 41666.01, 66666, 150);
        $add('Jharkhand', 'any', 66666.01, 83333, 175);
        $add('Jharkhand', 'any', 83333.01, null, 208, 212);

        $add('Chhattisgarh', 'any', 0, 40000, 0);
        $add('Chhattisgarh', 'any', 40000.01, 50000, 130);
        $add('Chhattisgarh', 'any', 50000.01, 66666, 150);
        $add('Chhattisgarh', 'any', 66666.01, 83333, 190);
        $add('Chhattisgarh', 'any', 83333.01, null, 200);

        // ── Meghalaya / Tripura / Sikkim / Nagaland / Puducherry ────────────
        $add('Meghalaya', 'any', 0, 4166, 0);
        $add('Meghalaya', 'any', 4166.01, 8333, 16.50);
        $add('Meghalaya', 'any', 8333.01, 12500, 25);
        $add('Meghalaya', 'any', 12500.01, 16666, 41.50);
        $add('Meghalaya', 'any', 16666.01, 20833, 62.50);
        $add('Meghalaya', 'any', 20833.01, 25000, 83.33);
        $add('Meghalaya', 'any', 25000.01, 29166, 104.16);
        $add('Meghalaya', 'any', 29166.01, 33333, 125);
        $add('Meghalaya', 'any', 33333.01, 37500, 150);
        $add('Meghalaya', 'any', 37500.01, 41666, 175);
        $add('Meghalaya', 'any', 41666.01, null, 208);

        $add('Tripura', 'any', 0, 7500, 0);
        $add('Tripura', 'any', 7500.01, 15000, 150);
        $add('Tripura', 'any', 15000.01, 25000, 180);
        $add('Tripura', 'any', 25000.01, null, 208);

        $add('Sikkim', 'any', 0, 20000, 0);
        $add('Sikkim', 'any', 20000.01, 30000, 125);
        $add('Sikkim', 'any', 30000.01, 40000, 150);
        $add('Sikkim', 'any', 40000.01, null, 200);

        $add('Nagaland', 'any', 0, 4000, 0);
        $add('Nagaland', 'any', 4000.01, 5000, 35);
        $add('Nagaland', 'any', 5000.01, 7000, 75);
        $add('Nagaland', 'any', 7000.01, 9000, 110);
        $add('Nagaland', 'any', 9000.01, 12000, 180);
        $add('Nagaland', 'any', 12000.01, null, 208);

        $add('Puducherry', 'any', 0, 16666, 0);
        $add('Puducherry', 'any', 16666.01, 33333, 41.66);
        $add('Puducherry', 'any', 33333.01, 50000, 83.33);
        $add('Puducherry', 'any', 50000.01, 66666, 125);
        $add('Puducherry', 'any', 66666.01, 83333, 166.66);
        $add('Puducherry', 'any', 83333.01, null, 208.33);

        // ── States and UTs that levy NO professional tax ─────────────────────
        // Seeded explicitly at ₹0 so payroll answers "nil, by statute" instead
        // of "unconfigured" and silently billing the Maharashtra table.
        foreach ([
            'Delhi', 'Haryana', 'Punjab', 'Rajasthan', 'Uttar Pradesh',
            'Uttarakhand', 'Himachal Pradesh', 'Jammu and Kashmir', 'Ladakh',
            'Goa', 'Chandigarh', 'Arunachal Pradesh', 'Manipur', 'Mizoram',
            'Andaman and Nicobar Islands', 'Lakshadweep',
            'Dadra and Nagar Haveli and Daman and Diu',
        ] as $s) {
            $add($s, 'any', 0, null, 0);
        }

        return $rows;
    }
};
