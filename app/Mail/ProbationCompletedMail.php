<?php

namespace App\Mail;

use Illuminate\Bus\Queueable;
use Illuminate\Mail\Mailable;
use Illuminate\Mail\Mailables\Content;
use Illuminate\Mail\Mailables\Envelope;
use Illuminate\Queue\SerializesModels;

/**
 * "Congratulations! Probation Period Successfully Completed" — the orange
 * announcement sent when an employee's probation completes (to the employee's
 * work + personal address, and/or the team).
 *
 * Like ExitFarewellMail, this takes a plain data array so it can be fired with
 * STATIC sample data (for preview / Postman) while the probation-completion
 * hook is still being wired up.
 */
class ProbationCompletedMail extends Mailable
{
    use Queueable, SerializesModels;

    public string  $orgName;
    public string  $employeeName;
    public string  $designation;
    public string  $department;
    public string  $effectiveDate;
    public string  $hrName;
    public string  $hrEmail;
    public string  $hrPhone;
    public ?string $logoUrl;
    public string  $iconUrl;
    public string  $dotsUrl;

    public function __construct(array $data)
    {
        $this->orgName       = (string) ($data['org_name'] ?? 'Our Company');
        $this->employeeName  = (string) ($data['employee_name'] ?? 'Employee');
        $this->designation   = (string) ($data['designation'] ?? '');
        $this->department    = (string) ($data['department'] ?? '');
        $this->effectiveDate = (string) ($data['effective_date'] ?? '');
        $this->hrName        = (string) ($data['hr_name'] ?? 'Human Resources');
        $this->hrEmail       = (string) ($data['hr_email'] ?? config('mail.from.address', 'hr@company.com'));
        $this->hrPhone       = (string) ($data['hr_phone'] ?? '');
        $this->logoUrl       = $data['logo_url'] ?? null;

        $this->iconUrl = $data['icon_url'] ?? self::defaultIcon();
        $this->dotsUrl = self::dots();
    }

    /**
     * Top-right orange halftone — the upper-right TRIANGLE of an 8×8 grid
     * (rectangle cut diagonally from top-left to bottom-right; only the
     * top-left→top-right→bottom-right half is filled). Light → dark gradient:
     * lightest at the diagonal edge, darkest at the top-right corner.
     */
    private static function dots(): string
    {
        $dots = ''; $cols = 8; $rows = 8;
        for ($r = 0; $r < $rows; $r++) {
            for ($c = 0; $c < $cols; $c++) {
                if ($r > $c) continue; // keep only the upper-right triangle
                // Clear light → dark ramp left-to-right (toward the corner).
                $t  = $c / ($cols - 1);                    // 0 (left) → 1 (right)
                $op = number_format(0.14 + $t * 0.86, 2);  // 0.14 (light) → 1.00 (dark)
                $dots .= "<circle cx='" . (6 + $c * 12) . "' cy='" . (6 + $r * 12) . "' r='2.6' fill='#f97316' opacity='{$op}'/>";
            }
        }
        $svg = "<svg xmlns='http://www.w3.org/2000/svg' width='102' height='102' viewBox='0 0 102 102'>{$dots}</svg>";
        return 'data:image/svg+xml,' . rawurlencode($svg);
    }

    /** Circular people-with-check badge on a peach disc, with sparkles. */
    private static function defaultIcon(): string
    {
        $o = '#f97316'; // orange
        $svg = "<svg xmlns='http://www.w3.org/2000/svg' width='200' height='120' viewBox='0 30 200 120'>"
             // sparkles
             . "<g fill='{$o}'>"
             . "<path d='M40 64 l3 7 7 3 -7 3 -3 7 -3 -7 -7 -3 7 -3z' opacity='0.9'/>"
             . "<path d='M160 58 l2.5 6 6 2.5 -6 2.5 -2.5 6 -2.5 -6 -6 -2.5 6 -2.5z' opacity='0.9'/>"
             . "<path d='M150 120 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z' opacity='0.8'/>"
             . "<path d='M46 116 l2 5 5 2 -5 2 -2 5 -2 -5 -5 -2 5 -2z' opacity='0.8'/>"
             . "</g>"
             // peach disc
             . "<circle cx='100' cy='90' r='52' fill='#fdecdf'/>"
             . "<circle cx='100' cy='90' r='52' fill='none' stroke='#f9d3b4' stroke-width='2'/>"
             // people group (orange)
             . "<g fill='{$o}'>"
             . "<circle cx='86' cy='74' r='10'/>"
             . "<circle cx='112' cy='78' r='8' opacity='0.9'/>"
             . "<path d='M68 108c0-10 8-16 18-16s18 6 18 16v3H68z'/>"
             . "<path d='M104 100c2-1 5-2 8-2 9 0 16 5 16 13v1h-19c-.5-5-2.5-9-5-12z' opacity='0.9'/>"
             . "</g>"
             // check badge bottom-right of the group
             . "<circle cx='118' cy='108' r='13' fill='{$o}'/>"
             . "<path d='M112 108l4 4 8-8' fill='none' stroke='#ffffff' stroke-width='2.6' stroke-linecap='round' stroke-linejoin='round'/>"
             . "</svg>";
        return 'data:image/svg+xml,' . rawurlencode($svg);
    }

    public function envelope(): Envelope
    {
        return new Envelope(
            subject: "Congratulations! Probation Period Successfully Completed — {$this->employeeName}",
        );
    }

    public function content(): Content
    {
        return new Content(view: 'emails.probation-completed');
    }
}
