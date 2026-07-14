<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\SoftDeletes;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class DebitNote extends Model
{
    use SoftDeletes;

    protected $fillable = [
        'client_id', 'branch_id', 'code',
        'debit_note_date', 'expected_debit_date',
        'debit_note_type_id', 'debit_note_type',
        'supplier_purchase_invoice_id', 'spi_code', 'spi_date',
        'purchase_order_id', 'po_code', 'po_date',
        'shipment_order_id', 'shipment_code', 'procurement_id', 'procurement_code',
        'vendor_id', 'supplier_code', 'supplier_name', 'supplier_type',
        'address', 'country', 'state', 'state_code', 'city',
        'contact_name', 'designation', 'contact_no', 'email',
        'gst_number', 'gst_status', 'scrutiny_date', 'last_filing_date', 'gst_remarks',
        'reason', 'terms',
        'total_product_cost', 'total_cgst', 'total_sgst', 'total_igst',
        'additions_total', 'deductions_total', 'grand_total', 'total_paid', 'balance',
        'attachment_path', 'zoho_status', 'status', 'created_by', 'updated_by',
    ];

    protected $casts = [
        'debit_note_date' => 'date',
        'expected_debit_date' => 'date',
        'spi_date' => 'date',
        'po_date' => 'date',
        'scrutiny_date' => 'date',
        'last_filing_date' => 'date',
        'total_product_cost' => 'decimal:2',
        'total_cgst' => 'decimal:2',
        'total_sgst' => 'decimal:2',
        'total_igst' => 'decimal:2',
        'additions_total' => 'decimal:2',
        'deductions_total' => 'decimal:2',
        'grand_total' => 'decimal:2',
        'total_paid' => 'decimal:2',
        'balance' => 'decimal:2',
    ];

    public function client(): BelongsTo { return $this->belongsTo(Client::class); }
    public function creator(): BelongsTo { return $this->belongsTo(User::class, 'created_by'); }
    public function supplierPurchaseInvoice(): BelongsTo { return $this->belongsTo(SupplierPurchaseInvoice::class); }
    public function items(): HasMany { return $this->hasMany(DebitNoteItem::class)->orderBy('line_no')->orderBy('id'); }
    public function charges(): HasMany { return $this->hasMany(DebitNoteCharge::class)->orderBy('line_no')->orderBy('id'); }
    public function payments(): HasMany { return $this->hasMany(DebitNotePayment::class)->orderBy('id'); }
}
