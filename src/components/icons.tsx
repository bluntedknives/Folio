/** Icons hand-drawn as inline SVG. No icon package, no logo soup. */

type IconProps = { className?: string };

const base = {
  viewBox: "0 0 24 24",
  fill: "none",
  stroke: "currentColor",
  strokeWidth: 1.5,
  strokeLinecap: "round" as const,
  strokeLinejoin: "round" as const,
  "aria-hidden": true,
};

export function PlusIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** A paper plane, tilted, drawn as a single folded shape. The send affordance. */
export function SendIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={1.7}>
      <path d="M4.6 11.9 19.3 4.7c.6-.3 1.2.3.9.9l-7.2 14.7c-.3.6-1.2.5-1.4-.1l-1.5-5.2a.8.8 0 0 0-.5-.5L4.4 13c-.6-.2-.7-1.1.2-1.1Z" />
      <path d="M10.2 14.3 20 4.9" />
    </svg>
  );
}

export function StopIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <rect x="7" y="7" width="10" height="10" rx="1.5" />
    </svg>
  );
}

export function ImageIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <circle cx="8.75" cy="9.5" r="1.5" />
      <path d="M3.5 17.5 9 12.5l3.5 3 3-2.5 5 5" />
    </svg>
  );
}

/** Paperclip for the attach button. */
export function PaperclipIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 11.3 12.1 19a4.6 4.6 0 0 1-6.5-6.5l7.4-7.4a3 3 0 0 1 4.2 4.2l-7.3 7.4a1.4 1.4 0 0 1-2-2l6.6-6.6" />
    </svg>
  );
}

/** Document with a folded corner, for a PDF attachment chip. */
export function DocumentIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 3h7l5 5v13H6z" />
      <path d="M13 3v5h5" />
    </svg>
  );
}

/** Waveform, for an audio attachment chip. */
export function AudioIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 10v4M8 7v10M12 4.5v15M16 8v8M20 11v2" />
    </svg>
  );
}

/** Globe with a meridian, for web sources. */
export function GlobeIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M3.5 12h17M12 3.5c2.4 2.6 3.6 5.5 3.6 8.5S14.4 18.4 12 20.5c-2.4-2.1-3.6-5.5-3.6-8.5S9.6 6.1 12 3.5Z" />
    </svg>
  );
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M9 6l6 6-6 6" />
    </svg>
  );
}

/** Reasoning marker: three descending lines, not a brain or a sparkle. */
export function ThoughtIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 7h16M4 12h11M4 17h6" />
    </svg>
  );
}

export function CopyIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="9" y="9" width="11" height="11" rx="2.5" />
      <path d="M15 5.5A2.5 2.5 0 0 0 12.5 4H6.5A2.5 2.5 0 0 0 4 6.5v6A2.5 2.5 0 0 0 5.5 15" />
    </svg>
  );
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M5 12.5l4.5 4.5L19 7" />
    </svg>
  );
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 7h16M9.5 7V5.5A1.5 1.5 0 0 1 11 4h2a1.5 1.5 0 0 1 1.5 1.5V7M6.5 7l.8 11a2 2 0 0 0 2 1.9h5.4a2 2 0 0 0 2-1.9l.8-11" />
    </svg>
  );
}

export function PanelIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3" y="4" width="18" height="16" rx="2.5" />
      <path d="M9.5 4v16" />
    </svg>
  );
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="4.5" y="10.5" width="15" height="9.5" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  );
}

export function XIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M6 6l12 12M18 6 6 18" />
    </svg>
  );
}

/** App mark: a smiley face. Two eyes and a wide, friendly smile. */
export function FolioMark({ className }: IconProps) {
  return (
    <svg {...base} className={className} strokeWidth={1.7}>
      <circle cx="12" cy="12" r="8.75" />
      <path d="M8.5 9.75h.01M15.5 9.75h.01" strokeWidth={2.4} />
      <path d="M8.25 14.25a4.6 4.6 0 0 0 7.5 0" />
    </svg>
  );
}

/** Sun, shown in light mode to switch to dark. */
export function SunIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="4.25" />
      <path d="M12 2.75v2M12 19.25v2M2.75 12h2M19.25 12h2M5.5 5.5l1.4 1.4M17.1 17.1l1.4 1.4M18.5 5.5l-1.4 1.4M6.9 17.1l-1.4 1.4" />
    </svg>
  );
}

/** Moon, shown in dark mode to switch to light. */
export function MoonIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 14.2A8.25 8.25 0 0 1 9.8 4a8.5 8.5 0 1 0 10.2 10.2Z" />
    </svg>
  );
}

/** Graph/plot icon for the custom plotter. */
export function PlotIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M4 4v16h16" />
      <path d="M7 15c1.6-4.5 3-6.8 4.2-6.8 1.5 0 2 3.4 3 3.4.8 0 1.4-.9 2-2.6" />
    </svg>
  );
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M20 12a8 8 0 1 1-2.6-5.9" />
      <path d="M20 4v4h-4" />
    </svg>
  );
}

export function DownloadIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 4v11" />
      <path d="M7.5 10.5 12 15l4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </svg>
  );
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="11" cy="11" r="6.5" />
      <path d="m16 16 4 4" />
    </svg>
  );
}

export function ArrowDownIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <path d="M12 5v14M6 13l6 6 6-6" />
    </svg>
  );
}

/** Ring with a gap. Pair with the `spin` class for the working indicator. */
export function SpinnerIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <circle cx="12" cy="12" r="8.5" opacity="0.22" />
      <path d="M20.5 12a8.5 8.5 0 0 0-8.5-8.5" />
    </svg>
  );
}

/** Monitor outline, for the screen-share affordance. */
export function ScreenIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="2.75" y="4.5" width="18.5" height="12.5" rx="2" />
      <path d="M9 20.5h6M12 17v3.5" />
    </svg>
  );
}

/** Solid triangle. The Play affordance in Study mode. */
export function PlayIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden className={className}>
      <path d="M8 5.6c0-.8.9-1.3 1.6-.9l8.3 5.5c.6.4.6 1.3 0 1.7l-8.3 5.5c-.7.4-1.6-.1-1.6-.9Z" />
    </svg>
  );
}

/** Square with an arrow leaving it, for popping the panel into a floating window. */
export function PopOutIcon({ className }: IconProps) {
  return (
    <svg {...base} className={className}>
      <rect x="3.5" y="6.5" width="13" height="14" rx="2" />
      <path d="M13 3.5h7.5V11" />
      <path d="M20.5 3.5 11 13" />
    </svg>
  );
}
