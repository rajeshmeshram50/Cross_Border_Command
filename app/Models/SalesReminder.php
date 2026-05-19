<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Sales Matrix → Productivity Tracker reminder row.
 *
 * Status is a 2-state lifecycle:
 *   In Progress (default on create) → Done (terminal)
 *
 * Tenant scope follows the project's standard pattern — client_id + branch_id
 * stamped at insert time by SalesTodoController. created_by_user_id is the
 * login user that filed the reminder (not the assigned employee, which we
 * don't model yet — the reminder is owned by its creator).
 */
class SalesReminder extends Model
{
    use SoftDeletes;

    protected $table = 'sales_reminders';

    public const STATUS_IN_PROGRESS = 'In Progress';
    public const STATUS_DONE        = 'Done';
    public const STATUSES           = [self::STATUS_IN_PROGRESS, self::STATUS_DONE];

    protected $fillable = [
        'client_id', 'branch_id',
        'created_by_user_id', 'employee_id',
        'opp_id', 'opp_date',
        'subject', 'set_date', 'tat',
        'remark', 'attachment_path', 'attachment_original_name',
        'status',
    ];

    protected $casts = [
        'opp_date' => 'date',
        'set_date' => 'date',
    ];

    protected $appends = ['attachment_url'];

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
        return $this->belongsTo(User::class, 'created_by_user_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    /** Resolve the relative attachment_path into a public URL. */
    public function getAttachmentUrlAttribute(): ?string
    {
        return $this->attachment_path ? file_url($this->attachment_path) : null;
    }
}
