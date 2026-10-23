import { useState, useEffect, useCallback, createContext, useContext, Suspense } from 'react';
import api from '../api';
import { lazyPage } from '../utils/lazyPage';
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
import NativeTitleTooltips from './NativeTitleTooltips';
import VelzonShell from '../velzon/VelzonShell';
import AccessDenied from './AccessDenied';
import { canAccessPath } from '../utils/routeAccess';
import { startIdlePrefetch } from '../utils/routePrefetch';
import { FEATURE_FLAGS } from '../constants';
import AppErrorBoundary from './AppErrorBoundary';
const Login = lazyPage(() => import('../pages/auth/Login'));
const ForgotPassword = lazyPage(() => import('../pages/auth/ForgotPassword'));
const VerifyOTP = lazyPage(() => import('../pages/auth/VerifyOTP'));
const ResetPassword = lazyPage(() => import('../pages/auth/ResetPassword'));
const AdminDashboard = lazyPage(() => import('../pages/dashboard/AdminDashboard'));
const ClientDashboard = lazyPage(() => import('../pages/dashboard/ClientDashboard'));
const BranchDashboard = lazyPage(() => import('../pages/dashboard/BranchDashboard'));
const EmployeeDashboard = lazyPage(() => import('../pages/dashboard/EmployeeDashboard'));
const Clients = lazyPage(() => import('../pages/client/Clients'));
const ClientForm = lazyPage(() => import('../pages/client/ClientForm'));
const Branches = lazyPage(() => import('../pages/branch/Branches'));
const UsersPage = lazyPage(() => import('../pages/UsersPage'));
const Plans = lazyPage(() => import('../pages/plan/Plans'));
const Payments = lazyPage(() => import('../pages/Payments'));
const Permissions = lazyPage(() => import('../pages/permission/Permissions'));
const Settings = lazyPage(() => import('../pages/Settings'));
const Profile = lazyPage(() => import('../pages/Profile'));
const AddPlan = lazyPage(() => import('../pages/plan/AddPlan'));
const BranchForm = lazyPage(() => import('../pages/branch/BranchForm'));
const BranchView = lazyPage(() => import('../pages/branch/BranchView'));
const PlanSelection = lazyPage(() => import('../pages/plan/PlanSelection'));
const ClientView = lazyPage(() => import('../pages/client/ClientView'));
const ClientBranches = lazyPage(() => import('../pages/client/ClientBranches'));
const ClientPermissions = lazyPage(() => import('../pages/client/ClientPermissions'));
const ClientPayments = lazyPage(() => import('../pages/client/ClientPayments'));
const ClientSettings = lazyPage(() => import('../pages/client/ClientSettings'));
const MasterDashboard = lazyPage(() => import('../pages/MasterDashboard'));
const MasterPage = lazyPage(() => import('../pages/master/MasterPage'));
const SalesCustomers = lazyPage(() => import('../pages/sales/core-masters/customer/SalesCustomers'));
const SalesConsignee = lazyPage(() => import('../pages/sales/core-masters/consignee/SalesConsignee'));
const SalesLeadAckMaster = lazyPage(() => import('../pages/sales/core-masters/lead-ack/SalesLeadAckMaster'));
const SalesLeadWorksheet = lazyPage(() => import('../pages/sales/opportunity-pipeline/SalesLeadWorksheet'));
const LeadDistributionPage = lazyPage(() => import('../pages/sales/opportunity-pipeline/AssignedLeadsModal'));
const SalesLeadsDetails = lazyPage(() => import('../pages/sales/opportunity-pipeline/SalesLeadsDetails'));
const SalesTodo = lazyPage(() => import('../pages/sales/insights-productivity/SalesTodo'));
const SalesQPI = lazyPage(() => import('../pages/sales/opportunity-pipeline/SalesQPI'));
const DeveloperShipments = lazyPage(() => import('../pages/developers/DeveloperShipments'));
const SalesSignTracker = lazyPage(() => import('../pages/sales/opportunity-pipeline/SalesSignTracker'));
const SalesP2PSummary = lazyPage(() => import('../pages/sales/opportunity-pipeline/SalesP2PSummary'));
const SalesMatrixDetail = lazyPage(() => import('../pages/sales/opportunity-pipeline/matrix/SalesMatrixDetail'));
const Products = lazyPage(() => import('../pages/p2p/p2p-master-management/product-management/Products'));
const ProductView = lazyPage(() => import('../pages/p2p/p2p-master-management/product-management/ProductView'));
const Vendors = lazyPage(() => import('../pages/p2p/p2p-master-management/supplier-management/Vendors'));
const SalesDiagnosis = lazyPage(() => import('../pages/sales/insights-productivity/SalesDiagnosis'));
const SalesResolutionCenter = lazyPage(() => import('../pages/sales/insights-productivity/SalesResolutionCenter'));
const SalesAnalytics = lazyPage(() => import('../pages/sales/insights-productivity/SalesAnalytics'));
const SalesPerformance = lazyPage(() => import('../pages/sales/insights-productivity/SalesPerformance'));
const ClmStubPage = lazyPage(() => import('../pages/clm/shared/ClmStubPage'));
const ClmAnalyticsPage = lazyPage(() => import('../pages/clm/command-center/ClmAnalyticsPage'));
const ClmSegmentPage = lazyPage(() => import('../pages/clm/compliance/ClmSegmentPage'));
const ClmAuthorityPage = lazyPage(() => import('../pages/clm/compliance/ClmAuthorityPage'));
const ClmKycPage = lazyPage(() => import('../pages/clm/compliance/ClmKycPage'));
const ClmDdPage = lazyPage(() => import('../pages/clm/compliance/ClmDdPage'));
const ClmTradeLicensesPage = lazyPage(() => import('../pages/clm/compliance/ClmTradeLicensesPage'));
const ClmQcPage = lazyPage(() => import('../pages/clm/compliance/ClmQcPage'));
const ClmTradeDocumentsPage = lazyPage(() => import('../pages/clm/document-masters/ClmTradeDocumentsPage'));
const ClmTncPage = lazyPage(() => import('../pages/clm/document-masters/ClmTncPage'));
const ClmAgreementsPage = lazyPage(() => import('../pages/clm/document-masters/ClmAgreementsPage'));
const ClmClauseLibraryPage = lazyPage(() => import('../pages/clm/document-masters/ClmClauseLibraryPage'));
const ClmDcpPage = lazyPage(() => import('../pages/clm/compliance/ClmDcpPage'));
const ClmBuyerProfilePage = lazyPage(() => import('../pages/clm/operations/ClmBuyerProfilePage'));
const ClmSupplierProfilePage = lazyPage(() => import('../pages/clm/operations/ClmSupplierProfilePage'));
const ClmDiagnosisResolutionPage = lazyPage(() => import('../pages/clm/command-center/ClmDiagnosisResolutionPage'));
const ClmRegulatoryDefenseFilePage = lazyPage(() => import('../pages/clm/command-center/ClmRegulatoryDefenseFilePage'));
const ClmCaseToCasePage = lazyPage(() => import('../pages/clm/operations/ClmCaseToCasePage'));
const ClmAgreementsSentPage = lazyPage(() => import('../pages/clm/operations/ClmAgreementsSentPage'));
const ClmAgreementsToApprovePage = lazyPage(() => import('../pages/clm/operations/ClmAgreementsToApprovePage'));
const HrDashboard = lazyPage(() => import('../pages/hrms/HrDashboard'));
const HrOverview = lazyPage(() => import('../pages/hrms/HrOverview'));
const HrEmployees = lazyPage(() => import('../pages/hrms/HrEmployees'));
const HrRecruitment = lazyPage(() => import('../pages/recruitment/HrRecruitment'));
const HrCandidates = lazyPage(() => import('../pages/recruitment/HrCandidates'));
const HrExitManagement = lazyPage(() => import('../pages/hrms/HrExitManagement'));
const HrAttendance = lazyPage(() => import('../pages/hrms/HrAttendance'));
const HrLeave = lazyPage(() => import('../pages/hrms/HrLeave'));
const HrLeavePlans = lazyPage(() => import('../pages/hrms/HrLeavePlans'));
const HrLeaveApprovals = lazyPage(() => import('../pages/hrms/HrLeaveApprovals'));
const HrHoliday = lazyPage(() => import('../pages/hrms/HrHoliday'));
const HrPIP = lazyPage(() => import('../pages/hrms/HrPIP'));
const HrExpenseManagement = lazyPage(() => import('../pages/hrms/HrExpenseManagement'));
const HrPayroll = lazyPage(() => import('../pages/hrms/HrPayroll'));
const HrBroadcastCentre = lazyPage(() => import('../pages/hrms/HrBroadcastCentre'));
const HrDocumentTemplates = lazyPage(() => import('../pages/hrms/HrDocumentTemplates'));
const HrCustomFields = lazyPage(() => import('../pages/hrms/HrCustomFields'));
const HrBiometricDevices = lazyPage(() => import('../pages/hrms/HrBiometricDevices'));
const TemplateFormPage = lazyPage(() => import('../pages/hrms/doc-templates/TemplateForm'));
const GenerateDocument = lazyPage(() => import('../pages/hrms/doc-templates/GenerateDocument'));
const HrEmployeeOnboarding = lazyPage(() => import('../pages/employee-onboarding/HrEmployeeOnboarding'));
const EmployeePermissions = lazyPage(() => import('../pages/employee/EmployeePermissions'));
const EmployeeProfile = lazyPage(() => import('../pages/employee/EmployeeProfile'));
import { Shimmer, ShimmerTable, ShimmerEmployeeProfile } from './ui/Shimmer';
const PublicOnboarding = lazyPage(() => import('../pages/PublicOnboarding'));
const ClockIn = lazyPage(() => import('../pages/ClockIn'));
const ModuleStubPage = lazyPage(() => import('../pages/ModuleStubPage'));
const WarehouseMaster = lazyPage(() => import('../pages/inventory-management/warehouse/WarehouseMaster'));
const ZoneMaster = lazyPage(() => import('../pages/inventory-management/zone/ZoneMaster'));
const RackMaster = lazyPage(() => import('../pages/inventory-management/rack/RackMaster'));
const ProductFlagMaster = lazyPage(() => import('../pages/inventory-management/product-flag/ProductFlagMaster'));
const P2pBulkSourcing = lazyPage(() => import('../pages/p2p/procurement-management/bulk-sourcing/P2pBulkSourcing'));
const DevTools = lazyPage(() => import('../pages/dev-tools/DevTools'));
const Invoice = lazyPage(() => import('../pages/p2p/purchase-management/invoice/InvoiceList'));
const Order = lazyPage(() => import('../pages/p2p/purchase-management/order/po-list/Order'));
const PoGstApprovalReview = lazyPage(() => import('../pages/p2p/purchase-management/order/gst-approval/PoGstApprovalReview'));
const PaymentRequestManagement = lazyPage(() => import('../pages/p2p/payment-management/payment-request/PaymentRequestManagement'));
const AdvanceRefundAdjustment = lazyPage(() => import('../pages/p2p/payment-management/advance-refund/AdvanceRefundAdjustment'));
const InventoryPutAway = lazyPage(() => import('../pages/inventory/InventoryPutAway'));
const InventoryStickers = lazyPage(() => import('../pages/inventory/InventoryStickers'));
const ScanLanding = lazyPage(() => import('../pages/inventory/ScanLanding'));
const PutawayScan = lazyPage(() => import('../pages/p2p/putaway/PutawayScan'));
const InventoryScanDevices = lazyPage(() => import('../pages/inventory/InventoryScanDevices'));
const InventoryScanLog = lazyPage(() => import('../pages/inventory/InventoryScanLog'));
const MyTeam = lazyPage(() => import('../pages/MyTeam'));
const Documentation = lazyPage(() => import('../pages/Documentation'));
const Inbox = lazyPage(() => import('../pages/Inbox'));
const Gmail = lazyPage(() => import('../pages/Gmail'));

