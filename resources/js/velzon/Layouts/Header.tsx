import React, { useState } from 'react';
import { Link } from 'react-router-dom';
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
import BranchSwitcher from '../../components/BranchSwitcher';
import { useAuth } from '../../contexts/AuthContext';

import { changeSidebarVisibility } from '../slices/thunks';
import { useSelector, useDispatch } from "react-redux";
import { createSelector } from 'reselect';

const Header = ({ onChangeLayoutMode, layoutModeType, headerClass } : any) => {
    const dispatch : any = useDispatch();
    // Tenant brand-color toggle. The button only appears when the logged-in
    // user actually has tenant colors (otherwise toggling is a no-op).
    const { user, tenantThemeEnabled, toggleTenantTheme } = useAuth();
    const hasTenantColors = !!(user?.primary_color || user?.secondary_color);
    // Header's `horizontal-logo` block shows the brand mark in horizontal /
    // twocolumn layouts (where the sidebar is hidden / collapsed). Use the
    // same fallback chain as Sidebar.tsx so a tenant's logo replaces the
    // static IGC defaults whenever it's available.
    const tenantLogo = user?.branch_logo || user?.client_logo || null;
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
            <header id="page-topbar" className={headerClass}>
                <div className="layout-width">
                    <div className="navbar-header">
                        <div className="d-flex">

                            <div className="navbar-brand-box horizontal-logo align-self-center">
                                <Link to="/" className="logo logo-dark">
                                    <span className="logo-sm">
                                        <img src={headerLogoSm} alt="" style={{ height: '50px', width: 'auto', objectFit: 'contain' }} />
                                    </span>
                                    <span className="logo-lg">
                                        <img src={headerLogoDark} alt="" style={{ height: '50px', width: 'auto', objectFit: 'contain' }} />
                                    </span>
                                </Link>

                                <Link to="/" className="logo logo-light">
                                    <span className="logo-sm">
                                        <img src={headerLogoSm} alt="" style={{ height: '50px', width: 'auto', objectFit: 'contain' }} />
                                    </span>
                                    <span className="logo-lg">
                                        <img src={headerLogoLight} alt="" style={{ height: '50px', width: 'auto', objectFit: 'contain' }} />
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

                        <div className="d-flex align-items-center">

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

                            {/* Branch Switcher (visible to main-branch users & client admins) */}
                            <div className="ms-1 header-item d-flex align-items-center">
                                <BranchSwitcher />
                            </div>

                            {/* FullScreenDropdown */}
                            <FullScreenDropdown />

                            {/* Tenant brand-color toggle — labeled pill, always visible when tenant has colors */}
                            {hasTenantColors && (
                                <div className="ms-2 me-1 header-item d-flex align-items-center">
                                    <button
                                        type="button"
                                        onClick={toggleTenantTheme}
                                        title={tenantThemeEnabled ? 'Click to switch to default theme' : 'Click to switch to brand theme'}
                                        aria-pressed={tenantThemeEnabled}
                                        className="btn btn-sm d-inline-flex align-items-center gap-2"
                                        style={{
                                            border: '1px solid rgba(255,255,255,0.35)',
                                            background: tenantThemeEnabled ? 'rgba(255,255,255,0.12)' : 'transparent',
                                            color: 'inherit',
                                            borderRadius: 999,
                                            padding: '4px 10px',
                                            fontSize: 12,
                                            fontWeight: 600,
                                            lineHeight: 1.2,
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {/* Color swatches show what the brand looks like */}
                                        <span className="d-inline-flex" style={{ gap: 2 }}>
                                            <span style={{
                                                width: 10, height: 10, borderRadius: '50%',
                                                background: user?.primary_color || '#cbd5e1',
                                                border: '1px solid rgba(255,255,255,0.6)',
                                                display: 'inline-block',
                                            }} />
                                            <span style={{
                                                width: 10, height: 10, borderRadius: '50%',
                                                background: user?.secondary_color || '#cbd5e1',
                                                border: '1px solid rgba(255,255,255,0.6)',
                                                display: 'inline-block',
                                            }} />
                                        </span>
                                        <span>{tenantThemeEnabled ? 'Brand' : 'Default'}</span>
                                        <i className={`bx ${tenantThemeEnabled ? 'bx-toggle-right' : 'bx-toggle-left'}`} style={{ fontSize: 18 }} />
                                    </button>
                                </div>
                            )}

                            {/* Dark/Light Mode set */}
                            <LightDark
                                layoutMode={layoutModeType}
                                onChangeLayoutMode={onChangeLayoutMode}
                            />

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