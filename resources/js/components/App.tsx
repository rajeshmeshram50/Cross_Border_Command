import { useState, useEffect, createContext, useContext, lazy, Suspense } from 'react';
import api from '../api';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams, useNavigationType } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import velzonStore from '../velzon/store';
import { ThemeProvider } from '../contexts/ThemeContext';
import { VariantProvider } from '../contexts/VariantContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { resolveFileUrl } from '../utils/resolveFileUrl';
import { encodeOppId, encodeStage } from '../utils/oppCrypto';
import SplashLoader from './ui/SplashLoader';
import { ToastProvider } from '../contexts/ToastContext';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import { LayoutProvider } from '../contexts/LayoutContext';
import { BranchSwitcherProvider } from '../contexts/BranchSwitcherContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import CookieBanner from './CookieBanner';
import IdleTimeout from './IdleTimeout';
import VelzonShell from '../velzon/VelzonShell';
import AccessDenied from './AccessDenied';
import { canAccessPath } from '../utils/routeAccess';
import { FEATURE_FLAGS } from '../constants';
const Login = lazy(() => import('../pages/auth/Login'));
const ForgotPassword = lazy(() => import('../pages/auth/ForgotPassword'));
const VerifyOTP = lazy(() => import('../pages/auth/VerifyOTP'));
const ResetPassword = lazy(() => import('../pages/auth/ResetPassword'));
const AdminDashboard = lazy(() => import('../pages/dashboard/AdminDashboard'));
const ClientDashboard = lazy(() => import('../pages/dashboard/ClientDashboard'));
const BranchDashboard = lazy(() => import('../pages/dashboard/BranchDashboard'));
const EmployeeDashboard = lazy(() => import('../pages/dashboard/EmployeeDashboard'));
const Clients = lazy(() => import('../pages/client/Clients'));
const ClientForm = lazy(() => import('../pages/client/ClientForm'));
const Branches = lazy(() => import('../pages/branch/Branches'));
const UsersPage = lazy(() => import('../pages/UsersPage'));
const Plans = lazy(() => import('../pages/plan/Plans'));
const Payments = lazy(() => import('../pages/Payments'));
const Permissions = lazy(() => import('../pages/permission/Permissions'));
const Settings = lazy(() => import('../pages/Settings'));
const Profile = lazy(() => import('../pages/Profile'));
const AddPlan = lazy(() => import('../pages/plan/AddPlan'));
const BranchForm = lazy(() => import('../pages/branch/BranchForm'));
const BranchView = lazy(() => import('../pages/branch/BranchView'));
const PlanSelection = lazy(() => import('../pages/plan/PlanSelection'));
const ClientView = lazy(() => import('../pages/client/ClientView'));
const ClientBranches = lazy(() => import('../pages/client/ClientBranches'));
const ClientPermissions = lazy(() => import('../pages/client/ClientPermissions'));
const ClientPayments = lazy(() => import('../pages/client/ClientPayments'));
const ClientSettings = lazy(() => import('../pages/client/ClientSettings'));
const MasterDashboard = lazy(() => import('../pages/MasterDashboard'));
const MasterPage = lazy(() => import('../pages/master/MasterPage'));
const SalesCustomers = lazy(() => import('../pages/sales/core-masters/customer/SalesCustomers'));
const SalesConsignee = lazy(() => import('../pages/sales/core-masters/consignee/SalesConsignee'));
const SalesLeadAckMaster = lazy(() => import('../pages/sales/core-masters/lead-ack/SalesLeadAckMaster'));
const SalesLeadWorksheet = lazy(() => import('../pages/sales/opportunity-pipeline/SalesLeadWorksheet'));
const LeadDistributionPage = lazy(() => import('../pages/sales/opportunity-pipeline/AssignedLeadsModal'));
const SalesLeadsDetails = lazy(() => import('../pages/sales/opportunity-pipeline/SalesLeadsDetails'));
const SalesTodo = lazy(() => import('../pages/sales/insights-productivity/SalesTodo'));
const SalesQPI = lazy(() => import('../pages/sales/opportunity-pipeline/SalesQPI'));
const DeveloperShipments = lazy(() => import('../pages/developers/DeveloperShipments'));
const SalesSignTracker = lazy(() => import('../pages/sales/opportunity-pipeline/SalesSignTracker'));
const SalesP2PSummary = lazy(() => import('../pages/sales/opportunity-pipeline/SalesP2PSummary'));
const SalesMatrixDetail = lazy(() => import('../pages/sales/opportunity-pipeline/matrix/SalesMatrixDetail'));
const Products = lazy(() => import('../pages/p2p/p2p-master-management/product-management/Products'));
const ProductView = lazy(() => import('../pages/p2p/p2p-master-management/product-management/ProductView'));
const Vendors = lazy(() => import('../pages/p2p/p2p-master-management/supplier-management/Vendors'));
const SalesDiagnosis = lazy(() => import('../pages/sales/insights-productivity/SalesDiagnosis'));
const SalesResolutionCenter = lazy(() => import('../pages/sales/insights-productivity/SalesResolutionCenter'));
const SalesAnalytics = lazy(() => import('../pages/sales/insights-productivity/SalesAnalytics'));
const SalesPerformance = lazy(() => import('../pages/sales/insights-productivity/SalesPerformance'));
const ClmStubPage = lazy(() => import('../pages/clm/shared/ClmStubPage'));
const ClmAnalyticsPage = lazy(() => import('../pages/clm/command-center/ClmAnalyticsPage'));
const ClmSegmentPage = lazy(() => import('../pages/clm/compliance/ClmSegmentPage'));
const ClmAuthorityPage = lazy(() => import('../pages/clm/compliance/ClmAuthorityPage'));
const ClmKycPage = lazy(() => import('../pages/clm/compliance/ClmKycPage'));
const ClmDdPage = lazy(() => import('../pages/clm/compliance/ClmDdPage'));
const ClmTradeLicensesPage = lazy(() => import('../pages/clm/compliance/ClmTradeLicensesPage'));
const ClmQcPage = lazy(() => import('../pages/clm/compliance/ClmQcPage'));
const ClmTradeDocumentsPage = lazy(() => import('../pages/clm/document-masters/ClmTradeDocumentsPage'));
const ClmTncPage = lazy(() => import('../pages/clm/document-masters/ClmTncPage'));
const ClmAgreementsPage = lazy(() => import('../pages/clm/document-masters/ClmAgreementsPage'));
const ClmClauseLibraryPage = lazy(() => import('../pages/clm/document-masters/ClmClauseLibraryPage'));
const ClmDcpPage = lazy(() => import('../pages/clm/compliance/ClmDcpPage'));
const ClmBuyerProfilePage = lazy(() => import('../pages/clm/operations/ClmBuyerProfilePage'));
const ClmSupplierProfilePage = lazy(() => import('../pages/clm/operations/ClmSupplierProfilePage'));
const ClmDiagnosisResolutionPage = lazy(() => import('../pages/clm/command-center/ClmDiagnosisResolutionPage'));
const ClmRegulatoryDefenseFilePage = lazy(() => import('../pages/clm/command-center/ClmRegulatoryDefenseFilePage'));
const ClmCaseToCasePage = lazy(() => import('../pages/clm/operations/ClmCaseToCasePage'));
const ClmAgreementsSentPage = lazy(() => import('../pages/clm/operations/ClmAgreementsSentPage'));
const ClmAgreementsToApprovePage = lazy(() => import('../pages/clm/operations/ClmAgreementsToApprovePage'));
const HrDashboard = lazy(() => import('../pages/hrms/HrDashboard'));
const HrOverview = lazy(() => import('../pages/hrms/HrOverview'));
const HrEmployees = lazy(() => import('../pages/hrms/HrEmployees'));
const HrRecruitment = lazy(() => import('../pages/recruitment/HrRecruitment'));
const HrCandidates = lazy(() => import('../pages/recruitment/HrCandidates'));
const HrExitManagement = lazy(() => import('../pages/hrms/HrExitManagement'));
const HrAttendance = lazy(() => import('../pages/hrms/HrAttendance'));
const HrLeave = lazy(() => import('../pages/hrms/HrLeave'));
const HrLeavePlans = lazy(() => import('../pages/hrms/HrLeavePlans'));
const HrLeaveApprovals = lazy(() => import('../pages/hrms/HrLeaveApprovals'));
const HrHoliday = lazy(() => import('../pages/hrms/HrHoliday'));
const HrPIP = lazy(() => import('../pages/hrms/HrPIP'));
const HrExpenseManagement = lazy(() => import('../pages/hrms/HrExpenseManagement'));
const HrPayroll = lazy(() => import('../pages/hrms/HrPayroll'));
const HrBroadcastCentre = lazy(() => import('../pages/hrms/HrBroadcastCentre'));
const HrDocumentTemplates = lazy(() => import('../pages/hrms/HrDocumentTemplates'));
const HrCustomFields = lazy(() => import('../pages/hrms/HrCustomFields'));
const HrBiometricDevices = lazy(() => import('../pages/hrms/HrBiometricDevices'));
const TemplateFormPage = lazy(() => import('../pages/hrms/doc-templates/TemplateForm'));
const GenerateDocument = lazy(() => import('../pages/hrms/doc-templates/GenerateDocument'));
const HrEmployeeOnboarding = lazy(() => import('../pages/employee-onboarding/HrEmployeeOnboarding'));
const EmployeePermissions = lazy(() => import('../pages/employee/EmployeePermissions'));
const EmployeeProfile = lazy(() => import('../pages/employee/EmployeeProfile'));
import { ShimmerEmployeeProfile } from './ui/Shimmer';
const PublicOnboarding = lazy(() => import('../pages/PublicOnboarding'));
const ClockIn = lazy(() => import('../pages/ClockIn'));
const ModuleStubPage = lazy(() => import('../pages/ModuleStubPage'));
const P2pBulkSourcing = lazy(() => import('../pages/p2p/procurement-management/bulk-sourcing/P2pBulkSourcing'));
const PurchaseOrder = lazy(() => import('../pages/p2p/procurement-management/purchase-order/PurchaseOrder'));
const DevTools = lazy(() => import('../pages/dev-tools/DevTools'));
const SupplierPurchaseInvoice = lazy(() => import('../pages/p2p/purchase-management/supplier-purchase-invoice/SupplierPurchaseInvoice'));
const DebitNote = lazy(() => import('../pages/p2p/purchase-management/debit-note/DebitNote'));
const InventoryPutAway = lazy(() => import('../pages/inventory/InventoryPutAway'));
const InventoryStickers = lazy(() => import('../pages/inventory/InventoryStickers'));
const ScanLanding = lazy(() => import('../pages/inventory/ScanLanding'));
const InventoryScanDevices = lazy(() => import('../pages/inventory/InventoryScanDevices'));
const InventoryScanLog = lazy(() => import('../pages/inventory/InventoryScanLog'));
const MyTeam = lazy(() => import('../pages/MyTeam'));
const Documentation = lazy(() => import('../pages/Documentation'));
const Inbox = lazy(() => import('../pages/Inbox'));
const Gmail = lazy(() => import('../pages/Gmail'));

