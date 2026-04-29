<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Kpis extends Model
{
    protected $table = 'master_kpis';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'code',
        'description',
        'role_id',
        'target_type',
        'priority',
        'status',
        'created_by',
    ];

    /**
     * Auto-generate the KPI code (KPI-01, KPI-02, …) on create
     * if the caller didn't supply one.
     */
    protected static function booted(): void
    {
        static::creating(function (self $row) {
            if (empty($row->code)) {
                $next = (int) static::max('id') + 1;
                $row->code = 'KPI-' . str_pad((string) $next, 2, '0', STR_PAD_LEFT);
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

    public function role(): BelongsTo
    {
        return $this->belongsTo(Roles::class, 'role_id');
    }
}
