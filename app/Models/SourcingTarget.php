<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Builder;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * Bulk Sourcing target (Procure to Pay).
 *
 * Header row for a sourcing request: an auto per-client code (SRC-0001),
 * the "source from" mode, start/due dates, and the team member it is
 * assigned to. Product line items hang off it via products().
 */
class SourcingTarget extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'created_by',
        'code', 'source',
        'start_date', 'due_date',
        'assignee_id',
    ];

    protected $casts = [
        'start_date' => 'date',
        'due_date'   => 'date',
    ];

    /* ── Tenant relations ─────────────────────────────────────────── */
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

    /** Team member the sourcing is assigned to ("Assigned To"). */
    public function assignee(): BelongsTo
    {
        return $this->belongsTo(User::class, 'assignee_id');
    }

    /* ── Child rows ───────────────────────────────────────────────── */
    public function products(): HasMany
    {
        return $this->hasMany(SourcingTargetProduct::class)->orderBy('id');
    }

    /**
     * Tenant visibility scope — delegates to MasterVisibility so this
     * module shares the same creator-hierarchy rule as vendors, products,
     * customers and consignees.
     *
     * Usage:
     *   SourcingTarget::query()->forUser($user)->where(...)
     */
    public function scopeForUser(Builder $q, $user, ?int $branchFilter = null): Builder
    {
        \App\Support\MasterVisibility::applyReadScope($q, $user, $branchFilter);
        return $q;
    }
}
