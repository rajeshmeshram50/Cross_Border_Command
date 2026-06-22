import React, { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Input } from 'reactstrap';
import SimpleBar from "simplebar-react";

import { useAuth } from '../../../contexts/AuthContext';
import { MENU_ITEMS, HR_GROUPS, SALES_GROUPS } from '../../../constants';
import type { UserRole } from '../../../types';

/* ────────────────────────────────────────────────────────────────────────────
 * Header search — restricted to global menu items only.
 *
 * The Velzon template originally shipped this component with hard-coded
 * "Recent Searches" / "Pages" / "Members" mock content (Angela Bernier and
 * friends). Per product call, that mock was misleading because nothing in
 * the app actually searches users / pages — the dropdown was decorative.
 *
 * This rewrite drops every mock section and uses MENU_ITEMS (the same
 * source the Sidebar reads) as the index. Typing in the box filters the
 * menus the current user can see and clicking a result navigates to the
 * matching route. HR + Sales children are flattened in so a deep leaf like
 * "Leave Plan Master" or "Lead Distribution" is reachable from one click.
 * ──────────────────────────────────────────────────────────────────────── */

// Local id→path resolver. Mirrors getPagePath() in components/App.tsx — kept
// inline to avoid a circular dependency. Only the menu-reachable ids need to
// be covered here; anything not matched falls back to /dashboard.
function pathForId(id: string): string {
    if (!id) return '/dashboard';
    if (id.startsWith('master.')) return `/master/${id.slice('master.'.length)}`;
    if (id === 'master') return '/master';
    switch (id) {
        case 'dashboard':            return '/dashboard';
        case 'clients':              return '/clients';
        case 'branches':             return '/branches';
        case 'plans':                return '/plans';
        case 'my-plan':              return '/my-plan';
        case 'payments':             return '/payments';
        case 'permissions':          return '/permissions';
        case 'settings':             return '/settings';
        case 'profile':              return '/profile';
        case 'clock-in':             return '/clock-in';
        case 'products':             return '/products';
        case 'vendors':              return '/suppliers';
        case 'hr-employees':         return '/hr/employees';
        case 'hr-recruitment':       return '/hr/recruitment';
        case 'hr-attendance':        return '/hr/attendance';
        case 'hr-leave':             return '/hr/leave';
        case 'hr-expense':           return '/hr/expense';
        case 'hr-payroll':           return '/hr/payroll';
        case 'hr-broadcast':         return '/hr/broadcast';
        case 'hr-doc-templates':     return '/hr/doc-templates';
        case 'hr-employee-onboarding': return '/hr/employee-onboarding';
        case 'sales.customers':       return '/sales/customers';
        case 'sales.consignee':       return '/sales/consignee';
        case 'sales.lead_ack_master': return '/sales/lead-ack-master';
        case 'sales.lead_worksheet':  return '/sales/lead-worksheet';
        // "My Workplace" alias — same backing page as Lead Worksheet.
        case 'sales.workplace':       return '/sales/lead-worksheet';
        case 'sales.todo':            return '/sales/todo';
        case 'sales.matrix_detail':   return '/sales/matrix';
        case 'sales.qpi':             return '/sales/qpi';
        // "Quotation Vs PI History" alias — same backing page as QPI.
        case 'sales.quotation_vs_pi': return '/sales/qpi';
        case 'sales.p2p_summary':     return '/sales/p2p-summary';
        case 'sales.diagnosis':       return '/sales/diagnosis';
        case 'sales.resolution_center': return '/sales/resolution-center';
        case 'sales.analytics':       return '/sales/analytics';
        case 'sales.performance':     return '/sales/performance';
        default:                     return '/dashboard';
    }
}

interface MenuHit {
    id: string;
    label: string;
    section?: string;      // e.g. "MAIN", "MASTER DATA" — taken from the nearest section header.
    parentLabel?: string;  // for HR/Sales children: surfaces "HR · Leave Plan Master".
}