/* Route-transition fallback.
 *
 * Every page below is code-split, so navigating to one the browser has not
 * fetched yet suspends for the length of one chunk request. This is what shows
 * during that gap.
 *
 * Deliberately NOT <SplashLoader />: that is the app-boot splash, a fixed
 * full-screen overlay on a 2.4s timer, and firing it on every menu click would
 * cover the shell and take longer than the chunk it is waiting for. This keeps
 * the sidebar and header on screen and only fills the content area, matching
 * the inline spinner the employee wrappers already use.
 *
 * The delay-then-appear trick avoids a spinner flash on chunks that are
 * already cached: nothing paints for the first 180ms, so a warm navigation
 * looks instant and only a genuinely slow fetch ever shows the spinner.
 */
function RouteFallback() {
  return (
    <div
      style={{
        padding: 48,
        textAlign: 'center',
        color: 'var(--vz-secondary-color)',
        animation: 'cbcRouteFallbackIn 0s linear 180ms forwards',
        opacity: 0,
      }}
    >
      <style>{'@keyframes cbcRouteFallbackIn{to{opacity:1}}'}</style>
      <i className="ri-loader-4-line ri-spin" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
      <div style={{ fontSize: 13, fontWeight: 600 }}>Loading…</div>
    </div>
  );
}

// Create NavigateContext for consistent navigation across the app
const NavigateContext = createContext<{
  navigate: (path: string, data?: any) => void;
  getPath: (page: string, data?: any) => string;
}>({
  navigate: () => {},
  getPath: () => '',
});

export const useNavigateContext = () => useContext(NavigateContext);

