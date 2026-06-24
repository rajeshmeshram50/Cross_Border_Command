import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from "prop-types";
import { Container } from 'reactstrap';
import withRouter from '../../Components/Common/withRouter';

// Same bundled fallback as Sidebar.tsx so the brand image is identical
// across Vertical / Horizontal / Two-Column layouts when the tenant
// hasn't uploaded their own logo. Previously two-column shipped a
// different small mark, which made switching layouts look like the
// app's branding had changed.
import brandFallback from "../../assets/images/igc-logo.png";
//i18n
import { withTranslation } from "react-i18next";

// Import Data
import navdata from "../LayoutMenuData";
import { closeAllMenus, subscribeMenu } from "../menuState";
import VerticalLayout from "../VerticalLayouts";
// Same logo-resolution chain as the vertical Sidebar: branch logo
// (for branch users) > client logo > bundled fallback. Without this
// the two-column layout always rendered the generic IGC mark, even
// when the tenant had uploaded a branded logo elsewhere.
import { useAuth } from "../../../contexts/AuthContext";
import { resolveFileUrl } from "../../../utils/resolveFileUrl";
// Tooltip on each icon in the narrow rail — the icon column has no
// space for labels, so users couldn't tell what each icon does
// without clicking it. The canonical dark-pill Tooltip used across
// the app surfaces the menu label on hover.
import Tooltip from "../../../components/ui/Tooltip";

//SimpleBar
import SimpleBar from "simplebar-react";

