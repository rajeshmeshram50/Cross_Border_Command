/* ─────────────────────────────────────────────────────────────────────────
 * CLM Operations · Without Shipment ID — shared seed data + helpers.
 *
 * Faithful port of the in-memory datasets that drive the three operations
 * pages in the CLM_CaseToCase prototype:
 *   - Case to Case Contracts   (CTC list)
 *   - Agreements We Sent       (AWS sender view)
 *   - Agreements To Approve    (ATA approver view)
 *
 * These pages have no backend yet, so the data lives client-side exactly
 * like the prototype. The arrays below mirror `_ctcContracts`,
 * `_awsContracts` and `_ataContracts` verbatim.
 * ───────────────────────────────────────────────────────────────────────── */

export type CtcStatus = 'signed' | 'inprogress' | 'rejected';
export type Approval  = 'approved' | 'pending' | 'rejected';

export type CtcContract = {
  id: string; dbId?: number; title: string; cp: string[]; org: string; stage: number;
  status: CtcStatus; date: string; type: string; effDate: string; endDate: string;
  createdBy: string; approval: Approval; cpSignedDate: string;
};

/* ── CTC contracts (Case to Case list) ── */
export const CTC_CONTRACTS: CtcContract[] = [
  { id: 'CTC-001', title: 'Non-Disclosure Agreement',         cp: ['Counter Party 1', 'Tech Solutions Ltd'], org: 'IGC-Aurentic',   stage: 4, status: 'signed',     date: '23 May 2026', type: 'NDA', effDate: '01 Jan 2026', endDate: '31 Dec 2026', createdBy: 'Rahul Kumar',  approval: 'approved', cpSignedDate: '22 May 2026' },
  { id: 'CTC-002', title: 'Service Level Agreement',          cp: ['Tech Solutions Ltd'],                    org: 'IGC-Healthcare', stage: 2, status: 'inprogress', date: '20 May 2026', type: 'SLA', effDate: '01 Jun 2026', endDate: '31 May 2027', createdBy: 'Priya Sharma', approval: 'pending',  cpSignedDate: '—' },
  { id: 'CTC-003', title: 'Master Supply Agreement',          cp: ['Global Vendors Co.', 'Nexus Partners', 'Acme Corp'], org: 'IGC-Agrotech', stage: 3, status: 'inprogress', date: '18 May 2026', type: 'MSA', effDate: '15 Jun 2026', endDate: '14 Jun 2027', createdBy: 'Arjun Singh',  approval: 'approved', cpSignedDate: '—' },
  { id: 'CTC-004', title: 'Consulting Services Agreement',    cp: ['Acme Corp'],                             org: 'IGC-Aurentic',   stage: 2, status: 'rejected',   date: '15 May 2026', type: 'CSA', effDate: '01 Jun 2026', endDate: '30 Nov 2026', createdBy: 'Rahul Kumar',  approval: 'rejected', cpSignedDate: '—' },
  { id: 'CTC-005', title: 'Confidentiality Agreement',        cp: ['Nexus Partners', 'BlueStar Exports Ltd'], org: 'IGC-Healthcare', stage: 1, status: 'inprogress', date: '10 May 2026', type: 'NDA', effDate: '01 Jul 2026', endDate: '30 Jun 2027', createdBy: 'Meera Nair',   approval: 'pending',  cpSignedDate: '—' },
  { id: 'CTC-006', title: 'Vendor Partnership Agreement',     cp: ['BlueStar Exports Ltd'],                  org: 'IGC-Agrotech',   stage: 4, status: 'signed',     date: '05 May 2026', type: 'VPA', effDate: '01 Apr 2026', endDate: '31 Mar 2027', createdBy: 'Arjun Singh',  approval: 'approved', cpSignedDate: '04 May 2026' },
  { id: 'CTC-007', title: 'Software Licensing Agreement',     cp: ['Orion Tech Pvt Ltd', 'Apex Global LLC'], org: 'IGC-Aurentic',   stage: 3, status: 'inprogress', date: '02 May 2026', type: 'SLA', effDate: '01 Jun 2026', endDate: '31 May 2028', createdBy: 'Priya Sharma', approval: 'approved', cpSignedDate: '—' },
  { id: 'CTC-008', title: 'Distribution Agreement',           cp: ['Meridian Trading Co.'],                  org: 'IGC-Healthcare', stage: 2, status: 'inprogress', date: '28 Apr 2026', type: 'DA',  effDate: '15 Jun 2026', endDate: '14 Jun 2027', createdBy: 'Rahul Kumar',  approval: 'pending',  cpSignedDate: '—' },
  { id: 'CTC-009', title: 'Joint Venture Agreement',          cp: ['Apex Global LLC', 'Stride Logistics', 'NovaTech Systems'], org: 'IGC-Agrotech', stage: 1, status: 'inprogress', date: '25 Apr 2026', type: 'JVA', effDate: '01 Aug 2026', endDate: '31 Jul 2031', createdBy: 'Meera Nair', approval: 'pending', cpSignedDate: '—' },
  { id: 'CTC-010', title: 'Exclusive Agency Agreement',       cp: ['Stride Logistics'],                      org: 'IGC-Aurentic',   stage: 2, status: 'rejected',   date: '20 Apr 2026', type: 'EAA', effDate: '01 Jun 2026', endDate: '31 May 2027', createdBy: 'Karan Mehta',  approval: 'rejected', cpSignedDate: '—' },
  { id: 'CTC-011', title: 'Memorandum of Understanding',      cp: ['Pinnacle Resources', 'Delta Supplies Inc.'], org: 'IGC-Healthcare', stage: 4, status: 'signed', date: '15 Apr 2026', type: 'MOU', effDate: '01 Mar 2026', endDate: '28 Feb 2027', createdBy: 'Priya Sharma', approval: 'approved', cpSignedDate: '14 Apr 2026' },
  { id: 'CTC-012', title: 'Technology Transfer Agreement',    cp: ['NovaTech Systems'],                      org: 'IGC-Agrotech',   stage: 3, status: 'inprogress', date: '10 Apr 2026', type: 'TTA', effDate: '01 Jul 2026', endDate: '30 Jun 2028', createdBy: 'Arjun Singh',  approval: 'approved', cpSignedDate: '—' },
  { id: 'CTC-013', title: 'Procurement Framework Agreement',  cp: ['Delta Supplies Inc.', 'Horizon Consulting'], org: 'IGC-Aurentic', stage: 2, status: 'inprogress', date: '05 Apr 2026', type: 'PFA', effDate: '01 Jun 2026', endDate: '31 May 2027', createdBy: 'Rahul Kumar', approval: 'pending', cpSignedDate: '—' },
  { id: 'CTC-014', title: 'Non-Compete Agreement',            cp: ['Synergy Partners LLP'],                  org: 'IGC-Healthcare', stage: 1, status: 'rejected',   date: '01 Apr 2026', type: 'NCA', effDate: '01 Jul 2026', endDate: '30 Jun 2028', createdBy: 'Meera Nair',   approval: 'rejected', cpSignedDate: '—' },
  { id: 'CTC-015', title: 'Master Service Agreement',         cp: ['Horizon Consulting', 'Synergy Partners LLP', 'Pinnacle Resources'], org: 'IGC-Agrotech', stage: 4, status: 'signed', date: '25 Mar 2026', type: 'MSA', effDate: '01 Feb 2026', endDate: '31 Jan 2027', createdBy: 'Karan Mehta', approval: 'approved', cpSignedDate: '24 Mar 2026' },
];

