<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Generic mailable for Sales Matrix → Quotation / Proforma Invoice docs.
 *
 * Used by `SalesPdfController::emailQuotation` and `emailProformaInvoice`
 * to send the matching PDF to the customer's primary email. The body
 * renders `emails.sales-document` with a branch-aware template — the
 * branch's name / email / website appear in the closing block so the
 * customer sees the issuing entity, not a generic system signature.
 *
 * Pre-generated PDF path is passed in so we don't re-render in the
 * Mailable; controller is responsible for writing the PDF to a temp
 * path and cleaning up after send.
 */
class SalesDocumentEmail extends Mailable
{
    use Queueable, SerializesModels;

    public string $docKind;         // 'Quotation' | 'Proforma Invoice'
    public string $docCode;         // QT/2026-27/6
    public string $docDate;         // 25/05/2026 (dd/mm/yyyy)
    public string $branchName;
    public ?string $branchEmail;
    public ?string $branchWebsite;
    public string $customerName;
    public string $productSummary;  // first line item name (or "Multiple items")
    public ?string $pdfPath;        // absolute filesystem path to the attached PDF
    public string $pdfFilename;     // visible name in the recipient's inbox

    public function __construct(array $payload)
    {
        $this->docKind        = (string) ($payload['docKind']        ?? 'Document');
        $this->docCode        = (string) ($payload['docCode']        ?? '');
        $this->docDate        = (string) ($payload['docDate']        ?? '');
        $this->branchName     = (string) ($payload['branchName']     ?? 'Sales Team');
        $this->branchEmail    = $payload['branchEmail']              ?? null;
        $this->branchWebsite  = $payload['branchWebsite']            ?? null;
        $this->customerName   = (string) ($payload['customerName']   ?? 'Sir/Madam');
        $this->productSummary = (string) ($payload['productSummary'] ?? '');
        $this->pdfPath        = $payload['pdfPath']                  ?? null;
        $this->pdfFilename    = (string) ($payload['pdfFilename']    ?? 'document.pdf');
    }

    public function envelope(): Envelope
    {
        // Subject reads like a finance team email: "Quotation QT/2026-27/6 from Inorbvict Agrotech"
        return new Envelope(
            subject: trim("{$this->docKind} {$this->docCode} from {$this->branchName}"),
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.sales-document',
            with: [
                'docKind'        => $this->docKind,
                'docCode'        => $this->docCode,
                'docDate'        => $this->docDate,
                'branchName'     => $this->branchName,
                'branchEmail'    => $this->branchEmail,
                'branchWebsite'  => $this->branchWebsite,
                'customerName'   => $this->customerName,
                'productSummary' => $this->productSummary,
            ],
        );
    }

    public function attachments(): array
    {
        if ($this->pdfPath && file_exists($this->pdfPath)) {
            return [
                Attachment::fromPath($this->pdfPath)
                    ->as($this->pdfFilename)
                    ->withMime('application/pdf'),
            ];
        }
        return [];
    }
}
