/** Small line icons, decorative: the buttons that use them carry the accessible name. */
interface IconProps {
  size?: number;
}

function Svg({ size = 20, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {children}
    </svg>
  );
}

export const SearchIcon = (props: IconProps) => (
  <Svg {...props}>
    <circle cx="11" cy="11" r="6.5" />
    <path d="m16 16 4.5 4.5" />
  </Svg>
);

export const SidebarIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
    <path d="M9.5 4.5v15" />
  </Svg>
);

export const NewChatIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 4.5H6.5a2 2 0 0 0-2 2v11a2 2 0 0 0 2 2h11a2 2 0 0 0 2-2V12" />
    <path d="M17.6 3.6a1.9 1.9 0 0 1 2.8 2.8L13 13.8l-3.5.8.8-3.5z" />
  </Svg>
);

export const PencilIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M15.6 4.6a2 2 0 0 1 2.8 2.8L8 17.8l-3.8 1 1-3.8z" />
  </Svg>
);

export const TrashIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M4.5 7h15M10 11v6M14 11v6M6.5 7l1 12a1.5 1.5 0 0 0 1.5 1.4h6a1.5 1.5 0 0 0 1.5-1.4l1-12M9.5 7V5a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v2" />
  </Svg>
);

export const CloseIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m6 6 12 12M18 6 6 18" />
  </Svg>
);

export const ChevronIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m8 10 4-4 4 4M8 14l4 4 4-4" />
  </Svg>
);

export const PlusIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 5v14M5 12h14" />
  </Svg>
);

export const SendIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M5 12h13M13 6l6 6-6 6" />
  </Svg>
);

/** A shield with a check: verified sources. */
export const VerifiedIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 3.5 5 6.5v5c0 4.2 3 7.6 7 9 4-1.4 7-4.8 7-9v-5z" />
    <path d="m9 12 2.2 2.2L15.5 10" />
  </Svg>
);

/** A light bulb: the answer type (normal or reasoned). */
export const ReasonIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M9.5 18h5M10.5 21h3" />
    <path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1v.1h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z" />
  </Svg>
);

export const DownloadIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 4v11M7 10.5l5 5 5-5M5 19.5h14" />
  </Svg>
);

export const ShareIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="M12 15V4M8 7.5l4-4 4 4M7.5 10.5H6a1 1 0 0 0-1 1V19a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-7.5a1 1 0 0 0-1-1h-1.5" />
  </Svg>
);

export const CopyIcon = (props: IconProps) => (
  <Svg {...props}>
    <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
    <path d="M15.5 8.5V6a1.5 1.5 0 0 0-1.5-1.5H6A1.5 1.5 0 0 0 4.5 6v8A1.5 1.5 0 0 0 6 15.5h2.5" />
  </Svg>
);

export const CheckIcon = (props: IconProps) => (
  <Svg {...props}>
    <path d="m5 12.5 4.5 4.5L19 7.5" />
  </Svg>
);