// Page to path mapping
const getPagePath = (page: string, data?: any): string => {
  switch (page) {
    case 'dashboard': return '/dashboard';
    case 'clients': return '/clients';
    case 'client-form': return data?.editId ? `/clients/${data.editId}/edit` : '/clients/new';
    case 'client-view': return `/clients/${data?.clientId}`;
    case 'client-branches': return `/clients/${data?.clientId}/branches`;
    case 'client-permissions': return `/clients/${data?.clientId}/permissions`;
    case 'client-payments': return `/clients/${data?.clientId}/payments`;
    case 'client-settings': return `/clients/${data?.clientId}/settings`;
    case 'branches': return '/branches';
    case 'branch-form': return data?.editId ? `/branches/${data.editId}/edit` : '/branches/new';
    case 'branch-view': return `/branches/${data?.branchId}`;
    case 'branch-users': return data?.branchId ? `/branches/${data.branchId}/users` : '/branches/users';
    case 'client-users': return '/clients/users';
    case 'hr-employees': return '/hr/employees';
    case 'hr-recruitment': return '/hr/recruitment';
    case 'hr-attendance': return '/hr/attendance';
    case 'hr-leave': return '/hr/leave';
    case 'hr-holiday': return '/hr/holiday';
    case 'hr-expense': return '/hr/expense';
    case 'hr-payroll': return '/hr/payroll';
    case 'hr-broadcast': return '/hr/broadcast';
    case 'hr-doc-templates': return '/hr/doc-templates';
    case 'hr-employee-onboarding': return '/hr/employee-onboarding';
    case 'employee-permissions': return `/hr/employees/${data?.employeeId}/permissions`;
    case 'employee-profile':     return `/hr/employees/${data?.employeeId}/profile`;
    case 'plans': return '/plans';
    case 'add-plan': return data?.editId ? `/plans/${data.editId}/edit` : '/plans/new';
    case 'my-plan': return '/my-plan';
    case 'plan-blocked': return '/plan-blocked';
    case 'payments': return '/payments';
    case 'clock-in': return '/clock-in';
    // New top-level header modules. P2P reuses the existing Sales P2P
    // Summary page; the other three render the shared permission-gated stub
    // until their real pages ship.
    case 'p2p': return '/p2p';
    case 'credentials-vault': return '/credentials-vault';
    case 'project-navigator': return '/project-navigator';
    case 'gts': return '/gts';
    case 'inventory': return '/inventory';
    case 'developers': return '/developers/shipment';
    case 'permissions': return '/permissions';
    case 'settings': return '/settings';
    case 'profile': return '/profile';
    /* Both routes existed but had no id here, so navigating to them by id fell
       through to the `default` branch and landed on /dashboard. The horizontal
       header pushes paths directly and never hit it; the vertical layout goes
       through this map, which is why its profile menu couldn't offer them. */
    case 'my-team': return '/my-team';
    case 'documentation': return '/documentation';
    default:
      // Master leaf slugs come as `master.xxx` — map to `/master/xxx`
      if (page.startsWith('master.')) return `/master/${page.slice('master.'.length)}`;
      if (page === 'master') return '/master';
      // Sales Matrix leaf slugs come as `sales.xxx`. Wired: customers,
      // consignee, lead_ack_master. Other sales.* leaves fall through to
      // /dashboard until their pages are built.
      if (page === 'sales.customers')       return '/sales/customers';
      if (page === 'sales.consignee')       return '/sales/consignee';
      if (page === 'sales.lead_ack_master') return '/sales/lead-ack-master';
      if (page === 'sales.lead_worksheet')  return data?.salespersonId ? `/sales/lead-worksheet?sp=${data.salespersonId}${data?.salespersonName ? `&sp_name=${encodeURIComponent(data.salespersonName)}` : ''}` : '/sales/lead-worksheet';
      if (page === 'sales.lead_distribution') return '/sales/lead-distribution';
      if (page === 'sales.leads_details') {
        const sp     = data?.salespersonId ? `sp=${data.salespersonId}` : '';
        const spName = data?.salespersonName ? `sp_name=${encodeURIComponent(data.salespersonName)}` : '';
        const spEmp  = data?.salespersonEmp ? `sp_emp=${encodeURIComponent(data.salespersonEmp)}` : '';
        const spMgr  = data?.salespersonMgr ? `sp_mgr=${encodeURIComponent(data.salespersonMgr)}` : '';
        const qs = [sp, spName, spEmp, spMgr].filter(Boolean).join('&');
        return qs ? `/sales/leads-details?${qs}` : '/sales/leads-details';
      }
      /* "My Workplace" reuses the Lead Worksheet page — it's the same
         operational view, surfaced under a friendlier menu label after
         the May-26 cleanup. */
      if (page === 'sales.workplace')       return '/sales/lead-worksheet';
      if (page === 'sales.todo')            return '/sales/todo';
      if (page === 'sales.matrix_detail')   return data?.oppId ? `/sales/matrix/${encodeOppId(data.oppId)}/stage/${encodeStage(data?.stage || 1)}` : '/sales/matrix';
      if (page === 'sales.qpi')             return '/sales/qpi';
      /* Sales Matrix Operations menu was trimmed to "My Workplace" and
         "Quotation Vs PI History"; the QPI page already exists and the
         alias keeps the new menu id wired to it. */
      if (page === 'sales.quotation_vs_pi') return '/sales/qpi';
      if (page === 'sales.sign_tracker')    return '/sales/sign-tracker';
      if (page === 'sales.p2p_summary')     return '/sales/p2p-summary';
      if (page === 'sales.diagnosis')       return '/sales/diagnosis';
      if (page === 'sales.resolution_center') return '/sales/resolution-center';
      if (page === 'sales.analytics')       return '/sales/analytics';
      if (page === 'sales.performance')     return '/sales/performance';
      // Central CLM — every leaf reuses the same stub route until the
      // real pages ship. The slug after /clm/ is what the stub reads
      // to render the right title + breadcrumb.
      if (page === 'clm.analytics')             return '/clm/analytics';
      if (page === 'clm.diagnosis_resolution')  return '/clm/diagnosis-resolution';
      if (page === 'clm.regulatory_defense')    return '/clm/regulatory-defense';
      if (page === 'clm.buyer_profile')         return '/clm/buyer-profile';
      if (page === 'clm.supplier_profile')      return '/clm/supplier-profile';
      if (page === 'clm.case_to_case')          return '/clm/case-to-case';
      if (page === 'clm.agreements_sent')       return '/clm/agreements-sent';
      if (page === 'clm.agreements_to_approve') return '/clm/agreements-to-approve';
      if (page === 'clm.segment')               return '/clm/segment';
      if (page === 'clm.authority')             return '/clm/authority';
      if (page === 'clm.quality_docs')          return '/clm/quality-docs';
      if (page === 'clm.kyc')                   return '/clm/kyc';
      if (page === 'clm.due_diligence')         return '/clm/due-diligence';
      if (page === 'clm.trade_licenses')        return '/clm/trade-licenses';
      if (page === 'clm.document_panel')        return '/clm/document-panel';
      if (page === 'clm.trade_documents')       return '/clm/trade-documents';
      if (page === 'clm.agreements')            return '/clm/agreements';
      if (page === 'clm.terms_conditions')      return '/clm/terms-conditions';
      if (page === 'clm.clause_library')        return '/clm/clause-library';
      // Developers → Shipment (Business Task list).
      if (page === 'developers.shipment')       return '/developers/shipment';
      return '/dashboard';
  }
};