export type AwsStatus = 'approved' | 'pending' | 'rejected' | 'clarify';
export type AwsContract = {
  id: string; title: string; cp: string[]; org: string; date: string;
  effDate: string; endDate: string; createdBy: string; approval: Approval; status: AwsStatus;
};

/* ── Agreements We Sent (sender's view of contracts) ── */
export const AWS_CONTRACTS: AwsContract[] = [
  { id: 'CTC-001', title: 'Non-Disclosure Agreement',        cp: ['Counter Party 1', 'Tech Solutions Ltd'], org: 'IGC-Aurentic',   date: '23 May 2026', effDate: '01 Jan 2026', endDate: '31 Dec 2026', createdBy: 'Rahul Kumar',  approval: 'approved', status: 'approved' },
  { id: 'CTC-002', title: 'Service Level Agreement',         cp: ['Tech Solutions Ltd'],                    org: 'IGC-Healthcare', date: '20 May 2026', effDate: '01 Jun 2026', endDate: '31 May 2027', createdBy: 'Priya Sharma', approval: 'pending',  status: 'pending' },
  { id: 'CTC-003', title: 'Master Supply Agreement',         cp: ['Global Vendors Co.', 'Nexus Partners', 'Acme Corp'], org: 'IGC-Agrotech', date: '18 May 2026', effDate: '15 Jun 2026', endDate: '14 Jun 2027', createdBy: 'Arjun Singh',  approval: 'approved', status: 'approved' },
  { id: 'CTC-004', title: 'Consulting Services Agreement',   cp: ['Acme Corp'],                             org: 'IGC-Aurentic',   date: '15 May 2026', effDate: '01 Jun 2026', endDate: '30 Nov 2026', createdBy: 'Rahul Kumar',  approval: 'rejected', status: 'rejected' },
  { id: 'CTC-005', title: 'Confidentiality Agreement',       cp: ['Nexus Partners', 'BlueStar Exports Ltd'], org: 'IGC-Healthcare', date: '10 May 2026', effDate: '01 Jul 2026', endDate: '30 Jun 2027', createdBy: 'Meera Nair',   approval: 'pending',  status: 'pending' },
  { id: 'CTC-006', title: 'Vendor Partnership Agreement',    cp: ['BlueStar Exports Ltd'],                  org: 'IGC-Agrotech',   date: '05 May 2026', effDate: '01 Apr 2026', endDate: '31 Mar 2027', createdBy: 'Arjun Singh',  approval: 'approved', status: 'approved' },
  { id: 'CTC-007', title: 'Software Licensing Agreement',    cp: ['Orion Tech Pvt Ltd', 'Apex Global LLC'], org: 'IGC-Aurentic',   date: '02 May 2026', effDate: '01 Jun 2026', endDate: '31 May 2028', createdBy: 'Priya Sharma', approval: 'approved', status: 'approved' },
  { id: 'CTC-008', title: 'Distribution Agreement',          cp: ['Meridian Trading Co.'],                  org: 'IGC-Healthcare', date: '28 Apr 2026', effDate: '15 Jun 2026', endDate: '14 Jun 2027', createdBy: 'Rahul Kumar',  approval: 'pending',  status: 'pending' },
  { id: 'CTC-009', title: 'Joint Venture Agreement',         cp: ['Apex Global LLC', 'Stride Logistics', 'NovaTech Systems'], org: 'IGC-Agrotech', date: '25 Apr 2026', effDate: '01 Aug 2026', endDate: '31 Jul 2031', createdBy: 'Meera Nair', approval: 'pending', status: 'pending' },
  { id: 'CTC-010', title: 'Exclusive Agency Agreement',      cp: ['Stride Logistics'],                      org: 'IGC-Aurentic',   date: '20 Apr 2026', effDate: '01 Jun 2026', endDate: '31 May 2027', createdBy: 'Karan Mehta',  approval: 'rejected', status: 'rejected' },
  { id: 'CTC-011', title: 'Memorandum of Understanding',     cp: ['Pinnacle Resources', 'Delta Supplies Inc.'], org: 'IGC-Healthcare', date: '15 Apr 2026', effDate: '01 Mar 2026', endDate: '28 Feb 2027', createdBy: 'Priya Sharma', approval: 'approved', status: 'approved' },
  { id: 'CTC-012', title: 'Technology Transfer Agreement',   cp: ['NovaTech Systems'],                      org: 'IGC-Agrotech',   date: '10 Apr 2026', effDate: '01 Jul 2026', endDate: '30 Jun 2028', createdBy: 'Arjun Singh',  approval: 'approved', status: 'clarify' },
  { id: 'CTC-013', title: 'Procurement Framework Agreement', cp: ['Delta Supplies Inc.', 'Horizon Consulting'], org: 'IGC-Aurentic', date: '05 Apr 2026', effDate: '01 Jun 2026', endDate: '31 May 2027', createdBy: 'Rahul Kumar', approval: 'pending', status: 'pending' },
  { id: 'CTC-014', title: 'Non-Compete Agreement',           cp: ['Synergy Partners LLP'],                  org: 'IGC-Healthcare', date: '01 Apr 2026', effDate: '01 Jul 2026', endDate: '30 Jun 2028', createdBy: 'Meera Nair',   approval: 'rejected', status: 'rejected' },
  { id: 'CTC-015', title: 'Master Service Agreement',        cp: ['Horizon Consulting', 'Synergy Partners LLP', 'Pinnacle Resources'], org: 'IGC-Agrotech', date: '25 Mar 2026', effDate: '01 Feb 2026', endDate: '31 Jan 2027', createdBy: 'Karan Mehta', approval: 'approved', status: 'clarify' },
];

