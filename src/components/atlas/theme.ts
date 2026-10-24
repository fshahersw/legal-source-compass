/**
 * Light / dark theme for the workspace. Light is the default; dark is opt-in through the toggle in the top bar and
 * remembered in this browser only. The theme is the `dark` class on <html> (styles.css defines the tokens for both).
 * THEME_SCRIPT runs inline while the page is parsed, so a remembered dark theme applies before the first paint.
 */
export const THEME_KEY = "lsa-theme";
export type Theme = "light" | "dark";

export const THEME_SCRIPT = `try{if(localStorage.getItem("${THEME_KEY}")==="dark"){var r=document.documentElement;r.classList.add("dark");r.style.colorScheme="dark"}}catch(e){}`;

export function readTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
  } catch {
    return "light";
  }
}

export function applyTheme(theme: Theme) {
  const root = document.documentElement;
  root.classList.toggle("dark", theme === "dark");
  root.style.colorScheme = theme;
}

export function storeTheme(theme: Theme) {
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // storage blocked (private mode): the theme still applies for this page view
  }
}
