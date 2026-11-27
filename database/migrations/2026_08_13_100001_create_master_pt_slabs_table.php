<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('master_pt_slabs', function (Blueprint $table) {
            $table->id();
            $table->unsignedBigInteger('client_id')->nullable()->index();
            $table->unsignedBigInteger('branch_id')->nullable()->index();
            $table->string('state', 120);
            $table->string('gender', 10)->default('any');
            $table->decimal('min_gross', 12, 2)->default(0);
            $table->decimal('max_gross', 12, 2)->nullable();
            $table->decimal('amount', 10, 2)->default(0);
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

        $add('Maharashtra', 'female', 0, 25000, 0);
        $add('Maharashtra', 'female', 25000.01, null, 200, 300);
        $add('Maharashtra', 'male', 0, 7500, 0);
        $add('Maharashtra', 'male', 7500.01, 10000, 175);
        $add('Maharashtra', 'male', 10000.01, null, 200, 300);

        $add('Karnataka', 'any', 0, 24999.99, 0);
        $add('Karnataka', 'any', 25000, null, 200);

        $add('West Bengal', 'any', 0, 10000, 0);
        $add('West Bengal', 'any', 10000.01, 15000, 110);
        $add('West Bengal', 'any', 15000.01, 25000, 130);
        $add('West Bengal', 'any', 25000.01, 40000, 150);
        $add('West Bengal', 'any', 40000.01, null, 200);

        $add('Tamil Nadu', 'any', 0, 21000, 0);
        $add('Tamil Nadu', 'any', 21000.01, 30000, 135);
        $add('Tamil Nadu', 'any', 30000.01, 45000, 315);
        $add('Tamil Nadu', 'any', 45000.01, 60000, 690);
        $add('Tamil Nadu', 'any', 60000.01, 75000, 1025);
        $add('Tamil Nadu', 'any', 75000.01, null, 1250);

        $add('Gujarat', 'any', 0, 12000, 0);
        $add('Gujarat', 'any', 12000.01, null, 200);

        foreach (['Andhra Pradesh', 'Telangana'] as $s) {
            $add($s, 'any', 0, 15000, 0);
            $add($s, 'any', 15000.01, 20000, 150);
            $add($s, 'any', 20000.01, null, 200);
        }

        $add('Madhya Pradesh', 'any', 0, 18750, 0);
        $add('Madhya Pradesh', 'any', 18750.01, 25000, 125);
        $add('Madhya Pradesh', 'any', 25000.01, 33333, 167);
        $add('Madhya Pradesh', 'any', 33333.01, null, 208, 212);

        $add('Odisha', 'any', 0, 13304, 0);
        $add('Odisha', 'any', 13304.01, 25000, 125);
        $add('Odisha', 'any', 25000.01, null, 200, 300);

        $add('Assam', 'any', 0, 10000, 0);
        $add('Assam', 'any', 10000.01, 15000, 150);
        $add('Assam', 'any', 15000.01, 25000, 180);
        $add('Assam', 'any', 25000.01, null, 208);

        $add('Kerala', 'any', 0, 1999, 0);
        $add('Kerala', 'any', 1999.01, 2999, 20);
        $add('Kerala', 'any', 2999.01, 4999, 30);
        $add('Kerala', 'any', 4999.01, 7499, 50);
        $add('Kerala', 'any', 7499.01, 9999, 75);
        $add('Kerala', 'any', 9999.01, 12499, 100);
        $add('Kerala', 'any', 12499.01, 16666, 125);
        $add('Kerala', 'any', 16666.01, 20833, 166);
        $add('Kerala', 'any', 20833.01, null, 208);

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