export type AtaStatus = 'pending' | 'clarification' | 'approved' | 'rejected';
export type Clarification = { query: string; date: string; response: string; resolved: boolean; by?: string };
export type ApproverEntry = { name: string; status: AtaStatus | string };
export type AtaContract = {
  id: string; title: string; date: string; createdBy: string; approver: string;
  approvers?: ApproverEntry[];
  status: AtaStatus; clarifications: Clarification[]; expDate: string; rejReason?: string;
};

/* ── Agreements To Approve (approver's queue) ── */
export const ATA_CONTRACTS: AtaContract[] = [
  // Pending approval
  { id: 'CTC-002', title: 'Service Level Agreement',          date: '20 May 2026', createdBy: 'Priya Sharma', approver: 'Rajesh Kumar', status: 'pending',       clarifications: [], expDate: '31 May 2027' },
  { id: 'CTC-005', title: 'Confidentiality Agreement',        date: '10 May 2026', createdBy: 'Meera Nair',    approver: 'Rajesh Kumar', status: 'pending',       clarifications: [], expDate: '30 Jun 2027' },
  { id: 'CTC-008', title: 'Distribution Agreement',           date: '28 Apr 2026', createdBy: 'Rahul Kumar',   approver: 'Rajesh Kumar', status: 'pending',       clarifications: [], expDate: '14 Jun 2027' },
  { id: 'CTC-009', title: 'Joint Venture Agreement',          date: '25 Apr 2026', createdBy: 'Meera Nair',    approver: 'Rajesh Kumar', status: 'pending',       clarifications: [], expDate: '31 Jul 2031' },
  { id: 'CTC-013', title: 'Procurement Framework Agreement',  date: '05 Apr 2026', createdBy: 'Rahul Kumar',   approver: 'Sana Kapoor',  status: 'pending',       clarifications: [], expDate: '31 May 2027' },
  // Clarification — query raised, no response yet
  { id: 'CTC-007', title: 'Software Licensing Agreement',     date: '02 May 2026', createdBy: 'Priya Sharma',  approver: 'Sana Kapoor',  status: 'clarification', expDate: '31 May 2028',
    clarifications: [ { query: 'Please clarify the software usage scope — how many licensed users and which departments will access it?', date: '21 May 2026', response: '', resolved: false } ] },
  // Clarification — sender responded, approver yet to act
  { id: 'CTC-012', title: 'Technology Transfer Agreement',    date: '10 Apr 2026', createdBy: 'Arjun Singh',   approver: 'Rajesh Kumar', status: 'clarification', expDate: '30 Jun 2028',
    clarifications: [ { query: 'IP ownership clause in section 4.2 needs revision — who retains rights post-contract?', date: '18 Apr 2026', response: 'Post-contract, all IP rights revert to IGC-Agrotech as outlined in Annexure B. The clause has been updated accordingly.', resolved: false } ] },
  // Multi-round clarification
  { id: 'CTC-013a', title: 'Vendor Partnership Agreement (Rev.)', date: '05 May 2026', createdBy: 'Arjun Singh', approver: 'Sana Kapoor', status: 'clarification', expDate: '31 Mar 2027',
    clarifications: [
      { query: 'Payment terms in clause 6 — is it 30 days or 60 days from invoice date?', date: '08 May 2026', response: 'It is 30 days from invoice date. Clause 6 has been corrected in the revised draft attached.', resolved: true },
      { query: 'Revised draft not received — please re-attach the updated agreement with the corrected payment clause.', date: '15 May 2026', response: '', resolved: false } ] },
  { id: 'CTC-013b', title: 'Procurement Framework Agreement (Rev.)', date: '06 Apr 2026', createdBy: 'Rahul Kumar', approver: 'Rajesh Kumar', status: 'clarification', expDate: '31 May 2027',
    clarifications: [
      { query: 'Delivery schedule in section 3 conflicts with our Q3 timeline. Please revise.', date: '10 Apr 2026', response: 'Delivery schedule revised — Q3 milestones pushed to Q4. Updated section 3 attached.', resolved: true },
      { query: 'New delivery dates still overlap with existing supplier contract ending Oct 2026.', date: '17 Apr 2026', response: 'We have coordinated with the existing supplier. New start date is 01 Nov 2026. No overlap. Confirmed in writing.', resolved: false } ] },
  { id: 'CTC-015a', title: 'Master Service Agreement (Draft 2)', date: '26 Mar 2026', createdBy: 'Karan Mehta', approver: 'Sana Kapoor', status: 'clarification', expDate: '31 Jan 2027',
    clarifications: [ { query: 'SLA breach penalties are undefined. What are the financial penalties for downtime exceeding 99.5% uptime SLA?', date: '01 Apr 2026', response: 'Penalty is 2% of monthly contract value per hour of excess downtime, capped at 10% of monthly value. Clause 8.3 updated.', resolved: false } ] },
  // Approved
  { id: 'CTC-001', title: 'Non-Disclosure Agreement',         date: '23 May 2026', createdBy: 'Rahul Kumar',   approver: 'Rajesh Kumar', status: 'approved', clarifications: [], expDate: '31 Dec 2026' },
  { id: 'CTC-003', title: 'Master Supply Agreement',          date: '18 May 2026', createdBy: 'Arjun Singh',   approver: 'Sana Kapoor',  status: 'approved', clarifications: [], expDate: '14 Jun 2027' },
  { id: 'CTC-006', title: 'Vendor Partnership Agreement',     date: '05 May 2026', createdBy: 'Arjun Singh',   approver: 'Rajesh Kumar', status: 'approved', clarifications: [], expDate: '31 Mar 2027' },
  { id: 'CTC-011', title: 'Memorandum of Understanding',      date: '15 Apr 2026', createdBy: 'Priya Sharma',  approver: 'Sana Kapoor',  status: 'approved', clarifications: [], expDate: '28 Feb 2027' },
  { id: 'CTC-015', title: 'Master Service Agreement',         date: '25 Mar 2026', createdBy: 'Karan Mehta',   approver: 'Rajesh Kumar', status: 'approved', clarifications: [], expDate: '31 Jan 2027' },
  // Rejected
  { id: 'CTC-004', title: 'Consulting Services Agreement',    date: '15 May 2026', createdBy: 'Rahul Kumar',   approver: 'Sana Kapoor',  status: 'rejected', rejReason: 'Scope of work is too vague and lacks measurable deliverables.', clarifications: [], expDate: '30 Nov 2026' },
  { id: 'CTC-010', title: 'Exclusive Agency Agreement',       date: '20 Apr 2026', createdBy: 'Karan Mehta',   approver: 'Rajesh Kumar', status: 'rejected', rejReason: 'Exclusivity terms conflict with existing vendor agreements.', clarifications: [], expDate: '31 May 2027' },
  { id: 'CTC-014', title: 'Non-Compete Agreement',            date: '01 Apr 2026', createdBy: 'Meera Nair',    approver: 'Sana Kapoor',  status: 'rejected', rejReason: 'Geographic restriction scope is unreasonably broad.', clarifications: [], expDate: '30 Jun 2028' },
];

/* ── Helpers ── */
export const inits = (n: string): string =>
  (n || '').split(' ').map(w => w[0] || '').join('').slice(0, 2).toUpperCase();

export const pad2 = (n: number): string => String(n).padStart(2, '0');

export const PER_PAGE = 10;
