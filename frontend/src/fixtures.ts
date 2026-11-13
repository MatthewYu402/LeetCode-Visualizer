// The example the page opens with, before any run: given the editor language, the source to
// show and its trace. A run (api/useInputs.ts) replaces the trace with the backend's.
// It is the only place a language maps to a trace; nothing reads trace.language.

import twoSumSource from "../../fixtures/two_sum_trace.cpp?raw";
import twoSumTrace from "../../fixtures/two-sum.trace.json?raw";
import type { EditorLanguage } from "./editor/languages";
import { TEMPLATES } from "./editor/languages";
import { loadTrace, type LoadResult } from "./trace/loader";

export interface Fixture {
  source: string;
  /** null when there is no trace for this language yet. */
  load: LoadResult | null;
}

// Parsed once, through the same loader a response body will go through.
const CPP: Fixture = { source: twoSumSource, load: loadTrace(twoSumTrace) };

export function fixtureFor(language: EditorLanguage): Fixture {
  return language === "cpp" ? CPP : { source: TEMPLATES[language], load: null };
}

export const NO_TRACE_NOTICE = "No trace for this language yet: only C++ can run so far.";
