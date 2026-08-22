<?php

namespace App\Models;

use Database\Factories\UserFactory;
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
    /** @use HasFactory<UserFactory> */
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
        // Email-slot key: true = active account (its email is taken), false = the
        // person has EXITED and the email is freed for reuse (see the dup-email
        // check in EmployeeController::validatePayload).
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
        // Never serialize the encrypted-mirror password through normal model
        // serialization — ClientController::show() explicitly decrypts and
        // adds it to the payload only when the caller is a super_admin.
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
            // Deliberately NOT in $fillable: these are stamped only by
            // PasswordHistory::recordPasswordHistory(), never mass-assigned
            // from a request — a client that could set them could fake the
            // audit trail the password screen reads.
            'password_change_count' => 'integer',
            'password_changed_at' => 'datetime',
        ];
    }

    /**
     * A password change kills every OTHER session for that user.
     *
     * Sanctum tokens are independent of the password: rotating the hash leaves
     * existing tokens valid, so an employee whose password was reset stayed
     * signed in indefinitely — a refresh did not help, because the old token
     * still authenticated. That is the whole point of a reset when it is done
     * because credentials leaked or someone left.
     *
     * This lives on the model rather than at each call site because there are
     * four places that write a password (self-change, HR reset, the Branch form
     * and the Client form) and every one of them had forgotten to revoke. A
     * hook cannot be forgotten by the next one.
     *
     * The token making the request survives, so changing your own password does
     * not sign you out of the tab you are typing in — but it does drop your
     * other devices. When an ADMIN resets someone else's password the acting
     * token belongs to the admin, so none of the target's tokens match and all
     * of them go.
     */
    protected static function booted(): void
    {
        static::updated(function (self $user) {
            if (!$user->wasChanged('password')) return;

            $current = $user->currentAccessToken();
            $keepId  = $current instanceof PersonalAccessToken ? $current->getKey() : null;

            $user->tokens()->when($keepId, fn ($q) => $q->whereKeyNot($keepId))->delete();
        });
    }

    // ── Relationships ──

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

    /** The employee record this login belongs to, if any. */
    public function employee(): HasOne
    {
        return $this->hasOne(Employee::class, 'user_id');
    }

    /**
     * The id of the employee record behind this login, or null.
     *
     * There is NO `employee_id` column on `users` — the link lives the other
     * way round, on `employees.user_id`. Three call sites nevertheless read
     * `$user->employee_id` directly, and without this accessor Eloquent simply
     * returned null for all of them:
     *
     *   · PayrollController::ownsRow / employeePayslips / history — the
     *     employee tier's self-guard compared `$slip->employee_id` against
     *     `(int) null` = 0, which matches nothing. The guard was written to let
     *     an employee see their OWN payslip and no one else's; instead it
     *     locked them out of their own (404 on the payslip, its PDF and the
     *     email, 403 on the salary history, and an empty payroll history).
     *   · HrDocumentSignatureController / MyTeamController — same read, same
     *     silent null. MyTeamController::myTeam had already worked around it
     *     with an inline `?: Employee::where('user_id', ...)` fallback, which
     *     is exactly the lookup below.
     *
     * Solved on the model so the next call site inherits it rather than having
     * to remember the workaround. Memoised because the payslip guard runs once
     * per row on a listing.
     *
     * `employee_code` is the secondary route: logins created before the
     * `user_id` back-link was populated only carry the code.
     */
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

    // ── Helpers ──

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

    /** A staff login paired to an `employees` row (the bottom tier). */
    public function isEmployee(): bool
    {
        return $this->user_type === 'employee';
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }
}
