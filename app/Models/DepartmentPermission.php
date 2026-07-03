<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class DepartmentPermission extends Model
{
    protected $fillable = [
        'client_id',
        'department_id',
        'module_id',
        'can_view',
        'can_add',
        'can_edit',
        'can_delete',
        'can_export',
        'can_import',
        'can_approve',
        'granted_by',
    ];

    protected function casts(): array
    {
        return [
            'can_view'    => 'boolean',
            'can_add'     => 'boolean',
            'can_edit'    => 'boolean',
            'can_delete'  => 'boolean',
            'can_export'  => 'boolean',
            'can_import'  => 'boolean',
            'can_approve' => 'boolean',
        ];
    }

    public function module(): BelongsTo
    {
        return $this->belongsTo(Module::class);
    }

    public function grantedBy(): BelongsTo
    {
        return $this->belongsTo(User::class, 'granted_by');
    }
}
