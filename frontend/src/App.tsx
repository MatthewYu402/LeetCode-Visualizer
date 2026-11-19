import { MotionConfig } from "framer-motion";
import { lazy, Suspense, useState } from "react";
import { Home } from "./home/Home";
import { exampleNamed } from "./home/examples";
import { useRoute } from "./route";

// The sandbox carries Monaco, most of the bundle, so it is loaded only when it is opened.
const Sandbox = lazy(() => import("./Sandbox"));

/**
 * The two pages, chosen by the URL's hash (route.ts): the home page, and the sandbox. A link
 * to an example opens the sandbox with that example; a slug that names no example opens it
 * on the bare Two Sum Solution. The sandbox is keyed by example and language, so following a
 * second example link starts a fresh sandbox instead of keeping the first one's code; picking
 * the example already open (the hash does not change) starts a fresh one too, through `reopen`.
 */
export function App() {
  const route = useRoute();
  const [opened, setOpened] = useState(0);
  return (
    // reducedMotion="user": with the system's "reduce motion" setting on, every
    // framer-motion animation jumps straight to its end, as the CSS ones already do.
    <MotionConfig reducedMotion="user">
      {route.page === "home" ? (
        <Home />
      ) : (
        <Suspense fallback={<div className="app page-loading" aria-busy="true" />}>
          <Sandbox
            key={`${route.example ?? ""}/${route.language ?? ""}/${opened}`}
            example={exampleNamed(route.example)}
            language={route.language}
            reopen={() => setOpened((n) => n + 1)}
          />
        </Suspense>
      )}
    </MotionConfig>
  );
}
