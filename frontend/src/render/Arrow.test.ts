import { describe, expect, it } from "vitest";
import { arrowParts, HEAD_HALF, HEAD_LENGTH } from "./Arrow";

const numbers = (d: string) => [...d.matchAll(/-?\d*\.?\d+/g)].map((m) => Number(m[0]));

describe("arrowParts", () => {
  it("ends the line just inside the head's base, and puts the head's tip on the path's end", () => {
    const { line, head } = arrowParts("M 0 0 L 100 0");
    // The line stops short of the tip by the head's length, less a small overlap, so it runs under the base.
    const end = numbers(line).slice(-2);
    expect(end[0]).toBeGreaterThan(100 - HEAD_LENGTH);
    expect(end[0]).toBeLessThan(100);
    expect(end[1]).toBe(0);
    // Base corners either side of the line, the tip at (100, 0).
    expect(numbers(head)).toEqual([100 - HEAD_LENGTH, HEAD_HALF, 100, 0, 100 - HEAD_LENGTH, -HEAD_HALF]);
  });

  it("points the head the way a curve arrives", () => {
    // A curve arriving straight down at (50, 80): the head's base is above the tip.
    const { line, head } = arrowParts("M 50 0 C 50 40, 50 40, 50 80");
    expect(line.startsWith("M 50 0 C 50 40, 50 40, ")).toBe(true);
    const [lx, ly, tx, ty, rx, ry] = numbers(head);
    expect([tx, ty]).toEqual([50, 80]);
    expect(ly).toBe(80 - HEAD_LENGTH);
    expect(ry).toBe(80 - HEAD_LENGTH);
    expect(Math.abs(lx - rx)).toBe(2 * HEAD_HALF);
  });

  it("follows a shallow curve, not the steep pull of its last control point", () => {
    // Arrives from the lower left, its last control point straight below the tip: the head leans
    // left along the curve rather than standing upright.
    const { head } = arrowParts("M 0 100 C 0 50, 100 50, 100 0");
    const [lx, , tx, , rx] = numbers(head);
    expect(tx).toBe(100);
    expect((lx + rx) / 2).toBeLessThan(100);
  });

  it("skips a control point that sits on the end", () => {
    const { head } = arrowParts("M 0 0 Q 10 0 10 0");
    expect(numbers(head).slice(2, 4)).toEqual([10, 0]);
    expect(head).not.toContain("NaN");
  });
});
