<?php

namespace App\Models\Masters;

use App\Models\Branch;
use App\Models\Client;
use App\Models\User;
use App\Models\Employee;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Departments extends Model
{
    protected $table = 'master_departments';

    protected $fillable = [
        'client_id',
        'branch_id',
        'name',
        'code',
        'parent_id',
        'head',
        'email',
        'description',
        'status',
        'created_by',
    ];

    /** Employees posted to this department — drives the list's headcount column.
     *  Employee uses SoftDeletes, so withCount('employees') already excludes
     *  deleted staff without any extra condition here. */
    public function employees(): HasMany
    {
        return $this->hasMany(Employee::class, 'department_id');
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
}
