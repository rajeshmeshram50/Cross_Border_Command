<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Attachment;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class SalesDocumentEmail extends Mailable
{
    use Queueable, SerializesModels;

    public string $docKind;
    public string $docLabel;
    public string $docCode;
    public string $docDate;
    public string $branchName;
    public ?string $branchEmail;
    public ?string $branchWebsite;
    public string $customerName;
    public string $productSummary;
    public int $productsCount;
    public float $grandTotal;
    public string $currency;
    public string $docType;
    public ?string $viewUrl;
    public ?string $logoPath;
    public ?string $pdfPath;
    public string $pdfFilename;
    public array $extraAttachments;

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
        $this->productSummary = (string) ($payload['productSummary'] ?? '');
        $this->productsCount  = (int)    ($payload['productsCount']  ?? 0);
        $this->grandTotal     = (float)  ($payload['grandTotal']     ?? 0);
        $this->currency       = (string) ($payload['currency']       ?? '');
        $this->docType        = (string) ($payload['docType']        ?? '');
        $this->viewUrl        = $payload['viewUrl']                  ?? null;
        $this->logoPath       = $payload['logoPath']                 ?? null;
        $this->pdfPath        = $payload['pdfPath']                  ?? null;
        $this->pdfFilename    = (string) ($payload['pdfFilename']    ?? 'document.pdf');
        $this->extraAttachments = (array) ($payload['extraAttachments'] ?? []);
    }

    public function envelope(): Envelope
    {
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
                'docLabel'       => $this->docLabel,
                'docCode'        => $this->docCode,
                'docDate'        => $this->docDate,
                'branchName'     => $this->branchName,
                'branchEmail'    => $this->branchEmail,
                'branchWebsite'  => $this->branchWebsite,
                'customerName'   => $this->customerName,
                'productSummary' => $this->productSummary,
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
        $out = [];
        if ($this->pdfPath && file_exists($this->pdfPath)) {
            $out[] = Attachment::fromPath($this->pdfPath)
                ->as($this->pdfFilename)
                ->withMime('application/pdf');
        }
        foreach ($this->extraAttachments as $file) {
            if (!empty($file['path']) && file_exists($file['path'])) {
                $out[] = Attachment::fromPath($file['path'])->as((string) ($file['name'] ?? basename($file['path'])));
            }
        }
        return $out;
    }
}
