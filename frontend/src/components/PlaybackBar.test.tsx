import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { PlayerState } from "../player/playback";
import { PlaybackBar } from "./PlaybackBar";

const bar = (state: Partial<PlayerState>) =>
  renderToStaticMarkup(
    <PlaybackBar player={{ count: 5, index: 0, cameFrom: null, playing: false, ...state }} dispatch={() => {}} speed={1} onSpeed={() => {}} />,
  );

describe("PlaybackBar scrubber", () => {
  it("draws its own dot at the same place the line ends, after the range input", () => {
    const html = bar({ index: 2 }); // step 3 of 5: halfway
    expect(html).toContain('class="scrubber-fill" aria-hidden="true" style="width:50%"');
    expect(html).toMatch(/<input type="range"[^>]*>.*<span class="scrubber-dot" aria-hidden="true" style="left:50%"/);
  });

  it("has no dot without a trace", () => {
    expect(bar({ count: 0, index: 0 })).not.toContain("scrubber-dot");
  });

  it("starts with no dragging, so each step's dot waits for the line", () => {
    expect(bar({ index: 4 })).toContain('class="scrubber"');
    expect(bar({ index: 4 })).not.toContain("is-dragging");
  });
});
