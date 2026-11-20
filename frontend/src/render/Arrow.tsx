import { motion } from "framer-motion";

/**
 * Every arrow on the canvas, drawn one way (docs/frontend.md §6.7, Arrows): a line, and a head that is
 * its own filled shape. The line ends a hair inside the head's base, so the two read as one
 * stroke, and the head's corners are rounded by a stroke of its own colour. An arrow that is new
 * draws its line from the tail, like the trace line while a run goes, and its head appears once
 * the line has reached it. An SVG marker cannot do that: it is drawn at the path's end at once,
 * before the line gets there, and it never meets a line that is still drawing.
 */

/** The head: this long from base to tip, and half this wide at its base. */
export const HEAD_LENGTH = 8;
export const HEAD_HALF = 4;
/** How far the line runs on under the head's base, so no gap shows between them. */
const OVERLAP = 1.5;

/** The line drawing in, then the head appearing as it arrives. */
export const DRAW = { duration: 0.4, ease: [0.4, 0, 0.2, 1] } as const;
export const HEAD_IN = { delay: 0.32, duration: 0.16, ease: "easeOut" } as const;

interface Pt {
  x: number;
  y: number;
}

/**
 * An arrow's path split in two: the line, its end moved back from the tip to the head's base,
 * and the head, a triangle whose tip is the path's end and which points the way the path arrives
 * (from its last control point, or the point before the end). `d` is a path of absolute
 * commands whose numbers are separated by spaces or commas, as the renderers write them.
 */
export function arrowParts(d: string): { line: string; head: string } {
  const numbers = [...d.matchAll(/-?\d*\.?\d+(?:e-?\d+)?/gi)];
  if (numbers.length < 4) return { line: d, head: "" };
  const value = (i: number) => Number(numbers[i][0]);
  const n = numbers.length;
  const tip = { x: value(n - 2), y: value(n - 1) };
  // The direction it arrives from. On a curve, a point a little way back along the last segment,
  // so the head follows the curve as the eye sees it, not the steeper pull of its last control
  // point; on a straight segment, the point before the tip.
  let from: Pt | null = curveBack(d, numbers.map((m) => Number(m[0])));
  if (!from || Math.hypot(from.x - tip.x, from.y - tip.y) < 0.01) {
    from = null;
    for (let i = n - 4; i >= 0; i -= 2) {
      const p = { x: value(i), y: value(i + 1) };
      if (Math.hypot(p.x - tip.x, p.y - tip.y) > 0.01) {
        from = p;
        break;
      }
    }
  }
  if (!from) return { line: d, head: "" };
  const len = Math.hypot(tip.x - from.x, tip.y - from.y);
  const ux = (tip.x - from.x) / len;
  const uy = (tip.y - from.y) / len;
  const back = Math.min(HEAD_LENGTH - OVERLAP, len * 0.6);
  const end = { x: tip.x - ux * back, y: tip.y - uy * back };
  const base = { x: tip.x - ux * HEAD_LENGTH, y: tip.y - uy * HEAD_LENGTH };
  const left = { x: base.x - uy * HEAD_HALF, y: base.y + ux * HEAD_HALF };
  const right = { x: base.x + uy * HEAD_HALF, y: base.y - ux * HEAD_HALF };
  const xIndex = numbers[n - 2].index!;
  const yMatch = numbers[n - 1];
  const line = d.slice(0, xIndex) + `${round(end.x)} ${round(end.y)}` + d.slice(yMatch.index! + yMatch[0].length);
  const head = `M ${round(left.x)} ${round(left.y)} L ${round(tip.x)} ${round(tip.y)} L ${round(right.x)} ${round(right.y)} Z`;
  return { line, head };
}

/** On a path that ends with a curve (`Q` or `C`), the point on that curve at t = 0.8; else null. */
function curveBack(d: string, values: number[]): Pt | null {
  const command = /[QC][^A-Za-z]*$/i.exec(d)?.[0][0].toUpperCase();
  const n = values.length;
  const at = (i: number) => ({ x: values[i], y: values[i + 1] });
  const t = 0.8;
  const u = 1 - t;
  if (command === "Q" && n >= 6) {
    const [p0, c, p1] = [at(n - 6), at(n - 4), at(n - 2)];
    return { x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x, y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y };
  }
  if (command === "C" && n >= 8) {
    const [p0, c1, c2, p1] = [at(n - 8), at(n - 6), at(n - 4), at(n - 2)];
    const x = u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x;
    const y = u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y;
    return { x, y };
  }
  return null;
}

function round(n: number): number {
  return Math.round(n * 10) / 10;
}

interface ArrowProps {
  d: string;
  /** The line's classes (its colour, width, and dashes). */
  className: string;
  /** The head's classes: its fill and stroke, the line's colour. */
  headClassName: string;
  /** False for an arrow with no head (a link drawn both ways): only the line. */
  head?: boolean;
  /** How a moved end follows its node. */
  move: object;
}

/**
 * One arrow, as a group: AnimatePresence fades the group out when the arrow goes. On its first
 * render the line draws from its tail and the head follows; after that, a changed path moves
 * both, with no second draw.
 */
export function Arrow({ d, className, headClassName, head = true, move }: ArrowProps) {
  const parts = head ? arrowParts(d) : { line: d, head: "" };
  return (
    <motion.g initial={{ opacity: 1 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.3, ease: "easeOut" } }}>
      <motion.path className={className} initial={{ pathLength: 0, d: parts.line }} animate={{ pathLength: 1, d: parts.line }} transition={{ pathLength: DRAW, d: move }} />
      {parts.head && (
        <motion.path className={headClassName} initial={{ opacity: 0, d: parts.head }} animate={{ opacity: 1, d: parts.head }} transition={{ opacity: HEAD_IN, d: move }} />
      )}
    </motion.g>
  );
}