function RouteFallback() {
  return (
    <div
      style={{
        padding: 24,
        animation: 'cbcRouteFallbackIn 0s linear 180ms forwards',
        opacity: 0,
      }}
      role="status"
      aria-live="polite"
      aria-label="Loading page"
    >
      <style>{'@keyframes cbcRouteFallbackIn{to{opacity:1}}'}</style>
      <div style={{ display: 'flex', alignItems: 'center', gap: 14, marginBottom: 18 }}>
        <Shimmer width={46} height={46} radius={13} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9, flex: 1, minWidth: 0 }}>
          <Shimmer width={220} height={17} />
          <Shimmer width={320} height={11} />
        </div>
        <Shimmer width={132} height={38} radius={10} />
      </div>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
        <Shimmer width={104} height={34} radius={10} />
        <Shimmer width={104} height={34} radius={10} />
        <Shimmer width={104} height={34} radius={10} />
        <div style={{ flex: 1 }} />
        <Shimmer width={260} height={34} radius={10} />
      </div>
      <ShimmerTable rows={8} cols={7} />
    </div>
  );
}

/* Landing pages worth warming. Deliberately a short list: prefetching all 114
   routes would cost more than it saves. */
const PREFETCH_PATHS = [
  '/hr/attendance', '/hr/employees', '/hr/recruitment', '/hr/leave',
  '/hr/leave-plans', '/hr/exit-management', '/hr/document-templates',
  '/hr/overview', '/clock-in', '/my-team', '/products', '/vendors',
  '/payments', '/settings',
];

