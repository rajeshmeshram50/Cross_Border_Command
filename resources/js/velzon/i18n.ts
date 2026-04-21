import i18n from "i18next";
import { initReactI18next } from "react-i18next";

/**
 * Minimal i18n config — pass-through (no translation resources loaded).
 * Velzon's VerticalLayout / horizontal layout call `props.t(label)`, so
 * we only need i18next to be initialized to avoid runtime warnings.
 * Translation can be added later by loading resources.
 */
if (!i18n.isInitialized) {
  i18n
    .use(initReactI18next)
    .init({
      lng: "en",
      fallbackLng: "en",
      interpolation: { escapeValue: false },
      resources: { en: { translation: {} } },
      react: { useSuspense: false },
    });
}

export default i18n;
