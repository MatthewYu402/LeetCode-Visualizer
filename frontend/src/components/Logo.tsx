import logoForDark from "../assets/visi-eye-white-dark-mode.svg";
import logoForLight from "../assets/visi-eye-black-light-mode.svg";

/**
 * The author's logo, an eye, as the two files they drew: white for the dark theme, black for
 * the light one. Both are in the page and CSS shows the one that matches `data-theme`, so the
 * logo switches with the theme at once, with nothing to re-render. `height` sets its size;
 * the width follows the drawing (about 3.3 to 1).
 */
export function Logo({ height = 20, className = "" }: { height?: number; className?: string }) {
  return (
    <span className={`logo-eye ${className}`.trim()} role="img" aria-label="Visi" style={{ height }}>
      <img className="logo-eye-dark" src={logoForDark} alt="" height={height} />
      <img className="logo-eye-light" src={logoForLight} alt="" height={height} />
    </span>
  );
}
