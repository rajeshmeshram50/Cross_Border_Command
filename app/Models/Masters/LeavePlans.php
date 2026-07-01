<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\Employee;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class LeavePlans extends Model
{
    protected $table = 'master_leave_plans';

    protected $fillable = [
        'client_id',
        'branch_id',
        'plan_name',
        'description',
        'calendar_year',
        'from_month_type',
        'from_month',
        'is_default',
        'policy_explanation_mode',
        'policy_doc_path',
        'status',
        'created_by',
    ];

    protected $casts = [
        'is_default' => 'boolean',
        'unlocked' => 'boolean',
    ];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function leaveTypes(): BelongsToMany
    {
        return $this->belongsToMany(LeaveTypes::class, 'leave_plan_leave_types', 'leave_plan_id', 'leave_type_id')
            ->withPivot(['id', 'config_json', 'quota_summary', 'eoy_summary', 'is_setup'])
            ->withTimestamps();
    }

    public function planTypeRows(): HasMany
    {
        return $this->hasMany(LeavePlanLeaveType::class, 'leave_plan_id');
    }

    public function employees(): BelongsToMany
    {
        return $this->belongsToMany(Employee::class, 'leave_plan_employees', 'leave_plan_id', 'employee_id')
            ->withPivot(['assigned_at', 'assigned_by'])
            ->withTimestamps();
    }
}
