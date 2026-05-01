<?php

namespace App\Models;

use App\Models\Masters\Departments;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class EmployeeOnboardingInvite extends Model
{
    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'invitee_name', 'invitee_email',
        'department_id', 'expected_join_date',
        'token', 'expires_at',
        'status', 'completed_at', 'employee_id',
    ];

    protected $casts = [
        'expected_join_date' => 'date',
        'expires_at'         => 'datetime',
        'completed_at'       => 'datetime',
    ];

    /** True only when status is still `pending` AND the deadline hasn't passed. */
    public function isUsable(): bool
    {
        return $this->status === 'pending' && !$this->expires_at?->isPast();
    }

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

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
