<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;

/**
 * Brings master_leave_types in line with the Keka-style "Add Leave Type"
 * modal: adds the Compoff category, classify-as-sick toggle, description,
 * paid/unpaid flag and gender restriction. The original enum() helper
 * compiled to a CHECK on Postgres; we widen it via raw SQL so existing
 * rows keep working while Compoff becomes a valid value.
 */
return new class extends Migration {
    public function up(): void
    {
        Schema::table('master_leave_types', function (Blueprint $table) {
            $table->text('description')->nullable()->after('name');
            $table->boolean('is_sick_medical')->default(false)->after('short_code');
            $table->enum('paid_unpaid', ['Paid', 'Unpaid'])->nullable()->after('is_sick_medical');
            $table->enum('gender_restriction', ['None', 'Male', 'Female'])->default('None')->after('paid_unpaid');
        });

        $driver = DB::getDriverName();
        if ($driver === 'pgsql') {
            DB::statement('ALTER TABLE master_leave_types DROP CONSTRAINT IF EXISTS master_leave_types_type_check');
            DB::statement(
                "ALTER TABLE master_leave_types ADD CONSTRAINT master_leave_types_type_check "
                . "CHECK (type IS NULL OR type IN ('Regular', 'Incident Based Leave', 'Unpaid Leave', 'Compoff'))"
            );
        } elseif ($driver === 'mysql') {
            DB::statement(
                "ALTER TABLE master_leave_types MODIFY type "
                . "ENUM('Regular','Incident Based Leave','Unpaid Leave','Compoff') NULL"
            );
        }
    }

    public function down(): void
    {
        $driver = DB::getDriverName();
        if ($driver === 'pgsql') {
            DB::statement("UPDATE master_leave_types SET type = 'Regular' WHERE type = 'Compoff'");
            DB::statement('ALTER TABLE master_leave_types DROP CONSTRAINT IF EXISTS master_leave_types_type_check');
            DB::statement(
                "ALTER TABLE master_leave_types ADD CONSTRAINT master_leave_types_type_check "
                . "CHECK (type IS NULL OR type IN ('Regular', 'Incident Based Leave', 'Unpaid Leave'))"
            );
        } elseif ($driver === 'mysql') {
            DB::statement("UPDATE master_leave_types SET type = 'Regular' WHERE type = 'Compoff'");
            DB::statement(
                "ALTER TABLE master_leave_types MODIFY type "
                . "ENUM('Regular','Incident Based Leave','Unpaid Leave') NULL"
            );
        }

        Schema::table('master_leave_types', function (Blueprint $table) {
            $table->dropColumn(['description', 'is_sick_medical', 'paid_unpaid', 'gender_restriction']);
        });
    }
};
