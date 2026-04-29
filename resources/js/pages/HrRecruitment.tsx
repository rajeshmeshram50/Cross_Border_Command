import { useEffect, useMemo, useState } from 'react';
import { Card, CardBody, Col, Row, Button, Input, Modal, ModalBody } from 'reactstrap';
import { MasterSelect, MasterDatePicker, MasterFormStyles } from './master/masterFormKit';
import { useToast } from '../contexts/ToastContext';

// ── Types ────────────────────────────────────────────────────────────────────
type RecruitmentStatus = 'In Progress' | 'Completed' | 'Cancelled';
type Priority = 'Low' | 'Medium' | 'High' | 'Critical';
type WorkMode = 'On-site' | 'Remote' | 'Hybrid' | 'Flexible';
type EmployType = 'Full Time' | 'Part Time' | 'Contract' | 'Internship';

interface RecruitmentRow {
  id: string;
  jobTitle: string;
  department: string;
  designation: string;
  employmentType: EmployType;
  openings: number;
  experience: string;
  workMode: WorkMode;
  priority: Priority;
  hiringManagerName: string;
  hiringManagerRole: string;
  hiringManagerInitials: string;
  hiringManagerAccent: string;
  assignedHrName: string;
  assignedHrInitials: string;
  assignedHrAccent: string;
  startDate: string;
  deadline: string;
  status: RecruitmentStatus;
}

type RequestStatus = 'Approved' | 'Under Review' | 'Submitted' | 'Sent Back' | 'Draft' | 'Rejected';
type RequestUrgency = 'Low' | 'Medium' | 'High' | 'Critical';
type RequestType =
  | 'New Position'
  | 'Replacement Hiring'
  | 'Intern Requirement'
  | 'Backfill'
  | 'Expansion Hiring'
  | 'Urgent Temporary Support';

interface HiringRequestRow {
  id: string;
  position: string;
  positionType: EmployType | 'Intern';
  positionMode: WorkMode;
  department: string;
  requestedByName: string;
  requestedByInitials: string;
  requestedByAccent: string;
  openings: number;
  requestType: RequestType;
  urgency: RequestUrgency;
  status: RequestStatus;
  requestDate: string;
  targetJoinDate: string;
}

// ── Mock data — 25 recruitments split across the 3 status tabs ──────────────
const RECRUITMENTS: RecruitmentRow[] = [
  // ── In Progress (19) ──
  { id: 'REC-1001', jobTitle: 'Senior Backend Engineer',  department: 'Engineering',     designation: 'Senior Software Engineer', employmentType: 'Full Time', openings: 2, experience: '5 yr+', workMode: 'Hybrid',  priority: 'High',   hiringManagerName: 'Vishal Rao',     hiringManagerRole: 'CEO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Sneha Chavan', assignedHrInitials: 'SC', assignedHrAccent: '#0ab39c', startDate: '05 Mar 2026', deadline: '20 May 2026', status: 'In Progress' },
  { id: 'REC-1002', jobTitle: 'Product Designer',         department: 'Design',          designation: 'Sr. Designer',             employmentType: 'Full Time', openings: 1, experience: '3 yr+', workMode: 'Hybrid',  priority: 'Medium', hiringManagerName: 'Amit Shah',      hiringManagerRole: 'HOD',                  hiringManagerInitials: 'H',  hiringManagerAccent: '#f06548', assignedHrName: 'Pooja Mehta',  assignedHrInitials: 'PM', assignedHrAccent: '#7c5cfc', startDate: '12 Mar 2026', deadline: '30 May 2026', status: 'In Progress' },
  { id: 'REC-1003', jobTitle: 'Sales Executive',          department: 'Sales',           designation: 'Executive',                employmentType: 'Full Time', openings: 4, experience: '1 yr+', workMode: 'On-site', priority: 'High',   hiringManagerName: 'Priya Iyer',     hiringManagerRole: 'Sales Lead',           hiringManagerInitials: 'SL', hiringManagerAccent: '#0ab39c', assignedHrName: 'Rahul Verma',  assignedHrInitials: 'RV', assignedHrAccent: '#f7b84b', startDate: '18 Feb 2026', deadline: '25 Apr 2026', status: 'In Progress' },
  { id: 'REC-1004', jobTitle: 'HR Intern',                department: 'HR',              designation: 'Intern',                   employmentType: 'Internship',openings: 2, experience: '0 yr+', workMode: 'On-site', priority: 'Low',    hiringManagerName: 'Sneha Chavan',   hiringManagerRole: 'HR Head',              hiringManagerInitials: 'HH', hiringManagerAccent: '#0ab39c', assignedHrName: 'Anjali Rao',   assignedHrInitials: 'AR', assignedHrAccent: '#e83e8c', startDate: '20 Mar 2026', deadline: '01 May 2026', status: 'In Progress' },
  { id: 'REC-1007', jobTitle: 'DevOps Engineer',          department: 'Engineering',     designation: 'Software Engineer',        employmentType: 'Full Time', openings: 1, experience: '4 yr+', workMode: 'Remote',  priority: 'High',   hiringManagerName: 'Arun Gupta',     hiringManagerRole: 'CTO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Sneha Chavan', assignedHrInitials: 'SC', assignedHrAccent: '#0ab39c', startDate: '25 Mar 2026', deadline: '05 Jun 2026', status: 'In Progress' },
  { id: 'REC-1008', jobTitle: 'Frontend Engineer',        department: 'Engineering',     designation: 'Software Engineer',        employmentType: 'Full Time', openings: 2, experience: '3 yr+', workMode: 'Hybrid',  priority: 'High',   hiringManagerName: 'Arun Gupta',     hiringManagerRole: 'CTO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Sneha Chavan', assignedHrInitials: 'SC', assignedHrAccent: '#0ab39c', startDate: '28 Mar 2026', deadline: '10 Jun 2026', status: 'In Progress' },
  { id: 'REC-1009', jobTitle: 'QA Automation Engineer',   department: 'Engineering',     designation: 'Senior QA Engineer',       employmentType: 'Full Time', openings: 2, experience: '4 yr+', workMode: 'On-site', priority: 'Medium', hiringManagerName: 'Arun Gupta',     hiringManagerRole: 'CTO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Karan Singh',  assignedHrInitials: 'KS', assignedHrAccent: '#0ea5e9', startDate: '01 Apr 2026', deadline: '20 Jun 2026', status: 'In Progress' },
  { id: 'REC-1010', jobTitle: 'Data Engineer',            department: 'Engineering',     designation: 'Data Engineer',            employmentType: 'Full Time', openings: 1, experience: '5 yr+', workMode: 'Hybrid',  priority: 'High',   hiringManagerName: 'Arun Gupta',     hiringManagerRole: 'CTO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Sneha Chavan', assignedHrInitials: 'SC', assignedHrAccent: '#0ab39c', startDate: '02 Apr 2026', deadline: '15 Jun 2026', status: 'In Progress' },
  { id: 'REC-1011', jobTitle: 'UI/UX Designer',           department: 'Design',          designation: 'Designer',                 employmentType: 'Full Time', openings: 1, experience: '2 yr+', workMode: 'Hybrid',  priority: 'Medium', hiringManagerName: 'Neha Kulkarni',  hiringManagerRole: 'Design Head',          hiringManagerInitials: 'DH', hiringManagerAccent: '#f06548', assignedHrName: 'Pooja Mehta',  assignedHrInitials: 'PM', assignedHrAccent: '#7c5cfc', startDate: '18 Mar 2026', deadline: '25 May 2026', status: 'In Progress' },
  { id: 'REC-1012', jobTitle: 'Business Development Manager', department: 'Sales',       designation: 'Manager',                  employmentType: 'Full Time', openings: 1, experience: '7 yr+', workMode: 'On-site', priority: 'High',   hiringManagerName: 'Priya Iyer',     hiringManagerRole: 'Sales Lead',           hiringManagerInitials: 'SL', hiringManagerAccent: '#0ab39c', assignedHrName: 'Rahul Verma',  assignedHrInitials: 'RV', assignedHrAccent: '#f7b84b', startDate: '22 Mar 2026', deadline: '30 May 2026', status: 'In Progress' },
  { id: 'REC-1013', jobTitle: 'Mobile App Developer',     department: 'Engineering',     designation: 'Software Engineer',        employmentType: 'Full Time', openings: 2, experience: '3 yr+', workMode: 'Hybrid',  priority: 'High',   hiringManagerName: 'Arun Gupta',     hiringManagerRole: 'CTO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Sneha Chavan', assignedHrInitials: 'SC', assignedHrAccent: '#0ab39c', startDate: '06 Apr 2026', deadline: '18 Jun 2026', status: 'In Progress' },
  { id: 'REC-1014', jobTitle: 'Customer Support Lead',    department: 'Operations',      designation: 'Lead',                     employmentType: 'Full Time', openings: 1, experience: '4 yr+', workMode: 'On-site', priority: 'Medium', hiringManagerName: 'Ritu Khanna',    hiringManagerRole: 'COO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#0ea5e9', assignedHrName: 'Anjali Rao',   assignedHrInitials: 'AR', assignedHrAccent: '#e83e8c', startDate: '10 Apr 2026', deadline: '22 Jun 2026', status: 'In Progress' },
  { id: 'REC-1015', jobTitle: 'Cloud Architect',          department: 'Engineering',     designation: 'Architect',                employmentType: 'Full Time', openings: 1, experience: '8 yr+', workMode: 'Remote',  priority: 'Critical', hiringManagerName: 'Arun Gupta', hiringManagerRole: 'CTO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Sneha Chavan', assignedHrInitials: 'SC', assignedHrAccent: '#0ab39c', startDate: '15 Apr 2026', deadline: '15 Jul 2026', status: 'In Progress' },
  { id: 'REC-1016', jobTitle: 'Content Marketing Lead',   department: 'Marketing',       designation: 'Lead',                     employmentType: 'Full Time', openings: 1, experience: '5 yr+', workMode: 'Hybrid',  priority: 'Medium', hiringManagerName: 'Ritu Khanna',    hiringManagerRole: 'CMO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#0ea5e9', assignedHrName: 'Pooja Mehta',  assignedHrInitials: 'PM', assignedHrAccent: '#7c5cfc', startDate: '12 Apr 2026', deadline: '28 Jun 2026', status: 'In Progress' },
  { id: 'REC-1017', jobTitle: 'Account Manager',          department: 'Sales',           designation: 'Manager',                  employmentType: 'Full Time', openings: 2, experience: '4 yr+', workMode: 'On-site', priority: 'High',   hiringManagerName: 'Priya Iyer',     hiringManagerRole: 'Sales Lead',           hiringManagerInitials: 'SL', hiringManagerAccent: '#0ab39c', assignedHrName: 'Rahul Verma',  assignedHrInitials: 'RV', assignedHrAccent: '#f7b84b', startDate: '08 Apr 2026', deadline: '20 Jun 2026', status: 'In Progress' },
  { id: 'REC-1018', jobTitle: 'Recruitment Specialist',   department: 'HR',              designation: 'Specialist',               employmentType: 'Full Time', openings: 1, experience: '3 yr+', workMode: 'Hybrid',  priority: 'Medium', hiringManagerName: 'Sneha Chavan',   hiringManagerRole: 'HR Head',              hiringManagerInitials: 'HH', hiringManagerAccent: '#0ab39c', assignedHrName: 'Anjali Rao',   assignedHrInitials: 'AR', assignedHrAccent: '#e83e8c', startDate: '14 Apr 2026', deadline: '30 Jun 2026', status: 'In Progress' },
  { id: 'REC-1019', jobTitle: 'Finance Manager',          department: 'Finance',         designation: 'Manager',                  employmentType: 'Full Time', openings: 1, experience: '6 yr+', workMode: 'On-site', priority: 'High',   hiringManagerName: 'Nikhil Mehra',   hiringManagerRole: 'CFO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#f7b84b', assignedHrName: 'Karan Singh',  assignedHrInitials: 'KS', assignedHrAccent: '#0ea5e9', startDate: '05 Apr 2026', deadline: '15 Jun 2026', status: 'In Progress' },
  { id: 'REC-1020', jobTitle: 'Logistics Coordinator',    department: 'Operations',      designation: 'Coordinator',              employmentType: 'Full Time', openings: 2, experience: '2 yr+', workMode: 'On-site', priority: 'Medium', hiringManagerName: 'Ritu Khanna',    hiringManagerRole: 'COO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#0ea5e9', assignedHrName: 'Anjali Rao',   assignedHrInitials: 'AR', assignedHrAccent: '#e83e8c', startDate: '18 Apr 2026', deadline: '02 Jul 2026', status: 'In Progress' },
  { id: 'REC-1021', jobTitle: 'Solutions Architect',      department: 'Engineering',     designation: 'Architect',                employmentType: 'Full Time', openings: 1, experience: '7 yr+', workMode: 'Hybrid',  priority: 'Critical', hiringManagerName: 'Arun Gupta', hiringManagerRole: 'CTO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Sneha Chavan', assignedHrInitials: 'SC', assignedHrAccent: '#0ab39c', startDate: '20 Apr 2026', deadline: '10 Jul 2026', status: 'In Progress' },

  // ── Completed (4) ──
  { id: 'REC-1005', jobTitle: 'Finance Analyst',          department: 'Finance',         designation: 'Analyst',                  employmentType: 'Full Time', openings: 1, experience: '2 yr+', workMode: 'On-site', priority: 'Medium', hiringManagerName: 'Nikhil Mehra',   hiringManagerRole: 'CFO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#f7b84b', assignedHrName: 'Karan Singh',  assignedHrInitials: 'KS', assignedHrAccent: '#0ea5e9', startDate: '10 Jan 2026', deadline: '15 Mar 2026', status: 'Completed' },
  { id: 'REC-1022', jobTitle: 'Technical Writer',         department: 'Engineering',     designation: 'Writer',                   employmentType: 'Contract', openings: 1, experience: '3 yr+', workMode: 'Remote',  priority: 'Low',    hiringManagerName: 'Arun Gupta',     hiringManagerRole: 'CTO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Sneha Chavan', assignedHrInitials: 'SC', assignedHrAccent: '#0ab39c', startDate: '25 Jan 2026', deadline: '20 Mar 2026', status: 'Completed' },
  { id: 'REC-1023', jobTitle: 'Legal Counsel',            department: 'HR',              designation: 'Counsel',                  employmentType: 'Full Time', openings: 1, experience: '6 yr+', workMode: 'Hybrid',  priority: 'High',   hiringManagerName: 'Vishal Rao',     hiringManagerRole: 'CEO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Anjali Rao',   assignedHrInitials: 'AR', assignedHrAccent: '#e83e8c', startDate: '05 Feb 2026', deadline: '10 Apr 2026', status: 'Completed' },
  { id: 'REC-1024', jobTitle: 'Customer Success Lead',    department: 'Sales',           designation: 'Lead',                     employmentType: 'Full Time', openings: 1, experience: '5 yr+', workMode: 'Hybrid',  priority: 'Medium', hiringManagerName: 'Priya Iyer',     hiringManagerRole: 'Sales Lead',           hiringManagerInitials: 'SL', hiringManagerAccent: '#0ab39c', assignedHrName: 'Rahul Verma',  assignedHrInitials: 'RV', assignedHrAccent: '#f7b84b', startDate: '12 Feb 2026', deadline: '18 Apr 2026', status: 'Completed' },

  // ── Cancelled (2) ──
  { id: 'REC-1006', jobTitle: 'Marketing Manager',        department: 'Marketing',       designation: 'Manager',                  employmentType: 'Full Time', openings: 1, experience: '6 yr+', workMode: 'Hybrid',  priority: 'Medium', hiringManagerName: 'Ritu Khanna',    hiringManagerRole: 'CMO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#0ea5e9', assignedHrName: 'Pooja Mehta',  assignedHrInitials: 'PM', assignedHrAccent: '#7c5cfc', startDate: '01 Feb 2026', deadline: '30 Mar 2026', status: 'Cancelled' },
  { id: 'REC-1025', jobTitle: 'SRE Engineer',             department: 'Engineering',     designation: 'Software Engineer',        employmentType: 'Full Time', openings: 2, experience: '4 yr+', workMode: 'Remote',  priority: 'Medium', hiringManagerName: 'Arun Gupta',     hiringManagerRole: 'CTO',                  hiringManagerInitials: 'C',  hiringManagerAccent: '#7c5cfc', assignedHrName: 'Sneha Chavan', assignedHrInitials: 'SC', assignedHrAccent: '#0ab39c', startDate: '20 Jan 2026', deadline: '25 Mar 2026', status: 'Cancelled' },
];

