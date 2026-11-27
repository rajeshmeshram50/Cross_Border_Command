<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    public function up(): void
    {
        $branches = DB::table('branches')->get(['id', 'city', 'country']);

        foreach ($branches as $branch) {
            $location = implode(', ', array_filter([
                trim((string) $branch->city),
                trim((string) $branch->country),
            ], fn ($v) => $v !== ''));

            DB::table('employees')
                ->where('legal_entity_id', $branch->id)
                ->update(['location' => $location !== '' ? $location : null]);
        }
    }

    public function down(): void
    {
    }
};
