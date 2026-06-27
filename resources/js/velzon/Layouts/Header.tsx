import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Dropdown, DropdownMenu, DropdownToggle, Form } from 'reactstrap';

//import images
import logoSm from "../assets/images/chotu-logo.png";
import logoDark from "../assets/images/igc-logo.png";
import logoLight from "../assets/images/igc-logo.png";

//import Components
import SearchOption from '../Components/Common/SearchOption';
import FullScreenDropdown from '../Components/Common/FullScreenDropdown';
import ProfileDropdown from '../Components/Common/ProfileDropdown';
import LightDark from '../Components/Common/LightDark';
import { useAuth } from '../../contexts/AuthContext';
import { resolveFileUrl } from '../../utils/resolveFileUrl';

import { changeSidebarVisibility } from '../slices/thunks';
import { useSelector, useDispatch } from "react-redux";
import { createSelector } from 'reselect';

const Header = ({ onChangeLayoutMode, layoutModeType, headerClass } : any) => {
    const dispatch : any = useDispatch();
    const navigate = useNavigate();
    // Tenant brand-color toggle. The button only appears when the logged-in
    // user actually has tenant colors (otherwise toggling is a no-op).
    const { user, logout, tenantThemeEnabled, toggleTenantTheme } = useAuth();
    const hasTenantColors = !!(user?.primary_color || user?.secondary_color);
    // Mirror the horizontal header's action icons (Gmail, Inbox, Logout +
    // employee clock-in) so both layouts expose the same controls.
    const isEmployee = user?.user_type === 'employee' && !!user?.employee_id;
    // Header's `horizontal-logo` block shows the brand mark in horizontal /
    // twocolumn layouts (where the sidebar is hidden / collapsed). Use the
    // same fallback chain as Sidebar.tsx so a tenant's logo replaces the
    // static IGC defaults whenever it's available. Backend returns
    // `/storage/...` relative paths — resolveFileUrl prefixes the API origin
    // so the <img> can actually load.
    const rawTenantLogo = user?.branch_logo || user?.client_logo || null;
    const tenantLogo = rawTenantLogo ? resolveFileUrl(rawTenantLogo) : null;
    const headerLogoSm    = tenantLogo || logoSm;
    const headerLogoDark  = tenantLogo || logoDark;
    const headerLogoLight = tenantLogo || logoLight;


    const selectDashboardData = createSelector(
        (state) => state.Layout,
        (sidebarVisibilitytype) => sidebarVisibilitytype.sidebarVisibilitytype
      );
    // Inside your component
    const sidebarVisibilitytype = useSelector(selectDashboardData);
    

    const [search, setSearch] = useState(false);
    const toogleSearch = () => {
        setSearch(!search);
    };

    const toogleMenuBtn = () => {
        var windowSize = document.documentElement.clientWidth;
        const humberIcon = document.querySelector(".hamburger-icon") as HTMLElement;
        dispatch(changeSidebarVisibility("show"));

        if (windowSize > 767)
            humberIcon.classList.toggle('open');

        //For collapse horizontal menu
        if (document.documentElement.getAttribute('data-layout') === "horizontal") {
            document.body.classList.contains("menu") ? document.body.classList.remove("menu") : document.body.classList.add("menu");
        }

        //For collapse vertical and semibox menu
        if (sidebarVisibilitytype === "show" && (document.documentElement.getAttribute('data-layout') === "vertical" || document.documentElement.getAttribute('data-layout') === "semibox")) {
            if (windowSize < 1025 && windowSize > 767) {
                document.body.classList.remove('vertical-sidebar-enable');
                (document.documentElement.getAttribute('data-sidebar-size') === 'sm') ? document.documentElement.setAttribute('data-sidebar-size', '') : document.documentElement.setAttribute('data-sidebar-size', 'sm');
            } else if (windowSize > 1025) {
                document.body.classList.remove('vertical-sidebar-enable');
                (document.documentElement.getAttribute('data-sidebar-size') === 'lg') ? document.documentElement.setAttribute('data-sidebar-size', 'sm') : document.documentElement.setAttribute('data-sidebar-size', 'lg');
            } else if (windowSize <= 767) {
                document.body.classList.add('vertical-sidebar-enable');
                document.documentElement.setAttribute('data-sidebar-size', 'lg');
            }
        }


        //Two column menu
        if (document.documentElement.getAttribute('data-layout') === "twocolumn") {
            document.body.classList.contains('twocolumn-panel') ? document.body.classList.remove('twocolumn-panel') : document.body.classList.add('twocolumn-panel');
        }
    };

    return (
        <React.Fragment>
            <style>{`
              .vth-switch { display: flex; align-items: center; gap: 9px; flex-shrink: 0; padding: 4px 10px 4px 11px; border-radius: 999px; background: linear-gradient(180deg,#FFF,#F7F8FC); border: 1.5px solid #E7EAF3; }
              .vth-switch-label { font-size: 11.5px; font-weight: 500; color: #6B7280; user-select: none; white-space: nowrap; }
              .vth-switch.vth-on .vth-switch-label { color: var(--vth-on, #7C3AED); }
              .vth-switch-toggle { position: relative; width: 42px; height: 22px; border-radius: 999px; border: none; cursor: pointer; flex-shrink: 0; padding: 0; background: linear-gradient(135deg,#CBD5E1,#94A3B8); box-shadow: inset 0 1px 3px rgba(15,23,42,.18); transition: background .25s ease; }
              .vth-switch-toggle::after { content: ''; position: absolute; top: 2.5px; left: 2.5px; width: 17px; height: 17px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(15,23,42,.3); transition: transform .28s cubic-bezier(.34,1.56,.64,1); }
              .vth-switch.vth-on .vth-switch-toggle { background: var(--vth-on, #7C3AED); }
              .vth-switch.vth-on .vth-switch-toggle::after { transform: translateX(20px); }
              [data-bs-theme="dark"] .vth-switch { background: linear-gradient(180deg,#1E2230,#1A1D29); border-color: #2C3242; }
              .vth-sep { width: 1px; height: 20px; flex-shrink: 0; background: #E7EAF3; align-self: center; margin: 0 10px; }
              [data-bs-theme="dark"] .vth-sep { background: #2C3242; }
              /* Smaller, tighter action icons in the vertical top bar. */
              .vth-topbar-actions .header-item { margin-left: 0 !important; }
              .vth-topbar-actions .btn-topbar { height: 35px !important; width: 35px !important; line-height: 30px !important; }
              .vth-topbar-actions .btn-topbar i { font-size: 17px !important; }
              /* Red logout button, matching the horizontal header. */
              .vth-logout-btn { color: #E11D48 !important; }
              .vth-logout-btn:hover, .vth-logout-btn:focus { background-color: #FFF1F2 !important; color: #E11D48 !important; }
              [data-bs-theme="dark"] .vth-logout-btn:hover, [data-bs-theme="dark"] .vth-logout-btn:focus { background-color: rgba(225,29,72,0.15) !important; }
              /* Brand mode: recolor the top-bar accents with the tenant brand colour,
                 mirroring the horizontal header. Logout stays red. */
              .vth-brand .vth-search .form-control:focus { border-color: var(--vth-bp) !important; box-shadow: 0 0 0 4px color-mix(in srgb, var(--vth-bp) 16%, transparent) !important; }
              .vth-brand .vth-search .form-control:focus ~ span.search-widget-icon { color: var(--vth-bp) !important; }
              .vth-brand .vth-search-kbd { color: var(--vth-bp); border-color: color-mix(in srgb, var(--vth-bp) 35%, #E2E6F0); }
              .vth-brand .vth-topbar-actions .btn-topbar:not(.vth-logout-btn):hover { color: var(--vth-bp) !important; background-color: color-mix(in srgb, var(--vth-bp) 10%, transparent) !important; }
            `}</style>
            <header
                id="page-topbar"
                className={`${headerClass || ''} ${tenantThemeEnabled ? 'vth-brand' : ''}`}
                style={{ ['--vth-bp' as any]: user?.primary_color || '#7C3AED' }}
            >
                <div className="layout-width">
                    <div className="navbar-header">
                        <div className="d-flex">

                            <div className="navbar-brand-box horizontal-logo align-self-center">
                                <Link to="/" className="logo logo-dark">
                                    <span className="logo-sm">
                                        <img src={headerLogoSm} alt="" style={{ height: '50px', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} />
                                    </span>
                                    <span className="logo-lg">
                                        <img src={headerLogoDark} alt="" style={{ height: '50px', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} />
                                    </span>
                                </Link>

                                <Link to="/" className="logo logo-light">
                                    <span className="logo-sm">
                                        <img src={headerLogoSm} alt="" style={{ height: '50px', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} />
                                    </span>
                                    <span className="logo-lg">
                                        <img src={headerLogoLight} alt="" style={{ height: '50px', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} />
                                    </span>
                                </Link>
                            </div>

                            <button
                                onClick={toogleMenuBtn}
                                type="button"
                                className="btn btn-sm px-3 fs-16 header-item vertical-menu-btn topnav-hamburger"
                                id="topnav-hamburger-icon">
                                <span className="hamburger-icon">
                                    <span></span>
                                    <span></span>
                                    <span></span>
                                </span>
                            </button>


                            <SearchOption />
                        </div>

                        <div className="d-flex align-items-center vth-topbar-actions">

                            <Dropdown isOpen={search} toggle={toogleSearch} className="d-md-none topbar-head-dropdown header-item">
                                <DropdownToggle type="button" tag="button" className="btn btn-icon btn-topbar btn-ghost-secondary rounded-circle">
                                    <i className="bx bx-search fs-22"></i>
                                </DropdownToggle>
                                <DropdownMenu className="dropdown-menu-lg dropdown-menu-end p-0">
                                    <Form className="p-3">
                                        <div className="form-group m-0">
                                            <div className="input-group">
                                                <input type="text" className="form-control" placeholder="Search ..."
                                                    aria-label="Recipient's username" />
                                                <button className="btn btn-primary" type="submit"><i
                                                    className="mdi mdi-magnify"></i></button>
                                            </div>
                                        </div>
                                    </Form>
                                </DropdownMenu>
                            </Dropdown>

                            {/* Order mirrors the horizontal header:
                                Default toggle → theme → fullscreen → mail → bell → logout → profile */}

                            {/* Tenant brand-color toggle — labeled pill switch, matching the
                                horizontal header's "Default / Brand" toggle. */}
                            {hasTenantColors && (
                                <div className="me-2 header-item d-flex align-items-center">
                                    <div
                                        className={`vth-switch ${tenantThemeEnabled ? 'vth-on' : ''}`}
                                        title={tenantThemeEnabled ? 'Click to switch to default theme' : 'Click to switch to brand theme'}
                                        style={{ '--vth-on': (user?.primary_color || '#7C3AED') } as React.CSSProperties}
                                    >
                                        <span className="vth-switch-label">{tenantThemeEnabled ? 'Brand' : 'Default'}</span>
                                        <button
                                            type="button"
                                            className="vth-switch-toggle"
                                            aria-label="Toggle brand theme"
                                            aria-pressed={tenantThemeEnabled}
                                            onClick={toggleTenantTheme}
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Dark/Light Mode set */}
                            <LightDark
                                layoutMode={layoutModeType}
                                onChangeLayoutMode={onChangeLayoutMode}
                            />

                            {/* FullScreenDropdown */}
                            <FullScreenDropdown />

                            {/* Clock In / Out — employees only (mirrors horizontal header) */}
                            {isEmployee && (
                                <div className="ms-1 header-item d-none d-sm-flex">
                                    <button type="button" title="Clock In / Out"
                                        onClick={() => navigate('/clock-in')}
                                        className="btn btn-icon btn-topbar btn-ghost-secondary rounded-circle">
                                        <i className="bx bx-time-five fs-22"></i>
                                    </button>
                                </div>
                            )}

                            {/* Gmail — hidden for employee logins; kept for
                                branch/client users and admins. */}
                            {!isEmployee && (
                                <div className="ms-1 header-item d-none d-sm-flex">
                                    <button type="button" title="Gmail"
                                        onClick={() => navigate('/gmail')}
                                        className="btn btn-icon btn-topbar btn-ghost-secondary rounded-circle">
                                        <i className="bx bx-envelope fs-22"></i>
                                    </button>
                                </div>
                            )}

                            {/* Inbox / Notifications */}
                            <div className="ms-1 header-item d-none d-sm-flex">
                                <button type="button" title="Inbox"
                                    onClick={() => navigate('/inbox')}
                                    className="btn btn-icon btn-topbar btn-ghost-secondary rounded-circle position-relative">
                                    <i className="bx bx-bell fs-22"></i>
                                    {!!user?.inbox_count && (
                                        <span className="position-absolute topbar-badge fs-10 translate-middle badge rounded-pill bg-danger">
                                            {user.inbox_count}
                                            <span className="visually-hidden">unread messages</span>
                                        </span>
                                    )}
                                </button>
                            </div>

                            {/* Logout */}
                            <div className="ms-1 header-item d-none d-sm-flex">
                                <button type="button" title="Logout"
                                    onClick={() => logout()}
                                    className="btn btn-icon btn-topbar btn-ghost-secondary rounded-circle vth-logout-btn">
                                    <i className="bx bx-log-out fs-22"></i>
                                </button>
                            </div>

                            {/* Faint divider before the profile (matches horizontal header) */}
                            <span className="vth-sep d-none d-sm-block" />

                            {/* ProfileDropdown */}
                            <ProfileDropdown />
                        </div>
                    </div>
                </div>
            </header>
        </React.Fragment>
    );
};

export default Header;