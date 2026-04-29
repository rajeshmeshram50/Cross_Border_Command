import React, { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import PropTypes from "prop-types";
import { Container } from 'reactstrap';
import withRouter from '../../Components/Common/withRouter';

import logoSm from "../../assets/images/logo-sm.png";
//i18n
import { withTranslation } from "react-i18next";

// Import Data
import navdata from "../LayoutMenuData";
import { closeAllMenus, subscribeMenu } from "../menuState";
import VerticalLayout from "../VerticalLayouts";

//SimpleBar
import SimpleBar from "simplebar-react";

// See VerticalLayouts/index.tsx for rationale: only render dropdowns when
// open, omit the `.collapse` class, and let Velzon's `.menu-dropdown.show`
// rule drive visibility.
const dropdownClass = () => "menu-dropdown show";

const TwoColumnLayout = (props: any) => {
    // Re-render whenever any sidebar dropdown is toggled. Open/closed state
    // lives in a module-level Set (see ../menuState.ts); without this the
    // layout never sees toggleMenu() updates and the Collapse stays stale.
    const [, setTick] = useState(0);
    useEffect(() => subscribeMenu(() => setTick((t) => t + 1)), []);

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
            if (id) document.body.classList.add('twocolumn-panel');
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
                item.nextElementSibling.classList.remove("show");
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
                                    <img src={logoSm} alt="" height="22" />
                                </Link>
                                {(navData || []).map((item: any, key: number) => (
                                    <React.Fragment key={key}>
                                        {item.icon && (
                                            item.subItems ? (
                                                <li>
                                                    <Link
                                                        onClick={item.click}
                                                        to="#"
                                                        sub-items={item.id}
                                                        className="nav-icon">
                                                        <i className={item.icon}></i>
                                                    </Link>
                                                </li>

                                            ) : (
                                                <>
                                                    <Link
                                                        onClick={item.click}
                                                        to={item.link ? item.link : "/#"}
                                                        sub-items={item.id}
                                                        className="nav-icon">
                                                        <i className={item.icon}></i>
                                                    </Link>
                                                </>
                                            )
                                        )}
                                    </React.Fragment>
                                ))}

                            </SimpleBar>
                        </div>
                        <SimpleBar id="navbar-nav" className="navbar-nav">
                            {(navData || []).map((item: any, key: number) => (
                                <React.Fragment key={key}>
                                    {item.subItems ? (
                                        <li className="nav-item">
                                            {item.stateVariables && (
                                            <div
                                                className={dropdownClass()}
                                                id={item.id}>
                                                <ul className="nav nav-sm flex-column">
                                                    {/* subItems  */}
                                                    {item.subItems && ((item.subItems || []).map((subItem: any, key: number) => (
                                                        <React.Fragment key={key}>
                                                            {!subItem.isChildItem ? (
                                                                <li className="nav-item">
                                                                    <Link
                                                                        to={subItem.link ? subItem.link : "/#"}
                                                                        className="nav-link"
                                                                    >
                                                                        {props.t(subItem.label)}
                                                                        {subItem.badgeName ?
                                                                            <span className={"badge badge-pill bg-" + subItem.badgeColor} data-key="t-new">{subItem.badgeName}</span>
                                                                            : null}
                                                                    </Link>
                                                                </li>
                                                            ) : (
                                                                <li className="nav-item">
                                                                    <Link
                                                                        onClick={subItem.click}
                                                                        className="nav-link"
                                                                        to="/#"
                                                                        aria-expanded={subItem.stateVariables}
                                                                    > {props.t(subItem.label)}
                                                                        {subItem.badgeName ?
                                                                            <span className={"badge badge-pill bg-" + subItem.badgeColor} data-key="t-new">{subItem.badgeName}</span>
                                                                            : null}
                                                                    </Link>
                                                                    {subItem.stateVariables && (
                                                                    <div className={dropdownClass()} id={subItem.id}>
                                                                        <ul className="nav nav-sm flex-column">
                                                                            {/* child subItems  */}
                                                                            {subItem.childItems && (
                                                                                (subItem.childItems || []).map((childItem: any, key: number) => (
                                                                                    <React.Fragment key={key}>
                                                                                        {!childItem.isChildItem ? (
                                                                                            <li className="nav-item">
                                                                                                <Link
                                                                                                    to={childItem.link ? childItem.link : "/#"}
                                                                                                    className="nav-link"
                                                                                                >
                                                                                                    {props.t(childItem.label)}
                                                                                                </Link>
                                                                                            </li>
                                                                                        ) : (
                                                                                            <li className="nav-item" key={key}>
                                                                                                <Link
                                                                                                    to={childItem.link ? childItem.link : "/#"}
                                                                                                    onClick={childItem.click}
                                                                                                    aria-expanded={childItem.stateVariables}
                                                                                                    className="nav-link" >
                                                                                                    {props.t(childItem.label)}
                                                                                                </Link>
                                                                                                {childItem.stateVariables && (
                                                                                                <div className={dropdownClass()} id={childItem.id}>
                                                                                                    <ul className="nav nav-sm flex-column">
                                                                                                        {/* child subChildItems  */}
                                                                                                        {childItem.isChildItem && (
                                                                                                            (childItem.childItems || []).map((childItem: any, key: number) => (
                                                                                                                <li className="nav-item" key={key} >
                                                                                                                    <Link
                                                                                                                        to={childItem.link ? childItem.link : "/#"}
                                                                                                                        className="nav-link">
                                                                                                                        {props.t(childItem.label)}
                                                                                                                    </Link>
                                                                                                                </li>
                                                                                                            ))
                                                                                                        )}
                                                                                                    </ul>
                                                                                                </div>
                                                                                                )}
                                                                                            </li>
                                                                                        )}
                                                                                    </React.Fragment>
                                                                                ))
                                                                            )}
                                                                        </ul>
                                                                    </div>
                                                                    )}
                                                                </li>
                                                            )}
                                                        </React.Fragment>
                                                    ))
                                                    )}
                                                </ul>

                                            </div>
                                            )}
                                        </li>
                                    ) : null
                                    }
                                </React.Fragment>
                            ))}
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