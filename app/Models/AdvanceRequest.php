<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

/**
 * Recoverable salary / travel / medical advance — mirrors ExpenseClaim
 * with advance-specific form fields and the same two-stage approval
 * surface (manager_status + hr_status).
 */
class AdvanceRequest extends Model
{
    protected $table = 'advance_requests';

    protected $fillable = [
        'client_id', 'branch_id', 'advance_no',
        'employee_id', 'manager_id',
        'advance_type', 'advance_type_other',
        'amount', 'requested_date', 'recovery_start',
        'recovery_mode', 'recovery_months', 'monthly_emi',
        'reason', 'attachments',
        'status', 'manager_status', 'manager_acted_at', 'manager_comment',
        'hr_status', 'hr_user_id', 'hr_acted_at', 'hr_comment',
        'created_by',
    ];

    protected $casts = [
        'amount'           => 'decimal:2',
        'monthly_emi'      => 'decimal:2',
        'requested_date'   => 'date',
        'recovery_start'   => 'date',
        'manager_acted_at' => 'datetime',
        'hr_acted_at'      => 'datetime',
        'attachments'      => 'array',
        'recovery_months'  => 'integer',
    ];

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'employee_id');
    }

    public function manager(): BelongsTo
    {
        return $this->belongsTo(Employee::class, 'manager_id');
    }

    public function creator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'created_by');
    }

    public function hrUser(): BelongsTo
    {
        return $this->belongsTo(User::class, 'hr_user_id');
    }

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }
}
