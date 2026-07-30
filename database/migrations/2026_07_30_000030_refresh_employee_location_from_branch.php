<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Support\Facades\DB;

return new class extends Migration
{
    /**
     * Refresh `employees.location` from the employee's legal entity (= branch),
     * as "City, Country".
     *
     * `location` is a DERIVED field — every form renders it read-only and fills
     * it from the selected legal entity — so the values left over from the old
     * master_legal_entities city (e.g. "Houston") are now just wrong, and a user
     * can't correct them without re-picking the entity. Only rows that actually
     * have a legal entity are touched; hand-entered locations on rows without
     * one (e.g. client-level staff) are left alone.
     *
     * Mirrors BranchController::composeBranchLocation() — keep the two in step.
     */
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

    /** Derived data — nothing meaningful to restore. */
    public function down(): void
    {
        //
    }
};
