import { useState, createContext, useContext } from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate, useLocation, useParams } from 'react-router-dom';
import { Provider as ReduxProvider } from 'react-redux';
import velzonStore from '../velzon/store';
import { ThemeProvider } from '../contexts/ThemeContext';
import { VariantProvider } from '../contexts/VariantContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import SplashLoader from './ui/SplashLoader';
import { ToastProvider } from '../contexts/ToastContext';
import { LayoutProvider } from '../contexts/LayoutContext';
import { BranchSwitcherProvider } from '../contexts/BranchSwitcherContext';
import VelzonShell from '../velzon/VelzonShell';
import Login from '../pages/Login';
import ForgotPassword from '../pages/ForgotPassword';
import VerifyOTP from '../pages/VerifyOTP';
import ResetPassword from '../pages/ResetPassword';
import AdminDashboard from '../pages/dashboard/AdminDashboard';
import ClientDashboard from '../pages/dashboard/ClientDashboard';
import BranchDashboard from '../pages/dashboard/BranchDashboard';
import Clients from '../pages/Clients';
import ClientForm from '../pages/ClientForm';
import Branches from '../pages/Branches';
import UsersPage from '../pages/UsersPage';
import Employees from '../pages/Employees';
import Plans from '../pages/Plans';
import Payments from '../pages/Payments';
import Permissions from '../pages/Permissions';
import Settings from '../pages/Settings';
import Profile from '../pages/Profile';
import AddPlan from '../pages/AddPlan';
import BranchForm from '../pages/BranchForm';
import BranchView from '../pages/BranchView';
import PlanSelection from '../pages/PlanSelection';
import ClientView from '../pages/ClientView';
import ClientBranches from '../pages/ClientBranches';
import ClientPermissions from '../pages/ClientPermissions';
import ClientPayments from '../pages/ClientPayments';
import ClientSettings from '../pages/ClientSettings';
import MasterDashboard from '../pages/MasterDashboard';
import MasterPage from '../pages/master/MasterPage';
import HrDashboard from '../pages/HrDashboard';
import HrEmployees from '../pages/HrEmployees';
import HrRecruitment from '../pages/HrRecruitment';
import HrCandidates from '../pages/HrCandidates';
import EmployeePermissions from '../pages/EmployeePermissions';
import EmployeeProfile from '../pages/EmployeeProfile';

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
    case 'branch-users': return '/branches/users';
    case 'client-users': return '/clients/users';
    case 'employees': return '/employees';
    case 'hr-employees': return '/hr/employees';
    case 'hr-recruitment': return '/hr/recruitment';
    case 'employee-permissions': return `/hr/employees/${data?.employeeId}/permissions`;
    case 'employee-profile':     return `/hr/employees/${data?.employeeId}/profile`;
    case 'plans': return '/plans';
    case 'add-plan': return data?.editId ? `/plans/${data.editId}/edit` : '/plans/new';
    case 'my-plan': return '/my-plan';
    case 'plan-blocked': return '/plan-blocked';
    case 'payments': return '/payments';
    case 'permissions': return '/permissions';
    case 'settings': return '/settings';
    case 'profile': return '/profile';
    default:
      // Master leaf slugs come as `master.xxx` — map to `/master/xxx`
      if (page.startsWith('master.')) return `/master/${page.slice('master.'.length)}`;
      if (page === 'master') return '/master';
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

function EmployeePermissionsWrapper() {
  const { id } = useParams();
  const location = useLocation();
  const navigateFn = useNavigateContext().navigate;
  // Employee row is passed via navigation state when entering from the HR
  // employees table. If the user lands on this URL directly, the page falls
  // back to showing just the ID.
  const stateEmp = (location.state as any)?.employee;
  return <EmployeePermissions employeeId={String(id)} employee={stateEmp} onBack={() => navigateFn('hr-employees')} />;
}

function EmployeeProfileWrapper() {
  const { id } = useParams();
  const location = useLocation();
  const navigateFn = useNavigateContext().navigate;
  const stateEmp = (location.state as any)?.employee;
  return <EmployeeProfile employeeId={String(id)} employee={stateEmp} onBack={() => navigateFn('hr-employees')} />;
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

  // Navigate function compatible with existing components
  const navigateFn = (p: string, data?: any) => {
    const path = getPagePath(p, data);
    if (planExpiredOrMissing && !defaultPages.includes(path)) {
      navigate('/my-plan', { replace: true });
      return;
    }
    navigate(path);
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
  };

  const DefaultDashboard = DashboardMap[user.user_type] || AdminDashboard;

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
              <Route path="/branches/users" element={<UsersPage />} />
              <Route path="/clients/users" element={<UsersPage />} />
              <Route path="/employees" element={<Employees />} />
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
              <Route path="/payments" element={<Payments />} />
              <Route path="/permissions" element={<Permissions />} />
              <Route path="/settings" element={<Settings />} />
              <Route path="/profile" element={<Profile />} />
              <Route path="/master" element={<MasterDashboard />} />
              <Route path="/master/:slug" element={<MasterPage />} />
              <Route path="/hr" element={<HrDashboard />} />
              <Route path="/hr/employees" element={<HrEmployees />} />
              <Route path="/hr/recruitment" element={<HrRecruitment />} />
              <Route path="/hr/recruitment/:id/candidates" element={<HrCandidates />} />
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
            <AuthProvider>
              <BrowserRouter>
                <Router />
              </BrowserRouter>
            </AuthProvider>
          </ToastProvider>
        </VariantProvider>
      </ThemeProvider>
    </ReduxProvider>
  );
}
