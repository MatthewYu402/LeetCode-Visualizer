import { describe, expect, it } from "vitest";
import { initialPlayer, playerReducer, type PlayerAction, type PlayerState } from "./playback";

const run = (s: PlayerState, ...actions: PlayerAction[]) => actions.reduce(playerReducer, s);
const nine = initialPlayer(9);

describe("playback", () => {
  it("Run advances from the current step and stops by itself at the last", () => {
    let s = run(nine, { type: "next" }, { type: "next" }, { type: "toggle" });
    expect(s).toMatchObject({ index: 2, playing: true });
    for (let i = 0; i < 20; i++) s = run(s, { type: "tick" });
    expect(s).toMatchObject({ index: 8, playing: false });
  });

  it("Run at the last step restarts from step 0 with no diff", () => {
    const s = run(nine, { type: "last" }, { type: "toggle" });
    expect(s).toMatchObject({ index: 0, cameFrom: null, playing: true });
  });

  it("Pause stops where it is and Run continues from there", () => {
    let s = run(nine, { type: "toggle" }, { type: "tick" }, { type: "tick" }, { type: "toggle" });
    expect(s).toMatchObject({ index: 2, playing: false });
    s = run(s, { type: "tick" });
    expect(s.index).toBe(2); // ticks do nothing while paused
    s = run(s, { type: "toggle" }, { type: "tick" });
    expect(s).toMatchObject({ index: 3, cameFrom: 2, playing: true });
  });

  it.each<PlayerAction>([{ type: "prev" }, { type: "next" }, { type: "first" }, { type: "last" }, { type: "seek", index: 4 }])(
    "%o pauses playback",
    (a) => {
      const s = run(nine, { type: "next" }, { type: "toggle" }, a);
      expect(s.playing).toBe(false);
    },
  );

  it("clamps at both ends", () => {
    expect(run(nine, { type: "prev" }).index).toBe(0);
    expect(run(nine, { type: "last" }, { type: "next" }).index).toBe(8);
    expect(run(nine, { type: "seek", index: 99 }).index).toBe(8);
  });

  it("records where each step was entered from", () => {
    expect(run(nine, { type: "next" }).cameFrom).toBe(0);
    expect(run(nine, { type: "seek", index: 6 }, { type: "prev" }).cameFrom).toBe(6);
  });

  it("does nothing without a trace", () => {
    const empty = initialPlayer(0);
    expect(run(empty, { type: "toggle" }, { type: "next" })).toMatchObject({ index: 0, playing: false });
  });
});
