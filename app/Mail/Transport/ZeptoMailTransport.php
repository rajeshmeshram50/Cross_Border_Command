<?php

namespace App\Mail\Transport;

use Illuminate\Support\Facades\Http;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\MessageConverter;

/**
 * ZeptoMail over its HTTP API instead of SMTP.
 *
 * SMTP to smtp.zeptomail.in is a ten-step conversation — greeting, EHLO,
 * STARTTLS, the TLS handshake, EHLO again, AUTH, MAIL FROM, RCPT TO, DATA,
 * QUIT — and every step waits for a reply across the internet. Measured on
 * production that is ~6 seconds per email, of which rendering the 12 KB
 * payslip PDF is ~200 ms. The talking is the cost, not the payload: the same
 * PDF downloads in 200 ms.
 *
 * The API is one POST. Same provider, same account, different door.
 *
 * It matters well beyond payslips — 25 files in this app send mail, including
 * the forgot-password OTP and the onboarding invite. Every one of them was
 * paying that six seconds.
 */
class ZeptoMailTransport extends AbstractTransport
{
    public function __construct(
        private string $token,
        private string $endpoint,
        private int $timeout = 20,
    ) {
        parent::__construct();
    }

    protected function doSend(SentMessage $message): void
    {
        $email = MessageConverter::toEmail($message->getOriginalMessage());

        $from = $email->getFrom()[0] ?? null;
        if (!$from) {
            throw new TransportException('ZeptoMail: the message has no From address.');
        }

        $payload = [
            'from'    => ['address' => $from->getAddress(), 'name' => $from->getName() ?: ''],
            'to'      => $this->addresses($email->getTo()),
            'subject' => $email->getSubject() ?: '',
        ];

        /* Only when present. ZeptoMail rejects an empty array on these, and an
           empty htmlbody would blank a text-only mail. */
        if ($cc = $this->addresses($email->getCc()))   $payload['cc']  = $cc;
        if ($bcc = $this->addresses($email->getBcc())) $payload['bcc'] = $bcc;
        if ($html = $email->getHtmlBody())             $payload['htmlbody'] = $html;
        if ($text = $email->getTextBody())             $payload['textbody'] = $text;

        if ($reply = $email->getReplyTo()) {
            $payload['reply_to'] = $this->addresses($reply);
        }

        foreach ($email->getAttachments() as $file) {
            $payload['attachments'][] = [
                'name'      => $file->getFilename(),
                'mime_type' => $file->getContentType(),
                'content'   => base64_encode($file->getBody()),
            ];
        }

        $response = Http::withHeaders([
                'Authorization' => 'Zoho-enczapikey ' . $this->token,
                'Accept'        => 'application/json',
            ])
            ->timeout($this->timeout)
            ->asJson()
            ->post($this->endpoint, $payload);

        /* A TransportException, not a generic one: that is what Symfony's
           failover transport catches to decide the mailer is unhealthy and
           move on to SMTP. Throwing anything else would bypass the fallback
           and surface as a hard failure to the caller. */
        if ($response->failed()) {
            throw new TransportException(
                'ZeptoMail API refused the message (HTTP ' . $response->status() . '): '
                . mb_substr((string) $response->body(), 0, 300)
            );
        }
    }

    /** Symfony addresses in the shape ZeptoMail expects. */
    private function addresses(array $list): array
    {
        return array_values(array_map(fn ($a) => [
            'email_address' => ['address' => $a->getAddress(), 'name' => $a->getName() ?: ''],
        ], $list));
    }

    public function __toString(): string
    {
        return 'zeptomail';
    }
}
