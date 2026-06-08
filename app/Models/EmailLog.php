<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\SoftDeletes;

/**
 * One outbound email the system sent. Rows are written by
 * App\Listeners\LogSentEmail (hooked to Laravel's MessageSent event), so the
 * table is a faithful mirror of everything that left the mailer — transactional
 * mails (OTP, payslips, invoices, …) and anything composed from the Gmail page.
 */
class EmailLog extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'user_id', 'employee_id',
        'direction', 'category', 'mailable_class',
        'from_email', 'from_name', 'to_email', 'to_name', 'cc', 'bcc',
        'subject', 'body_html', 'body_text', 'has_attachments',
        'status', 'error', 'sent_at', 'is_read', 'is_starred',
    ];

    protected $casts = [
        'cc'              => 'array',
        'bcc'             => 'array',
        'has_attachments' => 'boolean',
        'is_read'         => 'boolean',
        'is_starred'      => 'boolean',
        'sent_at'         => 'datetime',
    ];

    public function client(): BelongsTo
    {
        return $this->belongsTo(Client::class);
    }

    public function branch(): BelongsTo
    {
        return $this->belongsTo(Branch::class);
    }

    public function sender(): BelongsTo
    {
        return $this->belongsTo(User::class, 'user_id');
    }

    public function employee(): BelongsTo
    {
        return $this->belongsTo(Employee::class);
    }
}
