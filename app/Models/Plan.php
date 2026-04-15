<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsToMany;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Plan extends Model
{
    protected $fillable = [
        'name',
        'slug',
        'price',
        'period',
        'max_branches',
        'max_users',
        'storage_limit',
        'support_level',
        'is_featured',
        'badge',
        'color',
        'description',
        'best_for',
        'status',
        'sort_order',
        'trial_days',
        'yearly_discount',
        'is_custom',
    ];

    protected function casts(): array
    {
        return [
            'price' => 'decimal:2',
            'max_branches' => 'integer',
            'max_users' => 'integer',
            'is_featured' => 'boolean',
            'sort_order' => 'integer',
            'trial_days' => 'integer',
            'yearly_discount' => 'decimal:2',
            'is_custom' => 'boolean',
        ];
    }

    // ── Relationships ──

    public function clients(): HasMany
    {
        return $this->hasMany(Client::class);
    }

    public function payments(): HasMany
    {
        return $this->hasMany(Payment::class);
    }

    public function planModules(): HasMany
    {
        return $this->hasMany(PlanModule::class);
    }

    public function modules(): BelongsToMany
    {
        return $this->belongsToMany(Module::class, 'plan_modules')
            ->withPivot('access_level', 'usage_limit', 'notes')
            ->withTimestamps();
    }

    // ── Helpers ──

    public function isActive(): bool
    {
        return $this->status === 'active';
    }

    public function isFree(): bool
    {
        return $this->price <= 0;
    }
}