// Wrapper components to extract URL params
function ClientViewWrapper() {
  const { id } = useParams();
  const navigateFn = useNavigateContext().navigate;
  return <ClientView clientId={Number(id)} onBack={() => navigateFn('clients')} onNavigate={navigateFn} />;
}

function ClientBranchesWrapper() {
  const { id } = useParams();
  const navigateFn = useNavigateContext().navigate;
  return <ClientBranches clientId={Number(id)} clientName="" onBack={() => navigateFn('clients')} />;
}

function ClientPermissionsWrapper() {
  const { id } = useParams();
  const navigateFn = useNavigateContext().navigate;
  return <ClientPermissions clientId={Number(id)} clientName="" onBack={() => navigateFn('clients')} />;
}

function ClientPaymentsWrapper() {
  const { id } = useParams();
  const navigateFn = useNavigateContext().navigate;
  return <ClientPayments clientId={Number(id)} clientName="" onBack={() => navigateFn('clients')} />;
}

function ClientSettingsWrapper() {
  const { id } = useParams();
  const navigateFn = useNavigateContext().navigate;
  return <ClientSettings clientId={Number(id)} clientName="" onBack={() => navigateFn('clients')} />;
}

function ClientFormWrapper() {
  const { id } = useParams();
  const navigateFn = useNavigateContext().navigate;
  return <ClientForm onBack={() => navigateFn('clients')} editId={id ? Number(id) : undefined} />;
}

function BranchFormWrapper() {
  const { id } = useParams();
  const navigateFn = useNavigateContext().navigate;
  return <BranchForm onBack={() => navigateFn('branches')} editId={id ? Number(id) : undefined} />;
}

function BranchViewWrapper() {
  const { id } = useParams();
  const navigateFn = useNavigateContext().navigate;
  return <BranchView branchId={Number(id)} onBack={() => navigateFn('branches')} onNavigate={navigateFn} />;
}

function AddPlanWrapper() {
  const { id } = useParams();
  const navigateFn = useNavigateContext().navigate;
  return <AddPlan onBack={() => navigateFn('plans')} editId={id ? Number(id) : undefined} />;
}

function BranchUsersWrapper() {
  const { id } = useParams();
  const location = useLocation();
  const navigateFn = useNavigateContext().navigate;
  const stateBranchName = (location.state as any)?.branchName;
  return (
    <UsersPage
      branchId={id ? Number(id) : undefined}
      branchName={stateBranchName}
      onBack={() => navigateFn('branches')}
    />
  );
}

function EmployeePermissionsWrapper() {
  const { id } = useParams();
  const location = useLocation();
  const navigateFn = useNavigateContext().navigate;
  // Same identifier-decode pattern as EmployeeProfileWrapper — the URL
  // param can be an encrypted token, a numeric id, or a plain emp_code.
  // We resolve it once via /employees/{param} so the inner page receives
  // a stable emp_code and the linked employee row (with user_id) needed
  // to dispatch permission saves to the right backend user.
  const stateEmp = (location.state as any)?.employee;
  const [empCode, setEmpCode] = useState<string | null>(
    stateEmp?.emp_code || stateEmp?.id || null,
  );
  const [resolvedEmp, setResolvedEmp] = useState<any>(stateEmp || null);
  const [resolving, setResolving] = useState<boolean>(!stateEmp);

  useEffect(() => {
    if (stateEmp || !id) return;
    let cancelled = false;
    setResolving(true);
    api.get(`/employees/${encodeURIComponent(String(id))}`)
      .then((res: any) => {
        if (cancelled) return;
        const e = res?.data?.employee || res?.data;
        if (e) {
          setEmpCode(e.emp_code || (e.id ? `EMP-${e.id}` : null));
          setResolvedEmp(e);
        }
      })
      .catch(() => { /* leave empCode null — the inner page surfaces the error */ })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [id, stateEmp]);

  if (resolving) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--vz-secondary-color)' }}>
        <i className="ri-loader-4-line ri-spin" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>Loading permissions…</div>
      </div>
    );
  }
  return <EmployeePermissions employeeId={empCode || String(id)} employee={resolvedEmp} onBack={() => navigateFn('hr-employees')} />;
}

function EmployeeProfileWrapper() {
  const { id } = useParams();
  const location = useLocation();
  const navigateFn = useNavigateContext().navigate;
  const stateEmp = (location.state as any)?.employee;
  // A caller (e.g. the Payroll Execution Blocked popup, #38) can tag the
  // navigation with a return context so Back/Close comes back to where it was
  // opened from instead of the default Active-Employees list.
  const returnPage = (location.state as any)?.returnPage as string | undefined;
  const returnData = (location.state as any)?.returnData;

  // The URL param can be: (a) an encrypted token (preferred path,
  // surfaced by Employee::encrypted_id), (b) a plain numeric DB id, or
  // (c) a legacy emp_code like EMP-001. EmployeeProfile downstream
  // expects an emp_code as its `employeeId` prop, so resolve the
  // identifier via /employees/{param} — the backend's resolveIdParam
  // accepts all three shapes and returns the canonical record.
  //
  // When location.state already carries the row (navigated from
  // HrEmployees / MyTeam), skip the round-trip and use it directly so
  // back/forward navigation stays instant.
  const [empCode, setEmpCode] = useState<string | null>(
    stateEmp?.emp_code || stateEmp?.id || null,
  );
  const [resolvedEmp, setResolvedEmp] = useState<any>(stateEmp || null);
  const [resolving, setResolving] = useState<boolean>(!stateEmp);
  const [resolveErr, setResolveErr] = useState<string | null>(null);

  useEffect(() => {
    if (stateEmp || !id) return;
    let cancelled = false;
    setResolving(true);
    api.get(`/employees/${encodeURIComponent(String(id))}`)
      .then((res: any) => {
        if (cancelled) return;
        const e = res?.data?.employee || res?.data;
        if (!e) { setResolveErr('Employee not found'); return; }
        const code = e.emp_code || (e.id ? `EMP-${e.id}` : null);
        setEmpCode(code);
        // Normalise the raw API row into the EmployeeProfileTarget shape —
        // department / designation arrive as relation OBJECTS ({id,name,code}),
        // but EmployeeProfile expects flat strings. Passing the raw objects
        // crashed the hero with "Objects are not valid as a React child".
        const flatName = (v: any) => (v && typeof v === 'object' ? v.name : v) ?? undefined;
        setResolvedEmp({
          ...e,
          id: code,
          name: e.display_name || [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ').trim() || code,
          department: flatName(e.department),
          designation: flatName(e.designation),
        });
      })
      .catch((err: any) => {
        if (cancelled) return;
        setResolveErr(err?.response?.status === 404 ? 'Employee not found' : 'Could not load profile');
      })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [id, stateEmp]);

  /* Opened WITHOUT a preloaded row — Payroll → Run Payroll → Open Employee is
     the common case — so the record has to be fetched before the profile can
     render. That wait used to be a bare centred spinner on an empty page; show
     the profile's own skeleton instead, so the layout is already in place when
     the data lands. */
  if (resolving) {
    return <ShimmerEmployeeProfile />;
  }
  if (resolveErr || !empCode) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--vz-secondary-color)' }}>
        <i className="ri-error-warning-line" style={{ fontSize: 28, display: 'block', marginBottom: 8, color: '#ef4444' }} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>{resolveErr || 'Unable to open profile'}</div>
      </div>
    );
  }
  return <EmployeeProfile employeeId={empCode} employee={resolvedEmp} onBack={() => navigateFn(returnPage || 'hr-employees', returnData)} />;
}

