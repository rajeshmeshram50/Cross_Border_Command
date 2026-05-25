<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

/**
 * Letterhead / compliance fields for the Branch (issuing entity on the
 * Sales Matrix → Quotation / Proforma Invoice PDFs).
 *
 * The PDF header pulls these values per branch so each branch can
 * render its own letterhead — GST state code, CIN, IEC, drug license,
 * PCPNDT, AEO code, One-Star Export House file/UDIN — plus a signature
 * image used by the "with signature" PDF variant.
 *
 * All columns are nullable so existing branches keep working; admins
 * fill them in via the Branch settings form.
 */
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
            // One-Star Export House registration (DGFT)
            $table->string('one_star_file_no', 64)->nullable()->after('aeo_code');
            $table->string('one_star_udin_no', 64)->nullable()->after('one_star_file_no');
            // Authorised signatory image rendered on "with signature" PDFs.
            // Stored as a public-disk relative path (same pattern as `logo`).
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
