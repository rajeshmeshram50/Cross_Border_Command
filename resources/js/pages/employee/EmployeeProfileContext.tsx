import { createContext, useContext } from 'react';
import type { RefObject } from 'react';
import type { EmployeeProfileTarget } from './EmployeeProfile';

export interface EmployeeProfileCtx {
  // ── Identity / props ──
  employeeId: string;
  employee?: EmployeeProfileTarget;
  displayEmpCode: string;
  initials: string;
  accent: string;
  ancillaryList: string[];

  // ── Core employee record ──
  empDetail: any;
  empDetailLoading: boolean;

  // ── Shared formatters ──
  fmtDate: (raw: any) => string;
  fmtRupee: (n: number) => string;

  // ── Profile tab ──
  profilePct: number;
  profilePhotoSrc: string | null;
  profilePhotoFile: File | null;
  setProfilePhotoFile: (f: File | null) => void;
  savingPhoto: boolean;
  handleProfilePhotoChange: (file: File | null) => void;
  handleSaveProfilePhoto: () => Promise<void>;
  restoreSavedProfilePhoto: () => void;
  profilePhotoInputRef: RefObject<HTMLInputElement | null>;
  setFaceRegOpen: (v: boolean) => void;
  setPwOpen: (v: boolean) => void;

  // ── Vault tab ──
  vaultTab: 'employee' | 'organizational';
  setVaultTab: (v: 'employee' | 'organizational') => void;
  signedDocs: any[];
  uploadedDocs: any[];
  signedLoading: boolean;
  uploadedLoading: boolean;
  vaultCounts: any;
  prettyDocKey: (key: string) => string;
  formatBytes: (b: number | null) => string;
  setSignedPreview: (d: any) => void;
  downloadSignedPdf: (docId: number, code: string | null) => Promise<void>;

  // ── Payroll tab ──
  payrollTab: 'summary' | 'details';
  setPayrollTab: (v: 'summary' | 'details') => void;
  salaryStruct: any;
  realMonthlyGross: number;
  realAnnualCtc: number;
  realTimeline: any[];
  openLatestPayslip: () => void;
  setSalaryModalOpen: (v: boolean) => void;
  setBreakdownOpen: (v: boolean) => void;
  setBreakdownRowId: (id: string) => void;

  // ── Expense tab ──
  authUser: any;
  isOwnProfile: boolean;
  expenseModuleTab: 'expense' | 'advance';
  setExpenseModuleTab: (v: 'expense' | 'advance') => void;
  expenseSubTab: 'mine' | 'team';
  setExpenseSubTab: (v: 'mine' | 'team') => void;
  advanceSubTab: 'mine' | 'team';
  setAdvanceSubTab: (v: 'mine' | 'team') => void;
  expenseFilter: 'all' | 'approved' | 'rejected' | 'pending' | 'draft';
  setExpenseFilter: (v: 'all' | 'approved' | 'rejected' | 'pending' | 'draft') => void;
  expenseSearch: string;
  setExpenseSearch: (v: string) => void;
  expenseCounts: any;
  advanceCounts: any;
  totalClaimed: number;
  activeClaimsSource: any[];
  filteredExpenses: any[];
  activeAdvancesSource: any[];
  apiClaims: any[];
  teamClaims: any[];
  apiAdvances: any[];
  teamAdvances: any[];
  loadingClaims: boolean;
  loadingAdvances: boolean;
  refreshClaims: () => Promise<void>;
  refreshAdvances: () => Promise<void>;
  actOnClaim: (...args: any[]) => any;
  actOnAdvance: (...args: any[]) => any;
  claimCategories: any[];
  expenseDrafts: any[];
  advanceDrafts: any[];
  claimDraftKey: string;
  advanceDraftKey: string;
  setClaimOpen: (v: boolean) => void;
  setClaimMode: (v: 'expense' | 'advance') => void;
  setEditingDraftId: (id: string | null) => void;
  setResumeFromDraft: (v: boolean) => void;
  exportOpen: boolean;
  setExportOpen: (v: boolean | ((o: boolean) => boolean)) => void;

  // ── Hiring tab ──
  hiringRequests: any[];
  hiringLoading: boolean;
  setRaiseHiringOpen: (v: boolean) => void;
  setHiringEditing: (v: any) => void;
  setHiringViewing: (v: any) => void;
  teamSize: number;

  // ── Other shared (Profile/Vault/Expense) ──
  resetPwForm: () => void;
  employeeDocCount: number;
  organizationalDocCount: number;
  runProfileExport: (fmt: 'xlsx' | 'pdf' | 'csv') => void;
  readSavedDrafts: () => void;
  filteredAdvances: any[];
}

const Ctx = createContext<EmployeeProfileCtx | null>(null);

export const EmployeeProfileProvider = Ctx.Provider;

export function useEmployeeProfile(): EmployeeProfileCtx {
  const c = useContext(Ctx);
  if (!c) throw new Error('useEmployeeProfile must be used inside <EmployeeProfileProvider>');
  return c;
}
