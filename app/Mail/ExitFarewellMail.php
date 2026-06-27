<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * "Thank You for Being a Part of Our Journey" — the farewell broadcast sent
 * (to the team / employee) when an employee exit is completed.
 *
 * Built to take a plain data array so it can be fired with static data while
 * the exit-completion hook is still being wired up.
 */
class ExitFarewellMail extends Mailable
{
    use Queueable, SerializesModels;

    public string  $orgName;
    public string  $employeeName;
    public string  $lastWorkingDay;
    public string  $hrEmail;
    public string  $hrPhone;
    public ?string $logoUrl;
    public string  $iconUrl;
    public string  $introLine;
    public string  $subjectPronoun;
    public string  $objectPronoun;
    public string  $possessivePronoun;

    public function __construct(array $data)
    {
        $this->orgName        = (string) ($data['org_name'] ?? 'Our Company');
        $this->employeeName   = (string) ($data['employee_name'] ?? 'Employee');
        $this->lastWorkingDay = (string) ($data['last_working_day'] ?? '');
        $this->hrEmail        = (string) ($data['hr_email'] ?? config('mail.from.address', 'hr@company.com'));
        $this->hrPhone        = (string) ($data['hr_phone'] ?? '');
        $this->logoUrl        = $data['logo_url'] ?? null;
        $this->introLine      = (string) ($data['intro_line'] ?? 'Hi Team,');

        // Pronouns from gender so the copy reads naturally.
        $gender = strtolower((string) ($data['gender'] ?? ''));
        [$subj, $obj, $poss] = match (true) {
            str_starts_with($gender, 'f') => ['she', 'her', 'her'],
            str_starts_with($gender, 'm') => ['he', 'him', 'his'],
            default                       => ['they', 'them', 'their'],
        };
        $this->subjectPronoun    = $subj;
        $this->objectPronoun     = $obj;
        $this->possessivePronoun = $poss;

        // Default people-with-X icon (purple) as an inline SVG data URI so the
        // template needs no external asset; override via `icon_url`.
        $this->iconUrl = $data['icon_url'] ?? self::defaultIcon();
    }

    private static function defaultIcon(): string
    {
        $svg = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='56' height='56' fill='#7c5cfc'>"
             . "<circle cx='8.5' cy='7' r='3.2'/>"
             . "<circle cx='15' cy='8' r='2.4' opacity='0.85'/>"
             . "<path d='M2 19c0-2.9 3.5-4.5 6.5-4.5 1.6 0 3.4.45 4.7 1.4A5 5 0 0 0 12 19v.5H2z'/>"
             . "<path d='M15 12.4c-1 0-1.95.18-2.8.5.9.9 1.4 2 1.55 3.1H21v-.2c0-2.3-3-3.4-5-3.4z' opacity='0.85'/>"
             . "<circle cx='18.5' cy='17.5' r='4.5' fill='#7c5cfc'/>"
             . "<path d='M16.9 15.9l3.2 3.2M20.1 15.9l-3.2 3.2' stroke='#ffffff' stroke-width='1.4' stroke-linecap='round'/>"
             . "</svg>";
        return 'data:image/svg+xml,' . rawurlencode($svg);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Thank You for Being a Part of Our Journey — {$this->employeeName}",
        );
    }

    public function content(): Content
    {
        return new Content(view: 'emails.exit-farewell');
    }
}
