<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class OrganizationType extends Model
{
    protected $fillable = [
        'name',
        'slug',
        'icon',
        'description',
        'status',
        'sort_order',
    ];

    protected function casts(): array
    {
        return [
            'sort_order' => 'integer',
        ];
    }

    public function isActive(): bool
    {
        return $this->status === 'active';
    }
}