/**
 * /profile route — branches on the logged-in user type:
 *   employee → renders the EmployeeProfile component preloaded with their
 *              own Employee record (so they get the same tabs, expense
 *              raise/list, evidence vault, etc. as an HR-side view).
 *   anyone   → renders the existing admin/client Profile page.
 *
 * The fetch is fire-and-forget; if it fails, EmployeeProfile still renders
 * with the minimal `{ name, email }` stub built from the auth user.
 */
function ProfileRouter() {
  const { user } = useAuth();
  const navigateFn = useNavigateContext().navigate;
  const isEmployee = user?.user_type === 'employee' && !!user?.employee_id;
  const [stateEmp, setStateEmp] = useState<any>(null);
  useEffect(() => {
    let cancelled = false;
    if (!isEmployee || !user?.employee_id) return;
    api.get(`/employees/${user.employee_id}`)
      .then((res: any) => {
        if (cancelled) return;
        const e = res?.data?.employee || res?.data;
        if (!e) return;
        const fullName = (e.display_name
          || [e.first_name, e.middle_name, e.last_name].filter(Boolean).join(' ').trim())
          || user.name;
        setStateEmp({
          id: e.emp_code || `EMP-${e.id}`,
          name: fullName,
          email: e.email || user.email,
          department: e.department?.name,
          designation: e.designation?.name,
          primaryRole: e.primary_role?.name,
          ancillaryRole: e.ancillary_role?.name,
          manager: e.reporting_manager?.display_name
            || [e.reporting_manager?.first_name, e.reporting_manager?.last_name].filter(Boolean).join(' ').trim()
            || e.reporting_manager_user?.name
            || undefined,
          // Passport-size photo from onboarding (employee_documents,
          // document_key='photo'). Read by EmployeeProfile's hero avatar.
          // Resolve relative `/storage/...` paths to absolute URLs.
          photoUrl: (() => {
            const raw = e.photo_url || user.employee_profile_photo || null;
            return raw ? resolveFileUrl(raw) : null;
          })(),
        });
      })
      .catch(() => { /* fall back to the minimal stub built below */ });
    return () => { cancelled = true; };
  }, [isEmployee, user?.employee_id, user?.name, user?.email]);

  if (!isEmployee) return <Profile />;
  // Use the EMP- code as the URL slug — matches the convention HrEmployees
  // uses, so EmployeeProfile's existing employee_code lookup path runs the
  // same way for both /profile and /hr/employees/:id/profile.
  //
  // The code MUST come from `/me`'s `employee_code`, never be synthesised as
  // `EMP-${employee_id}`: emp_code is a per-client sequence, not the DB id, so
  // the fabricated string was a DIFFERENT (and wrong) id that flashed under the
  // name until the /employees fetch landed and replaced it. When /me has no
  // code, show nothing rather than a guess — EmployeeProfile renders "—".
  const fallback = {
    id: stateEmp?.id || user!.employee_code || '',
    name: user!.name,
    email: user!.email,
    // /me already carries the employee passport photo, so the hero shows it
    // immediately even if the /employees/:id fetch hasn't resolved yet.
    photoUrl: user!.employee_profile_photo ? resolveFileUrl(user!.employee_profile_photo) : null,
  };
  return (
    <EmployeeProfile
      employeeId={stateEmp?.id || user!.employee_code || String(user!.employee_id)}
      employee={stateEmp || fallback}
      onBack={() => navigateFn('dashboard')}
    />
  );
}

/* ── Auth Pages (Login / Forgot Password / OTP / Reset) ── */
function AuthRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  
  // Get state from location for email (passed via navigation state)
  const state = location.state as { email?: string } | null;
  const [resetEmail, setResetEmail] = useState(state?.email || '');

  return (
    <Suspense fallback={<RouteFallback />}>
    <Routes>
      <Route path="/login" element={
        <Login onForgotPassword={() => navigate('/forgot-password')} />
      } />
      <Route path="/forgot-password" element={
        <ForgotPassword
          onBackToLogin={() => navigate('/login')}
          onEmailSubmitted={(email: string) => { setResetEmail(email); navigate('/verify-otp', { state: { email } }); }}
        />
      } />
      <Route path="/verify-otp" element={
        <VerifyOTP
          email={resetEmail}
          onBackToForgotPassword={() => navigate('/forgot-password')}
          onOTPVerified={() => navigate('/reset-password', { state: { email: resetEmail } })}
        />
      } />
      <Route path="/reset-password" element={
        <ResetPassword
          email={resetEmail}
          onBackToVerifyOTP={() => navigate('/verify-otp', { state: { email: resetEmail } })}
          onPasswordReset={() => navigate('/login')}
        />
      } />
      <Route path="*" element={<Navigate to="/login" replace />} />
    </Routes>
    </Suspense>
  );
}

