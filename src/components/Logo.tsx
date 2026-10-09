// Brand rule: always use the logo file with a fixed height. Never type the name as text.
// Files live in public/brand and come from brand/logo/set (built by brand/logo/build_logo.py).
export const LOGO_URL = "/brand/arrowsterr-logo-color.svg";
export const LOGO_WHITE_URL = "/brand/arrowsterr-logo-white.svg";

type Size = "sm" | "md" | "lg";

export function Logo({
  size = "md",
  invert = false,
}: {
  size?: Size;
  invert?: boolean;
}) {
  const className = `aw-logo aw-logo--${size}`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={invert ? LOGO_WHITE_URL : LOGO_URL} alt="Arrowsterr" className={className} />;
}
