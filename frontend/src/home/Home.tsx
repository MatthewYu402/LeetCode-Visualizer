import { useRef, type ReactNode } from "react";
import { Logo } from "../components/Logo";
import { MoonIcon, SunIcon } from "../components/Toolbar";
import { href } from "../route";
import { useTheme } from "../theme";
import { EXAMPLES, type Example } from "./examples";
import { Preview } from "./Preview";

/** Languages, in the order the project plans them. Only C++ runs today. */
export const LANGUAGE_STATUS: { name: string; ready: boolean; note: string }[] = [
  { name: "C++", ready: true, note: "Available now" },
  { name: "Java", ready: false, note: "Coming soon" },
  { name: "Python", ready: false, note: "Coming soon" },
];

/**
 * The home page (docs/frontend.md §12): what the tool is, a live preview, a way in with your
 * own Solution, example problems that open the sandbox filled in, how a run works, and the
 * languages. It scrolls, unlike the sandbox, which is one screen.
 */
export function Home() {
  const { theme, toggle } = useTheme();
  const otherTheme = theme === "dark" ? "light" : "dark";
  const examplesRef = useRef<HTMLElement>(null);

  return (
    <div className="home">
      <header className="home-bar">
        <a className="brand" href={href({ page: "home" })}>
          <Logo height={18} />
          <span className="brand-name">LeetCode Visualizer</span>
        </a>
        <div className="topbar-end">
          <button type="button" className="control icon-control" aria-label={`Switch to the ${otherTheme} theme`} title={`Switch to the ${otherTheme} theme`} onClick={toggle}>
            {theme === "dark" ? <SunIcon /> : <MoonIcon />}
          </button>
          <a className="run-button" href={href({ page: "sandbox" })}>
            Open the sandbox
          </a>
        </div>
      </header>

      <main className="home-main">
        <section className="hero" aria-labelledby="hero-title">
          <div className="hero-text">
            <Logo height={44} className="hero-logo" />
            <h1 id="hero-title" className="hero-title">
              Watch your Solution run, <span className="hero-accent">one line at a time.</span>
            </h1>
            <p className="hero-lede">
              Paste a LeetCode <code>Solution</code> exactly as LeetCode gives it, add an example, and step through it. Every array, map, stack, linked list,
              tree, and graph it touches is drawn as it changes, beside the line that changed it.
            </p>
            <div className="hero-actions">
              <a className="run-button hero-cta" href={href({ page: "sandbox" })}>
                <PasteIcon />
                Paste a Solution
              </a>
              <button type="button" className="control hero-secondary" onClick={() => examplesRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
                Try an example
              </button>
            </div>
            <p className="hero-note">
              <span className="lang-dot is-ready" aria-hidden="true" />
              C++ today. Java and Python are coming.
            </p>
          </div>
          <Preview />
        </section>

        <section ref={examplesRef} className="home-section" aria-labelledby="examples-title">
          <div className="section-head">
            <h2 id="examples-title" className="section-title">
              Start from an example
            </h2>
            <p className="section-lede">Each opens the sandbox with the Solution in the editor and the example in the inputs. Press Run code to see it.</p>
          </div>
          <ul className="example-grid">
            {EXAMPLES.map((e) => (
              <li key={e.slug}>
                <ExampleCard example={e} />
              </li>
            ))}
          </ul>
        </section>

        <section className="home-section" aria-labelledby="how-title">
          <div className="section-head">
            <h2 id="how-title" className="section-title">
              How it works
            </h2>
            <p className="section-lede">Your code runs as written, in its own language. What comes back is a recording of its data, one snapshot per line.</p>
          </div>
          <ol className="how">
            <HowStep n={1} title="Your Solution and an example">
              The class LeetCode gives you, with its commented <code>ListNode</code> or <code>TreeNode</code>, and an <code>Input:</code> line pasted from the
              problem. Nothing to annotate.
            </HowStep>
            <HowStep n={2} title="Run in a sandbox">
              The code is instrumented before each line and run in an isolated container, with no network and strict limits.
            </HowStep>
            <HowStep n={3} title="A trace">
              Every step, the whole call stack and every value, written in one language-neutral format: <code>array</code>, <code>map</code>, <code>ref</code>,
              not <code>vector</code> or <code>dict</code>.
            </HowStep>
            <HowStep n={4} title="The canvas">
              Each structure gets a card. Step forward, back, or scrub; what changed is highlighted, and so is what the line read.
            </HowStep>
          </ol>
        </section>

        <section className="home-section" aria-labelledby="langs-title">
          <div className="section-head">
            <h2 id="langs-title" className="section-title">
              Languages
            </h2>
            <p className="section-lede">The canvas never knows which language ran, so each new language needs only its own adapter.</p>
          </div>
          <ul className="lang-list">
            {LANGUAGE_STATUS.map((l) => (
              <li key={l.name} className={`lang-item${l.ready ? " is-ready" : ""}`}>
                <span className={`lang-dot${l.ready ? " is-ready" : ""}`} aria-hidden="true" />
                <span className="lang-name">{l.name}</span>
                <span className="lang-note">{l.note}</span>
              </li>
            ))}
          </ul>
        </section>

        <footer className="home-foot">
          <Logo height={14} />
          <span>LeetCode Visualizer · Apache License 2.0</span>
        </footer>
      </main>
    </div>
  );
}

function ExampleCard({ example }: { example: Example }) {
  return (
    <a className="example-card" href={href({ page: "sandbox", example: example.slug })}>
      <span className="example-card-head">
        <span className="example-card-title">{example.title}</span>
        <span className={`difficulty is-${example.difficulty.toLowerCase()}`}>{example.difficulty}</span>
      </span>
      <span className="example-card-blurb">{example.blurb}</span>
      <span className="example-card-foot">
        <span className="example-tags">
          {example.tags.map((t) => (
            <span key={t} className="example-tag">
              {t}
            </span>
          ))}
        </span>
        <span className="example-open" aria-hidden="true">
          Open
          <svg className="icon-stroke" width="12" height="12" viewBox="0 0 12 12">
            <path d="M2.5 6h7M6.5 3l3 3-3 3" />
          </svg>
        </span>
      </span>
    </a>
  );
}

function HowStep({ n, title, children }: { n: number; title: string; children: ReactNode }) {
  return (
    <li className="how-step">
      <span className="how-n" aria-hidden="true">
        {n}
      </span>
      <h3 className="how-title">{title}</h3>
      <p className="how-text">{children}</p>
    </li>
  );
}

function PasteIcon() {
  return (
    <svg className="icon-stroke" aria-hidden="true" width="14" height="14" viewBox="0 0 16 16">
      <rect x="3.5" y="3" width="9" height="11" rx="2" />
      <path d="M6 3V2.5A1 1 0 0 1 7 1.5h2a1 1 0 0 1 1 1V3M6 7.5h4M6 10h2.5" />
    </svg>
  );
}
