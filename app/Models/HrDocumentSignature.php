<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;

class HrDocumentSignature extends Model
{
    protected $table = 'hr_document_signatures';

    protected $fillable = [
        'client_id', 'branch_id',
        'template_id', 'employee_id', 'code',
        'content_html', 'header_config', 'footer_config',
        'signers', 'current_index',
        'status', 'audit_log',
        'created_by',
    ];

    protected $casts = [
        'header_config' => 'array',
        'footer_config' => 'array',
        'signers'       => 'array',
        'audit_log'     => 'array',
        'current_index' => 'integer',
    ];

    public function template(): BelongsTo  { return $this->belongsTo(HrDocumentTemplate::class, 'template_id'); }
    public function employee(): BelongsTo  { return $this->belongsTo(Employee::class, 'employee_id'); }
    public function client(): BelongsTo    { return $this->belongsTo(Client::class); }
    public function branch(): BelongsTo    { return $this->belongsTo(Branch::class); }
    public function creator(): BelongsTo   { return $this->belongsTo(User::class, 'created_by'); }
}
