@extends('legal.layout')
@section('title','Terms of Service')
@section('body')

<p>These terms govern use of Kryptone.AI ("the Platform"), operated by Inorbvict
Group of Companies ("we", "us"). By signing in, you agree to them.</p>

<h2>1. Who may use the Platform</h2>

<p>Access is granted to organisations that subscribe, and to the people those
organisations authorise. Accounts are created by your organisation's
administrator; you may not create one yourself. Where a separate written
agreement exists between us and your organisation, that agreement prevails over
these terms if the two conflict.</p>

<h2>2. Your account</h2>

<ul>
  <li>Keep your credentials confidential and do not share your account.</li>
  <li>You are responsible for activity carried out under your account.</li>
  <li>Tell your administrator immediately if you suspect unauthorised access.</li>
  <li>We may suspend an account that is inactive, misused, or whose organisation's subscription has lapsed.</li>
</ul>

<h2>3. Acceptable use</h2>

<p>You must not:</p>

<ul>
  <li>Access data belonging to another organisation, or attempt to.</li>
  <li>Probe, scan, or test the security of the Platform without written permission.</li>
  <li>Interfere with its operation, including by automated scraping or excessive request volume.</li>
  <li>Upload malware, or content that is unlawful or that you have no right to upload.</li>
  <li>Reverse engineer, resell, or sublicense the Platform.</li>
</ul>

<h2>4. Your data</h2>

<p>Data your organisation enters remains your organisation's. We claim no
ownership of it. We process it to operate the Platform, as described in our
<a href="/privacy">Privacy Policy</a>.</p>

<p>Your organisation is responsible for the accuracy and lawfulness of what it
enters, including having a lawful basis to upload information about employees,
customers and third parties.</p>

<h2>5. Fees</h2>

<p>Paid plans are billed according to the plan your organisation selects. Access
to features may be limited or suspended if a subscription expires or payment
fails. Payments are processed by Razorpay; we do not store card details.</p>

<h2>6. Availability</h2>

<p>We aim to keep the Platform available, but it may be unavailable during
maintenance, or because of events outside our control. Unless a separate written
agreement states otherwise, the Platform is provided on an "as is" basis without
warranties of any kind.</p>

<h2>7. Third-party services</h2>

<p>The Platform integrates with services such as Google, Razorpay and Zoho Sign.
Your use of those services is also governed by their own terms. We are not
responsible for their availability or conduct.</p>

<h2>8. Limitation of liability</h2>

<p>To the maximum extent permitted by law, we are not liable for indirect or
consequential loss, loss of profit, or loss of data. Nothing in these terms
limits liability that cannot lawfully be limited.</p>

<h2>9. Termination</h2>

<p>Your organisation may stop using the Platform at any time. We may suspend or
terminate access for breach of these terms, or where required by law. On
termination, your organisation may request an export of its data within a
reasonable period.</p>

<h2>10. Changes</h2>

<p>We may update these terms. The date at the top of this page shows when they
last changed. Continuing to use the Platform after a change means you accept the
updated terms.</p>

<h2>11. Governing law</h2>

<p>These terms are governed by the laws of India, and the courts of Pune,
Maharashtra have exclusive jurisdiction, unless a separate written agreement
with your organisation states otherwise.</p>

<h2>12. Contact</h2>

<p>Inorbvict Group of Companies<br>
Email: <a href="mailto:{{ $contact }}">{{ $contact }}</a></p>

@endsection
