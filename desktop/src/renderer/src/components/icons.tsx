import type { SVGProps } from 'react'

/**
 * Shared 24-viewBox stroke icons (Lucide-style geometry). Size via CSS on the
 * consuming class (`.nav-ic`, `.ibtn svg`, `.btn svg`) — none is hardcoded here.
 */
function base(props: SVGProps<SVGSVGElement>): SVGProps<SVGSVGElement> {
  return {
    viewBox: '0 0 24 24',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: 2,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
    'aria-hidden': true,
    ...props
  }
}

export const IconChevronLeft = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}><path d="m15 18-6-6 6-6" /></svg>
)
export const IconChevronRight = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}><path d="m9 18 6-6-6-6" /></svg>
)
export const IconChevronDown = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}><path d="m6 9 6 6 6-6" /></svg>
)
export const IconSparkles = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M19 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </svg>
)
export const IconCompass = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="m15.5 8.5-2 5-5 2 2-5z" />
  </svg>
)
export const IconUsers = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
    <path d="M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
)
export const IconShapes = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <path d="M8.3 10 12 3l3.7 7z" />
    <rect x="3" y="14" width="7" height="7" rx="1" />
    <circle cx="17.5" cy="17.5" r="3.5" />
  </svg>
)
export const IconImage = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <rect x="3" y="3" width="18" height="18" rx="2" />
    <circle cx="9" cy="9" r="2" />
    <path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21" />
  </svg>
)
export const IconBookmark = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}><path d="m19 21-7-4-7 4V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z" /></svg>
)
export const IconHeart = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <path d="M20.8 4.6a5.5 5.5 0 0 0-7.8 0L12 5.6l-1-1a5.5 5.5 0 0 0-7.8 7.8l1 1L12 21l7.8-7.6 1-1a5.5 5.5 0 0 0 0-7.8z" />
  </svg>
)
export const IconDownload = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <path d="M12 3v12" />
    <path d="m7 10 5 5 5-5" />
    <path d="M5 21h14" />
  </svg>
)
export const IconClock = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
)
export const IconGear = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M12 2v2m0 16v2M4.9 4.9l1.4 1.4m11.4 11.4 1.4 1.4M2 12h2m16 0h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" />
  </svg>
)
export const IconLogout = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
    <path d="m16 17 5-5-5-5" />
    <path d="M21 12H9" />
  </svg>
)
export const IconX = (p: SVGProps<SVGSVGElement>): JSX.Element => (
  <svg {...base(p)}>
    <path d="M18 6 6 18" />
    <path d="m6 6 12 12" />
  </svg>
)
