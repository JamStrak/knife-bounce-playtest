import { mainMessages } from "./i18n-main.mjs";
import { shellMessages } from "./i18n-shell.mjs";
import { stageMessages } from "./i18n-stage.mjs";
import { effectMessages } from "./i18n-effects.mjs";

export const LOCALE_STORAGE_KEY = "knife-club.locale.v1";
export const supportedLocales = ["zh-CN", "en"];
export const messages = {
  ...mainMessages,
  ...shellMessages,
  ...stageMessages,
  ...effectMessages,
};
let locale = "zh-CN";
let initialized = false;
const listeners = new Set();
const escapeRE = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const patterns = Object.entries(messages)
  .filter(([source]) => /\{\w+\}/.test(source))
  .map(([source, target]) => {
    const names = [];
    let last = 0;
    let expression = "^";
    for (const match of source.matchAll(/\{(\w+)\}/g)) {
      expression += escapeRE(source.slice(last, match.index)) + "([\\s\\S]+?)";
      names.push(match[1]);
      last = match.index + match[0].length;
    }
    expression += escapeRE(source.slice(last)) + "$";
    return { source, target, names, regex: new RegExp(expression) };
  })
  // Prefer specific sentences over broad templates such as "Stage {index}".
  .sort(
    (a, b) =>
      b.source.replace(/\{\w+\}/g, "").length -
      a.source.replace(/\{\w+\}/g, "").length,
  );

export function normalizeLocale(value) {
  if (typeof value !== "string") return null;
  if (/^zh(?:[-_].*)?$/i.test(value)) return "zh-CN";
  if (/^en(?:[-_].*)?$/i.test(value)) return "en";
  return null;
}
export function resolveLocale({
  search = "",
  stored = null,
  languages = [],
} = {}) {
  const query = normalizeLocale(new URLSearchParams(search).get("lang"));
  if (query) return query;
  const saved = normalizeLocale(stored);
  if (saved) return saved;
  return normalizeLocale(languages[0]) || "en";
}
export const getLocale = () => locale;
const interpolate = (source, vars, depth = 0) =>
  source.replace(/\{(\w+)\}/g, (token, key) =>
    Object.hasOwn(vars, key) ? translate(String(vars[key]), depth + 1) : token,
  );
function translate(value, depth = 0) {
  const source = String(value ?? "");
  if (locale !== "en" || depth > 5) return source;
  if (Object.hasOwn(messages, source)) return messages[source];
  const trimmed = source.trim();
  if (trimmed !== source && Object.hasOwn(messages, trimmed))
    return source.replace(trimmed, messages[trimmed]);
  if (!/\p{Script=Han}/u.test(source)) return source;
  for (const { target, names, regex } of patterns) {
    const match = regex.exec(source);
    if (match)
      return interpolate(
        target,
        Object.fromEntries(names.map((name, i) => [name, match[i + 1]])),
        depth,
      );
  }
  return source;
}
export function t(source, vars) {
  const translated = translate(source);
  return vars ? interpolate(translated, vars) : translated;
}
export function onLocaleChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
export function setLocale(value, { persist = true } = {}) {
  const next = normalizeLocale(value);
  if (!next) return false;
  const changed = next !== locale;
  locale = next;
  if (typeof document !== "undefined") {
    document.documentElement.lang = locale;
    document.title = t("飞刀弹弹乐");
  }
  if (persist && typeof window !== "undefined") {
    try {
      window.localStorage.setItem(LOCALE_STORAGE_KEY, locale);
    } catch {
      /* Private/storage-disabled mode still supports this session. */
    }
    const url = new URL(window.location.href);
    if (url.searchParams.has("lang")) {
      url.searchParams.set("lang", locale);
      window.history.replaceState(window.history.state, "", url);
    }
  }
  if (changed) for (const listener of listeners) listener(locale);
  return true;
}
export function initLocale() {
  if (initialized || typeof window === "undefined") return locale;
  initialized = true;
  let stored = null;
  try {
    stored = window.localStorage.getItem(LOCALE_STORAGE_KEY);
  } catch {
    /* Use browser language when storage is unavailable. */
  }
  setLocale(
    resolveLocale({
      search: window.location.search,
      stored,
      languages: window.navigator.languages || [window.navigator.language],
    }),
    { persist: false },
  );
  return locale;
}
export function localize(root = document) {
  const attributes = {
    "data-i18n": null,
    "data-i18n-title": "title",
    "data-i18n-aria-label": "aria-label",
    "data-i18n-placeholder": "placeholder",
  };
  for (const [data, attribute] of Object.entries(attributes)) {
    const nodes = [...root.querySelectorAll(`[${data}]`)];
    if (root.matches?.(`[${data}]`)) nodes.unshift(root);
    for (const node of nodes) {
      const value = t(node.getAttribute(data));
      if (attribute) node.setAttribute(attribute, value);
      else node.textContent = value;
    }
  }
}
