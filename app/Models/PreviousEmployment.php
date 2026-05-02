<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class PreviousEmployment extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'employee_id', 'client_id', 'branch_id',
        'company_name', 'job_title',
        'start_date', 'end_date',
        'hr_email_1', 'hr_email_2', 'contact_number',
    ];

    protected $casts = [
        'start_date' => 'date',
        'end_date'   => 'date',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
