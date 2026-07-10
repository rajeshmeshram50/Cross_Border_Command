import { changeHTMLAttribute } from './utils';
import {
    changeLayoutAction,
    changeLayoutModeAction,
    changeSidebarThemeAction,
    changeLayoutWidthAction,
    changeLayoutPositionAction,
    changeTopbarThemeAction,
    changeLeftsidebarSizeTypeAction,
    changeLeftsidebarViewTypeAction,
    changeSidebarImageTypeAction,
    changePreLoaderAction,
    changeSidebarVisibilityAction
} from './reducer';

// All Theme-Customizer choices live under these localStorage keys so a
// refresh re-hydrates the exact layout the user picked. The companion
// reads happen in reducer.ts (initialState) and the synchronous DOM
// seeding in app.tsx. Keep the keys in sync between all three files.
const persist = (key: string, value: unknown) => {
    try { window.localStorage.setItem(key, String(value)); } catch { /* private mode */ }
};

/**
 * Changes the layout type
 * @param {*} param0
 */
export const changeLayout = (layout : any) => async (dispatch : any) => {
    try {
        if (layout === "twocolumn") {
            document.documentElement.removeAttribute("data-layout-width");
        } else if (layout === "horizontal") {
            document.documentElement.removeAttribute("data-sidebar-size");
        } else if (layout === "semibox") {
            changeHTMLAttribute("data-layout-width", "fluid");
            changeHTMLAttribute("data-layout-style", "default");
        }
        changeHTMLAttribute("data-layout", layout);
        persist('cbc-layout', layout);
        dispatch(changeLayoutAction(layout));
    } catch (error) { }
};

/**
 * Changes the layout mode
 * @param {*} param0
 */
export const changeLayoutMode = (layoutMode : any) => async (dispatch : any) => {
    try {
        // Suppress CSS transitions for the duration of the theme flip. Many
        // elements animate `background`/`all`, so without this they cross-fade
        // THROUGH their light colour on the way to the dark value — a white
        // flash (most visible on light-tinted surfaces like zebra rows and the
        // bref-box arrow button). A tiny <style> kill-switch forces an instant
        // switch; it's removed on the next paint so normal hover transitions
        // resume immediately.
        const KILL_ID = 'cbc-theme-transition-kill';
        if (typeof document !== 'undefined' && !document.getElementById(KILL_ID)) {
            const kill = document.createElement('style');
            kill.id = KILL_ID;
            kill.textContent = '*,*::before,*::after{transition:none !important;}';
            document.head.appendChild(kill);
            changeHTMLAttribute("data-bs-theme", layoutMode);
            // Force a reflow so the new theme paints with transitions disabled,
            // then drop the kill-switch after the browser has committed it.
            void document.body.offsetHeight;
            requestAnimationFrame(() => requestAnimationFrame(() => {
                document.getElementById(KILL_ID)?.remove();
            }));
        } else {
            changeHTMLAttribute("data-bs-theme", layoutMode);
        }
        persist('cbc-layout-mode', layoutMode);
        dispatch(changeLayoutModeAction(layoutMode));
    } catch (error) { }
};

/**
 * Changes the left sidebar theme
 * @param {*} param0
 */
export const changeSidebarTheme = (theme : any) => async (dispatch : any) => {
    try {
        changeHTMLAttribute("data-sidebar", theme);
        persist('cbc-sidebar-theme', theme);
        dispatch(changeSidebarThemeAction(theme));
    } catch (error) {
        // console.log(error);
    }
};

/**
 * Changes the layout width
 * @param {*} param0
 */
export const changeLayoutWidth = (layoutWidth : any) => async (dispatch : any) => {
    try {
        if (layoutWidth === 'lg') {
            changeHTMLAttribute("data-layout-width", "fluid");
        } else {
            changeHTMLAttribute("data-layout-width", "boxed");
        }
        persist('cbc-layout-width', layoutWidth);
        dispatch(changeLayoutWidthAction(layoutWidth));
    } catch (error) {
        return error;
    }
};

/**
 * Changes the layout position
 * @param {*} param0
 */
export const changeLayoutPosition = (layoutposition : any) => async (dispatch : any) => {
    try {
        changeHTMLAttribute("data-layout-position", layoutposition);
        persist('cbc-layout-position', layoutposition);
        dispatch(changeLayoutPositionAction(layoutposition));
    } catch (error) {
        // console.log(error);
    }
};

/**
 * Changes the topbar themes
 * @param {*} param0
 */
export const changeTopbarTheme = (topbarTheme : any) => async (dispatch : any) => {
    try {
        changeHTMLAttribute("data-topbar", topbarTheme);
        persist('cbc-topbar-theme', topbarTheme);
        dispatch(changeTopbarThemeAction(topbarTheme));

    } catch (error) {
        // console.log(error);
    }
};

/**
 * Changes the topbar themes
 * @param {*} param0
 */
export const changeSidebarImageType = (leftsidebarImagetype : any) => async (dispatch : any) => {
    try {
        changeHTMLAttribute("data-sidebar-image", leftsidebarImagetype);
        persist('cbc-sidebar-image', leftsidebarImagetype);
        dispatch(changeSidebarImageTypeAction(leftsidebarImagetype));
    } catch (error) {
        // console.log(error);
    }
};

/**
 * Changes the Preloader
 * @param {*} param0
 */
export const changePreLoader = (preloaderTypes : any) => async (dispatch : any) => {
    try {
        changeHTMLAttribute("data-preloader", preloaderTypes);
        dispatch(changePreLoaderAction(preloaderTypes));
    } catch (error) {
        // console.log(error);
    }
};

/**
 * Changes the topbar themes
 * @param {*} param0
 */
export const changeLeftsidebarSizeType = (leftsidebarSizetype : any) => async (dispatch : any) => {
    try {
        switch (leftsidebarSizetype) {
            case 'lg':
                changeHTMLAttribute("data-sidebar-size", "lg");
                break;
            case 'md':
                changeHTMLAttribute("data-sidebar-size", "md");
                break;
            case "sm":
                changeHTMLAttribute("data-sidebar-size", "sm");
                break;
            case "sm-hover":
                changeHTMLAttribute("data-sidebar-size", "sm-hover");
                break;
            default:
                changeHTMLAttribute("data-sidebar-size", "lg");
        }
        persist('cbc-sidebar-size', leftsidebarSizetype);
        dispatch(changeLeftsidebarSizeTypeAction(leftsidebarSizetype));

    } catch (error) {
        // console.log(error);
    }
};

/**
 * Changes the topbar themes
 * @param {*} param0
 */
export const changeLeftsidebarViewType = (leftsidebarViewtype : any) => async (dispatch : any) => {
    try {
        changeHTMLAttribute("data-layout-style", leftsidebarViewtype);
        persist('cbc-sidebar-view', leftsidebarViewtype);
        dispatch(changeLeftsidebarViewTypeAction(leftsidebarViewtype));
    } catch (error) {
        // console.log(error);
    }
};

/**
 * Changes the sidebar visibility
 * @param {*} param0
 */
export const changeSidebarVisibility = (sidebarVisibilitytype : any) => async (dispatch : any) => {
    try {
        changeHTMLAttribute("data-sidebar-visibility", sidebarVisibilitytype);
        dispatch(changeSidebarVisibilityAction(sidebarVisibilitytype));
    } catch (error) { }
};