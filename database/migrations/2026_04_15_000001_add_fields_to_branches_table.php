<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->string('district', 100)->nullable()->after('city');
            $table->string('taluka', 100)->nullable()->after('district');

            $table->string('branch_type', 50)->nullable()->after('contact_person');
            $table->string('industry', 100)->nullable()->after('branch_type');
            $table->string('website', 500)->nullable()->after('phone');
            $table->text('description')->nullable()->after('industry');

            $table->string('gst_number', 20)->nullable()->after('description');
            $table->string('pan_number', 20)->nullable()->after('gst_number');
            $table->string('registration_number', 50)->nullable()->after('pan_number');

            $table->string('logo', 500)->nullable()->after('registration_number');

            $table->integer('max_users')->nullable()->default(0)->after('is_main');
            $table->date('established_at')->nullable()->after('max_users');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn([
                'district', 'taluka', 'branch_type', 'industry', 'website',
                'description', 'gst_number', 'pan_number', 'registration_number',
                'logo', 'max_users', 'established_at',
            ]);
        });
    }
};
