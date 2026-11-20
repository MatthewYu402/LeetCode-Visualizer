// Which page is showing, from the URL's hash (docs/frontend.md §12). A hash route needs no
// router dependency and no server rule: every path serves the same index.html, and the hash
// never reaches the server. The back button and shared links work because the hash is part
// of the URL.
//
//   #/ or no hash             the home page
//   #/sandbox                 the sandbox, on the bare Two Sum Solution
//   #/sandbox/two-sum         the sandbox, with an example's Solution and inputs (home/examples.ts), in C++
//   #/sandbox/two-sum/java    the same in Java (or python, cpp): what the Examples menu opens
//
// Anything else is the home page.

import { useEffect, useState } from "react";
import { isEditorLanguage } from "./editor/languages";

export type Route = { page: "home" } | { page: "sandbox"; example?: string; language?: string };

/** The route a hash names: "#/sandbox/two-sum" is the sandbox with that example, "#/sandbox/two-sum/java" in Java. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  const [first, second, third, ...rest] = path.split("/");
  if (first !== "sandbox" || rest.length > 0) return { page: "home" };
  if (second === undefined || second === "") return { page: "sandbox" };
  if (third !== undefined) {
    const language = decodeURIComponent(third);
    return isEditorLanguage(language) ? { page: "sandbox", example: decodeURIComponent(second), language } : { page: "home" };
  }
  return { page: "sandbox", example: decodeURIComponent(second) };
}

/** The href for a route, for links: "#/", "#/sandbox", "#/sandbox/two-sum", "#/sandbox/two-sum/java". */
export function href(route: Route): string {
  if (route.page === "home") return "#/";
  if (!route.example) return "#/sandbox";
  const example = `#/sandbox/${encodeURIComponent(route.example)}`;
  return route.language ? `${example}/${encodeURIComponent(route.language)}` : example;
}

/** The window title for a route. */
export function titleFor(route: Route): string {
  return route.page === "home" ? "Visi" : "Visi · Sandbox";
}

/** The current route, following the hash as links and the back button change it. */
export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(globalThis.location?.hash ?? ""));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  useEffect(() => {
    document.title = titleFor(route);
  }, [route]);
  return route;
}
