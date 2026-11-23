<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Schema;
use Illuminate\Support\Str;

return new class extends Migration
{
    public function up(): void
    {
        Schema::table('employee_onboarding_invites', function (Blueprint $table) {
            $table->string('slug', 16)->nullable()->unique()->after('token');
        });

        foreach (DB::table('employee_onboarding_invites')->whereNull('slug')->get() as $row) {
            do {
                $slug = Str::random(10);
            } while (DB::table('employee_onboarding_invites')->where('slug', $slug)->exists());
            DB::table('employee_onboarding_invites')->where('id', $row->id)->update(['slug' => $slug]);
        }
    }

    public function down(): void
    {
        Schema::table('employee_onboarding_invites', function (Blueprint $table) {
            $table->dropUnique(['slug']);
            $table->dropColumn('slug');
        });
    }
};
