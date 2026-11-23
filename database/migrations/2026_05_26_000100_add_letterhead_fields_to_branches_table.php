<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->string('gst_state_code', 8)->nullable()->after('gst_number');
            $table->string('cin', 32)->nullable()->after('pan_number');
            $table->string('iec', 32)->nullable()->after('cin');
            $table->string('drug_license', 128)->nullable()->after('iec');
            $table->string('pcpndt_no', 64)->nullable()->after('drug_license');
            $table->string('aeo_code', 64)->nullable()->after('pcpndt_no');
            $table->string('one_star_file_no', 64)->nullable()->after('aeo_code');
            $table->string('one_star_udin_no', 64)->nullable()->after('one_star_file_no');
            $table->string('signature_path', 500)->nullable()->after('logo');
        });
    }

    public function down(): void
    {
        Schema::table('branches', function (Blueprint $table) {
            $table->dropColumn([
                'gst_state_code', 'cin', 'iec', 'drug_license', 'pcpndt_no',
                'aeo_code', 'one_star_file_no', 'one_star_udin_no', 'signature_path',
            ]);
        });
    }
};
