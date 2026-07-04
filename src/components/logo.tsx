/**
 * UsagePal logo — a circle with a smile cut out.
 *
 * Uses `currentColor` for the circle; the smile is a transparent hole, so the
 * background shows through and automatically provides the contrast. Set the
 * text color on a parent (e.g. `text-foreground`) and the logo adapts to the
 * app theme (light/dark) without any media query.
 *
 * The smile path is reused as a mask cutout so the same shape renders correctly
 * at every size, including the macOS menu-bar template image.
 */
interface LogoProps {
  className?: string;
  /** When true, the logo is decorative (aria-hidden, no label/role). */
  "aria-hidden"?: boolean | "true" | "false";
}

// The smile arc, traced from the official UsagePal logo SVG (256x256 viewBox).
const SMILE_PATH =
  "M38.8682 128.826C40.9839 124.807 46.1454 123.553 49.8691 126.154L61.3125 134.148C70.0001 140.218 80.7304 141.99 90.7305 139.901C96.1061 138.778 102.534 137.601 108.73 136.866C115.064 136.115 120.594 135.899 124.408 136.425C130.992 137.332 136.821 140.25 144.234 143.81C151.244 147.176 159.693 151.107 169.691 151.493C178.159 151.82 188.121 148.771 196.097 145.693C204.357 142.505 211.717 138.787 215.375 136.853C215.853 136.6 216.305 136.499 216.705 136.499C217.368 136.499 217.886 136.767 218.192 137.083C218.464 137.364 218.546 137.634 218.513 137.953C213.791 183.488 175.287 218.999 128.5 218.999C79.7036 218.999 39.9236 180.377 38.0674 132.039C38.0302 131.07 38.2723 129.958 38.8682 128.826Z";

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
      {/* The circle is painted with currentColor; the smile is punched out as a
          hole via a mask so the background shows through. */}
      <mask id="usagepal-smile-cutout" maskUnits="userSpaceOnUse">
        {/* white = keep, black = cut a hole */}
        <rect width="256" height="256" fill="white" />
        <path d={SMILE_PATH} fill="black" stroke="black" strokeWidth="16" strokeLinecap="round" />
      </mask>
      <circle
        cx="128"
        cy="128"
        r="120"
        fill="currentColor"
        stroke="currentColor"
        strokeWidth="16"
        mask="url(#usagepal-smile-cutout)"
      />
    </svg>
  );
}
