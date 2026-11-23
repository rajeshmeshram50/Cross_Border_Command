<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class HrOnboardingDocSelection extends Model
{
    protected $table = 'hr_onboarding_doc_selections';

    protected $fillable = [
        'client_id', 'branch_id', 'employee_id', 'kind', 'template_id', 'created_by',
    ];
}
