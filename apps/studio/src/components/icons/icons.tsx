/**
 * GROUNDTRUTH hand-rolled icon set (DESIGN_HANDOFF §4.4) — no emoji, no icon
 * package. Drafting-instrument voice: 16 px grid, 1.5 px stroke, square caps,
 * miter joins, `fill: none`, `currentColor`.
 *
 * Default usage is icon+label pairs → renders `aria-hidden="true"`. For
 * icon-only controls pass `title` to get `role="img"` + `<title>`.
 *
 * POI category mapping: Room / Service / Landmark / Furniture / Entrance, and
 * Grid for `other` — category is always icon + text, never color-only.
 */
import { type ReactNode, type SVGProps } from 'react';

export type IconProps = Omit<SVGProps<SVGSVGElement>, 'children'> & {
  /** Icon-only usage: adds role="img" and an accessible <title>. */
  title?: string;
};

function Icon({ title, ...props }: IconProps, children: ReactNode) {
  const a11y = title ? { role: 'img' as const } : { 'aria-hidden': true as const };
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...a11y}
      {...props}
    >
      {title ? <title>{title}</title> : null}
      {children}
    </svg>
  );
}

/* ---------- navigation / viewer ---------- */

export const Search = (props: IconProps) =>
  Icon(props, <>
    <circle cx="6.75" cy="6.75" r="4.25" />
    <path d="M9.9 9.9 14.5 14.5" />
  </>);

export const Route = (props: IconProps) =>
  Icon(props, <path d="M2.5 13.5v-4h5v-4h6" />);

export const Jump = (props: IconProps) =>
  Icon(props, <>
    <path d="M3.5 12.5 12.5 3.5" />
    <path d="M6.5 3.5h6v6" />
  </>);

export const Reset = (props: IconProps) =>
  Icon(props, <>
    <path d="M2.5 3.5v3.5h3.5" />
    <path d="M4.7 12.7A4.9 4.9 0 1 0 5.2 5.2L2.5 7.8" />
  </>);

export const Compass = (props: IconProps) =>
  Icon(props, <>
    <circle cx="8" cy="8" r="6" />
    <path d="M10.6 5.4 9.1 9.1 5.4 10.6 6.9 6.9z" />
  </>);

export const Grid = (props: IconProps) =>
  Icon(props, <>
    <rect x="2.5" y="2.5" width="11" height="11" />
    <path d="M8 2.5v11M2.5 8h11" />
  </>);

export const Layers = (props: IconProps) =>
  Icon(props, <>
    <path d="M8 1.5 14.5 5 8 8.5 1.5 5z" />
    <path d="M1.5 8 8 11.5 14.5 8" />
    <path d="M1.5 11 8 14.5 14.5 11" />
  </>);

/* ---------- capture ---------- */

export const Camera = (props: IconProps) =>
  Icon(props, <>
    <path d="M1.5 5.5h3.2l1.3-2h4l1.3 2h3.2v8.5h-13z" />
    <circle cx="8" cy="9.5" r="2.6" />
  </>);

export const Upload = (props: IconProps) =>
  Icon(props, <>
    <path d="M8 11.5V3.5" />
    <path d="M4.5 6.5 8 3l3.5 3.5" />
    <path d="M2.5 13.5h11" />
  </>);

export const Qr = (props: IconProps) =>
  Icon(props, <>
    <rect x="2" y="2" width="5" height="5" />
    <rect x="9" y="2" width="5" height="5" />
    <rect x="2" y="9" width="5" height="5" />
    <path d="M9 9h2v2H9zM12 12h2v2h-2zM12 9h2M9 12h2" />
  </>);

/* ---------- status ---------- */

export const Check = (props: IconProps) =>
  Icon(props, <path d="M3 8.5 6.5 12 13 4.5" />);

export const AlertTriangle = (props: IconProps) =>
  Icon(props, <>
    <path d="M8 2 15 13.5H1z" />
    <path d="M8 6.5v3" />
    <path d="M8 11.5v1" />
  </>);

export const XSquare = (props: IconProps) =>
  Icon(props, <>
    <rect x="2.5" y="2.5" width="11" height="11" />
    <path d="M6 6l4 4M10 6l-4 4" />
  </>);

export const Lock = (props: IconProps) =>
  Icon(props, <>
    <rect x="3.5" y="7.5" width="9" height="6.5" />
    <path d="M5.5 7.5V5.5a2.5 2.5 0 0 1 5 0v2" />
  </>);

export const Minus = (props: IconProps) =>
  Icon(props, <path d="M3 8h10" />);

/* ---------- chrome ---------- */

export const ChevronRight = (props: IconProps) =>
  Icon(props, <path d="M6 3.5 10.5 8 6 12.5" />);

export const ChevronDown = (props: IconProps) =>
  Icon(props, <path d="M3.5 6 8 10.5 12.5 6" />);

export const Plus = (props: IconProps) =>
  Icon(props, <path d="M8 3v10M3 8h10" />);

export const Close = (props: IconProps) =>
  Icon(props, <path d="M3.5 3.5l9 9M12.5 3.5l-9 9" />);

export const Play = (props: IconProps) =>
  Icon(props, <path d="M5 2.5 13 8l-8 5.5z" />);

export const Pause = (props: IconProps) =>
  Icon(props, <path d="M5.5 3v10M10.5 3v10" />);

export const Signal = (props: IconProps) =>
  Icon(props, <path d="M2.5 13.5v-3M6.5 13.5v-6M10.5 13.5v-9M14.5 13.5v-12" />);

/* ---------- POI categories (icon + text, never color-only) ---------- */

export const Room = (props: IconProps) =>
  Icon(props, <>
    <rect x="2.5" y="2.5" width="11" height="11" />
    <path d="M2.5 9.5h3v4" />
  </>);

export const Service = (props: IconProps) =>
  Icon(props, <>
    <circle cx="8" cy="8" r="2.5" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M12.6 3.4l-1.4 1.4M4.8 11.2l-1.4 1.4" />
  </>);

export const Landmark = (props: IconProps) =>
  Icon(props, <>
    <path d="M8 1.5 14.5 5h-13z" />
    <path d="M2.5 5v7.5M5.5 5v7.5M10.5 5v7.5M13.5 5v7.5" />
    <path d="M1.5 13.5h13" />
  </>);

export const Furniture = (props: IconProps) =>
  Icon(props, <>
    <path d="M3 7.5V6a1.5 1.5 0 0 1 1.5-1.5h7A1.5 1.5 0 0 1 13 6v1.5" />
    <path d="M2 7.5h12v4H2z" />
    <path d="M3.5 11.5v2M12.5 11.5v2" />
  </>);

export const Entrance = (props: IconProps) =>
  Icon(props, <>
    <rect x="9.5" y="2.5" width="4" height="11" />
    <path d="M2.5 8h6" />
    <path d="M6 5.5 8.5 8 6 10.5" />
  </>);

/** POI category → icon mapping (§4.4: category is icon + text, never color-only). */
export const CATEGORY_ICONS = {
  room: Room,
  service: Service,
  landmark: Landmark,
  furniture: Furniture,
  entrance: Entrance,
  other: Grid,
} as const;
