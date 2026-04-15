<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class UserDetail extends Model
{
    protected $table = 'user_details';

    protected $fillable = [
        'user_id',
        'gender',
        'date_of_birth',
        'blood_group',
        'marital_status',
        'nationality',
        'religion',
        'employee_id',
        'role_level',
        'joining_date',
        'confirmation_date',
        'resignation_date',
        'employment_type',
        'basic_salary',
        'hra',
        'da',
        'special_allowance',
        'gross_salary',
        'net_salary',
        'bank_name',
        'bank_account_number',
        'bank_ifsc',
        'aadhaar_number',
        'pan_number',
        'passport_number',
        'passport_expiry',
        'driving_license',
        'emergency_contact',
        'emergency_phone',
        'emergency_relation',
        'current_address',
        'permanent_address',
        'highest_qualification',
        'specialization',
        'university',
        'passing_year',
        'profile_photo',
        'document_uploads',
    ];

    protected function casts(): array
    {
        return [
            'date_of_birth' => 'date',
            'joining_date' => 'date',
            'confirmation_date' => 'date',
            'resignation_date' => 'date',
            'passport_expiry' => 'date',
            'basic_salary' => 'decimal:2',
            'hra' => 'decimal:2',
            'da' => 'decimal:2',
            'special_allowance' => 'decimal:2',
            'gross_salary' => 'decimal:2',
            'net_salary' => 'decimal:2',
            'passing_year' => 'integer',
            'document_uploads' => 'array',
        ];
    }

    // ── Relationships ──

    public function user(): BelongsTo
    {
        return $this->belongsTo(User::class);
    }
}
