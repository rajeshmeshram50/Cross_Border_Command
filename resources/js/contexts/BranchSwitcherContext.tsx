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

// Storage key is scoped per-user so logging in as a different user on the same
// browser does not inherit the previous user's selection.
function storageKey(userId?: number): string | null {
  return userId ? `cbc_selected_branch_id_${userId}` : null;
}

function readSaved(userId?: number): number | null | undefined {
  const key = storageKey(userId);
  if (!key || typeof window === 'undefined') return undefined;
  const raw = localStorage.getItem(key);
  if (raw === null) return undefined;
  if (raw === 'null' || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function writeSaved(userId: number, id: number | null) {
  const key = storageKey(userId);
  if (!key) return;
  try { localStorage.setItem(key, id === null ? 'null' : String(id)); } catch {}
}

// Compute the safest initial selection given user + (maybe loaded) branches.
function computeInitial(
  userType: string | undefined,
  userBranchId: number | null | undefined,
  userId: number | undefined,
  loadedBranches: Branch[],
): number | null {
  if (!userId) return null;

  // Sub-branch users (non-main) are ALWAYS locked to their own branch — never
  // honour saved state. Backend enforces too, but we keep UI consistent.
  if (userType === 'branch_user') {
    const myBranch = loadedBranches.find(b => b.id === userBranchId);
    if (myBranch && !myBranch.is_main) return userBranchId ?? null;
    // Branches not loaded yet OR is main — fall through to saved/default
  }

  const saved = readSaved(userId);
  if (saved !== undefined) {
    if (saved === null) return null;
    // Validate saved id belongs to this user's branch list (when loaded)
    if (loadedBranches.length === 0 || loadedBranches.some(b => b.id === saved)) {
      return saved;
    }
  }

  // No valid saved — sensible default
  if (userType === 'branch_user' && userBranchId) return userBranchId;
  return null; // client_admin default
}

export function BranchSwitcherProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const [branches, setBranches] = useState<Branch[]>([]);
  const [selectedBranchId, setSelectedBranchIdState] = useState<number | null>(
    () => computeInitial(user?.user_type, user?.branch_id, user?.id, [])
  );
  const [loading, setLoading] = useState(false);

  const isBranchUser = user?.user_type === 'branch_user';
  const isClientAdmin = user?.user_type === 'client_admin';

  const userBranch = branches.find(b => b.id === user?.branch_id);
  const isMainBranchUser = !!(isBranchUser && userBranch?.is_main);
  const canSwitch = isMainBranchUser || isClientAdmin;

  // Reset + reload branches whenever the active user changes.
  useEffect(() => {
    // Hard reset to prevent the previous user's selection bleeding into the new
    // user's session before /branches comes back.
    setSelectedBranchIdState(computeInitial(user?.user_type, user?.branch_id, user?.id, []));
    setBranches([]);

    if (!user || user.user_type === 'super_admin') return;

    const controller = new AbortController();
    setLoading(true);
    api.get('/branches', { params: { per_page: 100 }, signal: controller.signal })
      .then(res => {
        const data: Branch[] = res.data.data || [];
        setBranches(data);
        // Recompute now that we know the actual branch list (validates saved id,
        // applies sub-branch lock, etc.)
        setSelectedBranchIdState(computeInitial(user.user_type, user.branch_id, user.id, data));
      })
      .catch(err => {
        if (err?.name !== 'CanceledError' && err?.code !== 'ERR_CANCELED') {
          console.warn('[BranchSwitcher] failed to load branches', err);
        }
      })
      .finally(() => setLoading(false));

    return () => controller.abort();
  }, [user?.id]);

  const setBranch = (id: number | null) => {
    if (!user?.id) return;
    // Sub-branch user (non-main) cannot switch — silently ignore
    if (isBranchUser && !isMainBranchUser) return;
    // Validate id is in our branches list (or null)
    if (id !== null && !branches.some(b => b.id === id)) return;
    setSelectedBranchIdState(id);
    writeSaved(user.id, id);
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
