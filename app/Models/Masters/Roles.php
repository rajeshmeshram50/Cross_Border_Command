<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class Roles extends Model
{
    protected $table = 'master_roles';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'code',
        'role_type',
        'department_id',
        'role_category',
        'description',
        'status',
        'created_by',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $row) {
            if (empty($row->code)) {
                $next = (int) static::max('id') + 1;
                $row->code = 'ROL-' . str_pad((string) $next, 2, '0', STR_PAD_LEFT);
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
}
