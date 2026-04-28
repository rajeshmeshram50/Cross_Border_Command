<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Designations extends Model
{
    protected $table = 'master_designations';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'code',
        'department_id',
        'level',
        'reports_to_id',
        'description',
        'status',
        'created_by',
    ];

    /**
     * Auto-generate the designation code (DGN-001, DGN-002, …) on create
     * if the caller didn't supply one.
     */
    protected static function booted(): void
    {
        static::creating(function (self $row) {
            if (empty($row->code)) {
                $next = (int) static::max('id') + 1;
                // 2-digit padding (DGN-01) — auto-grows to 3+ digits past 99.
                $row->code = 'DGN-' . str_pad((string) $next, 2, '0', STR_PAD_LEFT);
            }
        });
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

    public function reportsTo(): BelongsTo
    {
        return $this->belongsTo(self::class, 'reports_to_id');
    }
}
