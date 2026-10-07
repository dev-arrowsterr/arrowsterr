// Brand rule: always use the logo image with a fixed height. Never type the name as text.
export const LOGO_URL =
  "https://arrowsterr.com/wp-content/uploads/2026/10/Arrowsterr-Logo.png";

type Size = "sm" | "md" | "lg";

export function Logo({
  size = "md",
  invert = false,
}: {
  size?: Size;
  invert?: boolean;
}) {
  const className = `aw-logo aw-logo--${size}${invert ? " aw-logo--invert" : ""}`;
  // eslint-disable-next-line @next/next/no-img-element
  return <img src={LOGO_URL} alt="Arrowsterr" className={className} />;
}