// ── Hiring Requests (mock) ──
const HIRING_REQUESTS: HiringRequestRow[] = [
  { id: 'HRQ-001', position: 'Senior ML Engineer',   positionType: 'Full Time',  positionMode: 'Hybrid',  department: 'Engineering', requestedByName: 'Gaurav Jagtap',  requestedByInitials: 'GJ', requestedByAccent: '#0c63b0', openings: 2, requestType: 'New Position',          urgency: 'High',     status: 'Approved',    requestDate: 'Apr 1, 2026',  targetJoinDate: 'May 15, 2026' },
  { id: 'HRQ-002', position: 'HR Executive',          positionType: 'Full Time',  positionMode: 'On-site', department: 'HR',          requestedByName: 'Priya Mehta',    requestedByInitials: 'PM', requestedByAccent: '#7c5cfc', openings: 1, requestType: 'Replacement Hiring',    urgency: 'Medium',   status: 'Under Review',requestDate: 'Apr 5, 2026',  targetJoinDate: 'May 1, 2026' },
  { id: 'HRQ-003', position: 'React Native Intern',   positionType: 'Intern',     positionMode: 'Hybrid',  department: 'Mobile',      requestedByName: 'Mayur Thorat',   requestedByInitials: 'MT', requestedByAccent: '#0ab39c', openings: 3, requestType: 'Intern Requirement',    urgency: 'Low',      status: 'Submitted',   requestDate: 'Apr 7, 2026',  targetJoinDate: 'Jun 1, 2026' },
  { id: 'HRQ-004', position: 'Finance Analyst',       positionType: 'Full Time',  positionMode: 'On-site', department: 'Finance',     requestedByName: 'Nisha Kapoor',   requestedByInitials: 'NK', requestedByAccent: '#f06548', openings: 1, requestType: 'Backfill',              urgency: 'Critical', status: 'Sent Back',   requestDate: 'Apr 3, 2026',  targetJoinDate: 'Apr 20, 2026' },
  { id: 'HRQ-005', position: 'QA Lead',               positionType: 'Full Time',  positionMode: 'On-site', department: 'Engineering', requestedByName: 'Atharv Patekar', requestedByInitials: 'AP', requestedByAccent: '#0ea5e9', openings: 1, requestType: 'New Position',          urgency: 'High',     status: 'Draft',       requestDate: 'Apr 9, 2026',  targetJoinDate: 'May 10, 2026' },
  { id: 'HRQ-006', position: 'Business Analyst',      positionType: 'Contract',   positionMode: 'Remote',  department: 'Product',     requestedByName: 'Rajesh Meshram', requestedByInitials: 'RM', requestedByAccent: '#e83e8c', openings: 1, requestType: 'Expansion Hiring',      urgency: 'Medium',   status: 'Rejected',    requestDate: 'Mar 28, 2026', targetJoinDate: 'Apr 30, 2026' },
  { id: 'HRQ-007', position: 'DevOps Engineer',       positionType: 'Full Time',  positionMode: 'Hybrid',  department: 'Engineering', requestedByName: 'Atharv Patekar', requestedByInitials: 'AP', requestedByAccent: '#0ea5e9', openings: 1, requestType: 'Urgent Temporary Support', urgency: 'Critical', status: 'Approved',    requestDate: 'Apr 2, 2026',  targetJoinDate: 'Apr 25, 2026' },
];

// ── Lookup palettes ─────────────────────────────────────────────────────────
const PRIORITY_TONES: Record<Priority, { bg: string; fg: string }> = {
  Low:      { bg: '#d6f4e3', fg: '#108548' },
  Medium:   { bg: '#fde8c4', fg: '#a4661c' },
  High:     { bg: '#fdd9d6', fg: '#b1401d' },
  Critical: { bg: '#fdd9ea', fg: '#a02960' },
};

const WORK_MODE_TONES: Record<WorkMode, { bg: string; fg: string }> = {
  'On-site':  { bg: '#dceefe', fg: '#0c63b0' },
  Remote:     { bg: '#fde8c4', fg: '#a4661c' },
  Hybrid:     { bg: '#ece6ff', fg: '#5a3fd1' },
  Flexible:   { bg: '#d3f0ee', fg: '#0a716a' },
};