/* ── Dashboard Pages (after login) with URL Routing ── */
function DashboardRoutes({ user }: { user: any }) {
  const navigate = useNavigate();
  const location = useLocation();
  const [splashDone, setSplashDone] = useState(false);

  const isClient = user.user_type === 'client_admin' || user.user_type === 'branch_user';
  const planExpiredOrMissing = isClient && user.plan && (!user.plan.has_plan || user.plan.expired);
  const defaultPages = ['/my-plan', '/profile', '/plan-blocked'];

  // Onboarding gate — an employee whose onboarding isn't finished yet CAN sign
  // in, but is locked to the Inbox so they can sign their pending onboarding
  // documents. Once HR completes onboarding the `onboarding_pending` flag
  // clears (on next /me refresh or re-login) and full access opens up, subject
  // to whatever module permissions the branch then grants. Profile is allowed
  // so the employee can still view their own record; everything else bounces
  // back to the Inbox.
  const onboardingPending = user.user_type === 'employee' && !!user.onboarding_pending;
  const onboardingPages = ['/inbox', '/profile'];

  /* Dashboard stats preload — fires once when this routes wrapper mounts
   * (i.e. immediately after successful login). Warms the sessionStorage
   * cache for the dashboard the user is about to land on, so the very
   * first dashboard paint reads from cache and feels instant. Skips when
   * the cache is already populated (rare — happens only if the user
   * navigated back to login without closing the tab).
   *
   * Idle-scheduled so it never competes with the splash render or the
   * initial route resolution. Fire-and-forget — any error keeps the
   * dashboard's own on-mount fetch as the fallback.
   *
   * Cache variants used:
   *   super_admin → 'admin'
   *   client_admin / branch_user → 'client' (the default branch slice)
   */
  useEffect(() => {
    const variant = user.user_type === 'super_admin' ? 'admin' : 'client';
    const endpoint = user.user_type === 'super_admin'
      ? '/dashboard/admin-stats'
      : '/dashboard/client-stats';
    const warm = () => {
      // Inline imports to keep the splash bundle small.
      Promise.all([
        import('../pages/dashboard/dashboardStatsCache'),
      ]).then(([cache]) => {
        if (cache.readDashboardStats(variant)) return;
        api.get(endpoint)
          .then(res => cache.writeDashboardStats(variant, res.data))
          .catch(() => { /* silent — dashboard's own fetch covers it */ });
      });
    };
    const w = window as Window & {
      requestIdleCallback?: (cb: () => void) => number;
      cancelIdleCallback?: (h: number) => void;
    };
    const handle = w.requestIdleCallback ? w.requestIdleCallback(warm) : window.setTimeout(warm, 800);
    return () => {
      if (w.requestIdleCallback) w.cancelIdleCallback?.(handle);
      else window.clearTimeout(handle);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user.user_type]);

  // Show splash on first login
  if (!splashDone) {
    return <SplashLoader onComplete={() => setSplashDone(true)} />;
  }

  // Navigate function compatible with existing components.
  // Forwarding `data` as react-router state means pages that need extra
  // context (e.g. UsersPage needs the branchName when navigating from the
  // Branches table) can read it via useLocation().state.
  const navigateFn = (p: string, data?: any) => {
    const path = getPagePath(p, data);
    if (onboardingPending && !onboardingPages.includes(path)) {
      navigate('/inbox', { replace: true });
      return;
    }
    if (planExpiredOrMissing && !defaultPages.includes(path)) {
      navigate('/my-plan', { replace: true });
      return;
    }
    navigate(path, data ? { state: data } : undefined);
  };

  // Provide navigate context to all child components
  const navigateContextValue = {
    navigate: navigateFn,
    getPath: getPagePath,
  };

  // Lock an onboarding-incomplete employee to the Inbox (+ their profile).
  // Any other path — including the dashboard they'd normally land on — is
  // bounced to /inbox so the only thing they can do is sign their docs.
  if (onboardingPending && !onboardingPages.includes(location.pathname)) {
    return <Navigate to="/inbox" replace />;
  }

  // Redirect to my-plan if plan expired and trying to access other pages
  if (planExpiredOrMissing && !defaultPages.includes(location.pathname)) {
    if (user.user_type === 'branch_user') {
      return <Navigate to="/plan-blocked" replace />;
    }
    return <Navigate to="/my-plan" replace />;
  }

  const DashboardMap: Record<string, React.ComponentType> = {
    super_admin: AdminDashboard,
    client_admin: ClientDashboard,
    branch_user: BranchDashboard,
    client_user: BranchDashboard,
    // Employees get a personal dashboard scoped to their own Employee row
    // (profile hero, expense KPIs, approvals queue, team peers, etc.).
    // Fallback below still points to BranchDashboard so any future
    // user_type is safe-by-default.
    employee:    EmployeeDashboard,
  };

  const DefaultDashboard = DashboardMap[user.user_type] || BranchDashboard;

  // Global permission guard — mirrors the sidebar/header visibility rules so a
  // user who pastes a restricted URL (e.g. a Dashboard-only employee opening
  // /hr/employees) is blocked with an explicit Access Denied instead of the
  // page silently rendering in a passive view-only state. Runs on every
  // navigation (location-driven re-render). See utils/routeAccess.
  const routeAllowed = canAccessPath(location.pathname, user);

  return (
    <NavigateContext.Provider value={navigateContextValue}>
      <LayoutProvider>
        <BranchSwitcherProvider>
          <VelzonShell>
            {onboardingPending && (
              <div className="app-onboarding-banner" style={{ background: '#fef3c7', color: '#92400e', padding: '9px 16px', fontSize: 12.5, fontWeight: 600, display: 'flex', alignItems: 'center', gap: 8, borderBottom: '1px solid #fde68a' }}>
                <i className="ri-information-line" style={{ fontSize: 16 }} />
                Your onboarding isn&rsquo;t complete yet — sign your pending documents in the Inbox below. Full access unlocks once HR finishes your onboarding.
              </div>
            )}
            {!routeAllowed ? (
              <AccessDenied />
            ) : (
            /* One boundary for every page route. Each page below is a lazy()
               chunk; this is the only thing that has to catch their suspend. */
            <Suspense fallback={<RouteFallback />}>
            <Routes>
              <Route path="/dashboard" element={<DefaultDashboard />} />
              <Route path="/clients" element={<Clients onNavigate={navigateFn} />} />
              <Route path="/clients/new" element={<ClientFormWrapper />} />
              <Route path="/clients/:id/edit" element={<ClientFormWrapper />} />
              <Route path="/clients/:id" element={<ClientViewWrapper />} />
              <Route path="/clients/:id/branches" element={<ClientBranchesWrapper />} />
              <Route path="/clients/:id/permissions" element={<ClientPermissionsWrapper />} />
              <Route path="/clients/:id/payments" element={<ClientPaymentsWrapper />} />
              <Route path="/clients/:id/settings" element={<ClientSettingsWrapper />} />
              <Route path="/branches" element={<Branches onNavigate={navigateFn} />} />
              <Route path="/branches/new" element={<BranchFormWrapper />} />
              <Route path="/branches/:id" element={<BranchViewWrapper />} />
              <Route path="/branches/:id/edit" element={<BranchFormWrapper />} />
              <Route path="/branches/:id/users" element={<BranchUsersWrapper />} />
              <Route path="/branches/users" element={<UsersPage />} />
              <Route path="/clients/users" element={<UsersPage />} />
              <Route path="/plans" element={<Plans onNavigate={navigateFn} />} />
              <Route path="/plans/new" element={<AddPlanWrapper />} />
              <Route path="/plans/:id/edit" element={<AddPlanWrapper />} />
              <Route path="/my-plan" element={<PlanSelection onSuccess={() => window.location.reload()} />} />
              <Route path="/plan-blocked" element={
                <div className="flex items-center justify-center py-20">
                  <div className="text-center max-w-md">
                    <div className="w-16 h-16 rounded-2xl bg-red-100 flex items-center justify-center mx-auto mb-4">
                      <svg className="w-8 h-8 text-red-500" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z"/></svg>
                    </div>
                    <h2 className="text-[18px] font-extrabold text-text mb-2">
                      {user.plan?.expired ? 'Plan Expired' : 'No Active Plan'}
                    </h2>
                    <p className="text-[13px] text-muted mb-4">
                      Your organization's subscription has {user.plan?.expired ? 'expired' : 'not been activated yet'}.
                      Please contact your client administrator to {user.plan?.expired ? 'renew' : 'purchase'} a plan.
                    </p>
                    <p className="text-[11px] text-secondary">Client: {user.client_name}</p>
                  </div>
                </div>
              } />
              {/* Payments is a billing surface — only the account owner
                  (super_admin) and the client_admin who paid the bills
                  should see it. Other roles hitting the URL directly get
                  bounced to their dashboard so an employee can't even
                  load the empty Payments shell. */}
              <Route
                path="/payments"
                element={
                  user.user_type === 'super_admin' || user.user_type === 'client_admin'
                    ? <Payments />
                    : <Navigate to="/dashboard" replace />
                }
              />
              <Route path="/permissions" element={<Permissions />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/profile" element={<ProfileRouter />} />
              {/* Face-driven attendance — open to any signed-in tenant user.
                  The controller hard-checks `user.employee_id`, so non-employees
                  hitting this URL get a friendly 404 toast from the page. */}
              <Route path="/clock-in" element={<ClockIn />} />
              <Route path="/my-team"  element={<MyTeam />} />
              {/* Master documentation — reference material, open to every role. */}
              <Route path="/documentation" element={<Documentation />} />
              <Route path="/inbox"    element={<Inbox />} />
              <Route path="/gmail"    element={<Gmail />} />
              <Route path="/master" element={<MasterDashboard />} />
              {/* /master/segments and /clm/segment share the SAME backend
                  (clm_segments table) and SAME UI. Whatever is added on either
                  side shows on both. The explicit route below must come before
                  the catch-all /master/:slug so it takes priority. */}
              <Route path="/master/segments" element={<ClmSegmentPage />} />
              <Route path="/master/:slug" element={<MasterPage />} />
              <Route path="/sales/customers" element={<SalesCustomers />} />
              <Route path="/sales/consignee" element={<SalesConsignee />} />
              <Route path="/sales/lead-ack-master" element={<SalesLeadAckMaster />} />
              <Route path="/sales/lead-worksheet" element={<SalesLeadWorksheet />} />
              <Route path="/sales/lead-distribution" element={<LeadDistributionPage />} />
              <Route path="/sales/leads-details" element={<SalesLeadsDetails />} />
              <Route path="/sales/todo" element={<SalesTodo />} />
              <Route path="/sales/matrix/:oppId/stage/:stage" element={<SalesMatrixDetail />} />
              <Route path="/sales/qpi" element={<SalesQPI />} />
              <Route path="/sales/sign-tracker" element={<SalesSignTracker />} />
              <Route path="/sales/p2p-summary" element={<SalesP2PSummary />} />
              {/* New top-level header modules. P2P reuses the Sales P2P
                  Summary page; the rest render the shared permission-gated
                  stub until their real pages are built. */}
              <Route path="/p2p" element={<SalesP2PSummary />} />
              <Route path="/credentials-vault" element={<ModuleStubPage />} />
              <Route path="/dev-tools" element={<DevTools />} />
              <Route path="/project-navigator" element={<ModuleStubPage />} />
              <Route path="/gts" element={<ModuleStubPage />} />
              {/* Inventory — Zebra TC27 put-away scanning. Runs on simulated
                  data until the scan/device endpoints ship; see putAwayStore.ts. */}
              <Route path="/inventory" element={<InventoryPutAway />} />
              <Route path="/inventory/stickers" element={<InventoryStickers />} />
              <Route path="/inventory/devices" element={<InventoryScanDevices />} />
              <Route path="/inventory/scan-log" element={<InventoryScanLog />} />
              {/* P2P leaves without a real page yet — dark-mode-aware "Coming soon" stub. */}
              <Route path="/p2p/analytics" element={<ModuleStubPage />} />
              <Route path="/p2p/diagnosis" element={<ModuleStubPage />} />
              <Route path="/p2p/bulk-sourcing" element={<P2pBulkSourcing />} />
              <Route path="/p2p/case-to-case" element={<ModuleStubPage />} />
              <Route path="/p2p/purchase-order" element={<PurchaseOrder />} />
              <Route path="/p2p/supplier-purchase-invoice" element={<SupplierPurchaseInvoice />} />
              <Route path="/p2p/debit-note" element={<DebitNote />} />
              <Route path="/developers/shipment" element={<DeveloperShipments />} />
              <Route path="/products" element={<Products />} />
              <Route path="/products/:id" element={<ProductView />} />
              <Route path="/suppliers" element={<Vendors />} />
              {/* Old path kept as a redirect so existing links/bookmarks survive the rename. */}
              <Route path="/vendors" element={<Navigate to="/suppliers" replace />} />
              <Route path="/sales/diagnosis" element={<SalesDiagnosis />} />
              <Route path="/sales/resolution-center" element={<SalesResolutionCenter />} />
              <Route path="/sales/analytics" element={<SalesAnalytics />} />
              <Route path="/sales/performance" element={<SalesPerformance />} />
              {/* Central CLM — real pages get explicit routes; everything
                  else falls through to the stub. */}
              <Route path="/clm" element={<ClmStubPage />} />
              <Route path="/clm/segment"          element={<ClmSegmentPage />} />
              <Route path="/clm/authority"        element={<ClmAuthorityPage />} />
              <Route path="/clm/kyc"              element={<ClmKycPage />} />
              <Route path="/clm/due-diligence"    element={<ClmDdPage />} />
              <Route path="/clm/trade-licenses"   element={<ClmTradeLicensesPage />} />
              <Route path="/clm/quality-docs"     element={<ClmQcPage />} />
              <Route path="/clm/trade-documents"  element={<ClmTradeDocumentsPage />} />
              <Route path="/clm/terms-conditions" element={<ClmTncPage />} />
              <Route path="/clm/agreements"       element={<ClmAgreementsPage />} />
              <Route path="/clm/clause-library"   element={<ClmClauseLibraryPage />} />
              <Route path="/clm/document-panel"   element={<ClmDcpPage />} />
              <Route path="/clm/buyer-profile"    element={<ClmBuyerProfilePage />} />
              <Route path="/clm/supplier-profile" element={<ClmSupplierProfilePage />} />
              {/* Command Center — combined Diagnosis & Resolution Center +
                  the read-only Regulatory Defense File repository. */}
              <Route path="/clm/diagnosis-resolution" element={<ClmDiagnosisResolutionPage />} />
              <Route path="/clm/regulatory-defense"   element={<ClmRegulatoryDefenseFilePage />} />
              {/* Operations · Without Shipment ID — Case to Case Contracts,
                  Agreements We Sent, Agreements To Approve. */}
              <Route path="/clm/analytics"             element={<ClmAnalyticsPage />} />
              <Route path="/clm/case-to-case"          element={<ClmCaseToCasePage />} />
              <Route path="/clm/agreements-sent"       element={<ClmAgreementsSentPage />} />
              <Route path="/clm/agreements-to-approve" element={<ClmAgreementsToApprovePage />} />
              {/* Remaining operations leaves (analytics / diagnosis /
                  resolution) still fall through to the stub. */}
              <Route path="/clm/:slug" element={<ClmStubPage />} />
              <Route path="/hr" element={<HrDashboard />} />
              <Route path="/hr/overview" element={<HrOverview />} />
              <Route path="/hr/employees" element={<HrEmployees />} />
              <Route path="/hr/recruitment" element={<HrRecruitment />} />
              <Route path="/hr/recruitment/:id/candidates" element={<HrCandidates />} />
              <Route path="/hr/exit-management" element={<HrExitManagement />} />
              {FEATURE_FLAGS.hrAttendance && (
                <Route path="/hr/attendance" element={<HrAttendance />} />
              )}
              <Route path="/hr/leave" element={<HrLeave />} />
              <Route path="/hr/leave-plans" element={<HrLeavePlans />} />
              <Route path="/hr/leave-approvals" element={<HrLeaveApprovals />} />
              <Route path="/hr/holiday" element={<HrHoliday />} />
              <Route path="/hr/pip" element={<HrPIP />} />
              <Route path="/hr/expense" element={<HrExpenseManagement />} />
              <Route path="/hr/payroll" element={<HrPayroll />} />
              <Route path="/hr/broadcast" element={<HrBroadcastCentre />} />
              <Route path="/hr/doc-templates" element={<HrDocumentTemplates />} />
              <Route path="/hr/doc-templates/new" element={<TemplateFormPage />} />
              <Route path="/hr/doc-templates/:id/edit" element={<TemplateFormPage />} />
              <Route path="/hr/doc-templates/:id/generate" element={<GenerateDocument />} />
              <Route path="/hr/custom-fields" element={<HrCustomFields />} />
              <Route path="/hr/devices" element={<HrBiometricDevices />} />
              <Route path="/hr/employee-onboarding" element={<HrEmployeeOnboarding />} />
              <Route path="/hr/employees/:id/permissions" element={<EmployeePermissionsWrapper />} />
              <Route path="/hr/employees/:id/profile" element={<EmployeeProfileWrapper />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
            </Suspense>
            )}
          </VelzonShell>
        </BranchSwitcherProvider>
      </LayoutProvider>
    </NavigateContext.Provider>
  );
}

/* ── Main Router — switches between Auth and Dashboard ── */
function Router() {
  const { user } = useAuth();
  const location = useLocation();

  // Public onboarding flow — token-protected, accessible without login.
  // Matched first so candidates clicking the email link don't bounce to
  // /login when no session is active.
  if (location.pathname.startsWith('/onboarding/')) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/onboarding/:token" element={<PublicOnboarding />} />
        </Routes>
      </Suspense>
    );
  }

  // Every printed sticker points here. It must resolve without a session:
  // an unregistered device has to see "Device blocked", not a login form —
  // bouncing it to /login would leak that the code means something.
  if (location.pathname.startsWith('/s/')) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/s/:key" element={<ScanLanding />} />
        </Routes>
      </Suspense>
    );
  }

  if (!user) {
    // Allow auth routes even when not logged in
    return <AuthRoutes />;
  }

  // key={user.id} forces full remount when user changes (login/switch user)
  return <DashboardRoutes key={user.id} user={user} />;
}

