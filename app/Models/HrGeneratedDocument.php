<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

class HrGeneratedDocument extends Model
{
    use SoftDeletes;

    protected $table = 'hr_generated_documents';

    protected $fillable = [
        'client_id', 'branch_id',
        'template_id', 'employee_id',
        'rendered_html', 'custom_values', 'resolved_vars',
        'status', 'generated_by', 'generated_at', 'sent_at',
    ];

    protected $casts = [
        'custom_values' => 'array',
        'resolved_vars' => 'array',
        'generated_at'  => 'datetime',
        'sent_at'       => 'datetime',
    ];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function template(): BelongsTo
    {
        return $this->belongsTo(HrDocumentTemplate::class, 'template_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }

    public function generator(): BelongsTo
    {
        return $this->belongsTo(User::class, 'generated_by');
    }
}