const SearchOption = () => {
    const { user } = useAuth();
    const navigate = useNavigate();
    const [value, setValue] = useState('');
    const role = (user?.user_type ?? 'employee') as UserRole;

    // Wire up the existing Velzon dropdown show/hide on focus/keyup/blur.
    // Behaviour preserved from the original template; only the dropdown
    // contents below changed.
    useEffect(() => {
        const searchOptions = document.getElementById("search-close-options") as HTMLElement | null;
        const dropdown = document.getElementById("search-dropdown") as HTMLElement | null;
        const searchInput = document.getElementById("search-options") as HTMLInputElement | null;
        if (!searchOptions || !dropdown || !searchInput) return;

        const show = () => {
            if (searchInput.value.length > 0) {
                dropdown.classList.add("show");
                searchOptions.classList.remove("d-none");
            } else {
                dropdown.classList.remove("show");
                searchOptions.classList.add("d-none");
            }
        };

        const handleClickClose = () => {
            searchInput.value = "";
            setValue('');
            dropdown.classList.remove("show");
            searchOptions.classList.add("d-none");
        };

        const handleBodyClick = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            if (!target.closest('.app-search')) {
                dropdown.classList.remove("show");
                searchOptions.classList.add("d-none");
            }
        };

        searchInput.addEventListener("focus", show);
        searchInput.addEventListener("keyup", show);
        searchOptions.addEventListener("click", handleClickClose);
        document.body.addEventListener("click", handleBodyClick);
        return () => {
            searchInput.removeEventListener("focus", show);
            searchInput.removeEventListener("keyup", show);
            searchOptions.removeEventListener("click", handleClickClose);
            document.body.removeEventListener("click", handleBodyClick);
        };
    }, []);

    /* Flatten the role-visible menu tree into a single list of hits we can
     * filter. Section headers carry no `id` and aren't searchable; we just
     * tag the next leaf with the most recent section name so the dropdown
     * can group hits the same way the sidebar does. HR + Sales groups are
     * expanded one level deep so "Leave Plan Master" / "Lead Distribution"
     * etc. surface even though they live under a parent. */
    const allHits = useMemo<MenuHit[]>(() => {
        const list: MenuHit[] = [];
        let currentSection: string | undefined;

        for (const item of MENU_ITEMS) {
            if (!item.roles?.includes(role)) continue;
            if (item.section) {
                currentSection = item.section;
                continue;
            }
            if (!item.id) continue;
            list.push({ id: item.id, label: item.label, section: currentSection });

            // Expand HR + Sales groups one level deep so leaf entries are
            // searchable directly.
            if (item.id === 'hr') {
                for (const g of HR_GROUPS) {
                    for (const child of g.children) {
                        list.push({
                            id: child.id,
                            label: child.label,
                            section: currentSection,
                            parentLabel: `${item.label} · ${g.label}`,
                        });
                    }
                }
            }
            if (item.id === 'sales') {
                for (const g of SALES_GROUPS) {
                    for (const child of g.children) {
                        list.push({
                            id: child.id,
                            label: child.label,
                            section: currentSection,
                            parentLabel: `${item.label} · ${g.label}`,
                        });
                    }
                }
            }
        }
        return list;
    }, [role]);

    const filtered = useMemo<MenuHit[]>(() => {
        const q = value.trim().toLowerCase();
        if (!q) return allHits.slice(0, 12);
        return allHits.filter(h =>
            h.label.toLowerCase().includes(q) ||
            (h.parentLabel?.toLowerCase().includes(q) ?? false)
        ).slice(0, 30);
    }, [allHits, value]);

    const go = (id: string) => {
        const dropdown = document.getElementById("search-dropdown");
        const searchOptions = document.getElementById("search-close-options");
        dropdown?.classList.remove("show");
        searchOptions?.classList.add("d-none");
        setValue('');
        navigate(pathForId(id));
    };

    return (
        <React.Fragment>
            <form className="app-search d-none d-md-block" onSubmit={e => e.preventDefault()}>
                <div className="position-relative">
                    <Input
                        type="text"
                        className="form-control"
                        placeholder="Search menus..."
                        id="search-options"
                        value={value}
                        onChange={e => setValue(e.target.value)}
                    />
                    <span className="mdi mdi-magnify search-widget-icon"></span>
                    <span
                        className="mdi mdi-close-circle search-widget-icon search-widget-icon-close d-none"
                        id="search-close-options"
                    ></span>
                </div>
                <div className="dropdown-menu dropdown-menu-lg" id="search-dropdown">
                    <SimpleBar style={{ maxHeight: 360 }}>
                        {filtered.length === 0 ? (
                            <div className="text-center text-muted py-4" style={{ fontSize: 12.5 }}>
                                No menu matches "{value}"
                            </div>
                        ) : (
                            <>
                                <div className="dropdown-header">
                                    <h6 className="text-overflow text-muted mb-0 text-uppercase">
                                        {value.trim() ? 'Matching menus' : 'Suggestions'}
                                    </h6>
                                </div>
                                {filtered.map(hit => (
                                    <button
                                        key={hit.id}
                                        type="button"
                                        className="dropdown-item notify-item d-flex align-items-center"
                                        onClick={() => go(hit.id)}
                                    >
                                        <i className="ri-arrow-right-s-line align-middle fs-18 text-muted me-2" />
                                        <div className="flex-grow-1 min-w-0">
                                            <div className="text-truncate" style={{ fontSize: 13, fontWeight: 600 }}>
                                                {hit.label}
                                            </div>
                                            {(hit.parentLabel || hit.section) && (
                                                <div
                                                    className="text-muted text-truncate"
                                                    style={{ fontSize: 10.5, marginTop: 1 }}
                                                >
                                                    {hit.parentLabel || hit.section}
                                                </div>
                                            )}
                                        </div>
                                    </button>
                                ))}
                            </>
                        )}
                    </SimpleBar>
                </div>
            </form>
        </React.Fragment>
    );
};

export default SearchOption;