const TwoColumnLayout = (props: any) => {
    // Re-render whenever any sidebar dropdown is toggled. Open/closed state
    // lives in a module-level Set (see ../menuState.ts); without this the
    // layout never sees toggleMenu() updates and the Collapse stays stale.
    const [, setTick] = useState(0);
    useEffect(() => subscribeMenu(() => setTick((t) => t + 1)), []);

    // Tenant-aware logo for the narrow icon column. Mirrors Sidebar.tsx:
    // branch logo wins for branch users, then client logo, then bundled
    // fallback. The previous hardcoded logoSm meant Two-Column users
    // always saw the generic IGC mark even after their tenant uploaded
    // a brand logo.
    const { user } = useAuth();
    const rawTenantLogo = user?.branch_logo || user?.client_logo || null;
    const tenantLogo = rawTenantLogo ? resolveFileUrl(rawTenantLogo) : null;
    const brandLogo = tenantLogo || brandFallback;

    // Close any open dropdown when the user clicks outside the menu column.
    useEffect(() => {
        const handleOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && !target.closest("#navbar-nav")) closeAllMenus();
        };
        document.addEventListener("mousedown", handleOutside);
        return () => document.removeEventListener("mousedown", handleOutside);
    }, []);

    const navData = navdata().props.children;
    const activateParentDropdown = useCallback((item: any) => {
        item.classList.add("active");
        let parentCollapseDiv = item.closest(".collapse.menu-dropdown");
        if (parentCollapseDiv) {
            // to set aria expand true remaining
            parentCollapseDiv.classList.add("show");
            parentCollapseDiv.parentElement.children[0].classList.add("active");
            parentCollapseDiv.parentElement.children[0].setAttribute("aria-expanded", "true");
            if (parentCollapseDiv.parentElement.closest(".collapse.menu-dropdown")) {
                parentCollapseDiv.parentElement.closest(".collapse").classList.add("show");
                const parentParentCollapse = parentCollapseDiv.parentElement.closest(".collapse").previousElementSibling;
                if (parentParentCollapse) {
                    parentParentCollapse.classList.add("active");
                    if (parentParentCollapse.closest(".collapse.menu-dropdown")) {
                        parentParentCollapse.closest(".collapse.menu-dropdown").classList.add("show");
                    }
                }
            }
            activateIconSidebarActive(parentCollapseDiv.getAttribute("id"));
            return false;
        }
        return false;
    }, []);

    const path = props.router.location.pathname;

    const initMenu = useCallback(() => {
        const pathName = process.env.PUBLIC_URL + path;
        const ul = document.getElementById("navbar-nav") as HTMLElement;
        const items: any = ul.getElementsByTagName("a");
        let itemsArray = [...items]; // converts NodeList to Array
        removeActivation(itemsArray);
        let matchingMenuItem = itemsArray.find((x) => {
            return x.pathname === pathName;
        });
        if (matchingMenuItem) {
            activateParentDropdown(matchingMenuItem);
        } else {
            if (process.env.PUBLIC_URL) {
                var id = pathName.replace(process.env.PUBLIC_URL, '');
                id = id.replace("/", "");
            } else {
                id = pathName.replace("/", "");
            }
            // NOTE: previously this auto-added the 'twocolumn-panel' body class
            // (which collapses the whole label panel) whenever the route had no
            // exact menu match. With the Bold Icon Strip design the panel now
            // shows the full top-level menu persistently, so auto-collapsing it
            // on deep routes would wrongly hide the menu. Collapse stays a
            // manual action via the Header hamburger toggle.
            activateIconSidebarActive(id);
        }
    }, [path, activateParentDropdown]);

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        initMenu();
    }, [path, initMenu]);

    function activateIconSidebarActive(id: any) {
        var menu = document.querySelector("#two-column-menu .simplebar-content-wrapper a[sub-items='" + id + "'].nav-icon");
        if (menu !== null) {
            menu.classList.add("active");
        }
    }

    const removeActivation = (items: any) => {
        let activeItems = items.filter((x: any) => x.classList.contains("active"));
        activeItems.forEach((item: any) => {
            if (item.classList.contains("menu-link")) {
                if (!item.classList.contains("active")) {
                    item.setAttribute("aria-expanded", false);
                }
                // The full menu now includes top-level links with no dropdown
                // sibling (Dashboard, GTS, Inventory, …) — guard against null
                // so removeActivation doesn't crash on them.
                if (item.nextElementSibling) {
                    item.nextElementSibling.classList.remove("show");
                }
            }
            if (item.classList.contains("nav-link")) {
                if (item.nextElementSibling) {
                    item.nextElementSibling.classList.remove("show");
                }
                item.setAttribute("aria-expanded", false);
            }
            item.classList.remove("active");
        });

        const ul = document.getElementById("two-column-menu") as HTMLElement;
        const iconItems: any = ul.getElementsByTagName("a");
        let itemsArray = [...iconItems];
        let activeIconItems = itemsArray.filter((x) => x.classList.contains("active"));
        activeIconItems.forEach((item) => {
            item.classList.remove("active");
            var id = item.getAttribute("sub-items");
            var getId = document.getElementById(id) as HTMLElement;
            if (getId)
                getId.classList.remove("show");
        });
    };

    // Resize sidebar
    const [isMenu, setIsMenu] = useState("twocolumn");
    const windowResizeHover = () => {
        initMenu();
        var windowSize = document.documentElement.clientWidth;
        if (windowSize < 767) {
            document.documentElement.setAttribute("data-layout", "vertical");
            setIsMenu('vertical');
        }
        else {
            document.documentElement.setAttribute("data-layout", "twocolumn");
            setIsMenu('twocolumn');
        }
    };

    useEffect(function setupListener() {
        if (props.layoutType === 'twocolumn') {
            window.addEventListener('resize', windowResizeHover);

            // remove classname when component will unmount
            return function cleanupListener() {
                window.removeEventListener('resize', windowResizeHover);
            };
        }
    });
    return (
        <React.Fragment>
            {isMenu === "twocolumn" ?
                <div id="scrollbar">
                    <Container fluid>
                        <div id="two-column-menu">
                            <SimpleBar className="twocolumn-iconview">
                                <Link to="#" className="logo">
                                    <img src={brandLogo} alt="" style={{ height: '22px', maxWidth: '100%', width: 'auto', objectFit: 'contain' }} />
                                </Link>
                                {(navData || []).map((item: any, key: number) => (
                                    <React.Fragment key={key}>
                                        {item.icon && (
                                            item.subItems ? (
                                                <li>
                                                    <Tooltip label={item.label} position="right">
                                                        <Link
                                                            onClick={item.click}
                                                            to="#"
                                                            sub-items={item.id}
                                                            aria-label={item.label}
                                                            className="nav-icon">
                                                            <i className={item.icon}></i>
                                                        </Link>
                                                    </Tooltip>
                                                </li>

                                            ) : (
                                                <>
                                                    <Tooltip label={item.label} position="right">
                                                        <Link
                                                            onClick={item.click}
                                                            to={item.link ? item.link : "/#"}
                                                            sub-items={item.id}
                                                            aria-label={item.label}
                                                            className="nav-icon">
                                                            <i className={item.icon}></i>
                                                        </Link>
                                                    </Tooltip>
                                                </>
                                            )
                                        )}
                                    </React.Fragment>
                                ))}

                            </SimpleBar>
                        </div>
                        {/* White label panel (Bold Icon Strip design): the full
                            top-level menu — icon tile + label + expandable
                            dropdowns — rendered beside the violet icon rail.
                            Previously this only rendered the active icon's
                            sub-items, so the panel sat empty until you drilled
                            in. VerticalLayout gives the complete menu and is the
                            same renderer the mobile fallback below uses. */}
                        <SimpleBar id="navbar-nav" className="navbar-nav">
                            <ul className="navbar-nav-list">
                                <VerticalLayout />
                            </ul>
                        </SimpleBar>
                    </Container>
                </div>
                :
                <SimpleBar id="scrollbar" className="h-100">
                    <Container fluid>
                        <div id="two-column-menu"></div>
                        <ul className="navbar-nav" id="navbar-nav">
                            <VerticalLayout />
                        </ul>
                    </Container>
                </SimpleBar>
            }
        </React.Fragment >
    );
};

TwoColumnLayout.propTypes = {
    location: PropTypes.object,
    t: PropTypes.any,
};

export default withRouter(withTranslation()(TwoColumnLayout));