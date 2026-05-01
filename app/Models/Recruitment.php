<?php

namespace App\Models;

use App\Models\Masters\Departments;
use App\Models\Masters\Designations;
use App\Models\Masters\Roles;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class Recruitment extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'code',

        'job_title',
        'department_id', 'designation_id', 'primary_role_id',
        'employment_type', 'openings', 'experience',
        'work_mode', 'ctc_range', 'priority',

        'hiring_manager_id', 'assigned_hr_id',
        'start_date', 'deadline',

        'job_description', 'requirements',

        'post_on_portal', 'notify_team_leads', 'enable_referral_bonus',

        'status', 'cancel_reason', 'cancel_notes',
    ];

    protected $casts = [
        'start_date'            => 'date',
        'deadline'              => 'date',
        'openings'              => 'integer',
        'post_on_portal'        => 'boolean',
        'notify_team_leads'     => 'boolean',
        'enable_referral_bonus' => 'boolean',
    ];

    // ── Tenant / ownership ──────────────────────────────────────────────

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

    // ── Master refs ─────────────────────────────────────────────────────

    public function department(): BelongsTo
    {
        return $this->belongsTo(Departments::class, 'department_id');
    }

    public function designation(): BelongsTo
    {
        return $this->belongsTo(Designations::class, 'designation_id');
    }

    public function primaryRole(): BelongsTo
    {
        return $this->belongsTo(Roles::class, 'primary_role_id');
    }

    public function hiringManager(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'hiring_manager_id');
    }

    public function assignedHr(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'assigned_hr_id');
    }
}