/**
 * Scrolls back to the top on every forward navigation.
 *
 * Without this, a route change kept the OUTGOING page's scroll offset: leave
 * /hr/employees scrolled halfway down, pick Employee Onboarding from the menu,
 * and it opened halfway down too — its header and KPI strip cut off above the
 * viewport, reading as a broken page. React Router does not reset scroll on its
 * own, and <ScrollRestoration /> is not an option here: it only works under a
 * data router (createBrowserRouter), while this app uses <BrowserRouter>.
 *
 * ── What actually scrolls ────────────────────────────────────────────────
 * Not the window. The Velzon shell pins #layout-wrapper to height:100dvh with
 * overflow:hidden and lets `.main-content` scroll inside it, deliberately, so
 * the app shows exactly one scrollbar. The document therefore never moves and
 * window.scrollTo() is a silent no-op for every signed-in page — which is why
 * the first version of this component appeared to do nothing.
 *
 * Both are reset: `.main-content` for the shell, and the window for the routes
 * that render outside it (login, forgot-password, public onboarding), which do
 * scroll the document normally.
 *
 * Two deliberate exemptions:
 *  - POP (browser Back/Forward) is left alone — going back should return you to
 *    where you were, not dump you at the top.
 *  - A #hash target is left alone so in-page anchors still land on their section.
 *
 * Keyed on pathname only, so query-string changes (?tab=…, filters, paging)
 * don't yank the page upward while the user is working in place.
 */
