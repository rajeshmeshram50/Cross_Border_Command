import React, { useEffect, useState } from 'react';
import PropTypes from "prop-types";
import { Link } from 'react-router-dom';
import { Col, Row } from 'reactstrap';
import withRouter from '../../Components/Common/withRouter';

// Import Data
import navdata from "../LayoutMenuData";
import { closeAllMenus, subscribeMenu } from "../menuState";
//i18n
import { withTranslation } from "react-i18next";

// We deliberately omit Bootstrap's `.collapse` class on these dropdowns.
// In this build, having `collapse` on the wrapper kept the menu hidden even
// when `.show` was present; dropping it lets Velzon's
// `[data-layout="..."] .menu-dropdown.show { display: block }` rule drive
// visibility cleanly. Closed dropdowns are simply not rendered, which
// guarantees they're invisible without depending on any CSS reset.
const dropdownClass = (extra = "") =>
    `menu-dropdown show${extra ? " " + extra : ""}`;

const HorizontalLayout = (props : any) => {
    const [isMoreMenu, setIsMoreMenu] = useState(false);
    // Tracks which HR category strip is currently expanded. Single-select:
    // clicking a different category swaps the visible leaf row; clicking the
    // same one collapses it back to just the strip.
    const [openHrCat, setOpenHrCat] = useState<string | null>(null);
    // Re-render whenever any sidebar dropdown is toggled. Open/closed state
    // lives in a module-level Set (see ../menuState.ts); without this the
    // layout never sees toggleMenu() updates and the Collapse stays stale.
    const [, setTick] = useState(0);
    useEffect(() => subscribeMenu(() => setTick((t) => t + 1)), []);

    // Single helper: collapse every open menu surface (sidebar dropdown set
    // + the local horizontal-layout state). Used by the outside-click
    // handler, the path-change effect, AND the leaf-click handler so the
    // mega-menu always closes when navigation happens.
    const collapseAllNavMenus = React.useCallback(() => {
        closeAllMenus();
        setOpenHrCat(null);
        setIsMoreMenu(false);
    }, []);

    // Close any open dropdown when the user clicks anywhere outside the
    // navbar. mousedown (rather than click) so we react before the focus/blur
    // shuffle, and `closest` so a click on a child element inside the navbar
    // still counts as "inside".
    useEffect(() => {
        const handleOutside = (e: MouseEvent) => {
            const target = e.target as HTMLElement | null;
            if (target && !target.closest("#navbar-nav")) collapseAllNavMenus();
        };
        document.addEventListener("mousedown", handleOutside);
        return () => document.removeEventListener("mousedown", handleOutside);
    }, [collapseAllNavMenus]);

    const navData = navdata().props.children;
    let menuItems = [];
    let splitMenuItems : Array<any> = [];
    let menuSplitContainer = 6;
    navData.forEach(function (value : any, key : number) {
        if (value['isHeader']) {
            menuSplitContainer++;
        }
        if (key >= menuSplitContainer) {
            let val = value;
            val.childItems = value.subItems;
            val.isChildItem = (value.subItems) ? true : false;
            delete val.subItems;
            splitMenuItems.push(val);
        } else {
            menuItems.push(value);
        }
    });
    menuItems.push({ id: 'more', label: 'More', icon: 'ri-briefcase-2-line', link: "/#", stateVariables: isMoreMenu, subItems: splitMenuItems, click: function (e : any) { e.preventDefault(); setIsMoreMenu(!isMoreMenu); }, });

    const path = props.router.location.pathname;

    useEffect(() => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        // Path changed — collapse every open menu surface so the navbar
        // resets to its default closed state on each navigation. Without
        // this, clicking HR Core → Employee leaves the HR mega-menu and the
        // active category strip both expanded over the new page.
        collapseAllNavMenus();
        const initMenu = () => {
            const pathName = process.env.PUBLIC_URL + path;
            const ul = document.getElementById("navbar-nav") as HTMLElement;
            const items : any = ul.getElementsByTagName("a");
            let itemsArray = [...items]; // converts NodeList to Array
            removeActivation(itemsArray);
            let matchingMenuItem = itemsArray.find((x) => {
                return x.pathname === pathName;
            });
            if (matchingMenuItem) {
                activateParentDropdown(matchingMenuItem);
            }
        };
        initMenu();
    }, [path, props.layoutType]);

    function activateParentDropdown(item : any) {
        item.classList.add("active");
        let parentCollapseDiv = item.closest(".collapse.menu-dropdown");

        if (parentCollapseDiv) {

            // to set aria expand true remaining
            parentCollapseDiv.classList.add("show");
            parentCollapseDiv.parentElement.children[0].classList.add("active");
            parentCollapseDiv.parentElement.children[0].setAttribute("aria-expanded", "true");
            if (parentCollapseDiv.parentElement.closest(".collapse.menu-dropdown")) {
                parentCollapseDiv.parentElement.closest(".collapse").classList.add("show");
                var parentElementDiv = parentCollapseDiv.parentElement.closest(".collapse").previousElementSibling;
                if (parentElementDiv)
                    if (parentElementDiv.closest(".collapse"))
                        parentElementDiv.closest(".collapse").classList.add("show");
                parentElementDiv.classList.add("active");
                var parentElementSibling = parentElementDiv.parentElement.parentElement.parentElement.previousElementSibling;
                if (parentElementSibling) {
                    parentElementSibling.classList.add("active");
                }
            }
            return false;
        }
        return false;
    }

    const removeActivation = (items : any) => {
        let activeItems = items.filter((x : any) => x.classList.contains("active"));

        activeItems.forEach((item : any) => {
            if (item.classList.contains("menu-link")) {
                if (!item.classList.contains("active")) {
                    item.setAttribute("aria-expanded", false);
                }
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
    };

    return (
        <React.Fragment>
            {(menuItems || []).map((item  :any, key : number) => {
                return (
                    <React.Fragment key={key}>
                        {/* Main Header */}
                        {!item['isHeader'] ?
                            (item.subItems ? (
                                <li className="nav-item">
                                    <Link
                                        onClick={item.click}
                                        className="nav-link menu-link"
                                        to={item.link ? item.link : "/#"}
                                        aria-expanded={item.stateVariables}
                                    >
                                        <i className={item.icon}></i> <span data-key="t-apps">{props.t(item.label)}</span>
                                    </Link>
                                    {item.stateVariables && (
                                    <div
                                        className={dropdownClass(
                                            (item.id === "baseUi" && item.subItems.length > 13) ||
                                            item.id === "hr" || item.id === "more"
                                                ? "mega-dropdown-menu hr-mega-menu"
                                                : ""
                                        )}
                                        id={item.id}>
                                        {/* Horizontal mega-menu used for both HR and More.
                                            Strip rendering supports a mix of:
                                              • category buttons (isChildItem with childItems) — click
                                                expands the category's leaves in a horizontal row below
                                              • plain links — direct navigation, no expand
                                            Only one category is expanded at a time. */}
                                        {(item.id === "hr" || item.id === "more") ? (
                                            (() => {
                                                const items = item.subItems || [];
                                                const activeCat = items.find((c: any) => c.isChildItem && c.id === openHrCat) || null;
                                                return (
                                                    <div className="hr-mega-wrap">
                                                        <div className="hr-mega-cats">
                                                            {items.map((entry: any, ei: number) => (
                                                                entry.isChildItem ? (
                                                                    <button
                                                                        key={ei}
                                                                        type="button"
                                                                        className={`hr-mega-cat-btn${openHrCat === entry.id ? ' is-active' : ''}`}
                                                                        onClick={() => setOpenHrCat(prev => prev === entry.id ? null : entry.id)}
                                                                    >
                                                                        {props.t(entry.label)}
                                                                        <i className="ri-arrow-down-s-line hr-mega-cat-caret" />
                                                                    </button>
                                                                ) : (
                                                                    <Link
                                                                        key={ei}
                                                                        to={entry.link ? entry.link : "/#"}
                                                                        className="hr-mega-cat-btn is-link"
                                                                        onClick={collapseAllNavMenus}
                                                                    >
                                                                        {props.t(entry.label)}
                                                                    </Link>
                                                                )
                                                            ))}
                                                        </div>
                                                        {activeCat && (
                                                            <div className="hr-mega-leaves">
                                                                {(activeCat.childItems || []).map((leaf: any, li: number) => (
                                                                    <Link
                                                                        key={li}
                                                                        to={leaf.link ? leaf.link : "/#"}
                                                                        className="hr-mega-leaf-link"
                                                                        onClick={collapseAllNavMenus}
                                                                    >
                                                                        {props.t(leaf.label)}
                                                                    </Link>
                                                                ))}
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })()
                                        ) : item.id === "baseUi" && item.subItems.length > 13 ? (
                                            <React.Fragment>
                                                <Row>
                                                    {item.subItems && ((item.subItems || []).map((subItem : any, key : number) => (
                                                        <React.Fragment key={key}>
                                                            {key % 2 === 0 ? (
                                                                <Col lg={4}>
                                                                    <ul className="nav nav-sm flex-column">
                                                                        <li className="nav-item">
                                                                            <Link to={item.subItems[key].link} className="nav-link">{item.subItems[key].label}</Link>
                                                                        </li>
                                                                    </ul>
                                                                </Col>
                                                            ) : (
                                                                <Col lg={4}>
                                                                    <ul className="nav nav-sm flex-column">
                                                                        <li className="nav-item">
                                                                            <Link to={item.subItems[key].link} className="nav-link">{item.subItems[key].label}</Link>
                                                                        </li>
                                                                    </ul>
                                                                </Col>
                                                            )
                                                            }
                                                        </React.Fragment>
                                                    ))
                                                    )}
                                                </Row>
                                            </React.Fragment>
                                        ) : (
                                            <ul className="nav nav-sm flex-column">
                                                {item.subItems && ((item.subItems || []).map((subItem  : any, key : number) => (
                                                    <React.Fragment key={key}>
                                                        {!subItem.isChildItem ? (
                                                            <li className="nav-item">
                                                                <Link
                                                                    to={subItem.link ? subItem.link : "/#"}
                                                                    className="nav-link"
                                                                >
                                                                    {props.t(subItem.label)}
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
                                                                </Link>
                                                                {subItem.stateVariables && (
                                                                <div className={dropdownClass()} id={subItem.id}>
                                                                    <ul className="nav nav-sm flex-column">
                                                                        {/* child subItems  */}
                                                                        {subItem.childItems && (
                                                                            (subItem.childItems || []).map((subChildItem : any, key : number) => (
                                                                                <React.Fragment key={key}>
                                                                                    {!subChildItem.isChildItem ? (
                                                                                        <li className="nav-item">
                                                                                            <Link
                                                                                                to={subChildItem.link ? subChildItem.link : "/#"}
                                                                                                className="nav-link"
                                                                                            >
                                                                                                {props.t(subChildItem.label)}
                                                                                            </Link>
                                                                                        </li>
                                                                                    ) : (
                                                                                        <li className="nav-item">
                                                                                            <Link
                                                                                                onClick={subChildItem.click}
                                                                                                className="nav-link"
                                                                                                to="/#"
                                                                                                aria-expanded={subChildItem.stateVariables}
                                                                                            > {props.t(subChildItem.label)}
                                                                                            </Link>
                                                                                            {subChildItem.stateVariables && (
                                                                                            <div className={dropdownClass()} id={subChildItem.id}>
                                                                                                <ul className="nav nav-sm flex-column">
                                                                                                    {/* child subItems  */}
                                                                                                    {subChildItem.childItems && (
                                                                                                        (subChildItem.childItems || []).map((subSubChildItem : any, key : number) => (
                                                                                                            <li className="nav-item apex" key={key}>
                                                                                                                <Link
                                                                                                                    to={subSubChildItem.link ? subSubChildItem.link : "/#"}
                                                                                                                    className="nav-link"
                                                                                                                >
                                                                                                                    {props.t(subSubChildItem.label)}
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
                                        )}
                                    </div>
                                    )}
                                </li>
                            ) : (
                                <li className="nav-item">
                                    <Link
                                        className="nav-link menu-link"
                                        to={item.link ? item.link : "/#"}>
                                        <i className={item.icon}></i> <span>{props.t(item.label)}</span>
                                    </Link>
                                </li>
                            ))
                            : (<li className="menu-title"><span data-key="t-menu">{props.t(item.label)}</span></li>)}
                    </React.Fragment>
                );
            })}
            {/* menu Items */}
        </React.Fragment >
    );
};

HorizontalLayout.propTypes = {
    location: PropTypes.object,
    t: PropTypes.any,
};

export default withRouter(withTranslation()(HorizontalLayout));