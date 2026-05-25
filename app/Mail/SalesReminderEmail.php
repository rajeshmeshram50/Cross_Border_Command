<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * Gentle follow-up reminder for a previously emailed Quotation / PI.
 *
 * Sent by SalesPdfController::remindQuotation / remindProformaInvoice
 * AFTER the initial document email has already been delivered (the
 * controller refuses to send a reminder until `emailed_at` is set on
 * the row, so the customer never gets a "reminder" for something they
 * never received in the first place).
 *
 * Body comes from `emails.sales-reminder` — short, polite nudge that
 * references the document code and asks for feedback. PDF is attached
 * again so the customer doesn't have to dig through their inbox.
 */
class SalesReminderEmail extends Mailable
{
    use Queueable, SerializesModels;

    public string $docKind;        // 'Quotation' | 'Proforma Invoice'
    public string $docLabel;       // 'QT' | 'PI' — used in the info-card label
    public string $docCode;        // QT/2026-27/6
    public string $docDate;        // 25/05/2026
    public string $branchName;
    public ?string $branchEmail;
    public ?string $branchWebsite;
    public string $customerName;
    public int $reminderNumber;    // 1, 2, 3 … displayed in subject ("Reminder #2: …")
    public int $productsCount;     // line-item count for the info card
    public float $grandTotal;      // total amount on the doc (shown in the total card)
    public string $currency;       // currency code
    public string $docType;        // "International" | "Domestic"
    public ?string $viewUrl;       // signed public URL that opens the PDF in a browser
    public ?string $logoPath;      // absolute filesystem path to branch logo (for CID embed)
    public ?string $pdfPath;
    public string $pdfFilename;

    public function __construct(array $payload)
    {
        $this->docKind        = (string) ($payload['docKind']        ?? 'Document');
        $this->docLabel       = (string) ($payload['docLabel']       ?? 'DOC');
        $this->docCode        = (string) ($payload['docCode']        ?? '');
        $this->docDate        = (string) ($payload['docDate']        ?? '');
        $this->branchName     = (string) ($payload['branchName']     ?? 'Sales Team');
        $this->branchEmail    = $payload['branchEmail']              ?? null;
        $this->branchWebsite  = $payload['branchWebsite']            ?? null;
        $this->customerName   = (string) ($payload['customerName']   ?? 'Sir/Madam');
        $this->reminderNumber = (int)    ($payload['reminderNumber'] ?? 1);
        $this->productsCount  = (int)    ($payload['productsCount']  ?? 0);
        $this->grandTotal     = (float)  ($payload['grandTotal']     ?? 0);
        $this->currency       = (string) ($payload['currency']       ?? '');
        $this->docType        = (string) ($payload['docType']        ?? '');
        $this->viewUrl        = $payload['viewUrl']                  ?? null;
        $this->logoPath       = $payload['logoPath']                 ?? null;
        $this->pdfPath        = $payload['pdfPath']                  ?? null;
        $this->pdfFilename    = (string) ($payload['pdfFilename']    ?? 'document.pdf');
    }

    public function envelope(): Envelope
    {
        // Subject reads like a finance follow-up:
        //   "Reminder: Quotation QT/2026-27/6 from Inorbvict Agrotech"
        // After the first reminder we add the count so the customer can
        // tell repeat follow-ups apart in their inbox.
        $prefix = $this->reminderNumber > 1
            ? "Reminder #{$this->reminderNumber}"
            : 'Reminder';

        return new Envelope(
            subject: trim("{$prefix}: {$this->docKind} {$this->docCode} from {$this->branchName}"),
        );
    }

    public function content(): Content
    {
        return new Content(
            view: 'emails.sales-reminder',
            with: [
                'docKind'        => $this->docKind,
                'docLabel'       => $this->docLabel,
                'docCode'        => $this->docCode,
                'docDate'        => $this->docDate,
                'branchName'     => $this->branchName,
                'branchEmail'    => $this->branchEmail,
                'branchWebsite'  => $this->branchWebsite,
                'customerName'   => $this->customerName,
                'reminderNumber' => $this->reminderNumber,
                'productsCount'  => $this->productsCount,
                'grandTotal'     => $this->grandTotal,
                'currency'       => $this->currency,
                'docType'        => $this->docType,
                'viewUrl'        => $this->viewUrl,
                'logoPath'       => $this->logoPath,
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
