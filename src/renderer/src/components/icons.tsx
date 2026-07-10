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
