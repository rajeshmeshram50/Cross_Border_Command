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

const STORAGE_KEY = 'cbc_selected_branch_id';

function readSaved(): number | null | undefined {
  if (typeof window === 'undefined') return undefined;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (raw === null) return undefined;            // never saved
  if (raw === 'null' || raw === '') return null; // "All Branches" was explicitly chosen
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function writeSaved(id: number | null) {
  try { localStorage.setItem(STORAGE_KEY, id === null ? 'null' : String(id)); } catch {}
}

export function BranchSwitcherProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchIdState] = useState<number | null>(null);
  const [loading, setLoading] = useState(false);

  const isBranchUser = user?.user_type === 'branch_user';
  const isClientAdmin = user?.user_type === 'client_admin';

  const userBranch = branches.find(b => b.id === user?.branch_id);
  const isMainBranchUser = !!(isBranchUser && userBranch?.is_main);

  // Main branch user + client admin can switch. Sub-branch user is locked.
  const canSwitch = isMainBranchUser || isClientAdmin;

  useEffect(() => {
    if (!user || user.user_type === 'super_admin') return;

    setLoading(true);
    api.get('/branches', { params: { per_page: 100 } })
      .then(res => {
        const data: Branch[] = res.data.data || [];
        setBranches(data);

        const myBranch = data.find(b => b.id === user.branch_id);
        const isMain = !!(user.user_type === 'branch_user' && myBranch?.is_main);

        const saved = readSaved();
        let initial: number | null;

        if (saved !== undefined && (saved === null || data.some(b => b.id === saved))) {
          // Use saved value if still valid for this user's branch list
          initial = saved;
        } else if (user.user_type === 'branch_user') {
          // Both main and sub-branch users default to their own branch
          initial = user.branch_id ?? null;
        } else {
          // Client admin defaults to "All Branches"
          initial = null;
        }

        // Sub-branch user (non-main) is always locked to their own branch
        if (user.user_type === 'branch_user' && !isMain) {
          initial = user.branch_id ?? null;
        }

        setSelectedBranchIdState(initial);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [user?.id]);

  const setBranch = (id: number | null) => {
    setSelectedBranchIdState(id);
    writeSaved(id);
  };

  const selectedBranch = selectedBranchId ? branches.find(b => b.id === selectedBranchId) || null : null;

  return (
    <Ctx.Provider value={{
      branches, selectedBranchId, selectedBranch,
      isMainBranchUser, canSwitch,
      setBranch, loading,
    }}>
      {children}
    </Ctx.Provider>
  );
}

export const useBranchSwitcher = () => useContext(Ctx);
