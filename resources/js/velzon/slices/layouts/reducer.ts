import { createSlice } from "@reduxjs/toolkit";
//constants
import {
  LAYOUT_TYPES,
  LAYOUT_MODE_TYPES,
  LAYOUT_SIDEBAR_TYPES,
  LAYOUT_WIDTH_TYPES,
  LAYOUT_POSITION_TYPES,
  LAYOUT_TOPBAR_THEME_TYPES,
  LEFT_SIDEBAR_SIZE_TYPES,
  LEFT_SIDEBAR_VIEW_TYPES,
  LEFT_SIDEBAR_IMAGE_TYPES,
  PERLOADER_TYPES,
  SIDEBAR_VISIBILITY_TYPES
} from "../../Components/constants/layout"


export interface LayoutState {
  layoutType: LAYOUT_TYPES.HORIZONTAL | LAYOUT_TYPES.VERTICAL | LAYOUT_TYPES.TWOCOLUMN | LAYOUT_TYPES.SEMIBOX;
  layoutModeType: LAYOUT_MODE_TYPES.LIGHTMODE | LAYOUT_MODE_TYPES.DARKMODE;
  leftSidebarType: LAYOUT_SIDEBAR_TYPES.LIGHT | LAYOUT_SIDEBAR_TYPES.DARK | LAYOUT_SIDEBAR_TYPES.GRADIENT | LAYOUT_SIDEBAR_TYPES.GRADIENT_2 | LAYOUT_SIDEBAR_TYPES.GRADIENT_3 | LAYOUT_SIDEBAR_TYPES.GRADIENT_4;
  layoutWidthType: LAYOUT_WIDTH_TYPES.FLUID | LAYOUT_WIDTH_TYPES.BOXED;
  layoutPositionType: LAYOUT_POSITION_TYPES.FIXED | LAYOUT_POSITION_TYPES.SCROLLABLE;
  topbarThemeType: LAYOUT_TOPBAR_THEME_TYPES.LIGHT | LAYOUT_TOPBAR_THEME_TYPES.DARK;
  leftsidbarSizeType: LEFT_SIDEBAR_SIZE_TYPES.DEFAULT | LEFT_SIDEBAR_SIZE_TYPES.COMPACT | LEFT_SIDEBAR_SIZE_TYPES.SMALLICON | LEFT_SIDEBAR_SIZE_TYPES.SMALLHOVER;
  leftSidebarViewType: LEFT_SIDEBAR_VIEW_TYPES.DEFAULT | LEFT_SIDEBAR_VIEW_TYPES.DETACHED;
  leftSidebarImageType: LEFT_SIDEBAR_IMAGE_TYPES.NONE | LEFT_SIDEBAR_IMAGE_TYPES.IMG1 | LEFT_SIDEBAR_IMAGE_TYPES.IMG2 | LEFT_SIDEBAR_IMAGE_TYPES.IMG3 | LEFT_SIDEBAR_IMAGE_TYPES.IMG4;
  preloader: PERLOADER_TYPES.ENABLE | PERLOADER_TYPES.DISABLE;
  sidebarVisibilitytype:  SIDEBAR_VISIBILITY_TYPES.SHOW | SIDEBAR_VISIBILITY_TYPES.HIDDEN;
}

// Read every persisted customizer choice so a refresh re-hydrates the
// exact layout the user picked. Paired with the localStorage writes in
// thunk.ts (one per setting) and the synchronous attribute seeding in
// app.tsx (which prevents a flash before React mounts).
const read = <T extends string>(key: string, fallback: T, allowed?: readonly T[]): T => {
  try {
    const v = window.localStorage.getItem(key);
    if (v == null) return fallback;
    if (allowed && !allowed.includes(v as T)) return fallback;
    return v as T;
  } catch { return fallback; }
};

