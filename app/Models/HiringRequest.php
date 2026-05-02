<?php

namespace App\Models;

use App\Models\Masters\Departments;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class HiringRequest extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'code',

        // Section 1 — basics
        'title', 'job_role', 'department_id', 'team',
        'requested_by_name', 'request_date',

        // Section 2 — hiring need
        'openings', 'employment_type', 'work_mode', 'urgency',

        // Section 3 — role details
        'job_description', 'daily_responsibilities',
        'required_skills', 'required_experience',
        'required_qualification', 'preferred_profile',

        // Section 4 — business justification
        'request_type', 'business_justification', 'hiring_need_reason',
        'current_team_gap', 'what_if_not_filled',

        'target_join_date', 'status',
    ];

    protected $casts = [
        'request_date'     => 'date',
        'target_join_date' => 'date',
        'openings'         => 'integer',
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

    public function department(): BelongsTo
    {
        return $this->belongsTo(Departments::class, 'department_id');
    }
}