const NavigateContext = createContext<{
  navigate: (path: string, data?: any) => void;
  getPath: (page: string, data?: any) => string;
}>({
  navigate: () => {},
  getPath: () => '',
});

export const useNavigateContext = () => useContext(NavigateContext);

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
    case 'p2p': return '/p2p';
    case 'credentials-vault': return '/credentials-vault';
    case 'project-navigator': return '/project-navigator';
    case 'gts': return '/gts';
    case 'inventory': return '/inventory';
    case 'developers': return '/developers/shipment';
    case 'permissions': return '/permissions';
    case 'settings': return '/settings';
    case 'profile': return '/profile';
    case 'my-team': return '/my-team';
    case 'documentation': return '/documentation';
    default:
      if (page.startsWith('master.')) return `/master/${page.slice('master.'.length)}`;
      if (page === 'master') return '/master';
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
      if (page === 'sales.workplace')       return '/sales/lead-worksheet';
      if (page === 'sales.todo')            return '/sales/todo';
      if (page === 'sales.matrix_detail')   return data?.oppId ? `/sales/matrix/${encodeOppId(data.oppId)}/stage/${encodeStage(data?.stage || 1)}` : '/sales/matrix';
      if (page === 'sales.qpi')             return '/sales/qpi';
      if (page === 'sales.quotation_vs_pi') return '/sales/qpi';
      if (page === 'sales.sign_tracker')    return '/sales/sign-tracker';
      if (page === 'sales.p2p_summary')     return '/sales/p2p-summary';
      if (page === 'sales.diagnosis')       return '/sales/diagnosis';
      if (page === 'sales.resolution_center') return '/sales/resolution-center';
      if (page === 'sales.analytics')       return '/sales/analytics';
      if (page === 'sales.performance')     return '/sales/performance';
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
      if (page === 'developers.shipment')       return '/developers/shipment';
      return '/dashboard';
  }
};

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
      .catch(() => {})
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
  const returnPage = (location.state as any)?.returnPage as string | undefined;
  const returnData = (location.state as any)?.returnData;

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
          photoUrl: (() => {
            const raw = e.photo_url || user.employee_profile_photo || null;
            return raw ? resolveFileUrl(raw) : null;
          })(),
        });
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [isEmployee, user?.employee_id, user?.name, user?.email]);

  if (!isEmployee) return <Profile />;
  const fallback = {
    id: stateEmp?.id || user!.employee_code || '',
    name: user!.name,
    email: user!.email,
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

function AuthRoutes() {
  const navigate = useNavigate();
  const location = useLocation();
  
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
          initialEmail={resetEmail}
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

/* The splash plays over the page instead of in place of it. It used to be
   rendered alone for its full 2.4 s, so the page's code and API calls only
   started after it — every refresh paid that wait on top of the load (QA #13).
   Now the page loads underneath while the same animation plays on top.
   The callback is stable on purpose: SplashLoader restarts its timers when
   onComplete changes, and the page re-rendering beneath must not do that. */
function DashboardRoutes({ user }: { user: any }) {
  const [splashDone, setSplashDone] = useState(false);
  const finishSplash = useCallback(() => setSplashDone(true), []);
  return (
    <>
      <DashboardRoutesInner user={user} />
      {!splashDone && <SplashLoader onComplete={finishSplash} />}
    </>
  );
}

function DashboardRoutesInner({ user }: { user: any }) {
  const navigate = useNavigate();
  const location = useLocation();

  const isPlanGoverned = user.user_type === 'client_admin'
    || user.user_type === 'branch_user'
    || user.user_type === 'employee';
  const planExpiredOrMissing = isPlanGoverned && user.plan && (!user.plan.has_plan || user.plan.expired);
  const defaultPages = ['/my-plan', '/profile', '/plan-blocked'];

  const onboardingPending = user.user_type === 'employee' && !!user.onboarding_pending;
  const onboardingPages = ['/inbox', '/profile'];

  useEffect(() => {
    if (!onboardingPending) return;
    const onPop = () => {
      const popped = window.location.pathname;
      if (onboardingPages.includes(popped)) return;
      window.history.replaceState(null, '', '/inbox');
      navigate('/inbox', { replace: true });
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onboardingPending, navigate]);

  const navigateFn = (p: string, data?: any) => {
    const path = getPagePath(p, data);
    if (onboardingPending && !onboardingPages.includes(path)) {
      navigate('/inbox', { replace: true });
      return;
    }
    if (planExpiredOrMissing && !defaultPages.includes(path)) {
      navigate(
        (user.user_type === 'branch_user' || user.user_type === 'employee') ? '/plan-blocked' : '/my-plan',
        { replace: true },
      );
      return;
    }
    navigate(path, data ? { state: data } : undefined);
  };

  const navigateContextValue = {
    navigate: navigateFn,
    getPath: getPagePath,
  };

  if (onboardingPending && !onboardingPages.includes(location.pathname)) {
    return <Navigate to="/inbox" replace />;
  }

  if (planExpiredOrMissing && !defaultPages.includes(location.pathname)) {
    if (user.user_type === 'branch_user' || user.user_type === 'employee') {
      return <Navigate to="/plan-blocked" replace />;
    }
    return <Navigate to="/my-plan" replace />;
  }

  const DashboardMap: Record<string, React.ComponentType> = {
    super_admin: AdminDashboard,
    client_admin: ClientDashboard,
    branch_user: BranchDashboard,
    client_user: BranchDashboard,
    employee:    EmployeeDashboard,
  };

  const DefaultDashboard = DashboardMap[user.user_type] || BranchDashboard;

  const routeAllowed = canAccessPath(location.pathname, user);

  return (
    <NavigateContext.Provider value={navigateContextValue}>
      <LayoutProvider>
        <BranchSwitcherProvider>
          <VelzonShell>
            {onboardingPending && (
              <div className="app-onboarding-banner" style={{ background: '#fef3c7', color: '#92400e', padding: '10px 16px', marginBottom: 10, borderRadius: 10, fontSize: 12.5, fontWeight: 600, lineHeight: 1.5, display: 'flex', alignItems: 'center', gap: 8, border: '1px solid #fde68a' }}>
                <i className="ri-information-line" style={{ fontSize: 16 }} />
                Your onboarding isn&rsquo;t complete yet — sign your pending documents in the Inbox below. Full access unlocks once HR finishes your onboarding.
              </div>
            )}
            {!routeAllowed ? (
              <AccessDenied />
            ) : (
            <Suspense key={location.pathname} fallback={<RouteFallback />}>
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
              <Route path="/clock-in" element={<ClockIn />} />
              <Route path="/my-team"  element={<MyTeam />} />
              <Route path="/documentation" element={<Documentation />} />
              <Route path="/inbox"    element={<Inbox />} />
              <Route path="/gmail"    element={<Gmail />} />
              <Route path="/master" element={<MasterDashboard />} />
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
              <Route path="/p2p" element={<SalesP2PSummary />} />
              <Route path="/credentials-vault" element={<ModuleStubPage />} />
              <Route path="/dev-tools" element={<DevTools />} />
              <Route path="/project-navigator" element={<ModuleStubPage />} />
              <Route path="/gts" element={<ModuleStubPage />} />
              <Route path="/inventory" element={<InventoryPutAway />} />
              <Route path="/inventory/stickers" element={<InventoryStickers />} />
              <Route path="/inventory/devices" element={<InventoryScanDevices />} />
              <Route path="/inventory/scan-log" element={<InventoryScanLog />} />
              <Route path="/p2p/analytics" element={<ModuleStubPage />} />
              <Route path="/p2p/diagnosis" element={<ModuleStubPage />} />
              <Route path="/p2p/bulk-sourcing" element={<P2pBulkSourcing />} />
              <Route path="/p2p/case-to-case" element={<ModuleStubPage />} />
              <Route path="/inventory-management/warehouse-master" element={<WarehouseMaster />} />
              <Route path="/inventory-management/zone-master" element={<ZoneMaster />} />
              <Route path="/inventory-management/rack-master" element={<RackMaster />} />
              <Route path="/inventory-management/product-flags" element={<ProductFlagMaster />} />
              <Route path="/p2p/supplier-purchase-invoice" element={<Invoice />} />
              <Route path="/p2p/invoice" element={<Navigate to="/p2p/supplier-purchase-invoice" replace />} />
              <Route path="/p2p/order" element={<Order />} />
              <Route path="/inbox/po-approval/:id" element={<PoGstApprovalReview />} />
              <Route path="/p2p/payment-request" element={<PaymentRequestManagement />} />
              <Route path="/p2p/advance-refund-adjustment" element={<AdvanceRefundAdjustment />} />
              <Route path="/developers/shipment" element={<DeveloperShipments />} />
              <Route path="/products" element={<Products />} />
              <Route path="/products/:id" element={<ProductView />} />
              <Route path="/suppliers" element={<Vendors />} />
              <Route path="/vendors" element={<Navigate to="/suppliers" replace />} />
              <Route path="/sales/diagnosis" element={<SalesDiagnosis />} />
              <Route path="/sales/resolution-center" element={<SalesResolutionCenter />} />
              <Route path="/sales/analytics" element={<SalesAnalytics />} />
              <Route path="/sales/performance" element={<SalesPerformance />} />
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
              <Route path="/clm/diagnosis-resolution" element={<ClmDiagnosisResolutionPage />} />
              <Route path="/clm/regulatory-defense"   element={<ClmRegulatoryDefenseFilePage />} />
              <Route path="/clm/analytics"             element={<ClmAnalyticsPage />} />
              <Route path="/clm/case-to-case"          element={<ClmCaseToCasePage />} />
              <Route path="/clm/agreements-sent"       element={<ClmAgreementsSentPage />} />
              <Route path="/clm/agreements-to-approve" element={<ClmAgreementsToApprovePage />} />
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

function Router() {
  const { user } = useAuth();
  const location = useLocation();

  /* Warm the landing chunks while the browser is idle, so clicking a module
     resolves from memory instead of waiting on a request. Only the routes this
     user may open — prefetching a module they cannot reach is pure waste. */
  useEffect(() => {
    if (!user) return;
    startIdlePrefetch(PREFETCH_PATHS.filter((p) => canAccessPath(p, user)));
  }, [user]);

  if (location.pathname.startsWith('/onboarding/')) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/onboarding/:token" element={<PublicOnboarding />} />
        </Routes>
      </Suspense>
    );
  }

  if (location.pathname.startsWith('/s/')) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/s/:key" element={<ScanLanding />} />
        </Routes>
      </Suspense>
    );
  }

  if (location.pathname.startsWith('/putaway-scan') || location.pathname.startsWith('/ps/')) {
    return (
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/putaway-scan/enroll" element={<PutawayScan />} />
          <Route path="/putaway-scan" element={<PutawayScan />} />
          <Route path="/putaway-scan/:taskId" element={<PutawayScan />} />
          <Route path="/ps/:scanKey" element={<PutawayScan />} />
        </Routes>
      </Suspense>
    );
  }

  if (!user) {
    return <AuthRoutes />;
  }

  return <DashboardRoutes key={user.id} user={user} />;
}

function ScrollToTop() {
  const { pathname, hash } = useLocation();
  const navType = useNavigationType();

  useEffect(() => {
    if (navType === 'POP' || hash) return;

    document.querySelectorAll<HTMLElement>('.main-content')
      .forEach(el => { el.scrollTop = 0; });

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
            <ConfirmProvider>
            <AuthProvider>
              <SettingsProvider>
                <BrowserRouter>
                  <ScrollToTop />
                  <AppErrorBoundary>
                    <Router />
                  </AppErrorBoundary>
                </BrowserRouter>
                <CookieBanner />
                <IdleTimeout />
                {/* Draws every native `title` in the app as the app's own pill. */}
                <NativeTitleTooltips />
              </SettingsProvider>
            </AuthProvider>
            </ConfirmProvider>
          </ToastProvider>
        </VariantProvider>
      </ThemeProvider>
    </ReduxProvider>
  );
}
