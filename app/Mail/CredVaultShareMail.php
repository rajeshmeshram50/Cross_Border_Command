<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

class CredVaultShareMail extends Mailable
{
    use Queueable, SerializesModels;

    public const CAN = [
        'Sign in / autofill'    => ['use', 'view', 'copy', 'full'],
        'See the password'      => ['view', 'copy', 'full'],
        'Copy the password'     => ['copy', 'full'],
        'Edit the credential'   => ['full'],
        'Re-share with others'  => ['full'],
        'Delete the credential' => ['full'],
    ];
    public const PERMISSION = [
        'use'  => ['Use Only', 'Launch / autofill, password hidden'],
        'view' => ['View', 'Reveal the password'],
        'copy' => ['Copy', 'Reveal and copy'],
        'full' => ['Full Access', 'Edit, share and delete'],
    ];

    public function __construct(public array $d, public ?string $recipientName = null, public array $branding = [])
    {
        $this->branding = array_filter($branding, fn ($v) => $v !== null);
    }

    public function envelope(): Envelope
    {
        $c = $this->d['credential'];
        $to = $this->d['team'] ? "your team {$this->d['team']['name']}" : 'you';

        return new Envelope(subject: ($this->d['renewed'] ? 'Share updated: ' : '')
            . "{$this->d['shared_by']['name']} shared “{$c['name']}” ({$c['code']}) with {$to} — CredVault");
    }

    public function content(): Content
    {
        $p = $this->d['permission'];

        return new Content(view: 'emails.credvault-share', with: array_merge([
            'd'          => $this->d,
            'recipient'  => $this->recipientName,
            'permLabel'  => self::PERMISSION[$p][0],
            'permDesc'   => self::PERMISSION[$p][1],
            'can'        => collect(self::CAN)->map(fn ($perms) => in_array($p, $perms, true))->all(),
        ], $this->branding));
    }
}
