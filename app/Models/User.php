<?php

namespace App\Models;

use App\Support\Concerns\EnforcesUniqueEmail;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Foundation\Auth\User as Authenticatable;
use Illuminate\Notifications\Notifiable;
use Laravel\Sanctum\HasApiTokens;
use Laravel\Sanctum\PersonalAccessToken;

class User extends Authenticatable
{
    use EnforcesUniqueEmail;
    protected static string $emailScope   = 'login';
    protected static array  $emailColumns = ['email'];

    use HasApiTokens, HasFactory, Notifiable, SoftDeletes;

    protected $fillable = [
        'name',
        'email',
        'password',
        'password_encrypted',
        'phone',
        'user_type',
        'client_id',
        'branch_id',
        'department_id',
        'status',
        'email_active',
        'must_reset_password',
        'avatar',
        'profile_photo',
        'designation',
        'employee_code',
        'last_login_at',
        'last_login_ip',
        'login_count',
        'device_token',
        'login_source',
        'google_id',
    ];

    protected $hidden = [
        'password',
        'password_encrypted',
        'remember_token',
        'device_token',
    ];

    protected function casts(): array
    {
        return [
            'email_verified_at' => 'datetime',
            'password' => 'hashed',
            'last_login_at' => 'datetime',
            'login_count' => 'integer',
            'email_active' => 'boolean',
            'must_reset_password' => 'boolean',
            'password_change_count' => 'integer',
            'password_changed_at' => 'datetime',
        ];
    }

    protected static function booted(): void
    {
        static::updated(function (self $user) {
            if (!$user->wasChanged('password')) return;

            $current = $user->currentAccessToken();
            $keepId  = $current instanceof PersonalAccessToken ? $current->getKey() : null;

            $user->tokens()->when($keepId, fn ($q) => $q->whereKeyNot($keepId))->delete();
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

    public function effectiveClient(): ?Client
    {
        if ($this->client_id && $this->client) {
            return $this->client;
        }
        if ($this->branch_id && $this->branch && $this->branch->client) {
            return $this->branch->client;
        }
        return null;
    }

    public function department(): BelongsTo
    {
        return $this->belongsTo(Department::class);
    }

    public function details(): HasOne
    {
        return $this->hasOne(UserDetail::class);
    }

    public function employee(): HasOne
    {
        return $this->hasOne(Employee::class, 'user_id');
    }

    public function getEmployeeIdAttribute(): ?int
    {
        if (array_key_exists('employee_id', $this->attributes)) {
            return $this->attributes['employee_id'] !== null
                ? (int) $this->attributes['employee_id']
                : null;
        }

        if (!array_key_exists('resolvedEmployeeId', $this->relations)) {
            $id = Employee::where('user_id', $this->id)->value('id');

            if (!$id && !empty($this->employee_code)) {
                $id = Employee::where('emp_code', $this->employee_code)
                    ->when($this->client_id, fn ($q) => $q->where('client_id', $this->client_id))
                    ->value('id');
            }

            $this->relations['resolvedEmployeeId'] = $id ? (int) $id : null;
        }

        return $this->relations['resolvedEmployeeId'];
    }

    public function permissions(): HasMany
    {
        return $this->hasMany(Permission::class);
    }

    public function activityLogs(): HasMany
    {
        return $this->hasMany(ActivityLog::class);
    }

    public function approvalSubmissions(): HasMany
    {
        return $this->hasMany(ApprovalQueue::class, 'submitted_by');
    }

    public function approvalReviews(): HasMany
    {
        return $this->hasMany(ApprovalQueue::class, 'approved_by');
    }

    public function isSuperAdmin(): bool
    {
        return $this->user_type === 'super_admin';
    }

    public function isClientAdmin(): bool
    {
        return $this->user_type === 'client_admin';
    }

    public function isClientUser(): bool
    {
        return $this->user_type === 'client_user';
    }

    public function isBranchUser(): bool
    {
        return $this->user_type === 'branch_user';
    }

    public function isEmployee(): bool
    {
        return $this->user_type === 'employee';
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }
}
