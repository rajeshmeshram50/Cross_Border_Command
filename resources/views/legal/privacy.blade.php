@extends('legal.layout')
@section('title','Privacy Policy')
@section('body')

<p>Kryptone.AI ("the Platform") is an enterprise operations platform provided by
Inorbvict Group of Companies ("we", "us"). This policy explains what personal
data the Platform processes, why, and what rights you have.</p>

<p>The Platform is supplied to organisations, not to the general public. If you
use it as an employee or representative of an organisation, that organisation
decides what data is entered about you and for how long it is kept. We process
that data on their instructions.</p>

<h2>1. Data we process</h2>

<table>
  <tr><th>Category</th><th>Examples</th><th>Why</th></tr>
  <tr><td>Account</td><td>Name, work email, phone, role, branch, profile photo</td><td>Create and secure your login</td></tr>
  <tr><td>Google sign-in</td><td>Email address, name, Google account identifier</td><td>Verify who you are when you choose "Sign in with Google"</td></tr>
  <tr><td>Employment</td><td>Employee code, designation, department, reporting line, salary structure, leave and expense records</td><td>Operate the HR and payroll features your employer has enabled</td></tr>
  <tr><td>Attendance</td><td>Punch timestamps, device or terminal used, location of the office terminal</td><td>Record working hours</td></tr>
  <tr><td>Face data</td><td>A numeric face descriptor derived from a photograph</td><td>Optional face-based attendance and sign-in — see section 3</td></tr>
  <tr><td>Documents</td><td>Identity, KYC, compliance and contractual documents uploaded by you or your employer</td><td>Regulatory and contractual record-keeping</td></tr>
  <tr><td>Business records</td><td>Customers, vendors, leads, quotations, invoices, shipments</td><td>The trade operations the Platform exists to run</td></tr>
  <tr><td>Technical</td><td>IP address, browser type, session tokens, audit logs of actions taken</td><td>Security, troubleshooting and accountability</td></tr>
</table>

<h2>2. Google sign-in</h2>

<p>If you sign in with Google, Google tells us your email address, your name and
a Google account identifier. We use the email address solely to locate your
existing account on the Platform. If no account exists for that address, sign-in
is refused and nothing is stored.</p>

<p>We do not request access to your Gmail, Google Drive, contacts, calendar or
any other Google service, and we cannot read them. You can revoke the Platform's
access at any time at
<a href="https://myaccount.google.com/permissions">myaccount.google.com/permissions</a>.</p>

<h2>3. Face data</h2>

<p>Where your employer enables face-based attendance or sign-in, the Platform
converts a photograph of your face into a numeric descriptor and stores that
descriptor. The descriptor is compared against future captures to confirm a
match.</p>

<p>Face data is sensitive. It is used only for attendance and authentication,
is never sold or shared for advertising, and is deleted when your account is
deleted or when your employer disables the feature for you. If you prefer not to
use it, email and password sign-in remains available.</p>

<h2>4. Cookies and local storage</h2>

<p>The Platform stores a session token in your browser so you stay signed in,
along with interface preferences such as your selected branch and theme. These
are necessary for the Platform to function. We do not use advertising or
cross-site tracking cookies.</p>

<h2>5. Service providers</h2>

<p>We share data with the following providers only to the extent needed to
deliver the Platform:</p>

<ul>
  <li><strong>Google</strong> — sign-in verification</li>
  <li><strong>Razorpay</strong> — subscription and payment processing</li>
  <li><strong>Zoho Sign</strong> — electronic signature of agreements and trade documents</li>
  <li><strong>Microsoft Azure</strong> — document and file storage</li>
  <li><strong>Email delivery providers</strong> — transactional email such as notifications and password resets</li>
</ul>

<p>We do not sell personal data, and we do not share it for advertising.</p>

<h2>6. Retention</h2>

<p>Business and employment records are retained for as long as your organisation
requires them and for any period required by applicable law. Session tokens
expire on sign-out. Audit logs are retained for security purposes.</p>

<h2>7. Security</h2>

<p>Access is restricted by account, role and permission, and each organisation's
data is separated from every other organisation's. Traffic is encrypted in
transit. Passwords are stored only as salted hashes and are never recoverable in
readable form. Repeated failed sign-in attempts are locked out.</p>

<p>No system is perfectly secure. If we become aware of a breach affecting your
data, we will notify your organisation without undue delay.</p>

<h2>8. Your rights</h2>

<p>Depending on where you live, you may have the right to access, correct, or
request deletion of your personal data, to withdraw consent, and to complain to
a data protection authority.</p>

<p>Because your employer controls the data held about you, please direct such
requests to your organisation's administrator first. If you cannot reach them,
contact us at the address below and we will assist.</p>

<h2>9. Children</h2>

<p>The Platform is for workplace use and is not directed at anyone under 18.</p>

<h2>10. Changes</h2>

<p>We may update this policy. The date at the top of this page shows when it last
changed. Material changes will be communicated to the organisations that use the
Platform.</p>

<h2>11. Contact</h2>

<p>Inorbvict Group of Companies<br>
Email: <a href="mailto:{{ $contact }}">{{ $contact }}</a></p>

@endsection
