<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One row per employee: whether their Policies & Agreements set is finalised. */
class HrOnboardingDocsetLock extends Model
{
    protected $table = 'hr_onboarding_docset_locks';

    protected $fillable = [
        'client_id', 'branch_id', 'employee_id', 'kind', 'finalized_at', 'finalized_by',
    ];

    protected $casts = ['finalized_at' => 'datetime'];
}
