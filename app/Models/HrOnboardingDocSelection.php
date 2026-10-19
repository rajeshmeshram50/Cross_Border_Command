<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

/** One row per onboarding document a hire's Policies & Agreements set includes. */
class HrOnboardingDocSelection extends Model
{
    protected $table = 'hr_onboarding_doc_selections';

    protected $fillable = [
        'client_id', 'branch_id', 'employee_id', 'kind', 'template_id', 'created_by',
    ];
}
