import { useCallback, useMemo } from 'react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';

/* ─────────────────────────────────────────────────────────────────────────
 * Per-ACTION module permissions for a page.
 *
 * The Permissions matrix grants seven independent flags per module (view /
 * add / edit / delete / export / import / approve), and the API enforces each
 * one — EmployeeController::authorize() aborts 403 "Missing can_add on
 * hr.employee". The pages, however, mostly rendered every button regardless,
 * so a view-only user could press Add, fill the whole form, and only then meet
 * a raw 403. This hook is the front half of that contract:
 *
 *   const perm = useModulePermission('hr.employee', 'employees');
 *   perm.canAdd                              → boolean, for disabling a button
 *   perm.guard('edit', () => openEdit(row))  → runs it, or explains why not
 *
 * `guard` deliberately does NOT silently swallow the click: a button that
 * looks pressable and then does nothing is worse than one that says why. Pair
 * it with the greyed styling so the state is visible BEFORE the click too.
 *
 * Super admin bypasses everything, matching the server (`isSuperAdmin()`
 * returns early there). No other role is special-cased — a client_admin with
 * no grant row is denied by the API, so denying here keeps the two in step.
 * ───────────────────────────────────────────────────────────────────────── */

export type PermAction = 'view' | 'add' | 'edit' | 'delete' | 'export' | 'import' | 'approve';

/** How each action is phrased in the toast: "…permission to <verb> <subject>". */
const VERBS: Record<PermAction, string> = {
  view: 'view',
  add: 'add',
  edit: 'edit',
  delete: 'delete',
  export: 'export',
  import: 'import',
  approve: 'approve',
};

/** Column name on the permissions row, for the "ask for X access" hint. */
const FLAG_LABEL: Record<PermAction, string> = {
  view: 'View',
  add: 'Add',
  edit: 'Edit',
  delete: 'Delete',
  export: 'Export',
  import: 'Import',
  approve: 'Approve',
};

export interface ModulePermission {
  canView: boolean;
  canAdd: boolean;
  canEdit: boolean;
  canDelete: boolean;
  canExport: boolean;
  canImport: boolean;
  canApprove: boolean;
  /** Raw check, for conditions the helpers below don't cover. */
  can: (action: PermAction) => boolean;
  /** Show the "you don't have permission" toast for this action. Always false. */
  deny: (action: PermAction) => false;
  /** Run `run` when allowed; otherwise explain via toast. Returns whether it ran. */
  guard: (action: PermAction, run: () => void) => boolean;
  /** Tooltip text for a locked control — undefined when the action is allowed. */
  lockedTitle: (action: PermAction) => string | undefined;
}

/**
 * @param slug    Module slug exactly as the API checks it, e.g. 'hr.employee'.
 * @param subject Plural noun for the toast copy, e.g. 'employees'.
 */
export function useModulePermission(slug: string, subject: string): ModulePermission {
  const { user } = useAuth();
  const toast = useToast();

  const flags = useMemo(() => {
    const isSuperAdmin = user?.user_type === 'super_admin';
    const row = (user?.permissions as Record<string, any> | undefined)?.[slug];
    const read = (key: string) => isSuperAdmin || !!row?.[key];
    return {
      canView: read('can_view'),
      canAdd: read('can_add'),
      canEdit: read('can_edit'),
      canDelete: read('can_delete'),
      canExport: read('can_export'),
      canImport: read('can_import'),
      canApprove: read('can_approve'),
    };
  }, [user, slug]);

  const can = useCallback((action: PermAction) => {
    switch (action) {
      case 'view': return flags.canView;
      case 'add': return flags.canAdd;
      case 'edit': return flags.canEdit;
      case 'delete': return flags.canDelete;
      case 'export': return flags.canExport;
      case 'import': return flags.canImport;
      case 'approve': return flags.canApprove;
    }
  }, [flags]);

  const lockedTitle = useCallback((action: PermAction) => (
    can(action)
      ? undefined
      : `You don't have permission to ${VERBS[action]} ${subject}`
  ), [can, subject]);

  const deny = useCallback((action: PermAction) => {
    toast.error(
      'Permission required',
      `You don't have permission to ${VERBS[action]} ${subject}. Ask your manager or administrator to grant ${FLAG_LABEL[action]} access on this module.`,
    );
    return false as const;
  }, [toast, subject]);

  const guard = useCallback((action: PermAction, run: () => void) => {
    if (!can(action)) { deny(action); return false; }
    run();
    return true;
  }, [can, deny]);

  return { ...flags, can, deny, guard, lockedTitle };
}

export default useModulePermission;
