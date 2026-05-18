import { useState, useEffect, createContext, useContext } from 'react';
import api from '../api';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import velzonStore from '../velzon/store';
import { ThemeProvider } from '../contexts/ThemeContext';
import { VariantProvider } from '../contexts/VariantContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { resolveFileUrl } from '../utils/resolveFileUrl';
import SplashLoader from './ui/SplashLoader';
import { ToastProvider } from '../contexts/ToastContext';
import { ConfirmProvider } from '../contexts/ConfirmContext';
import { LayoutProvider } from '../contexts/LayoutContext';
import { BranchSwitcherProvider } from '../contexts/BranchSwitcherContext';
import { SettingsProvider } from '../contexts/SettingsContext';
import CookieBanner from './CookieBanner';
import IdleTimeout from './IdleTimeout';
import VelzonShell from '../velzon/VelzonShell';
import { FEATURE_FLAGS } from '../constants';
import Login from '../pages/auth/Login';
import ForgotPassword from '../pages/auth/ForgotPassword';
import VerifyOTP from '../pages/auth/VerifyOTP';
import ResetPassword from '../pages/auth/ResetPassword';
import AdminDashboard from '../pages/dashboard/AdminDashboard';
import ClientDashboard from '../pages/dashboard/ClientDashboard';
import BranchDashboard from '../pages/dashboard/BranchDashboard';
import EmployeeDashboard from '../pages/dashboard/EmployeeDashboard';
import Clients from '../pages/client/Clients';
import ClientForm from '../pages/client/ClientForm';
import Branches from '../pages/branch/Branches';
import UsersPage from '../pages/UsersPage';
import Plans from '../pages/plan/Plans';
import Payments from '../pages/Payments';
import Permissions from '../pages/permission/Permissions';
import Settings from '../pages/Settings';
import Profile from '../pages/Profile';
import AddPlan from '../pages/plan/AddPlan';
import BranchForm from '../pages/branch/BranchForm';
import BranchView from '../pages/branch/BranchView';
import PlanSelection from '../pages/plan/PlanSelection';
import ClientView from '../pages/client/ClientView';
import ClientBranches from '../pages/client/ClientBranches';
import ClientPermissions from '../pages/client/ClientPermissions';
import ClientPayments from '../pages/client/ClientPayments';
import ClientSettings from '../pages/client/ClientSettings';
import MasterDashboard from '../pages/MasterDashboard';
import MasterPage from '../pages/master/MasterPage';
import SalesCustomers from '../pages/sales/SalesCustomers';
import SalesConsignee from '../pages/sales/SalesConsignee';
import SalesLeadAckMaster from '../pages/sales/SalesLeadAckMaster';
import HrDashboard from '../pages/hrms/HrDashboard';
import HrOverview from '../pages/hrms/HrOverview';
import HrEmployees from '../pages/hrms/HrEmployees';
import HrRecruitment from '../pages/recruitment/HrRecruitment';
import HrCandidates from '../pages/recruitment/HrCandidates';
import HrExitManagement from '../pages/hrms/HrExitManagement';
import HrAttendance from '../pages/hrms/HrAttendance';
import HrLeave from '../pages/hrms/HrLeave';
import HrLeavePlans from '../pages/hrms/HrLeavePlans';
import HrLeaveApprovals from '../pages/hrms/HrLeaveApprovals';
import HrPIP from '../pages/hrms/HrPIP';
import HrCalculationMaster from '../pages/hrms/HrCalculationMaster';
import HrExpenseManagement from '../pages/hrms/HrExpenseManagement';
import HrPayroll from '../pages/hrms/HrPayroll';
import HrBroadcastCentre from '../pages/hrms/HrBroadcastCentre';
import HrDocumentTemplates from '../pages/hrms/HrDocumentTemplates';
import HrCustomFields from '../pages/hrms/HrCustomFields';
import TemplateFormPage from '../pages/hrms/doc-templates/TemplateForm';
import GenerateDocument from '../pages/hrms/doc-templates/GenerateDocument';
import HrEmployeeOnboarding from '../pages/employee-onboarding/HrEmployeeOnboarding';
import EmployeePermissions from '../pages/employee/EmployeePermissions';
import EmployeeProfile from '../pages/employee/EmployeeProfile';
import PublicOnboarding from '../pages/PublicOnboarding';
import ClockIn from '../pages/ClockIn';
import MyTeam from '../pages/MyTeam';
import Inbox from '../pages/Inbox';

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
    case 'permissions': return '/permissions';
    case 'settings': return '/settings';
    case 'profile': return '/profile';
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
        setResolvedEmp(e);
      })
      .catch((err: any) => {
        if (cancelled) return;
        setResolveErr(err?.response?.status === 404 ? 'Employee not found' : 'Could not load profile');
      })
      .finally(() => { if (!cancelled) setResolving(false); });
    return () => { cancelled = true; };
  }, [id, stateEmp]);

  if (resolving) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--vz-secondary-color)' }}>
        <i className="ri-loader-4-line ri-spin" style={{ fontSize: 28, display: 'block', marginBottom: 8 }} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>Loading employee profile…</div>
      </div>
    );
  }
  if (resolveErr || !empCode) {
    return (
      <div style={{ padding: 48, textAlign: 'center', color: 'var(--vz-secondary-color)' }}>
        <i className="ri-error-warning-line" style={{ fontSize: 28, display: 'block', marginBottom: 8, color: '#ef4444' }} />
        <div style={{ fontSize: 13, fontWeight: 600 }}>{resolveErr || 'Unable to open profile'}</div>
      </div>
    );
  }
  return <EmployeeProfile employeeId={empCode} employee={resolvedEmp} onBack={() => navigateFn('hr-employees')} />;
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
  const fallback = {
    id: stateEmp?.id || `EMP-${user!.employee_id}`,
    name: user!.name,
    email: user!.email,
    // /me already carries the employee passport photo, so the hero shows it
    // immediately even if the /employees/:id fetch hasn't resolved yet.
    photoUrl: user!.employee_profile_photo ? resolveFileUrl(user!.employee_profile_photo) : null,
  };
  return (
    <EmployeeProfile
      employeeId={stateEmp?.id || String(user!.employee_id)}
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

  return (
    <NavigateContext.Provider value={navigateContextValue}>
      <LayoutProvider>
        <BranchSwitcherProvider>
          <VelzonShell>
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
              <Route path="/inbox"    element={<Inbox />} />
              <Route path="/master" element={<MasterDashboard />} />
              <Route path="/master/:slug" element={<MasterPage />} />
              <Route path="/sales/customers" element={<SalesCustomers />} />
              <Route path="/sales/consignee" element={<SalesConsignee />} />
              <Route path="/sales/lead-ack-master" element={<SalesLeadAckMaster />} />
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
              <Route path="/hr/pip" element={<HrPIP />} />
              <Route path="/hr/calculation-master" element={<HrCalculationMaster />} />
              <Route path="/hr/expense" element={<HrExpenseManagement />} />
              <Route path="/hr/payroll" element={<HrPayroll />} />
              <Route path="/hr/broadcast" element={<HrBroadcastCentre />} />
              <Route path="/hr/doc-templates" element={<HrDocumentTemplates />} />
              <Route path="/hr/doc-templates/new" element={<TemplateFormPage />} />
              <Route path="/hr/doc-templates/:id/edit" element={<TemplateFormPage />} />
              <Route path="/hr/doc-templates/:id/generate" element={<GenerateDocument />} />
              <Route path="/hr/custom-fields" element={<HrCustomFields />} />
              <Route path="/hr/employee-onboarding" element={<HrEmployeeOnboarding />} />
              <Route path="/hr/employees/:id/permissions" element={<EmployeePermissionsWrapper />} />
              <Route path="/hr/employees/:id/profile" element={<EmployeeProfileWrapper />} />
              <Route path="*" element={<Navigate to="/dashboard" replace />} />
            </Routes>
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
      <Routes>
        <Route path="/onboarding/:token" element={<PublicOnboarding />} />
      </Routes>
    );
  }

  if (!user) {
    // Allow auth routes even when not logged in
    return <AuthRoutes />;
  }

  // key={user.id} forces full remount when user changes (login/switch user)
  return <DashboardRoutes key={user.id} user={user} />;
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
