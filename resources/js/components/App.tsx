import { useState } from 'react';
import { ThemeProvider } from '../contexts/ThemeContext';
import { AuthProvider, useAuth } from '../contexts/AuthContext';
import { ToastProvider } from '../contexts/ToastContext';
import { LayoutProvider } from '../contexts/LayoutContext';
import { BranchSwitcherProvider } from '../contexts/BranchSwitcherContext';
import AppLayout from '../layouts/AppLayout';
import Login from '../pages/Login';
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

function Router() {
  const { user } = useAuth();
  const [page, setPage] = useState('dashboard');
  const [pageData, setPageData] = useState<any>(null);

  if (!user) return <Login />;

  const navigate = (p: string, data?: any) => {
    setPage(p);
    setPageData(data || null);
  };

  const DashboardMap: Record<string, React.ComponentType> = {
    super_admin: AdminDashboard,
    client_admin: ClientDashboard,
    branch_user: BranchDashboard,
  };

  const renderPage = () => {
    switch (page) {
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
        return <AddPlan onBack={() => navigate('plans')} />;
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
        <AppLayout page={page} onNavigate={navigate}>
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
