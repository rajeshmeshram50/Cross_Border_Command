<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Support\Facades\DB;

class LeaveTypes extends Model
{
    protected $table = 'master_leave_types';

    /**
     * We don't enforce an FK on leave_plan_leave_types.leave_type_id (so the
     * pivot survives a temporary catalog rebuild during testing). That makes
     * it possible to delete a type without removing the rows pointing at it
     * — the plan's Configuration table would then show ghost entries. Clean
     * them up explicitly on delete so the data stays consistent.
     */
    protected static function booted(): void
    {
        static::deleting(function (LeaveTypes $type) {
            DB::table('leave_plan_leave_types')
                ->where('leave_type_id', $type->id)
                ->delete();
        });
    }

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'description',
        'type',
        'short_code',
        'is_sick_medical',
        'paid_unpaid',
        'gender_restriction',
        'status',
        'created_by',
    ];

    protected $casts = [
        'is_sick_medical' => 'boolean',
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

    public function leavePlans(): BelongsToMany
    {
        return $this->belongsToMany(LeavePlans::class, 'leave_plan_leave_types', 'leave_type_id', 'leave_plan_id')
            ->withPivot(['config_json', 'quota_summary', 'eoy_summary', 'is_setup'])
            ->withTimestamps();
    }
}
