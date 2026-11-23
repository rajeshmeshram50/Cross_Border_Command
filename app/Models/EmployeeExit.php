<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeExit extends Model
{
    protected $fillable = [
        'employee_id', 'client_id', 'branch_id',
        'exit_type', 'initiated_by', 'reason_for_exit', 'other_reason',
        'notice_date', 'last_working_day',
        'reporting_manager_id', 'comments',
        'business_impact', 'replacement_required',
        'notice_settlement_mode', 'notice_payment_choice',
        'notice_days_required', 'notice_days_served',
        'notice_days_unserved', 'notice_settlement_basis', 'notice_per_day_rate',
        'notice_settlement_amount', 'notice_settlement_status', 'notice_payment',
        'fnf',
        'clearances', 'asset_returns', 'handover_notes',
        'documents_released', 'documents_released_at', 'documents_released_by',
        'validation', 'final_employee_status', 'profile_lock',
        'exit_case_status', 'hr_sign_off',
        'blacklisted', 'blacklist_reason',
        'stage_status', 'current_stage', 'completed_at',
        'rehired_at', 'rehired_by', 'rehire_restart_onboarding', 'rehire_note',
        'created_by',
    ];

    protected $casts = [
        'notice_date'      => 'date',
        'last_working_day' => 'date',
        'clearances'       => 'array',
        'asset_returns'    => 'array',
        'validation'       => 'array',
        'stage_status'     => 'array',
        'current_stage'    => 'integer',
        'completed_at'     => 'datetime',
        'notice_payment'   => 'array',
        'fnf'              => 'array',
        'rehired_at'       => 'datetime',
        'rehire_restart_onboarding' => 'boolean',
        'documents_released'    => 'boolean',
        'documents_released_at' => 'datetime',
        'notice_days_required'     => 'integer',
        'notice_days_served'       => 'integer',
        'notice_days_unserved'     => 'integer',
        'notice_per_day_rate'      => 'float',
        'notice_settlement_amount' => 'float',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'reporting_manager_id');
    }
}