const REQUEST_STATUS_TONES: Record<RequestStatus, { bg: string; fg: string; dot: string }> = {
  Approved:      { bg: '#d6f4e3', fg: '#108548', dot: '#10b981' },
  'Under Review':{ bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  Submitted:     { bg: '#dceefe', fg: '#0c63b0', dot: '#3b82f6' },
  'Sent Back':   { bg: '#fde8c4', fg: '#a4661c', dot: '#f59e0b' },
  Draft:         { bg: '#eef2f6', fg: '#5b6478', dot: '#878a99' },
  Rejected:      { bg: '#fdd9d6', fg: '#b1401d', dot: '#f06548' },
};

const REQUEST_URGENCY_TONES: Record<RequestUrgency, { bg: string; fg: string }> = {
  Low:      { bg: '#d6f4e3', fg: '#108548' },
  Medium:   { bg: '#fde8c4', fg: '#a4661c' },
  High:     { bg: '#fdd9d6', fg: '#b1401d' },
  Critical: { bg: '#fdd9ea', fg: '#a02960' },
};

// ── KPI cards (6 tiles) ─────────────────────────────────────────────────────
const KPI_CARDS = [
  { key: 'total',       label: 'Total Recruitments', icon: 'ri-briefcase-4-line',     gradient: 'linear-gradient(135deg,#405189,#6691e7)' },
  { key: 'active',      label: 'Active Hiring',      icon: 'ri-checkbox-circle-fill', gradient: 'linear-gradient(135deg,#0ab39c,#02c8a7)' },
  { key: 'candidates',  label: 'Total Candidates',   icon: 'ri-team-line',            gradient: 'linear-gradient(135deg,#299cdb,#63bcec)' },
  { key: 'selected',    label: 'Selected',           icon: 'ri-user-follow-line',     gradient: 'linear-gradient(135deg,#10b981,#34d399)' },
  { key: 'rejected',    label: 'Rejected',           icon: 'ri-close-circle-fill',    gradient: 'linear-gradient(135deg,#f06548,#f4907b)' },
  { key: 'pending',     label: 'Pending Interviews', icon: 'ri-time-line',            gradient: 'linear-gradient(135deg,#f7b84b,#fad07e)' },
] as const;

// ── Filter option lists ────────────────────────────────────────────────────
const DEPARTMENT_FILTER_OPTIONS = [
  { value: 'All',         label: 'All' },
  { value: 'Engineering', label: 'Engineering' },
  { value: 'Design',      label: 'Design' },
  { value: 'Sales',       label: 'Sales' },
  { value: 'HR',          label: 'HR' },
  { value: 'Finance',     label: 'Finance' },
  { value: 'Marketing',   label: 'Marketing' },
  { value: 'Operations',  label: 'Operations' },
  { value: 'Mobile',      label: 'Mobile' },
  { value: 'Product',     label: 'Product' },
];
const PRIORITY_FILTER_OPTIONS = [
  { value: 'All',      label: 'All' },
  { value: 'Low',      label: 'Low' },
  { value: 'Medium',   label: 'Medium' },
  { value: 'High',     label: 'High' },
  { value: 'Critical', label: 'Critical' },
];
const JOB_TYPE_FILTER_OPTIONS = [
  { value: 'All',         label: 'All' },
  { value: 'Full Time',   label: 'Full Time' },
  { value: 'Part Time',   label: 'Part Time' },
  { value: 'Contract',    label: 'Contract' },
  { value: 'Internship',  label: 'Internship' },
];

// ── Form option lists for Raise Hiring Request modal ───────────────────────
const HR_DEPT_OPTIONS = [
  { value: 'Engineering', label: 'Engineering' },
  { value: 'Design',      label: 'Design' },
  { value: 'Sales',       label: 'Sales' },
  { value: 'HR',          label: 'HR' },
  { value: 'Finance',     label: 'Finance' },
  { value: 'Marketing',   label: 'Marketing' },
  { value: 'Operations',  label: 'Operations' },
  { value: 'Product',     label: 'Product' },
  { value: 'Mobile',      label: 'Mobile' },
];
const EMPLOYMENT_TYPE_OPTIONS = [
  { value: 'Full-time', label: 'Full-time' },
  { value: 'Part-time', label: 'Part-time' },
  { value: 'Contract',  label: 'Contract' },
  { value: 'Intern',    label: 'Intern' },
];
const REQUIRED_EXPERIENCE_OPTIONS = [
  { value: '0-1',  label: '0 – 1 yr (Entry)' },
  { value: '1-3',  label: '1 – 3 yr (Junior)' },
  { value: '3-5',  label: '3 – 5 yr (Mid)' },
  { value: '5-8',  label: '5 – 8 yr (Senior)' },
  { value: '8+',   label: '8+ yr (Lead/Principal)' },
];
const REQUEST_TYPE_OPTIONS = [
  { value: 'New Position',           label: 'New Position' },
  { value: 'Replacement Hiring',     label: 'Replacement Hiring' },
  { value: 'Backfill',               label: 'Backfill' },
  { value: 'Expansion Hiring',       label: 'Expansion Hiring' },
  { value: 'Intern Requirement',     label: 'Intern Requirement' },
  { value: 'Urgent Temporary Support', label: 'Urgent Temporary Support' },
];

// ── Hiring Manager / HR options for Create Recruitment ─────────────────────
const HIRING_MANAGER_OPTIONS = [
  { value: 'CEO – Vishal Rao',           label: 'CEO – Vishal Rao' },
  { value: 'CTO – Arun Gupta',           label: 'CTO – Arun Gupta' },
  { value: 'CFO – Nikhil Mehra',         label: 'CFO – Nikhil Mehra' },
  { value: 'CMO – Ritu Khanna',          label: 'CMO – Ritu Khanna' },
  { value: 'COO – Ritu Khanna',          label: 'COO – Ritu Khanna' },
  { value: 'HR Head – Sneha Chavan',     label: 'HR Head – Sneha Chavan' },
  { value: 'Sales Lead – Priya Iyer',    label: 'Sales Lead – Priya Iyer' },
  { value: 'Design Head – Neha Kulkarni',label: 'Design Head – Neha Kulkarni' },
  { value: 'HOD – Amit Shah',            label: 'HOD – Amit Shah' },
];
const ASSIGNED_HR_OPTIONS = [
  { value: 'Sneha Chavan', label: 'Sneha Chavan' },
  { value: 'Pooja Mehta',  label: 'Pooja Mehta' },
  { value: 'Rahul Verma',  label: 'Rahul Verma' },
  { value: 'Anjali Rao',   label: 'Anjali Rao' },
  { value: 'Karan Singh',  label: 'Karan Singh' },
];
const WORK_MODE_OPTIONS = [
  { value: 'On-site',  label: 'On-site' },
  { value: 'Remote',   label: 'Remote' },
  { value: 'Hybrid',   label: 'Hybrid' },
  { value: 'Flexible', label: 'Flexible' },
];
const REC_EMPLOYMENT_OPTIONS = [
  { value: 'Full Time',  label: 'Full Time' },
  { value: 'Part Time',  label: 'Part Time' },
  { value: 'Contract',   label: 'Contract' },
  { value: 'Internship', label: 'Internship' },
];
const REC_PRIORITY_OPTIONS: { value: Priority; label: Priority }[] = [
  { value: 'Low',      label: 'Low' },
  { value: 'Medium',   label: 'Medium' },
  { value: 'High',     label: 'High' },
  { value: 'Critical', label: 'Critical' },
];

// ── Page ────────────────────────────────────────────────────────────────────
export default function HrRecruitment() {
  const toast = useToast();

  // List state
  const [tab, setTab] = useState<RecruitmentStatus>('In Progress');
  const [q, setQ] = useState('');
  const [deptFilter, setDeptFilter]     = useState<string>('All');
  const [priorityFilter, setPriorityFilter] = useState<string>('All');
  const [jobTypeFilter, setJobTypeFilter]   = useState<string>('All');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  // Reset page when tab / filters change
  useEffect(() => { setPage(1); }, [tab, q, deptFilter, priorityFilter, jobTypeFilter]);

  // Counts
  const counts = useMemo(() => {
    const total = RECRUITMENTS.length;
    const inProgress = RECRUITMENTS.filter(r => r.status === 'In Progress').length;
    const completed  = RECRUITMENTS.filter(r => r.status === 'Completed').length;
    const cancelled  = RECRUITMENTS.filter(r => r.status === 'Cancelled').length;
    return {
      total,
      active: inProgress,
      // Mock totals — visible on the KPI tiles
      candidates: 55,
      selected: 13,
      rejected: 14,
      pending: 25,
      tabs: { 'In Progress': inProgress, Completed: completed, Cancelled: cancelled },
    };
  }, []);

  // Filtered rows
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return RECRUITMENTS.filter(r => r.status === tab)
      .filter(r => deptFilter === 'All' || r.department === deptFilter)
      .filter(r => priorityFilter === 'All' || r.priority === priorityFilter)
      .filter(r => jobTypeFilter === 'All' || r.employmentType === jobTypeFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          r.id.toLowerCase().includes(needle) ||
          r.jobTitle.toLowerCase().includes(needle) ||
          r.department.toLowerCase().includes(needle) ||
          r.assignedHrName.toLowerCase().includes(needle) ||
          r.hiringManagerName.toLowerCase().includes(needle)
        );
      });
  }, [tab, q, deptFilter, priorityFilter, jobTypeFilter]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const safePage  = Math.min(page, pageCount);
  const sliceFrom = (safePage - 1) * pageSize;
  const visible   = filtered.slice(sliceFrom, sliceFrom + pageSize);

  // ── Modal switches ─────────────────────────────────────────────────────────
  const [createOpen, setCreateOpen]                 = useState(false);
  const [createMode, setCreateMode]                 = useState<'add' | 'edit'>('add');
  const [createEditingId, setCreateEditingId]       = useState<string | null>(null);
  const [raiseOpen, setRaiseOpen]                   = useState(false);
  const [requestsOpen, setRequestsOpen]             = useState(false);
  const [cancelTarget, setCancelTarget]             = useState<RecruitmentRow | null>(null);
  const [candidatesTarget, setCandidatesTarget]     = useState<RecruitmentRow | null>(null);

  // Pagination helpers
  const goto = (p: number) => setPage(Math.min(Math.max(1, p), pageCount));

  return (
    <>
      <style>{`
        .rec-surface { background: #ffffff; }
        [data-bs-theme="dark"] .rec-surface { background: #1c2531; }
        .rec-tab { border-radius: 12px; padding: 10px 18px; font-weight: 600; font-size: 13.5px; cursor: pointer; transition: all .15s ease; display: inline-flex; align-items: center; gap: 8px; border: 1px solid var(--vz-border-color); background: var(--vz-secondary-bg); color: var(--vz-secondary-color); }
        .rec-tab:hover { color: var(--vz-heading-color, var(--vz-body-color)); }
        .rec-tab.is-active.in-progress { background: linear-gradient(135deg,#7c5cfc,#a78bfa); color: #fff; border-color: transparent; box-shadow: 0 4px 14px rgba(124,92,252,0.30); }
        .rec-tab.is-active.completed   { background: linear-gradient(135deg,#0ab39c,#02c8a7); color: #fff; border-color: transparent; box-shadow: 0 4px 14px rgba(10,179,156,0.30); }
        .rec-tab.is-active.cancelled   { background: linear-gradient(135deg,#f06548,#f4907b); color: #fff; border-color: transparent; box-shadow: 0 4px 14px rgba(240,101,72,0.30); }
        .rec-tab .badge { font-size: 11px; padding: 3px 8px; border-radius: 999px; background: var(--vz-light); color: var(--vz-secondary-color); }
        .rec-tab.is-active .badge { background: rgba(255,255,255,0.22); color: #fff; }
        .rec-id-pill { display: inline-flex; align-items: center; padding: 4px 10px; border-radius: 999px; background: #ece6ff; color: #5a3fd1; font-family: var(--vz-font-monospace, monospace); font-weight: 700; font-size: 11.5px; letter-spacing: 0.02em; }
        .rec-pill { display: inline-flex; align-items: center; padding: 3px 10px; border-radius: 999px; font-size: 11px; font-weight: 600; }
        .rec-num { font-weight: 700; font-size: 14px; color: var(--vz-heading-color, var(--vz-body-color)); }
        .rec-pagebtn { width: 32px; height: 32px; border-radius: 8px; border: 1px solid var(--vz-border-color); background: #fff; color: var(--vz-secondary-color); font-weight: 600; font-size: 13px; cursor: pointer; transition: all .15s ease; }
        .rec-pagebtn:hover:not(:disabled) { border-color: #a78bfa; color: #7c5cfc; }
        .rec-pagebtn:disabled { opacity: 0.45; cursor: not-allowed; }
        .rec-pagebtn.is-active { background: linear-gradient(135deg,#7c5cfc,#a78bfa); color: #fff; border-color: transparent; box-shadow: 0 3px 8px rgba(124,92,252,0.25); }
        [data-bs-theme="dark"] .rec-pagebtn { background: var(--vz-secondary-bg); }

        /* Form modal (Raise / Create) */
        .rec-form-modal .modal-dialog { max-width: min(960px, 94vw); }
        .rec-form-content { border-radius: 22px !important; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.20); }
        .rec-form-header { background: linear-gradient(135deg,#5b3fd1 0%, #7c5cfc 50%, #a78bfa 100%); color: #fff; padding: 22px 28px 14px; }
        .rec-form-header .crumbs { display: flex; gap: 22px; margin-top: 16px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,0.20); font-size: 11px; font-weight: 700; letter-spacing: 0.10em; text-transform: uppercase; }
        .rec-form-header .crumb { color: rgba(255,255,255,0.55); position: relative; padding-bottom: 6px; }
        .rec-form-header .crumb.active { color: #fff; }
        .rec-form-header .crumb.active::after { content: ''; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px; background: #fff; border-radius: 2px; }
        .rec-form-body { background: #f8f9fc; padding: 22px 28px 8px; max-height: 70vh; overflow-y: auto; }
        [data-bs-theme="dark"] .rec-form-body { background: #1f2630; }
        .rec-form-section { background: #fff; border: 1px solid #eef0f4; border-radius: 14px; padding: 18px 20px; margin-bottom: 18px; }
        [data-bs-theme="dark"] .rec-form-section { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .rec-form-section-head { display: flex; align-items: center; gap: 12px; margin-bottom: 14px; }
        .rec-form-section-icon { width: 36px; height: 36px; border-radius: 10px; display: inline-flex; align-items: center; justify-content: center; flex-shrink: 0; }
        .rec-form-section-title { font-size: 11px; font-weight: 800; letter-spacing: 0.10em; text-transform: uppercase; color: #1f2937; margin: 0; }
        [data-bs-theme="dark"] .rec-form-section-title { color: var(--vz-heading-color, var(--vz-body-color)); }
        .rec-form-section-sub   { font-size: 12px; color: #6b7280; margin: 0; }
        .rec-form-label { font-size: 11.5px; font-weight: 700; color: #374151; letter-spacing: 0.06em; text-transform: uppercase; margin-bottom: 6px; display: block; }
        [data-bs-theme="dark"] .rec-form-label { color: var(--vz-body-color); }
        .rec-form-label .req { color: #f06548; margin-left: 2px; font-weight: 700; }
        .rec-input { width: 100%; height: 42px; background: #fff; border: 1px solid #e5e7eb; border-radius: 10px; padding: 8px 12px; font-size: 13px; color: #1f2937; transition: border-color .15s ease, box-shadow .15s ease; }
        .rec-input::placeholder { color: #9ca3af; }
        .rec-input:focus { outline: none; border-color: #a78bfa; box-shadow: 0 0 0 3px rgba(124,92,252,0.15); }
        .rec-input.is-invalid { border-color: #f06548 !important; box-shadow: 0 0 0 3px rgba(240,101,72,0.15) !important; }
        .rec-textarea { width: 100%; min-height: 80px; padding: 10px 12px; resize: vertical; }
        [data-bs-theme="dark"] .rec-input, [data-bs-theme="dark"] .rec-textarea { background: var(--vz-card-bg); border-color: var(--vz-border-color); color: var(--vz-body-color); }
        .rec-error { color: #f06548; font-size: 12px; margin-top: 4px; display: flex; align-items: center; gap: 4px; }
        .rec-mode-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 8px; }
        @media (max-width: 720px) { .rec-mode-grid { grid-template-columns: repeat(2, 1fr); } }
        .rec-mode-btn { height: 42px; border: 1px solid #e5e7eb; background: #fff; border-radius: 10px; font-size: 13px; font-weight: 600; color: #6b7280; cursor: pointer; transition: all .15s ease; display: inline-flex; align-items: center; justify-content: center; gap: 6px; }
        .rec-mode-btn:hover { border-color: #c4b5fd; color: #7c5cfc; }
        .rec-mode-btn.is-active { color: #fff; border-color: transparent; box-shadow: 0 4px 12px rgba(124,92,252,0.25); }
        .rec-mode-btn.is-active.onsite   { background: linear-gradient(135deg,#5b3fd1,#7c5cfc); }
        .rec-mode-btn.is-active.remote   { background: linear-gradient(135deg,#0c63b0,#3b82f6); }
        .rec-mode-btn.is-active.hybrid   { background: linear-gradient(135deg,#7c5cfc,#a78bfa); }
        .rec-mode-btn.is-active.flexible { background: linear-gradient(135deg,#0ab39c,#02c8a7); }
        [data-bs-theme="dark"] .rec-mode-btn { background: var(--vz-card-bg); border-color: var(--vz-border-color); color: var(--vz-secondary-color); }
        .rec-urgency-row { display: flex; flex-wrap: wrap; gap: 8px; }
        .rec-urgency { padding: 7px 16px; border-radius: 999px; font-size: 12.5px; font-weight: 700; cursor: pointer; border: 1px solid transparent; transition: all .15s ease; display: inline-flex; align-items: center; gap: 6px; }
        .rec-urgency.is-active { box-shadow: 0 3px 10px rgba(0,0,0,0.10); transform: translateY(-1px); }
        .rec-form-footer { background: #fff; border-top: 1px solid #eef0f4; padding: 14px 28px; display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
        [data-bs-theme="dark"] .rec-form-footer { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .rec-form-footer .hint { font-size: 12px; color: #6b7280; }
        .rec-btn-primary { padding: 10px 20px; border-radius: 12px; font-size: 13.5px; font-weight: 700; color: #fff; border: none; background: linear-gradient(90deg,#7c5cfc,#5b3fd1); box-shadow: 0 8px 18px rgba(91,63,209,0.28); cursor: pointer; transition: transform .15s ease, box-shadow .15s ease; display: inline-flex; align-items: center; gap: 8px; }
        .rec-btn-primary:hover { transform: translateY(-1px); box-shadow: 0 12px 22px rgba(91,63,209,0.36); }
        .rec-btn-ghost { padding: 10px 18px; border-radius: 12px; font-size: 13.5px; font-weight: 600; color: #4b5563; background: #fff; border: 1px solid #e5e7eb; cursor: pointer; transition: all .15s ease; display: inline-flex; align-items: center; gap: 6px; }
        .rec-btn-ghost:hover { border-color: #a78bfa; color: #7c5cfc; }
        [data-bs-theme="dark"] .rec-btn-ghost { background: var(--vz-secondary-bg); border-color: var(--vz-border-color); color: var(--vz-body-color); }
        .rec-close-btn { width: 34px; height: 34px; border-radius: 10px; background: rgba(255,255,255,0.18); border: none; color: #fff; transition: background .15s ease; }
        .rec-close-btn:hover { background: rgba(255,255,255,0.30); }

        /* Hiring Requests modal */
        .rec-req-modal .modal-dialog { max-width: min(1100px, 94vw); }
        .rec-req-content { border-radius: 22px !important; overflow: hidden; box-shadow: 0 24px 60px rgba(18,38,63,0.20); }
        .rec-req-header { background: linear-gradient(135deg,#5b3fd1 0%, #7c5cfc 50%, #a78bfa 100%); color: #fff; padding: 22px 28px; display: flex; align-items: center; justify-content: space-between; gap: 16px; flex-wrap: wrap; }
        .rec-signal { background: #fff7e6; border-bottom: 1px solid #fde8c4; padding: 10px 28px; font-size: 12.5px; color: #a4661c; font-weight: 600; display: flex; align-items: center; gap: 8px; }
        .rec-req-stats { display: grid; grid-template-columns: repeat(5, 1fr); gap: 0; padding: 16px 28px; border-bottom: 1px solid #eef0f4; background: #fff; }
        @media (max-width: 720px) { .rec-req-stats { grid-template-columns: repeat(2, 1fr); gap: 12px; } }
        [data-bs-theme="dark"] .rec-req-stats { background: var(--vz-card-bg); border-color: var(--vz-border-color); }
        .rec-req-stat { padding: 4px 14px; border-right: 1px solid #eef0f4; }
        .rec-req-stat:last-child { border-right: none; }
        [data-bs-theme="dark"] .rec-req-stat { border-color: var(--vz-border-color); }
        .rec-req-stat .v { font-size: 24px; font-weight: 800; line-height: 1; }
        .rec-req-stat .l { font-size: 10.5px; font-weight: 700; letter-spacing: 0.08em; text-transform: uppercase; color: var(--vz-secondary-color); margin-top: 4px; }

        /* tiny chip used inside the position cell of hiring-requests table */
        .rec-mini-chip { display: inline-flex; align-items: center; padding: 2px 7px; border-radius: 999px; font-size: 10.5px; font-weight: 600; margin-left: 4px; }
      `}</style>
      <MasterFormStyles />

      <Row>
        <Col xs={12}>
          <div
            className="rec-surface"
            style={{
              borderRadius: 16,
              border: '1px solid var(--vz-border-color)',
              boxShadow: '0 2px 12px rgba(0,0,0,0.05)',
              padding: '20px',
            }}
          >
            {/* ── Header ── */}
            <div className="d-flex align-items-start justify-content-between flex-wrap gap-3 mb-3">
              <div className="d-flex align-items-center gap-3 min-w-0">
                <span
                  className="d-inline-flex align-items-center justify-content-center rounded-3 flex-shrink-0"
                  style={{
                    width: 46, height: 46,
                    background: 'linear-gradient(135deg, #7c5cfc 0%, #a78bfa 100%)',
                    boxShadow: '0 4px 10px rgba(124,92,252,0.30)',
                  }}
                >
                  <i className="ri-briefcase-4-line" style={{ color: '#fff', fontSize: 21 }} />
                </span>
                <div className="min-w-0">
                  <div className="d-flex align-items-center gap-2 flex-wrap">
                    <h5 className="fw-bold mb-0" style={{ letterSpacing: '-0.01em' }}>Recruitment Management</h5>
                    <span
                      className="badge rounded-pill"
                      style={{
                        background: 'rgba(124,92,252,0.12)',
                        color: '#5a3fd1',
                        fontSize: 11,
                        padding: '5px 10px',
                        fontWeight: 700,
                      }}
                    >
                      <i className="ri-checkbox-circle-fill align-bottom me-1" style={{ fontSize: 9 }} />
                      {counts.total} recruitments
                    </span>
                  </div>
                  <div className="text-muted mt-1" style={{ fontSize: 12.5 }}>
                    Create recruitments, track candidates, and manage the end-to-end hiring pipeline
                  </div>
                </div>
              </div>
              <div className="d-flex align-items-center gap-2 flex-wrap">
                <Button
                  onClick={() => { setCreateMode('add'); setCreateEditingId(null); setCreateOpen(true); }}
                  className="rounded-pill px-3 fw-semibold"
                  style={{
                    background: 'linear-gradient(90deg,#7c5cfc,#5b3fd1)',
                    color: '#fff',
                    border: 'none',
                    boxShadow: '0 6px 16px rgba(91,63,209,0.30)',
                  }}
                >
                  <i className="ri-add-line align-bottom me-1"></i>Create Recruitment
                </Button>
                <Button
                  onClick={() => setRaiseOpen(true)}
                  className="rounded-pill px-3 fw-semibold"
                  style={{
                    background: 'linear-gradient(90deg,#3b82f6,#0c63b0)',
                    color: '#fff',
                    border: 'none',
                    boxShadow: '0 6px 16px rgba(59,130,246,0.30)',
                  }}
                >
                  <i className="ri-file-add-line align-bottom me-1"></i>Raise Hiring Request
                </Button>
                <Button
                  onClick={() => setRequestsOpen(true)}
                  className="rounded-pill px-3 fw-semibold"
                  style={{
                    background: '#fff',
                    color: 'var(--vz-secondary)',
                    border: '1px solid var(--vz-secondary)',
                  }}
                >
                  <i className="ri-eye-line align-bottom me-1"></i>View Hiring Requests
                </Button>
              </div>
            </div>

            {/* ── KPI cards (6 tiles) ── */}
            <Row className="g-3 mb-3 align-items-stretch">
              {KPI_CARDS.map(k => (
                <Col key={k.key} xl={2} md={4} sm={6} xs={12}>
                  <div
                    className="rec-surface"
                    style={{
                      borderRadius: 14,
                      border: '1px solid var(--vz-border-color)',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.04)',
                      padding: '16px 18px',
                      position: 'relative',
                      overflow: 'hidden',
                      height: '100%',
                    }}
                  >
                    <div style={{ position: 'absolute', top: 0, left: 0, right: 0, height: 3, background: k.gradient }} />
                    <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', height: '100%' }}>
                      <div className="min-w-0">
                        <p style={{ fontSize: 11, fontWeight: 700, color: 'var(--vz-secondary-color)', letterSpacing: '0.06em', textTransform: 'uppercase', margin: '0 0 8px' }}>
                          {k.label}
                        </p>
                        <h3 style={{ fontSize: 26, fontWeight: 800, color: 'var(--vz-heading-color, var(--vz-body-color))', margin: 0, lineHeight: 1 }}>
                          <AnimatedNumber value={(counts as any)[k.key]} />
                        </h3>
                      </div>
                      <div style={{ width: 44, height: 44, borderRadius: 10, background: k.gradient, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, boxShadow: '0 4px 12px rgba(0,0,0,0.10)' }}>
                        <i className={k.icon} style={{ fontSize: 20, color: '#fff' }} />
                      </div>
                    </div>
                  </div>
                </Col>
              ))}
            </Row>

            {/* ── Tabs (In Progress / Completed / Cancelled) ── */}
            <div className="d-flex gap-2 mb-3 flex-wrap">
              {([
                { key: 'In Progress' as const, label: 'In Progress', count: counts.tabs['In Progress'], icon: 'ri-time-line',           variant: 'in-progress' },
                { key: 'Completed'   as const, label: 'Completed',   count: counts.tabs.Completed,     icon: 'ri-checkbox-circle-line',variant: 'completed'   },
                { key: 'Cancelled'   as const, label: 'Cancelled',   count: counts.tabs.Cancelled,     icon: 'ri-close-circle-line',   variant: 'cancelled'   },
              ]).map(t => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => setTab(t.key)}
                  className={`rec-tab ${tab === t.key ? `is-active ${t.variant}` : ''}`}
                >
                  <i className={t.icon} />
                  {t.label}
                  <span className="badge">{t.count}</span>
                </button>
              ))}
            </div>

            {/* ── Search + Filters ── */}
            <Row className="g-2 align-items-center mb-3">
              <Col md={4} sm={12}>
                <div className="search-box">
                  <Input
                    type="text"
                    className="form-control"
                    placeholder="Search ID, job title, HR…"
                    value={q}
                    onChange={e => setQ(e.target.value)}
                  />
                  <i className="ri-search-line search-icon"></i>
                </div>
              </Col>
              <Col md={8} sm={12} className="d-flex justify-content-md-end gap-3 flex-wrap align-items-center">
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Department</span>
                  <div style={{ minWidth: 150 }}>
                    <MasterSelect
                      value={deptFilter}
                      onChange={setDeptFilter}
                      options={DEPARTMENT_FILTER_OPTIONS}
                      placeholder="All"
                    />
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Priority</span>
                  <div style={{ minWidth: 130 }}>
                    <MasterSelect
                      value={priorityFilter}
                      onChange={setPriorityFilter}
                      options={PRIORITY_FILTER_OPTIONS}
                      placeholder="All"
                    />
                  </div>
                </div>
                <div className="d-flex align-items-center gap-2">
                  <span className="text-muted text-uppercase fw-semibold" style={{ fontSize: 11, letterSpacing: '0.06em' }}>Job Type</span>
                  <div style={{ minWidth: 140 }}>
                    <MasterSelect
                      value={jobTypeFilter}
                      onChange={setJobTypeFilter}
                      options={JOB_TYPE_FILTER_OPTIONS}
                      placeholder="All"
                    />
                  </div>
                </div>
                <span className="text-muted fw-semibold" style={{ fontSize: 12 }}>
                  {filtered.length} results
                </span>
              </Col>
            </Row>

            {/* ── Table ── */}
            <Card className="border-0 shadow-none mb-0">
              <CardBody className="p-3">
                <div className="table-responsive table-card border rounded">
                  <table className="table align-middle table-nowrap mb-0">
                    <thead className="table-light">
                      <tr>
                        <th scope="col" className="ps-3 text-center" style={{ width: 56 }}>SR. NO</th>
                        <th scope="col">REC ID</th>
                        <th scope="col">Job Title</th>
                        <th scope="col">Department</th>
                        <th scope="col">Designation</th>
                        <th scope="col">Employment Type</th>
                        <th scope="col" className="text-center">Openings</th>
                        <th scope="col">Experience<br/>Required</th>
                        <th scope="col">Work Mode</th>
                        <th scope="col">Priority</th>
                        <th scope="col">Hiring Manager</th>
                        <th scope="col">Assigned HR</th>
                        <th scope="col">Start Date</th>
                        <th scope="col">TAT /<br/>Deadline</th>
                        <th scope="col" className="text-center pe-3" style={{ width: 130 }}>Action</th>
                      </tr>
                    </thead>
                    <tbody>
                      {visible.length === 0 ? (
                        <tr>
                          <td colSpan={15} className="text-center py-5 text-muted">
                            <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 32, opacity: 0.4 }} />
                            No recruitments match your filters
                          </td>
                        </tr>
                      ) : visible.map((r, idx) => {
                        const pri = PRIORITY_TONES[r.priority];
                        const wm  = WORK_MODE_TONES[r.workMode];
                        return (
                          <tr key={r.id}>
                            <td className="ps-3 text-center text-muted fs-13">{sliceFrom + idx + 1}</td>
                            <td><span className="rec-id-pill">{r.id}</span></td>
                            <td className="fw-bold fs-13" style={{ color: 'var(--vz-heading-color, var(--vz-body-color))' }}>{r.jobTitle}</td>
                            <td className="fs-13">{r.department}</td>
                            <td className="fs-13">{r.designation}</td>
                            <td>
                              <span className="rec-pill" style={{ background: '#eef2f6', color: '#475569' }}>
                                {r.employmentType}
                              </span>
                            </td>
                            <td className="text-center"><span className="rec-num">{r.openings}</span></td>
                            <td className="fs-13"><span className="text-muted">{r.experience}</span></td>
                            <td><span className="rec-pill" style={{ background: wm.bg, color: wm.fg }}>{r.workMode}</span></td>
                            <td><span className="rec-pill" style={{ background: pri.bg, color: pri.fg }}>{r.priority}</span></td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div
                                  className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                  style={{ width: 26, height: 26, fontSize: 10, background: `linear-gradient(135deg, ${r.hiringManagerAccent}, ${r.hiringManagerAccent}cc)` }}
                                >
                                  {r.hiringManagerInitials}
                                </div>
                                <span className="fs-13">{r.hiringManagerRole} – {r.hiringManagerName}</span>
                              </div>
                            </td>
                            <td>
                              <div className="d-flex align-items-center gap-2">
                                <div
                                  className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                                  style={{ width: 26, height: 26, fontSize: 10, background: `linear-gradient(135deg, ${r.assignedHrAccent}, ${r.assignedHrAccent}cc)` }}
                                >
                                  {r.assignedHrInitials}
                                </div>
                                <span className="fs-13">{r.assignedHrName}</span>
                              </div>
                            </td>
                            <td className="fs-13">{r.startDate}</td>
                            <td className="fs-13">{r.deadline}</td>
                            <td className="pe-3">
                              <div className="d-flex gap-1 justify-content-center align-items-center">
                                <ActionBtn
                                  title="Edit Recruitment"
                                  icon="ri-pencil-line"
                                  color="info"
                                  onClick={() => { setCreateMode('edit'); setCreateEditingId(r.id); setCreateOpen(true); }}
                                />
                                <ActionBtn
                                  title="View Candidates"
                                  icon="ri-team-line"
                                  color="primary"
                                  onClick={() => setCandidatesTarget(r)}
                                />
                                <ActionBtn
                                  title={r.status === 'Cancelled' ? 'Already Cancelled' : 'Cancel Recruitment'}
                                  icon="ri-close-circle-line"
                                  color="danger"
                                  disabled={r.status === 'Cancelled'}
                                  onClick={() => setCancelTarget(r)}
                                />
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>

                {/* Pagination */}
                <div className="d-flex align-items-center justify-content-between flex-wrap gap-2 mt-3 pt-2 border-top">
                  <div className="d-flex align-items-center gap-2">
                    <span className="text-muted" style={{ fontSize: 12 }}>Rows per page:</span>
                    <div style={{ width: 80 }}>
                      <MasterSelect
                        value={String(pageSize)}
                        onChange={(v) => { setPageSize(Number(v) || 10); setPage(1); }}
                        options={['10', '25', '50'].map(v => ({ value: v, label: v }))}
                        placeholder="10"
                      />
                    </div>
                    <span className="text-muted" style={{ fontSize: 12, marginLeft: 16 }}>
                      Showing {filtered.length === 0 ? 0 : (sliceFrom + 1)}–{Math.min(sliceFrom + pageSize, filtered.length)} of {filtered.length}
                    </span>
                  </div>
                  <div className="d-flex align-items-center gap-1">
                    <button className="rec-pagebtn" onClick={() => goto(safePage - 1)} disabled={safePage <= 1}>
                      ‹ Prev
                    </button>
                    {Array.from({ length: pageCount }).map((_, i) => (
                      <button
                        key={i}
                        className={`rec-pagebtn${safePage === i + 1 ? ' is-active' : ''}`}
                        onClick={() => goto(i + 1)}
                      >
                        {i + 1}
                      </button>
                    ))}
                    <button className="rec-pagebtn" onClick={() => goto(safePage + 1)} disabled={safePage >= pageCount}>
                      Next ›
                    </button>
                  </div>
                </div>
              </CardBody>
            </Card>
          </div>
        </Col>
      </Row>

      {/* ── Modals ── */}
      <RaiseHiringRequestModal
        isOpen={raiseOpen}
        onClose={() => setRaiseOpen(false)}
        onSubmit={(asDraft) => {
          setRaiseOpen(false);
          if (asDraft) toast.success('Saved as draft', 'Hiring request saved to drafts.');
          else toast.success('Hiring request submitted', 'HR will review your request shortly.');
        }}
      />

      <HiringRequestsListModal
        isOpen={requestsOpen}
        onClose={() => setRequestsOpen(false)}
        onRaiseNew={() => { setRequestsOpen(false); setRaiseOpen(true); }}
      />

      <CreateRecruitmentModal
        isOpen={createOpen}
        mode={createMode}
        editingId={createEditingId}
        onClose={() => setCreateOpen(false)}
        onSubmit={() => {
          setCreateOpen(false);
          toast.success(createMode === 'add' ? 'Recruitment created' : 'Recruitment updated', createMode === 'add' ? 'New recruitment is now live.' : 'Changes saved successfully.');
        }}
      />

      <CancelConfirmModal
        target={cancelTarget}
        onClose={() => setCancelTarget(null)}
        onConfirm={() => {
          if (cancelTarget) toast.success('Recruitment cancelled', `${cancelTarget.id} has been moved to Cancelled.`);
          setCancelTarget(null);
        }}
      />

      <CandidatesPlaceholderModal
        target={candidatesTarget}
        onClose={() => setCandidatesTarget(null)}
      />
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Raise Hiring Request — 4-section modal
// ─────────────────────────────────────────────────────────────────────────────

interface RaiseHiringRequestModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (asDraft: boolean) => void;
}

function RaiseHiringRequestModal({ isOpen, onClose, onSubmit }: RaiseHiringRequestModalProps) {
  const toast = useToast();

  // Section 1 — Basics
  const [title, setTitle]           = useState('');
  const [jobRole, setJobRole]       = useState('');
  const [department, setDepartment] = useState('');
  const [team, setTeam]             = useState('');
  const [requestedBy, setRequestedBy] = useState('');
  const today = new Date().toISOString().slice(0, 10);
  const [reqDate, setReqDate]       = useState(today);

  // Section 2 — Hiring Need
  const [openings, setOpenings]         = useState('1');
  const [employType, setEmployType]     = useState('Full-time');
  const [workMode, setWorkMode]         = useState<'Onsite' | 'Remote' | 'Hybrid' | 'Flexible'>('Onsite');
  const [urgency, setUrgency]           = useState<RequestUrgency>('Medium');

  // Section 3 — Role Details
  const [jobDesc, setJobDesc]                 = useState('');
  const [dailyResp, setDailyResp]             = useState('');
  const [requiredSkills, setRequiredSkills]   = useState('');
  const [requiredExp, setRequiredExp]         = useState('');
  const [requiredQual, setRequiredQual]       = useState('');
  const [preferred, setPreferred]             = useState('');

  // Section 4 — Business Justification
  const [needReason, setNeedReason]       = useState('');
  const [requestType, setRequestType]     = useState<RequestType>('New Position');
  const [businessJust, setBusinessJust]   = useState('');
  const [teamGap, setTeamGap]             = useState('');
  const [whatIfNot, setWhatIfNot]         = useState('');

  // Errors
  type RaiseErrors = Partial<Record<
    'title' | 'jobRole' | 'department' | 'openings' | 'employType' | 'workMode' | 'urgency'
    | 'jobDesc' | 'requiredSkills' | 'requiredExp' | 'needReason' | 'requestType' | 'businessJust',
    string
  >>;
  const [errors, setErrors] = useState<RaiseErrors>({});

  // Reset when reopened
  useEffect(() => {
    if (!isOpen) return;
    setTitle(''); setJobRole(''); setDepartment(''); setTeam(''); setRequestedBy(''); setReqDate(today);
    setOpenings('1'); setEmployType('Full-time'); setWorkMode('Onsite'); setUrgency('Medium');
    setJobDesc(''); setDailyResp(''); setRequiredSkills(''); setRequiredExp(''); setRequiredQual(''); setPreferred('');
    setNeedReason(''); setRequestType('New Position'); setBusinessJust(''); setTeamGap(''); setWhatIfNot('');
    setErrors({});
  }, [isOpen]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = (k: keyof RaiseErrors) =>
    setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  const validate = (): RaiseErrors => {
    const e: RaiseErrors = {};
    if (!title.trim())          e.title          = 'Request title is required';
    if (!jobRole.trim())        e.jobRole        = 'Job role is required';
    if (!department)            e.department     = 'Department is required';
    if (!openings.trim() || Number(openings) <= 0) e.openings = 'Openings must be at least 1';
    if (!employType)            e.employType     = 'Employment type is required';
    if (!workMode)              e.workMode       = 'Work mode is required';
    if (!urgency)               e.urgency        = 'Urgency is required';
    if (!jobDesc.trim())        e.jobDesc        = 'Job description is required';
    if (!requiredSkills.trim()) e.requiredSkills = 'Required skills are required';
    if (!requiredExp)           e.requiredExp    = 'Required experience is required';
    if (!needReason.trim())     e.needReason     = 'Hiring need reason is required';
    if (!requestType)           e.requestType    = 'Request type is required';
    if (!businessJust.trim())   e.businessJust   = 'Business justification is required';
    return e;
  };

  const handleSubmit = (asDraft: boolean) => {
    if (!asDraft) {
      const errs = validate();
      if (Object.keys(errs).length > 0) {
        setErrors(errs);
        toast.error('Please complete required fields', `${Object.keys(errs).length} field${Object.keys(errs).length === 1 ? '' : 's'} need attention.`);
        return;
      }
    }
    onSubmit(asDraft);
  };

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-form-modal" contentClassName="rec-form-content border-0" backdrop="static" keyboard={false}>
      <ModalBody className="p-0">
        {/* Header */}
        <div className="rec-form-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3">
              <span
                style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'rgba(255,255,255,0.18)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <i className="ri-file-add-line" style={{ fontSize: 22 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 18, letterSpacing: '-0.01em' }}>Raise Hiring Request</h5>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                  Internal workforce demand · Reviewed by HR before job posting
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 20 }} />
            </button>
          </div>
          <div className="crumbs">
            <span className="crumb active">Basics</span>
            <span className="crumb">Hiring Need</span>
            <span className="crumb">Role Details</span>
            <span className="crumb">Justification</span>
          </div>
        </div>

        {/* Body */}
        <div className="rec-form-body">
          {/* Section 1 — Basics */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: '#ece6ff', color: '#5a3fd1' }}>
                <i className="ri-calendar-event-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 1 · Request Basics</p>
                <p className="rec-form-section-sub">Core identification of the hiring request</p>
              </div>
            </div>
            <Row className="g-3">
              <Col md={8}>
                <label className="rec-form-label">Request Title<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.title ? ' is-invalid' : ''}`}
                  placeholder="e.g. Senior ML Engineer for AI Team"
                  value={title}
                  onChange={e => { setTitle(e.target.value); clear('title'); }}
                />
                {errors.title && <div className="rec-error"><i className="ri-error-warning-line" />{errors.title}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Job Role / Position Name<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.jobRole ? ' is-invalid' : ''}`}
                  placeholder="e.g. DevOps Engineer"
                  value={jobRole}
                  onChange={e => { setJobRole(e.target.value); clear('jobRole'); }}
                />
                {errors.jobRole && <div className="rec-error"><i className="ri-error-warning-line" />{errors.jobRole}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Department<span className="req">*</span></label>
                <MasterSelect
                  value={department}
                  onChange={(v) => { setDepartment(v); clear('department'); }}
                  options={HR_DEPT_OPTIONS}
                  placeholder="Select Department"
                  invalid={!!errors.department}
                />
                {errors.department && <div className="rec-error"><i className="ri-error-warning-line" />{errors.department}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Team / Sub-Department</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="e.g. AI/ML, Infrastructure"
                  value={team}
                  onChange={e => setTeam(e.target.value)}
                />
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Requested By</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="Your Name (Role)"
                  value={requestedBy}
                  onChange={e => setRequestedBy(e.target.value)}
                />
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Request Date</label>
                <MasterDatePicker
                  value={reqDate}
                  onChange={setReqDate}
                  placeholder="dd-mm-yyyy"
                />
              </Col>
            </Row>
          </div>

          {/* Section 2 — Hiring Need */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: '#dceefe', color: '#0c63b0' }}>
                <i className="ri-time-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 2 · Hiring Need</p>
                <p className="rec-form-section-sub">Openings, type, mode and urgency</p>
              </div>
            </div>
            <Row className="g-3">
              <Col md={4}>
                <label className="rec-form-label">No. of Openings<span className="req">*</span></label>
                <input
                  type="number"
                  min={1}
                  className={`rec-input${errors.openings ? ' is-invalid' : ''}`}
                  value={openings}
                  onChange={e => { setOpenings(e.target.value); clear('openings'); }}
                />
                {errors.openings && <div className="rec-error"><i className="ri-error-warning-line" />{errors.openings}</div>}
              </Col>
              <Col md={8}>
                <label className="rec-form-label">Employment Type<span className="req">*</span></label>
                <MasterSelect
                  value={employType}
                  onChange={(v) => { setEmployType(v); clear('employType'); }}
                  options={EMPLOYMENT_TYPE_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.employType}
                />
                {errors.employType && <div className="rec-error"><i className="ri-error-warning-line" />{errors.employType}</div>}
              </Col>
              <Col xs={12}>
                <label className="rec-form-label">Work Mode<span className="req">*</span></label>
                <div className="rec-mode-grid">
                  {([
                    { val: 'Onsite',   icon: 'ri-building-line',     variant: 'onsite'   },
                    { val: 'Remote',   icon: 'ri-globe-line',        variant: 'remote'   },
                    { val: 'Hybrid',   icon: 'ri-flashlight-line',   variant: 'hybrid'   },
                    { val: 'Flexible', icon: 'ri-shuffle-line',      variant: 'flexible' },
                  ] as const).map(m => (
                    <button
                      key={m.val}
                      type="button"
                      className={`rec-mode-btn${workMode === m.val ? ` is-active ${m.variant}` : ''}`}
                      onClick={() => { setWorkMode(m.val); clear('workMode'); }}
                    >
                      <i className={m.icon} />
                      {m.val}
                    </button>
                  ))}
                </div>
              </Col>
              <Col xs={12}>
                <label className="rec-form-label">Urgency Level<span className="req">*</span></label>
                <div className="rec-urgency-row">
                  {(['Low', 'Medium', 'High', 'Critical'] as RequestUrgency[]).map(u => {
                    const tone = REQUEST_URGENCY_TONES[u];
                    const active = urgency === u;
                    return (
                      <button
                        key={u}
                        type="button"
                        className={`rec-urgency${active ? ' is-active' : ''}`}
                        style={{
                          background: active ? tone.bg : '#fff',
                          color: tone.fg,
                          borderColor: active ? tone.fg : '#e5e7eb',
                        }}
                        onClick={() => { setUrgency(u); clear('urgency'); }}
                      >
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: tone.fg }} />
                        {u}
                      </button>
                    );
                  })}
                </div>
              </Col>
            </Row>
          </div>

          {/* Section 3 — Role Details */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: '#fde8c4', color: '#a4661c' }}>
                <i className="ri-team-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 3 · Role Details</p>
                <p className="rec-form-section-sub">Job description, skills and qualifications</p>
              </div>
            </div>
            <Row className="g-3">
              <Col xs={12}>
                <label className="rec-form-label">Job Description<span className="req">*</span></label>
                <textarea
                  className={`rec-input rec-textarea${errors.jobDesc ? ' is-invalid' : ''}`}
                  placeholder="Key responsibilities and scope of work…"
                  value={jobDesc}
                  onChange={e => { setJobDesc(e.target.value); clear('jobDesc'); }}
                />
                {errors.jobDesc && <div className="rec-error"><i className="ri-error-warning-line" />{errors.jobDesc}</div>}
              </Col>
              <Col xs={12}>
                <label className="rec-form-label">Daily Responsibilities</label>
                <textarea
                  className="rec-input rec-textarea"
                  placeholder="Day-to-day tasks and deliverables…"
                  value={dailyResp}
                  onChange={e => setDailyResp(e.target.value)}
                />
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Required Skills<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.requiredSkills ? ' is-invalid' : ''}`}
                  placeholder="e.g. React, Node.js, AWS"
                  value={requiredSkills}
                  onChange={e => { setRequiredSkills(e.target.value); clear('requiredSkills'); }}
                />
                {errors.requiredSkills && <div className="rec-error"><i className="ri-error-warning-line" />{errors.requiredSkills}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Required Experience<span className="req">*</span></label>
                <MasterSelect
                  value={requiredExp}
                  onChange={(v) => { setRequiredExp(v); clear('requiredExp'); }}
                  options={REQUIRED_EXPERIENCE_OPTIONS}
                  placeholder="Select Experience"
                  invalid={!!errors.requiredExp}
                />
                {errors.requiredExp && <div className="rec-error"><i className="ri-error-warning-line" />{errors.requiredExp}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Required Qualification</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="e.g. B.Tech, MBA"
                  value={requiredQual}
                  onChange={e => setRequiredQual(e.target.value)}
                />
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Preferred Candidate Profile</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="Ideal candidate background…"
                  value={preferred}
                  onChange={e => setPreferred(e.target.value)}
                />
              </Col>
            </Row>
          </div>

          {/* Section 4 — Business Justification */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: '#fdd9d6', color: '#b1401d' }}>
                <i className="ri-flashlight-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Section 4 · Business Justification</p>
                <p className="rec-form-section-sub">Why this hire is needed now</p>
              </div>
            </div>
            <Row className="g-3">
              <Col xs={12}>
                <label className="rec-form-label">Hiring Need Reason<span className="req">*</span></label>
                <textarea
                  className={`rec-input rec-textarea${errors.needReason ? ' is-invalid' : ''}`}
                  placeholder="Why is this position needed now?…"
                  value={needReason}
                  onChange={e => { setNeedReason(e.target.value); clear('needReason'); }}
                />
                {errors.needReason && <div className="rec-error"><i className="ri-error-warning-line" />{errors.needReason}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Request Type<span className="req">*</span></label>
                <MasterSelect
                  value={requestType}
                  onChange={(v) => { setRequestType(v as RequestType); clear('requestType'); }}
                  options={REQUEST_TYPE_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.requestType}
                />
                {errors.requestType && <div className="rec-error"><i className="ri-error-warning-line" />{errors.requestType}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Business Justification<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.businessJust ? ' is-invalid' : ''}`}
                  placeholder="Business impact and value of this hire…"
                  value={businessJust}
                  onChange={e => { setBusinessJust(e.target.value); clear('businessJust'); }}
                />
                {errors.businessJust && <div className="rec-error"><i className="ri-error-warning-line" />{errors.businessJust}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Current Team Gap</label>
                <textarea
                  className="rec-input rec-textarea"
                  placeholder="Describe the current gap or overload…"
                  value={teamGap}
                  onChange={e => setTeamGap(e.target.value)}
                />
              </Col>
              <Col md={6}>
                <label className="rec-form-label">What If Not Filled?</label>
                <textarea
                  className="rec-input rec-textarea"
                  placeholder="Consequence of not hiring…"
                  value={whatIfNot}
                  onChange={e => setWhatIfNot(e.target.value)}
                />
              </Col>
            </Row>
          </div>
        </div>

        {/* Footer */}
        <div className="rec-form-footer">
          <span className="hint">Fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={() => handleSubmit(true)}>
              <i className="ri-save-3-line" />Save as Draft
            </button>
            <button type="button" className="rec-btn-primary" onClick={() => handleSubmit(false)}>
              <i className="ri-send-plane-line" />Submit to HR <i className="ri-arrow-right-line" />
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Hiring Requests — list modal
// ─────────────────────────────────────────────────────────────────────────────

interface HiringRequestsListModalProps {
  isOpen: boolean;
  onClose: () => void;
  onRaiseNew: () => void;
}

function HiringRequestsListModal({ isOpen, onClose, onRaiseNew }: HiringRequestsListModalProps) {
  const [statusFilter, setStatusFilter]   = useState<string>('All');
  const [urgencyFilter, setUrgencyFilter] = useState<string>('All');
  const [q, setQ] = useState('');

  useEffect(() => { if (!isOpen) { setStatusFilter('All'); setUrgencyFilter('All'); setQ(''); } }, [isOpen]);

  const stats = useMemo(() => {
    const total       = HIRING_REQUESTS.length;
    const underReview = HIRING_REQUESTS.filter(r => r.status === 'Under Review').length;
    const approved    = HIRING_REQUESTS.filter(r => r.status === 'Approved').length;
    const critical    = HIRING_REQUESTS.filter(r => r.urgency === 'Critical').length;
    const sentBack    = HIRING_REQUESTS.filter(r => r.status === 'Sent Back').length;
    return { total, underReview, approved, critical, sentBack };
  }, []);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return HIRING_REQUESTS
      .filter(r => statusFilter === 'All' || r.status === statusFilter)
      .filter(r => urgencyFilter === 'All' || r.urgency === urgencyFilter)
      .filter(r => {
        if (!needle) return true;
        return (
          r.id.toLowerCase().includes(needle) ||
          r.position.toLowerCase().includes(needle) ||
          r.department.toLowerCase().includes(needle) ||
          r.requestedByName.toLowerCase().includes(needle)
        );
      });
  }, [statusFilter, urgencyFilter, q]);

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-req-modal" contentClassName="rec-req-content border-0" backdrop="static" keyboard={false}>
      <ModalBody className="p-0">
        {/* Header */}
        <div className="rec-req-header">
          <div className="d-flex align-items-center gap-3 min-w-0">
            <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <i className="ri-file-list-3-line" style={{ fontSize: 22 }} />
            </span>
            <div>
              <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 18 }}>Hiring Requests</h5>
              <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                Internal workforce demand · Reviewed by HR before job posting
              </div>
            </div>
          </div>
          <div className="d-flex align-items-center gap-2">
            <button
              type="button"
              onClick={onRaiseNew}
              className="d-inline-flex align-items-center gap-2"
              style={{
                background: 'rgba(255,255,255,0.18)',
                border: '1px solid rgba(255,255,255,0.28)',
                color: '#fff',
                padding: '8px 16px',
                borderRadius: 10,
                fontSize: 13,
                fontWeight: 600,
                cursor: 'pointer',
              }}
            >
              <i className="ri-add-line" />Raise New Request
            </button>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 20 }} />
            </button>
          </div>
        </div>

        {/* Smart signals strip */}
        <div className="rec-signal">
          <i className="ri-error-warning-line" style={{ fontSize: 14 }} />
          <span><strong>Smart Signals:</strong> {stats.sentBack} request sent back — action needed by requester · {stats.critical} critical urgency request{stats.critical === 1 ? '' : 's'} still open</span>
        </div>

        {/* Stats strip */}
        <div className="rec-req-stats">
          <div className="rec-req-stat">
            <div className="v" style={{ color: '#1f2937' }}>{stats.total}</div>
            <div className="l">Total</div>
          </div>
          <div className="rec-req-stat">
            <div className="v" style={{ color: '#0c63b0' }}>{stats.underReview}</div>
            <div className="l">Under Review</div>
          </div>
          <div className="rec-req-stat">
            <div className="v" style={{ color: '#108548' }}>{stats.approved}</div>
            <div className="l">Approved</div>
          </div>
          <div className="rec-req-stat">
            <div className="v" style={{ color: '#a02960' }}>{stats.critical}</div>
            <div className="l">Critical</div>
          </div>
          <div className="rec-req-stat">
            <div className="v" style={{ color: '#a4661c' }}>{stats.sentBack}</div>
            <div className="l">Sent Back</div>
          </div>
        </div>

        {/* Filter row */}
        <div className="d-flex align-items-center gap-2 flex-wrap" style={{ padding: '14px 28px', background: '#fff', borderBottom: '1px solid #eef0f4' }}>
          <div className="search-box" style={{ flex: 1, minWidth: 220 }}>
            <Input
              type="text"
              className="form-control"
              placeholder="Search requests…"
              value={q}
              onChange={e => setQ(e.target.value)}
            />
            <i className="ri-search-line search-icon"></i>
          </div>
          <div style={{ minWidth: 150 }}>
            <MasterSelect
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: 'All',          label: 'All Status' },
                { value: 'Approved',     label: 'Approved' },
                { value: 'Under Review', label: 'Under Review' },
                { value: 'Submitted',    label: 'Submitted' },
                { value: 'Sent Back',    label: 'Sent Back' },
                { value: 'Draft',        label: 'Draft' },
                { value: 'Rejected',     label: 'Rejected' },
              ]}
              placeholder="All Status"
            />
          </div>
          <div style={{ minWidth: 150 }}>
            <MasterSelect
              value={urgencyFilter}
              onChange={setUrgencyFilter}
              options={[
                { value: 'All',      label: 'All Urgency' },
                { value: 'Low',      label: 'Low' },
                { value: 'Medium',   label: 'Medium' },
                { value: 'High',     label: 'High' },
                { value: 'Critical', label: 'Critical' },
              ]}
              placeholder="All Urgency"
            />
          </div>
          <span className="text-muted fw-semibold ms-auto" style={{ fontSize: 12 }}>
            {filtered.length} request{filtered.length === 1 ? '' : 's'}
          </span>
        </div>

        {/* List */}
        <div style={{ maxHeight: '50vh', overflowY: 'auto', background: '#fff' }}>
          <table className="table align-middle table-nowrap mb-0">
            <thead className="table-light">
              <tr>
                <th className="ps-4">REQ ID</th>
                <th>Position</th>
                <th>Department</th>
                <th>Requested By</th>
                <th className="text-center">Openings</th>
                <th>Request Type</th>
                <th>Urgency</th>
                <th>Status</th>
                <th>Req Date</th>
                <th className="pe-4">Target Join</th>
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr>
                  <td colSpan={10} className="text-center py-5 text-muted">
                    <i className="ri-search-eye-line d-block mb-2" style={{ fontSize: 28, opacity: 0.4 }} />
                    No requests match your filters
                  </td>
                </tr>
              ) : filtered.map(r => {
                const u = REQUEST_URGENCY_TONES[r.urgency];
                const s = REQUEST_STATUS_TONES[r.status];
                return (
                  <tr key={r.id}>
                    <td className="ps-4"><span className="rec-id-pill">{r.id}</span></td>
                    <td>
                      <span className="fw-bold fs-13">{r.position}</span>
                      <span className="rec-mini-chip" style={{ background: '#eef2f6', color: '#475569' }}>{r.positionType}</span>
                      <span
                        className="rec-mini-chip"
                        style={{
                          background: WORK_MODE_TONES[r.positionMode]?.bg || '#eef2f6',
                          color: WORK_MODE_TONES[r.positionMode]?.fg || '#475569',
                        }}
                      >
                        {r.positionMode}
                      </span>
                    </td>
                    <td className="fs-13">{r.department}</td>
                    <td>
                      <div className="d-flex align-items-center gap-2">
                        <div
                          className="rounded-circle d-flex align-items-center justify-content-center text-white fw-bold flex-shrink-0"
                          style={{ width: 26, height: 26, fontSize: 10, background: `linear-gradient(135deg, ${r.requestedByAccent}, ${r.requestedByAccent}cc)` }}
                        >
                          {r.requestedByInitials}
                        </div>
                        <span className="fs-13">{r.requestedByName}</span>
                      </div>
                    </td>
                    <td className="text-center"><span className="rec-num">{r.openings}</span></td>
                    <td className="fs-13">{r.requestType}</td>
                    <td><span className="rec-pill" style={{ background: u.bg, color: u.fg }}>{r.urgency}</span></td>
                    <td>
                      <span className="rec-pill d-inline-flex align-items-center gap-1" style={{ background: s.bg, color: s.fg }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.dot }} />
                        {r.status}
                      </span>
                    </td>
                    <td className="fs-13">{r.requestDate}</td>
                    <td className="pe-4 fs-13">{r.targetJoinDate}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Footer */}
        <div className="rec-form-footer">
          <span className="hint">Status changes are applied immediately and visible to all HR users</span>
          <button type="button" className="rec-btn-ghost" onClick={onClose}>
            <i className="ri-close-line" />Close
          </button>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Create / Edit Recruitment modal
// ─────────────────────────────────────────────────────────────────────────────

interface CreateRecruitmentModalProps {
  isOpen: boolean;
  mode: 'add' | 'edit';
  editingId: string | null;
  onClose: () => void;
  onSubmit: () => void;
}

function CreateRecruitmentModal({ isOpen, mode, editingId, onClose, onSubmit }: CreateRecruitmentModalProps) {
  const toast = useToast();
  const editing = mode === 'edit' && editingId ? RECRUITMENTS.find(r => r.id === editingId) : null;

  const [jobTitle, setJobTitle]               = useState('');
  const [department, setDepartment]           = useState('');
  const [designation, setDesignation]         = useState('');
  const [employmentType, setEmploymentType]   = useState('Full Time');
  const [openings, setOpenings]               = useState('1');
  const [experience, setExperience]           = useState('');
  const [workMode, setWorkMode]               = useState('Hybrid');
  const [priority, setPriority]               = useState<Priority>('Medium');
  const [hiringManager, setHiringManager]     = useState('');
  const [assignedHr, setAssignedHr]           = useState('');
  const [startDate, setStartDate]             = useState('');
  const [deadline, setDeadline]               = useState('');
  const [linkedRequest, setLinkedRequest]     = useState('');
  const [jobDescription, setJobDescription]   = useState('');
  const [requiredSkills, setRequiredSkills]   = useState('');
  const [postExternally, setPostExternally]   = useState(true);

  type CreateErrors = Partial<Record<
    'jobTitle' | 'department' | 'designation' | 'employmentType' | 'openings' | 'experience'
    | 'workMode' | 'priority' | 'hiringManager' | 'assignedHr' | 'startDate' | 'deadline'
    | 'jobDescription' | 'requiredSkills',
    string
  >>;
  const [errors, setErrors] = useState<CreateErrors>({});

  useEffect(() => {
    if (!isOpen) return;
    if (editing) {
      setJobTitle(editing.jobTitle);
      setDepartment(editing.department);
      setDesignation(editing.designation);
      setEmploymentType(editing.employmentType);
      setOpenings(String(editing.openings));
      setExperience(editing.experience);
      setWorkMode(editing.workMode);
      setPriority(editing.priority);
      setHiringManager(`${editing.hiringManagerRole} – ${editing.hiringManagerName}`);
      setAssignedHr(editing.assignedHrName);
      setStartDate('');
      setDeadline('');
      setLinkedRequest('');
      setJobDescription('');
      setRequiredSkills('');
      setPostExternally(true);
      setErrors({});
    } else {
      setJobTitle(''); setDepartment(''); setDesignation(''); setEmploymentType('Full Time');
      setOpenings('1'); setExperience(''); setWorkMode('Hybrid'); setPriority('Medium');
      setHiringManager(''); setAssignedHr(''); setStartDate(''); setDeadline('');
      setLinkedRequest(''); setJobDescription(''); setRequiredSkills(''); setPostExternally(true);
      setErrors({});
    }
  }, [isOpen, editingId]); // eslint-disable-line react-hooks/exhaustive-deps

  const clear = (k: keyof CreateErrors) =>
    setErrors(prev => { if (!prev[k]) return prev; const n = { ...prev }; delete n[k]; return n; });

  const validate = (): CreateErrors => {
    const e: CreateErrors = {};
    if (!jobTitle.trim())        e.jobTitle        = 'Job title is required';
    if (!department)             e.department      = 'Department is required';
    if (!designation.trim())     e.designation     = 'Designation is required';
    if (!employmentType)         e.employmentType  = 'Employment type is required';
    if (!openings.trim() || Number(openings) <= 0) e.openings = 'Openings must be at least 1';
    if (!experience.trim())      e.experience      = 'Experience is required';
    if (!workMode)               e.workMode        = 'Work mode is required';
    if (!priority)               e.priority        = 'Priority is required';
    if (!hiringManager)          e.hiringManager   = 'Hiring manager is required';
    if (!assignedHr)             e.assignedHr      = 'Assigned HR is required';
    if (!startDate)              e.startDate       = 'Start date is required';
    if (!deadline)               e.deadline        = 'TAT/Deadline is required';
    return e;
  };

  const handleSubmit = () => {
    const errs = validate();
    if (Object.keys(errs).length > 0) {
      setErrors(errs);
      toast.error('Please complete required fields', `${Object.keys(errs).length} field${Object.keys(errs).length === 1 ? '' : 's'} need attention.`);
      return;
    }
    onSubmit();
  };

  return (
    <Modal isOpen={isOpen} toggle={onClose} centered modalClassName="rec-form-modal" contentClassName="rec-form-content border-0" backdrop="static" keyboard={false}>
      <ModalBody className="p-0">
        {/* Header */}
        <div className="rec-form-header">
          <div className="d-flex align-items-center justify-content-between gap-3">
            <div className="d-flex align-items-center gap-3">
              <span
                style={{
                  width: 44, height: 44, borderRadius: 12,
                  background: 'rgba(255,255,255,0.18)',
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                }}
              >
                <i className={mode === 'edit' ? 'ri-pencil-line' : 'ri-add-circle-line'} style={{ fontSize: 22 }} />
              </span>
              <div>
                <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 18, letterSpacing: '-0.01em' }}>
                  {mode === 'edit' ? `Edit Recruitment ${editing ? `(${editing.id})` : ''}` : 'Create Recruitment'}
                </h5>
                <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                  Set up a new hiring drive — link to a request or post directly
                </div>
              </div>
            </div>
            <button type="button" onClick={onClose} aria-label="Close" className="rec-close-btn d-inline-flex align-items-center justify-content-center">
              <i className="ri-close-line" style={{ fontSize: 20 }} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="rec-form-body">
          {/* Job Basics */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: '#ece6ff', color: '#5a3fd1' }}>
                <i className="ri-briefcase-4-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Job Basics</p>
                <p className="rec-form-section-sub">Title, department and designation</p>
              </div>
            </div>
            <Row className="g-3">
              <Col md={6}>
                <label className="rec-form-label">Job Title<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.jobTitle ? ' is-invalid' : ''}`}
                  placeholder="e.g. Senior Backend Engineer"
                  value={jobTitle}
                  onChange={e => { setJobTitle(e.target.value); clear('jobTitle'); }}
                />
                {errors.jobTitle && <div className="rec-error"><i className="ri-error-warning-line" />{errors.jobTitle}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Linked Hiring Request</label>
                <MasterSelect
                  value={linkedRequest}
                  onChange={setLinkedRequest}
                  options={[
                    { value: '', label: 'None — direct posting' },
                    ...HIRING_REQUESTS.filter(r => r.status === 'Approved').map(r => ({
                      value: r.id, label: `${r.id} · ${r.position}`,
                    })),
                  ]}
                  placeholder="None — direct posting"
                />
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Department<span className="req">*</span></label>
                <MasterSelect
                  value={department}
                  onChange={(v) => { setDepartment(v); clear('department'); }}
                  options={HR_DEPT_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.department}
                />
                {errors.department && <div className="rec-error"><i className="ri-error-warning-line" />{errors.department}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Designation<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.designation ? ' is-invalid' : ''}`}
                  placeholder="e.g. Senior Software Engineer"
                  value={designation}
                  onChange={e => { setDesignation(e.target.value); clear('designation'); }}
                />
                {errors.designation && <div className="rec-error"><i className="ri-error-warning-line" />{errors.designation}</div>}
              </Col>
              <Col md={4}>
                <label className="rec-form-label">Employment Type<span className="req">*</span></label>
                <MasterSelect
                  value={employmentType}
                  onChange={(v) => { setEmploymentType(v); clear('employmentType'); }}
                  options={REC_EMPLOYMENT_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.employmentType}
                />
                {errors.employmentType && <div className="rec-error"><i className="ri-error-warning-line" />{errors.employmentType}</div>}
              </Col>
            </Row>
          </div>

          {/* Pipeline & Logistics */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: '#dceefe', color: '#0c63b0' }}>
                <i className="ri-flow-chart" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Pipeline &amp; Logistics</p>
                <p className="rec-form-section-sub">Openings, experience, mode and priority</p>
              </div>
            </div>
            <Row className="g-3">
              <Col md={3}>
                <label className="rec-form-label">No. of Openings<span className="req">*</span></label>
                <input
                  type="number"
                  min={1}
                  className={`rec-input${errors.openings ? ' is-invalid' : ''}`}
                  value={openings}
                  onChange={e => { setOpenings(e.target.value); clear('openings'); }}
                />
                {errors.openings && <div className="rec-error"><i className="ri-error-warning-line" />{errors.openings}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label">Experience<span className="req">*</span></label>
                <input
                  type="text"
                  className={`rec-input${errors.experience ? ' is-invalid' : ''}`}
                  placeholder="e.g. 4 yr+"
                  value={experience}
                  onChange={e => { setExperience(e.target.value); clear('experience'); }}
                />
                {errors.experience && <div className="rec-error"><i className="ri-error-warning-line" />{errors.experience}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label">Work Mode<span className="req">*</span></label>
                <MasterSelect
                  value={workMode}
                  onChange={(v) => { setWorkMode(v); clear('workMode'); }}
                  options={WORK_MODE_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.workMode}
                />
                {errors.workMode && <div className="rec-error"><i className="ri-error-warning-line" />{errors.workMode}</div>}
              </Col>
              <Col md={3}>
                <label className="rec-form-label">Priority<span className="req">*</span></label>
                <MasterSelect
                  value={priority}
                  onChange={(v) => { setPriority(v as Priority); clear('priority'); }}
                  options={REC_PRIORITY_OPTIONS}
                  placeholder="Select"
                  invalid={!!errors.priority}
                />
                {errors.priority && <div className="rec-error"><i className="ri-error-warning-line" />{errors.priority}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Hiring Manager<span className="req">*</span></label>
                <MasterSelect
                  value={hiringManager}
                  onChange={(v) => { setHiringManager(v); clear('hiringManager'); }}
                  options={HIRING_MANAGER_OPTIONS}
                  placeholder="Select hiring manager"
                  invalid={!!errors.hiringManager}
                />
                {errors.hiringManager && <div className="rec-error"><i className="ri-error-warning-line" />{errors.hiringManager}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Assigned HR<span className="req">*</span></label>
                <MasterSelect
                  value={assignedHr}
                  onChange={(v) => { setAssignedHr(v); clear('assignedHr'); }}
                  options={ASSIGNED_HR_OPTIONS}
                  placeholder="Select HR owner"
                  invalid={!!errors.assignedHr}
                />
                {errors.assignedHr && <div className="rec-error"><i className="ri-error-warning-line" />{errors.assignedHr}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">Start Date<span className="req">*</span></label>
                <MasterDatePicker
                  value={startDate}
                  onChange={(v) => { setStartDate(v); clear('startDate'); }}
                  placeholder="dd-mm-yyyy"
                  invalid={!!errors.startDate}
                />
                {errors.startDate && <div className="rec-error"><i className="ri-error-warning-line" />{errors.startDate}</div>}
              </Col>
              <Col md={6}>
                <label className="rec-form-label">TAT / Deadline<span className="req">*</span></label>
                <MasterDatePicker
                  value={deadline}
                  onChange={(v) => { setDeadline(v); clear('deadline'); }}
                  placeholder="dd-mm-yyyy"
                  invalid={!!errors.deadline}
                />
                {errors.deadline && <div className="rec-error"><i className="ri-error-warning-line" />{errors.deadline}</div>}
              </Col>
            </Row>
          </div>

          {/* Job content */}
          <div className="rec-form-section">
            <div className="rec-form-section-head">
              <span className="rec-form-section-icon" style={{ background: '#fde8c4', color: '#a4661c' }}>
                <i className="ri-file-text-line" style={{ fontSize: 18 }} />
              </span>
              <div>
                <p className="rec-form-section-title">Job Content</p>
                <p className="rec-form-section-sub">Description and required skills (optional but recommended)</p>
              </div>
            </div>
            <Row className="g-3">
              <Col xs={12}>
                <label className="rec-form-label">Job Description</label>
                <textarea
                  className="rec-input rec-textarea"
                  placeholder="Paste from the linked hiring request or write fresh…"
                  value={jobDescription}
                  onChange={e => setJobDescription(e.target.value)}
                />
              </Col>
              <Col xs={12}>
                <label className="rec-form-label">Required Skills</label>
                <input
                  type="text"
                  className="rec-input"
                  placeholder="e.g. React, Node.js, AWS"
                  value={requiredSkills}
                  onChange={e => setRequiredSkills(e.target.value)}
                />
              </Col>
              <Col xs={12}>
                <label className="d-inline-flex align-items-center gap-2" style={{ cursor: 'pointer' }}>
                  <input
                    type="checkbox"
                    checked={postExternally}
                    onChange={e => setPostExternally(e.target.checked)}
                    style={{ width: 16, height: 16, accentColor: '#7c5cfc' }}
                  />
                  <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>
                    Post to external job board after creation
                  </span>
                </label>
              </Col>
            </Row>
          </div>
        </div>

        {/* Footer */}
        <div className="rec-form-footer">
          <span className="hint">Fields marked <span style={{ color: '#f06548', fontWeight: 700 }}>*</span> are required</span>
          <div className="d-flex gap-2">
            <button type="button" className="rec-btn-ghost" onClick={onClose}>
              <i className="ri-close-line" />Cancel
            </button>
            <button type="button" className="rec-btn-primary" onClick={handleSubmit}>
              <i className={mode === 'edit' ? 'ri-save-3-line' : 'ri-add-circle-line'} />
              {mode === 'edit' ? 'Save Changes' : 'Create Recruitment'}
              <i className="ri-arrow-right-line" />
            </button>
          </div>
        </div>
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Cancel confirmation
// ─────────────────────────────────────────────────────────────────────────────

function CancelConfirmModal({
  target, onClose, onConfirm,
}: { target: RecruitmentRow | null; onClose: () => void; onConfirm: () => void }) {
  return (
    <Modal isOpen={!!target} toggle={onClose} centered size="md" backdrop="static" keyboard={false}
      contentClassName="border-0" style={{ borderRadius: 20 }}
    >
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)', borderRadius: 20, overflow: 'hidden' }}>
        {target && (
          <>
            <div style={{ background: 'linear-gradient(135deg,#fdd9d6 0%, #fdc8c2 100%)', padding: '22px 24px', textAlign: 'center' }}>
              <div
                className="d-inline-flex align-items-center justify-content-center"
                style={{
                  width: 56, height: 56, borderRadius: 16,
                  background: '#f06548',
                  boxShadow: '0 8px 22px rgba(240,101,72,0.40)',
                }}
              >
                <i className="ri-close-circle-line" style={{ fontSize: 28, color: '#fff' }} />
              </div>
              <h5 className="fw-bold mt-3 mb-1" style={{ color: '#7a1f0d' }}>Cancel Recruitment</h5>
              <div style={{ color: '#7a1f0d', fontSize: 13 }}>
                Cancel <strong>{target.id} · {target.jobTitle}</strong>?
              </div>
            </div>
            <div style={{ padding: '20px 24px', background: '#fef6f4', borderBottom: '1px solid #fde0db' }}>
              <div style={{ background: '#fff', border: '1px solid #fde0db', borderRadius: 10, padding: '10px 14px', fontSize: 12.5, color: '#7a1f0d' }}>
                <i className="ri-information-line align-bottom me-1" />
                The recruitment will move to the Cancelled tab. Linked candidate pipelines will be paused but kept for reference.
              </div>
            </div>
            <div className="d-flex gap-2 justify-content-end" style={{ padding: '14px 24px' }}>
              <button type="button" className="rec-btn-ghost" onClick={onClose}>
                <i className="ri-arrow-go-back-line" />Keep Active
              </button>
              <button
                type="button"
                onClick={onConfirm}
                className="d-inline-flex align-items-center gap-2"
                style={{
                  padding: '10px 20px', borderRadius: 12,
                  background: 'linear-gradient(90deg,#f06548,#d94d2c)',
                  color: '#fff', border: 'none',
                  fontSize: 13.5, fontWeight: 700,
                  boxShadow: '0 8px 18px rgba(240,101,72,0.30)',
                  cursor: 'pointer',
                }}
              >
                <i className="ri-close-circle-line" />Yes, Cancel
              </button>
            </div>
          </>
        )}
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Candidates placeholder modal
// ─────────────────────────────────────────────────────────────────────────────

function CandidatesPlaceholderModal({
  target, onClose,
}: { target: RecruitmentRow | null; onClose: () => void }) {
  return (
    <Modal isOpen={!!target} toggle={onClose} centered size="lg" backdrop="static"
      contentClassName="border-0" style={{ borderRadius: 20 }}
    >
      <ModalBody className="p-0" style={{ background: 'var(--vz-card-bg)', borderRadius: 20, overflow: 'hidden' }}>
        {target && (
          <>
            <div className="rec-form-header">
              <div className="d-flex align-items-center justify-content-between gap-3">
                <div className="d-flex align-items-center gap-3">
                  <span style={{ width: 44, height: 44, borderRadius: 12, background: 'rgba(255,255,255,0.18)', display: 'inline-flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <i className="ri-team-line" style={{ fontSize: 22 }} />
                  </span>
                  <div>
                    <h5 className="fw-bold mb-0" style={{ color: '#fff', fontSize: 18 }}>Candidates · {target.id}</h5>
                    <div style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.85)' }}>
                      {target.jobTitle} · {target.openings} opening{target.openings === 1 ? '' : 's'} · {target.workMode}
                    </div>
                  </div>
                </div>
                <button type="button" onClick={onClose} className="rec-close-btn d-inline-flex align-items-center justify-content-center">
                  <i className="ri-close-line" style={{ fontSize: 20 }} />
                </button>
              </div>
            </div>
            <div style={{ padding: '40px 32px', textAlign: 'center' }}>
              <div
                className="d-inline-flex align-items-center justify-content-center"
                style={{ width: 72, height: 72, borderRadius: 20, background: '#ece6ff', color: '#5a3fd1' }}
              >
                <i className="ri-user-search-line" style={{ fontSize: 32 }} />
              </div>
              <h5 className="fw-bold mt-3 mb-1">Candidate Pipeline</h5>
              <p className="text-muted mb-3" style={{ fontSize: 13.5 }}>
                Detailed candidate pipeline (Sourced → Screened → Interview → Offer → Joined) opens here.
                Wire it up to the Candidate API once the endpoints are ready.
              </p>
              <button type="button" className="rec-btn-primary" onClick={onClose}>
                <i className="ri-check-line" />Got it
              </button>
            </div>
          </>
        )}
      </ModalBody>
    </Modal>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ActionBtn({
  title, icon, color, onClick, disabled,
}: { title: string; icon: string; color: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      title={title}
      disabled={disabled}
      className="btn p-0 d-inline-flex align-items-center justify-content-center"
      style={{
        width: 30, height: 30, borderRadius: 8,
        background: 'var(--vz-secondary-bg)',
        border: '1px solid var(--vz-border-color)',
        color: 'var(--vz-secondary-color)',
        transition: 'all .15s ease',
        opacity: disabled ? 0.45 : 1,
        cursor: disabled ? 'not-allowed' : 'pointer',
      }}
      onMouseEnter={e => {
        if (disabled) return;
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = `var(--vz-${color})`;
        el.style.color = `var(--vz-${color})`;
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLButtonElement;
        el.style.borderColor = 'var(--vz-border-color)';
        el.style.color = 'var(--vz-secondary-color)';
      }}
      onClick={onClick}
    >
      <i className={`${icon} fs-14`} />
    </button>
  );
}

function AnimatedNumber({ value, prefix = '', suffix = '' }: { value: number; prefix?: string; suffix?: string }) {
  const [display, setDisplay] = useState(0);
  useEffect(() => {
    let start = 0;
    const end = value;
    if (!end) { setDisplay(0); return; }
    const dur = 600;
    const t0 = performance.now();
    let raf = 0;
    const tick = (t: number) => {
      const p = Math.min(1, (t - t0) / dur);
      const eased = 1 - Math.pow(1 - p, 3);
      setDisplay(Math.round(start + (end - start) * eased));
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return <>{prefix}{display}{suffix}</>;
}