function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (navType === 'POP' || hash) return;

    // scrollTop rather than scrollTo({behavior:'instant'}): assignment is
    // always immediate, and it cannot be animated by a stray
    // `scroll-behavior: smooth` further up the tree.
    document.querySelectorAll<HTMLElement>('.main-content')
      .forEach(el => { el.scrollTop = 0; });

    // Routes outside the shell still scroll the document.
    window.scrollTo({ top: 0, left: 0, behavior: 'instant' as ScrollBehavior });
  }, [pathname, hash, navType]);

  return null;
}

export default function App() {
  return (
    <ReduxProvider store={velzonStore}>
      <ThemeProvider>
        <VariantProvider>
          <ToastProvider>
            {/* ConfirmProvider exposes an async useConfirm() hook so any
                page can replace native window.confirm() with a styled
                modal dialog. */}
            <ConfirmProvider>
            <AuthProvider>
              {/* SettingsProvider sits inside Auth so its API call carries the
                  bearer token; it sets document.title, favicon, and platform
                  default theme colors as live dependencies. */}
              <SettingsProvider>
                <BrowserRouter>
                  {/* Must sit INSIDE BrowserRouter — it reads the router's
                      location. Placed above <Router /> so it covers every
                      route: dashboard, auth and public onboarding alike. */}
                  <ScrollToTop />
                  <Router />
                </BrowserRouter>
                {/* CookieBanner reads privacy.cookie + the user's prior
                    accept state. Hidden when disabled or already accepted. */}
                <CookieBanner />
                {/* Auto-logout after 30 min idle when security.sessTimeout is ON */}
                <IdleTimeout />
              </SettingsProvider>
            </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </VariantProvider>
      </ThemeProvider>
    </ReduxProvider>
  );
}
