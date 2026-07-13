/** Small inline SVG icons for chrome (top bar / session rail). */

export function GearIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M6.3 1.5h3.4l.3 1.4a5 5 0 0 1 1.2.7l1.4-.5 1.7 2.9-1.1 1c.05.3.08.6.08.9s-.03.6-.08.9l1.1 1-1.7 2.9-1.4-.5a5 5 0 0 1-1.2.7l-.3 1.4H6.3l-.3-1.4a5 5 0 0 1-1.2-.7l-1.4.5L1.7 9.9l1.1-1A5 5 0 0 1 2.7 8c0-.3.03-.6.08-.9l-1.1-1 1.7-2.9 1.4.5a5 5 0 0 1 1.2-.7l.3-1.4Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <circle cx="8" cy="8" r="2.1" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  )
}

/** Command palette (top bar) — action first; shortcut lives in tooltip. */
export function CommandPaletteIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Command bar frame */}
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="2"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {/* Search lens */}
      <circle cx="6.2" cy="7.2" r="2" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M7.7 8.7 9.8 10.8"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
      {/* Palette list rows (right) */}
      <path
        d="M11 5.5h2.2M11 7.8h2.2M11 10.1h1.4"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        opacity="0.75"
      />
    </svg>
  )
}

/** Stage clipboard image (term toolbar). */
export function ImageStageIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="2"
        y="3"
        width="12"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="5.5" cy="6.5" r="1.2" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M2.8 11.2 5.6 8.6l2 1.8 2.4-2.8 3.2 3.6"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Upload image from file (term toolbar). */
export function ImageFileIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <path
        d="M3.5 2.5h5.2L12.5 6v7.5a1 1 0 0 1-1 1h-8a1 1 0 0 1-1-1v-10a1 1 0 0 1 1-1Z"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinejoin="round"
      />
      <path d="M8.5 2.5V6h3.5" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path
        d="M8 12.2V8.2m0 0 1.6 1.5M8 8.2 6.4 9.7"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}

/** Find in terminal scrollback. */
export function SearchIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <circle cx="7" cy="7" r="3.75" stroke="currentColor" strokeWidth="1.2" />
      <path
        d="M10 10.2 13.2 13.4"
        stroke="currentColor"
        strokeWidth="1.2"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Image actions menu trigger (term toolbar overflow). */
export function ImageMenuIcon({ size = 16 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      <rect
        x="1.75"
        y="3"
        width="12.5"
        height="10"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      <circle cx="5.3" cy="6.4" r="1.15" stroke="currentColor" strokeWidth="1.1" />
      <path
        d="M2.5 11.2 5.2 8.7l1.9 1.7 2.3-2.6 3.6 3.4"
        stroke="currentColor"
        strokeWidth="1.15"
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  )
}

/** Right tool sidebar toggle (panel open / closed). */
export function PanelIcon({ size = 16, open = true }: { size?: number; open?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden
    >
      {/* Outer frame */}
      <rect
        x="1.5"
        y="2.5"
        width="13"
        height="11"
        rx="1.5"
        stroke="currentColor"
        strokeWidth="1.2"
      />
      {/* Right panel strip */}
      {open ? (
        <>
          <path d="M10.5 2.5v11" stroke="currentColor" strokeWidth="1.2" />
          <rect x="11.1" y="4" width="2.2" height="2" rx="0.4" fill="currentColor" opacity="0.9" />
          <rect x="11.1" y="7" width="2.2" height="1.2" rx="0.3" fill="currentColor" opacity="0.55" />
          <rect x="11.1" y="9" width="2.2" height="1.2" rx="0.3" fill="currentColor" opacity="0.35" />
        </>
      ) : (
        <path
          d="M10.5 2.5v11"
          stroke="currentColor"
          strokeWidth="1.2"
          strokeDasharray="1.6 1.4"
          opacity="0.45"
        />
      )}
    </svg>
  )
}