const persistedLayoutMode = read('cbc-layout-mode', 'light', ['light', 'dark'] as const);
const persistedLayoutType = read('cbc-layout', LAYOUT_TYPES.VERTICAL, [
  LAYOUT_TYPES.VERTICAL, LAYOUT_TYPES.HORIZONTAL, LAYOUT_TYPES.TWOCOLUMN, LAYOUT_TYPES.SEMIBOX,
] as const);
const persistedSidebarTheme = read('cbc-sidebar-theme', LAYOUT_SIDEBAR_TYPES.DARK);
const persistedLayoutWidth = read('cbc-layout-width', LAYOUT_WIDTH_TYPES.FLUID, [
  LAYOUT_WIDTH_TYPES.FLUID, LAYOUT_WIDTH_TYPES.BOXED,
] as const);
const persistedLayoutPosition = read('cbc-layout-position', LAYOUT_POSITION_TYPES.FIXED, [
  LAYOUT_POSITION_TYPES.FIXED, LAYOUT_POSITION_TYPES.SCROLLABLE,
] as const);
const persistedTopbarTheme = read('cbc-topbar-theme', LAYOUT_TOPBAR_THEME_TYPES.LIGHT, [
  LAYOUT_TOPBAR_THEME_TYPES.LIGHT, LAYOUT_TOPBAR_THEME_TYPES.DARK,
] as const);
const persistedSidebarSize = read('cbc-sidebar-size', LEFT_SIDEBAR_SIZE_TYPES.DEFAULT);
const persistedSidebarView = read('cbc-sidebar-view', LEFT_SIDEBAR_VIEW_TYPES.DEFAULT, [
  LEFT_SIDEBAR_VIEW_TYPES.DEFAULT, LEFT_SIDEBAR_VIEW_TYPES.DETACHED,
] as const);
const persistedSidebarImage = read('cbc-sidebar-image', LEFT_SIDEBAR_IMAGE_TYPES.NONE);

export const initialState = {
  layoutType: persistedLayoutType as any,
  leftSidebarType: persistedSidebarTheme as any,
  layoutModeType: persistedLayoutMode === 'dark' ? LAYOUT_MODE_TYPES.DARKMODE : LAYOUT_MODE_TYPES.LIGHTMODE,
  layoutWidthType: persistedLayoutWidth as any,
  layoutPositionType: persistedLayoutPosition as any,
  topbarThemeType: persistedTopbarTheme as any,
  leftsidbarSizeType: persistedSidebarSize as any,
  leftSidebarViewType: persistedSidebarView as any,
  leftSidebarImageType: persistedSidebarImage as any,
  preloader: PERLOADER_TYPES.DISABLE,
  sidebarVisibilitytype: SIDEBAR_VISIBILITY_TYPES.SHOW
};

const LayoutSlice = createSlice({
  name: 'LayoutSlice',
  initialState,
  reducers: {
    changeLayoutAction(state: any, action : any) {
      state.layoutType = action.payload;
    },
    changeLayoutModeAction(state: any, action: any) {
      state.layoutModeType = action.payload;
    },
    changeSidebarThemeAction(state: any, action: any) {
      state.leftSidebarType = action.payload;
    },
    changeLayoutWidthAction(state: any, action: any) {
      state.layoutWidthType = action.payload;
    },
    changeLayoutPositionAction(state: any, action: any) {
      state.layoutPositionType = action.payload;
    },
    changeTopbarThemeAction(state: any, action: any) {
      state.topbarThemeType = action.payload;
    },
    changeLeftsidebarSizeTypeAction(state: any, action: any) {
      state.leftsidbarSizeType = action.payload;
    },
    changeLeftsidebarViewTypeAction(state: any, action: any) {
      state.leftSidebarViewType = action.payload;
    },
    changeSidebarImageTypeAction(state: any, action: any) {
      state.leftSidebarImageType = action.payload;
    },
    changePreLoaderAction(state: any, action: any) {
      state.preloader = action.payload;
    },
    changeSidebarVisibilityAction(state: any, action: any) {
      state.sidebarVisibilitytype = action.payload;
    },
  }
});

export const {
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
} = LayoutSlice.actions;

export default LayoutSlice.reducer;