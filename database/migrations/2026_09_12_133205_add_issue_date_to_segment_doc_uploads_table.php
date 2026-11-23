<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('segment_doc_uploads', function (Blueprint $table) {
            $table->date('issue_date')->nullable()->after('attachment_name');
        });
    }

    public function down(): void
    {
        Schema::table('segment_doc_uploads', function (Blueprint $table) {
            $table->dropColumn('issue_date');
        });
    }
};
