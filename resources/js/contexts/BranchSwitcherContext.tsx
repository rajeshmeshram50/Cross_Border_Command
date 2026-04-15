import { createContext, useContext, useState, useEffect, type ReactNode } from 'react';
import { useAuth } from './AuthContext';
import api from '../api';
import type { Branch } from '../types';

interface BranchSwitcherCtx {
  branches: Branch[];
  selectedBranchId: number | null; // null = "All Branches"
  selectedBranch: Branch | null;
  isMainBranchUser: boolean;
  canSwitch: boolean;
  setBranch: (id: number | null) => void;
  loading: boolean;
}

const Ctx = createContext<BranchSwitcherCtx>({
  branches: [], selectedBranchId: null, selectedBranch: null,
  isMainBranchUser: false, canSwitch: false, setBranch: () => {}, loading: false,
});

export function BranchSwitcherProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchId] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const isBranchUser = user?.user_type === 'branch_user';
  const isClientAdmin = user?.user_type === 'client_admin';

  // Check if user's branch is the main branch
  const userBranch = branches.find(b => b.id === user?.branch_id);
  const isMainBranchUser = !!(isBranchUser && userBranch?.is_main);

  // Can switch: main branch user or client admin
  const canSwitch = isMainBranchUser || isClientAdmin;

  // Load branches for users who can switch
  useEffect(() => {
    if (!user || user.user_type === 'super_admin') return;

    setLoading(true);
    api.get('/branches', { params: { per_page: 100 } })
      .then(res => {
        const data = res.data.data || [];
        setBranches(data);

        // For non-main branch users, lock to their branch
        if (isBranchUser) {
          const myBranch = data.find((b: Branch) => b.id === user.branch_id);
          if (myBranch && !myBranch.is_main) {
            setSelectedBranchId(user.branch_id!);
          }
          // Main branch user starts with "All" (null)
        }
        // Client admin starts with "All" (null)
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  const selectedBranch = selectedBranchId ? branches.find(b => b.id === selectedBranchId) || null : null;

  return (
    <Ctx.Provider value={{
      branches, selectedBranchId, selectedBranch,
      isMainBranchUser, canSwitch,
      setBranch: setSelectedBranchId, loading,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useBranchSwitcher = () => useContext(Ctx);
