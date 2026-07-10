import type { SVGProps } from 'react'

function base(p: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...p
  }
}

export const IconHome = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M3 10.5 12 3l9 7.5" /><path d="M5 9.5V21h14V9.5" /></svg>
)
export const IconCompass = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><circle cx="12" cy="12" r="9" /><path d="m15.5 8.5-2 5-5 2 2-5z" /></svg>
)
export const IconImage = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><rect x="3" y="3" width="18" height="18" rx="2" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" /></svg>
)
export const IconDownload = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M12 3v12" /><path d="m7 10 5 5 5-5" /><path d="M5 21h14" /></svg>
)
export const IconUser = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>
)
export const IconUsers = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M22 21v-2a4 4 0 0 0-3-3.87" /><path d="M16 3.13a4 4 0 0 1 0 7.75" /></svg>
)
export const IconHeart = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" /></svg>
)
export const IconBookmark = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
)
export const IconX = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M18 6 6 18" /><path d="m6 6 12 12" /></svg>
)
export const IconCheck = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M20 6 9 17l-5-5" /></svg>
)
export const IconPlus = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M12 5v14" /><path d="M5 12h14" /></svg>
)
export const IconChevronLeft = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="m15 18-6-6 6-6" /></svg>
)
export const IconPlay = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base({ ...p, fill: 'currentColor', stroke: 'none' })}><path d="M8 5v14l11-7z" /></svg>
)
export const IconShapes = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M8.3 10 12 3l3.7 7z" /><rect x="3" y="14" width="7" height="7" rx="1" /><circle cx="17.5" cy="17.5" r="3.5" /></svg>
)
export const IconLink = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.8 1.7" /><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.8-1.7" /></svg>
)
export const IconGear = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><circle cx="12" cy="12" r="3" /><path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
)
export const IconMuted = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M11 5 6 9H2v6h4l5 4z" /><path d="m23 9-6 6" /><path d="m17 9 6 6" /></svg>
)
export const IconSound = (p: SVGProps<SVGSVGElement>): React.JSX.Element => (
  <svg {...base(p)}><path d="M11 5 6 9H2v6h4l5 4z" /><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M19 5a9 9 0 0 1 0 14" /></svg>
)
