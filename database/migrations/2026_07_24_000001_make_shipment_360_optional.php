<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    private array $slugs = ['developers', 'developers.ops', 'developers.shipment'];

    public function up(): void
    {
        DB::table('modules')->whereIn('slug', $this->slugs)->update(['is_default' => false]);

        $moduleIds = DB::table('modules')->whereIn('slug', $this->slugs)->pluck('id');
        if ($moduleIds->isNotEmpty()) {
            DB::table('permissions')->whereIn('module_id', $moduleIds)->delete();
        }
    }

    public function down(): void
    {
        DB::table('modules')->whereIn('slug', $this->slugs)->update(['is_default' => true]);
    }
};
