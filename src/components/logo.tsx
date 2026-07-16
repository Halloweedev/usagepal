/**
 * UsagePal logo — a circle with a smile cut out.
 *
 * Uses `currentColor` for the circle; the smile is a transparent hole, so the
 * background shows through and automatically provides the contrast. Set the
 * text color on a parent (e.g. `text-foreground`) and the logo adapts to the
 * app theme (light/dark) without any media query.
 *
 * The cutout is baked into a single even-odd path (disk minus the smile's
 * fill + stroke outline, precomputed with skia pathops from the official
 * 256x256 logo SVG) instead of an SVG <mask>. Masks force WebKit through an
 * intermediate raster buffer at the element's layout size, which made the
 * logo blurry in share-card image exports rendered at a higher pixel ratio;
 * a plain path stays vector all the way down. It also avoids duplicate mask
 * ids when the logo renders more than once per page.
 */
interface LogoProps {
  className?: string;
  /** When true, the logo is decorative (aria-hidden, no label/role). */
  "aria-hidden"?: boolean | "true" | "false";
}

// Disk (r=120 circle + 16px stroke → r=128) with the smile hole, even-odd.
const LOGO_PATH =
  "M256,128 C256,198.69 198.69,256 128,256 C57.31,256 0,198.69 0,128 C0,57.31 57.31,0 128,0 C198.69,0 256,57.31 256,128 Z M31.79,125.1 Q29.93,128.63 30.07,132.35 Q30.82,151.76 38.84,169.34 Q46.61,186.36 60.13,199.4 Q73.67,212.47 91,219.61 Q108.94,227 128.5,227 Q166.51,227 194.65,201.48 Q222.6,176.14 226.47,138.78 Q226.9,134.58 223.94,131.52 Q221.02,128.5 216.71,128.5 Q214.06,128.5 211.64,129.78 Q202.25,134.74 193.22,138.23 Q178.69,143.84 170,143.5 Q161.38,143.17 147.7,136.6 Q147.33,136.42 146.64,136.09 Q133.01,129.54 125.5,128.5 Q118.96,127.6 107.79,128.92 Q99.41,129.92 89.1,132.07 Q76.17,134.77 65.89,127.59 L54.45,119.6 Q48.7,115.58 41.88,117.23 Q35.06,118.89 31.79,125.1 Z";

export function Logo({ className, "aria-hidden": ariaHidden }: LogoProps) {
  const decorative = ariaHidden === true || ariaHidden === "true";
  return (
    <svg
      viewBox="0 0 256 256"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : "UsagePal"}
      role={decorative ? undefined : "img"}
    >
      <path d={LOGO_PATH} fill="currentColor" fillRule="evenodd" />
    </svg>
  );
}
