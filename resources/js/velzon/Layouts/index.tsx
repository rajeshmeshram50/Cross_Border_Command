import React, { useEffect, useState } from 'react';
import PropTypes from "prop-types";
import withRouter from '../Components/Common/withRouter';

//import Components
import Header from './Header';
import Sidebar from './Sidebar';
import IdimsHeader from './IdimsHeader';
import Footer from './Footer';
import RightSidebar from '../Components/Common/RightSidebar';

//import actions
import {
    changeLayout,
    changeSidebarTheme,
    changeLayoutMode,
    changeLayoutWidth,
    changeLayoutPosition,
    changeTopbarTheme,
    changeLeftsidebarSizeType,
    changeLeftsidebarViewType,
    changeSidebarImageType,
    changeSidebarVisibility
} from "../slices/thunks";

//redux
import { useSelector, useDispatch } from "react-redux";
import { createSelector } from 'reselect';

const Layout = (props : any) => {
    const [headerClass, setHeaderClass] = useState("");
    const dispatch : any = useDispatch();

    const selectLayoutState = (state : any) => state.Layout;
    const selectLayoutProperties = createSelector(
        selectLayoutState,
        (layout) => ({
            layoutType: layout.layoutType,
            leftSidebarType: layout.leftSidebarType,
            layoutModeType: layout.layoutModeType,
            layoutWidthType: layout.layoutWidthType,
            layoutPositionType: layout.layoutPositionType,
            topbarThemeType: layout.topbarThemeType,
            leftsidbarSizeType: layout.leftsidbarSizeType,
            leftSidebarViewType: layout.leftSidebarViewType,
            leftSidebarImageType: layout.leftSidebarImageType,
            preloader: layout.preloader,
            sidebarVisibilitytype: layout.sidebarVisibilitytype,
        })
    );
    // Inside your component
    const {
        layoutType,
        leftSidebarType,
        layoutModeType,
        layoutWidthType,
        layoutPositionType,
        topbarThemeType,
        leftsidbarSizeType,
        leftSidebarViewType,
        leftSidebarImageType,
        sidebarVisibilitytype
    } = useSelector(selectLayoutProperties);

    /*
    layout settings
    */
    useEffect(() => {
        if (
            layoutType ||
            leftSidebarType ||
            layoutModeType ||
            layoutWidthType ||
            layoutPositionType ||
            topbarThemeType ||
            leftsidbarSizeType ||
            leftSidebarViewType ||
            leftSidebarImageType ||
            sidebarVisibilitytype
        ) {
            window.dispatchEvent(new Event('resize'));
            dispatch(changeLeftsidebarViewType(leftSidebarViewType));
            dispatch(changeLeftsidebarSizeType(leftsidbarSizeType));
            dispatch(changeSidebarTheme(leftSidebarType));
            dispatch(changeLayoutMode(layoutModeType));
            dispatch(changeLayoutWidth(layoutWidthType));
            dispatch(changeLayoutPosition(layoutPositionType));
            dispatch(changeTopbarTheme(topbarThemeType));
            dispatch(changeLayout(layoutType));
            dispatch(changeSidebarImageType(leftSidebarImageType));
            dispatch(changeSidebarVisibility(sidebarVisibilitytype));
        }
    // NOTE: layoutModeType is intentionally OMITTED from the deps below. A pure
    // dark/light toggle already applies `data-bs-theme` directly via
    // onChangeLayoutMode → changeLayoutMode, so re-running this whole effect
    // (which fires a synthetic window `resize` + re-dispatches all 10 layout
    // thunks) on every theme switch just forces a full-page reflow — the
    // flash/shake QA reported. Structural changes (sidebar size, layout
    // width/type, etc.) still fire the effect and pick up the current mode via
    // the live closure.
    }, [layoutType,
        leftSidebarType,
        layoutWidthType,
        layoutPositionType,
        topbarThemeType,
        leftsidbarSizeType,
        leftSidebarViewType,
        leftSidebarImageType,
        sidebarVisibilitytype,
        dispatch]);
    /*
    call dark/light mode
    */
    const onChangeLayoutMode = (value : any) => {
        if (changeLayoutMode) {
            dispatch(changeLayoutMode(value));
        }
    };

    // class add remove in header 
    useEffect(() => {
        window.addEventListener("scroll", scrollNavigation, true);
    });

    function scrollNavigation() {
        var scrollup = document.documentElement.scrollTop;
        if (scrollup > 50) {
            setHeaderClass("topbar-shadow");
        } else {
            setHeaderClass("");
        }
    }

    useEffect(() => {
        // The IDIMS horizontal header has no .hamburger-icon, so this query is
        // null in horizontal mode — guard before touching classList.
        const humberIcon = document.querySelector(".hamburger-icon") as HTMLElement | null;
        if (!humberIcon) return;
        if (sidebarVisibilitytype === 'show' || layoutType === "vertical" || layoutType === "twocolumn") {
            humberIcon.classList.remove('open');
        } else {
            humberIcon.classList.add('open');
        }
    }, [sidebarVisibilitytype, layoutType]);

    // Horizontal layout uses the ported IDIMS two-row header (logo + search +
    // branch switcher + controls on top, nav items below). It fully replaces
    // the stock Velzon Header + horizontal Sidebar nav. The `idims-active`
    // class neutralises the Velzon topbar/sidebar offsets on .main-content so
    // the page content flows directly under the sticky header.
    if (layoutType === 'horizontal') {
        return (
            <React.Fragment>
                {/* Fixed header + fixed footer, single scroll BETWEEN them: the
                    wrapper fills the viewport and does not scroll; the header and
                    footer keep their natural height and sit outside the scroller,
                    so only .main-content moves. That gives exactly one scrollbar
                    (no double scroll), starting below the navbar.

                    Height is 100dvh, not 100vh, and that matters: 100vh is the
                    LARGEST viewport, ignoring browser UI, so on a browser whose
                    chrome is taller (Edge's tab strip + address bar + sidebar
                    stack vs Chrome's) the wrapper ends up taller than the visible
                    area. The body then gets its own scrollbar and the whole
                    shell — header included — scrolls away. 100dvh tracks the
                    actual visible viewport, so the frame stays put in every
                    browser. The `overflow: hidden` here is what stops any inner
                    content pushing the document itself. */}
                <div id="layout-wrapper" className="idims-active" style={{ display: 'flex', flexDirection: 'column', height: '100dvh', overflow: 'hidden' }}>
                    <style>{'.idims-active .main-content{margin-left:0!important;margin-top:0!important;padding-top:0!important;}.idims-active .page-content{margin-top:0!important;padding-top:1rem!important;}.idims-active > .footer{position:static!important;left:0!important;right:0!important;flex-shrink:0;}'}</style>
                    <IdimsHeader />
                    <div className="main-content" style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'hidden' }}>
                        {props.children}
                    </div>
                    {/* Sibling of the scroller, not a child — otherwise it rides
                        along with the page content instead of pinning to the
                        bottom of the frame. */}
                    <Footer />
                </div>
                <RightSidebar />
            </React.Fragment>
        );
    }

    return (
        <React.Fragment>
            <div id="layout-wrapper">
                <Header
                    headerClass={headerClass}
                    layoutModeType={layoutModeType}
                    onChangeLayoutMode={onChangeLayoutMode} />
                <Sidebar
                    layoutType={layoutType}
                />
                <div className="main-content mb-2">
                    {props.children}
                    <Footer />
                </div>
            </div>
            <RightSidebar />
        </React.Fragment>

    );
};

Layout.propTypes = {
    children: PropTypes.object,
};

export default withRouter(Layout);