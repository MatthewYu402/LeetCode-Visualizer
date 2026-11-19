// Which page is showing, from the URL's hash (docs/frontend.md §12). A hash route needs no
// router dependency and no server rule: every path serves the same index.html, and the hash
// never reaches the server. The back button and shared links work because the hash is part
// of the URL.
//
//   #/ or no hash             the home page
//   #/sandbox                 the sandbox, on the bare Two Sum Solution
//   #/sandbox/two-sum         the sandbox, with an example's Solution and inputs (home/examples.ts)
//
// Anything else is the home page.

import { useEffect, useState } from "react";

export type Route = { page: "home" } | { page: "sandbox"; example?: string };

/** The route a hash names: "#/sandbox/two-sum" is the sandbox with that example. */
export function parseRoute(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").replace(/\/+$/, "");
  const [first, second, ...rest] = path.split("/");
  if (first !== "sandbox" || rest.length > 0) return { page: "home" };
  if (second === undefined || second === "") return { page: "sandbox" };
  return { page: "sandbox", example: decodeURIComponent(second) };
}

/** The href for a route, for links: "#/", "#/sandbox", "#/sandbox/two-sum". */
export function href(route: Route): string {
  if (route.page === "home") return "#/";
  return route.example ? `#/sandbox/${encodeURIComponent(route.example)}` : "#/sandbox";
}

/** The window title for a route. */
export function titleFor(route: Route): string {
  return route.page === "home" ? "LeetCode Visualizer" : "LeetCode Visualizer · Sandbox";
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
