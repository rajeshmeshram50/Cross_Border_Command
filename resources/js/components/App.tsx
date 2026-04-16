import { useState } from 'react';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { LayoutProvider } from '../contexts/LayoutContext';
import { BranchSwitcherProvider } from '../contexts/BranchSwitcherContext';
import AppLayout from '../layouts/AppLayout';
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
import PlanSelection from '../pages/PlanSelection';

function Router() {
  const { user } = useAuth();
  const [authPage, setAuthPage] = useState<'login' | 'forgot-password' | 'verify-otp' | 'reset-password'>('login');
  const [resetEmail, setResetEmail] = useState('');
  
  if (!user) {
    const handleForgotPasswordClick = () => {
      setAuthPage('forgot-password');
    };

    const handleEmailSubmitted = (email: string) => {
      setResetEmail(email);
      setAuthPage('verify-otp');
    };

    const handleOTPVerified = () => {
      setAuthPage('reset-password');
    };

    const handlePasswordReset = () => {
      setAuthPage('login');
    };

    return (
      <>
        {authPage === 'login' && (
          <Login onForgotPassword={handleForgotPasswordClick} />
        )}
        {authPage === 'forgot-password' && (
          <ForgotPassword 
            onBackToLogin={() => setAuthPage('login')}
            onEmailSubmitted={handleEmailSubmitted}
          />
        )}
        {authPage === 'verify-otp' && (
          <VerifyOTP 
            email={resetEmail}
            onBackToForgotPassword={() => setAuthPage('forgot-password')}
            onOTPVerified={handleOTPVerified}
          />
        )}
        {authPage === 'reset-password' && (
          <ResetPassword 
            email={resetEmail}
            onBackToVerifyOTP={() => setAuthPage('verify-otp')}
            onPasswordReset={handlePasswordReset}
          />
        )}
      </>
    );
  }

  const isClient = user.user_type === 'client_admin' || user.user_type === 'branch_user';
  const planExpiredOrMissing = isClient && user.plan && (!user.plan.has_plan || user.plan.expired);

  // Client without plan starts on my-plan page
  const initialPage = (planExpiredOrMissing && user.user_type === 'client_admin') ? 'my-plan' : 'dashboard';
  const [page, setPage] = useState(initialPage);
  const [pageData, setPageData] = useState<any>(null);
  const defaultPages = ['dashboard', 'my-plan', 'profile'];

  const navigate = (p: string, data?: any) => {
    // If plan expired/missing, only allow default pages
    if (planExpiredOrMissing && !defaultPages.includes(p)) {
      setPage('my-plan');
      setPageData(null);
      return;
    }
    setPage(p);
    setPageData(data || null);
  };

  // Determine effective page
  let effectivePage = page;
  if (planExpiredOrMissing) {
    if (user.user_type === 'branch_user') {
      // Branch user blocked completely - show message
      effectivePage = 'plan-blocked';
    } else if (!defaultPages.includes(page)) {
      effectivePage = 'my-plan';
    }
  }

  const DashboardMap: Record<string, React.ComponentType> = {
    super_admin: AdminDashboard,
    client_admin: ClientDashboard,
    branch_user: BranchDashboard,
  };

  const renderPage = () => {
    switch (effectivePage) {
      case 'dashboard':
        const Dash = DashboardMap[user.user_type] || AdminDashboard;
        return <Dash />;
      case 'clients':
        return <Clients onNavigate={navigate} />;
      case 'client-form':
        return <ClientForm onBack={() => navigate('clients')} editId={pageData?.editId} />;
      case 'branches':
        return <Branches onNavigate={navigate} />;
      case 'branch-form':
        return <BranchForm onBack={() => navigate('branches')} editId={pageData?.editId} />;
      case 'branch-users':
      case 'client-users':
        return <UsersPage />;
      case 'employees':
        return <Employees />;
      case 'plans':
        return <Plans onNavigate={navigate} />;
      case 'add-plan':
        return <AddPlan onBack={() => navigate('plans')} editId={pageData?.editId} />;
      case 'my-plan':
        return <PlanSelection onSuccess={() => window.location.reload()} />;
      case 'plan-blocked':
        return (
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
        );
      case 'payments':
        return <Payments />;
      case 'permissions':
        return <Permissions />;
      case 'settings':
        return <Settings />;
      case 'profile':
        return <Profile />;
      default:
        const Default = DashboardMap[user.user_type] || AdminDashboard;
        return <Default />;
    }
  };

  return (
    <LayoutProvider>
      <BranchSwitcherProvider>
        <AppLayout page={effectivePage} onNavigate={navigate}>
          {renderPage()}
        </AppLayout>
      </BranchSwitcherProvider>
    </LayoutProvider>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <ToastProvider>
        <AuthProvider>
          <Router />
        </AuthProvider>
      </ToastProvider>
    </ThemeProvider>
  );
}
