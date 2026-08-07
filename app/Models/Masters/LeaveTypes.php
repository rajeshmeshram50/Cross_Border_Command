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
     * A leave type that is IN USE cannot be deleted. Two things put it in use,
     * and both refuse the delete with a 422 the SPA shows as a toast:
     *
     *   1. Leave requests reference it (LV-26). Deleting would silently drop
     *      those days from every "used balance" sum (they join
     *      master_leave_types), under-counting consumed leave.
     *   2. It is assigned to one or more leave plans (#108). This used to
     *      cascade — the pivot rows were quietly deleted with the type — so a
     *      type sitting in a configured plan vanished from it without warning,
     *      taking its quota and setup with it. There is no FK on
     *      leave_plan_leave_types.leave_type_id (the pivot deliberately
     *      survives a catalog rebuild during testing), so nothing at the
     *      database level stopped it either.
     *
     * Un-assign the type from every plan first; a type used by leave requests
     * cannot be deleted at all and should be set Inactive instead.
     */
    protected static function booted(): void
    {
        static::deleting(function (LeaveTypes $type) {
            if (DB::table('leave_requests')->where('leave_type_id', $type->id)->exists()) {
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'leave_type' => ['Cannot delete this leave type — existing leave requests reference it. Set it to Inactive instead.'],
                ]);
            }

            // Name the plans rather than just saying "it's in use" — otherwise
            // the only way to find out where it is assigned is to open every
            // plan in turn.
            // INNER join on purpose: a pivot row whose plan no longer exists is
            // an orphan and must not keep the type locked forever.
            $planNames = DB::table('leave_plan_leave_types as lplt')
                ->join('master_leave_plans as lp', 'lp.id', '=', 'lplt.leave_plan_id')
                ->where('lplt.leave_type_id', $type->id)
                ->orderBy('lp.plan_name')
                ->pluck('lp.plan_name')
                ->all();

            if ($planNames) {
                $shown = array_slice($planNames, 0, 3);
                $more  = count($planNames) - count($shown);
                $list  = implode(', ', $shown) . ($more > 0 ? " and {$more} more" : '');
                $count = count($planNames);
                throw \Illuminate\Validation\ValidationException::withMessages([
                    'leave_type' => ["Cannot delete this leave type — it is assigned to {$count} leave plan(s): {$list}. Remove it from those plans first."],
                ]);
            }
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
