import {
  getLocale,
  initLocale,
  localize,
  onLocaleChange,
  setLocale,
} from "./i18n.mjs";

// Imported by the single game entry point, before its async asset loading.
initLocale();
function refreshLanguageUI() {
  localize(document);
  for (const select of document.querySelectorAll("[data-language-select]"))
    select.value = getLocale();
}
for (const select of document.querySelectorAll("[data-language-select]"))
  select.addEventListener("change", () => setLocale(select.value));
onLocaleChange(refreshLanguageUI);
refreshLanguageUI();
