<?php

namespace App\Mail\Transport;

use Illuminate\Support\Facades\Http;
use Symfony\Component\Mailer\Exception\TransportException;
use Symfony\Component\Mailer\SentMessage;
use Symfony\Component\Mailer\Transport\AbstractTransport;
use Symfony\Component\Mime\MessageConverter;

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

        if ($response->failed()) {
            throw new TransportException(
                'ZeptoMail API refused the message (HTTP ' . $response->status() . '): '
                . mb_substr((string) $response->body(), 0, 300)
            );
        }
    }

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
