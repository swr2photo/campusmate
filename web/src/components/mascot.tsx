import { cn } from '@/lib/utils';

// The CampusMate mascot from the app (src/components/illustrations/Mascot.js),
// redrawn as a small SVG for the web pages. Decorative only.
const COLORS = {
  outline: '#1C1C22',
  body: '#5AAEFF',
  blush: '#FF9F7A',
  heart: '#FFA866',
  white: '#FFFFFF',
};

export function Mascot({
  size = 96,
  mood = 'happy',
  className,
}: {
  size?: number;
  mood?: 'happy' | 'calm' | 'wow';
  className?: string;
}) {
  return (
    <svg
      aria-hidden
      viewBox="0 0 120 132"
      width={size}
      height={(size * 132) / 120}
      className={cn('shrink-0', className)}
    >
      <path
        d="M60 12c-4-7-15-6-15 3 0 7 9 12 15 17 6-5 15-10 15-17 0-9-11-10-15-3Z"
        fill={COLORS.heart}
        stroke={COLORS.outline}
        strokeWidth="3"
        strokeLinejoin="round"
      />
      <ellipse cx="18" cy="88" rx="9" ry="13" fill={COLORS.body} stroke={COLORS.outline} strokeWidth="3.5" transform="rotate(20 18 88)" />
      <ellipse cx="102" cy="88" rx="9" ry="13" fill={COLORS.body} stroke={COLORS.outline} strokeWidth="3.5" transform="rotate(-20 102 88)" />
      <path
        d="M60 30c30 0 44 22 44 52 0 30-18 44-44 44S16 112 16 82c0-30 14-52 44-52Z"
        fill={COLORS.body}
        stroke={COLORS.outline}
        strokeWidth="4"
      />
      <ellipse cx="38" cy="92" rx="8" ry="4.5" fill={COLORS.blush} opacity="0.85" />
      <ellipse cx="82" cy="92" rx="8" ry="4.5" fill={COLORS.blush} opacity="0.85" />
      {[46, 74].map((x) => (
        <g key={x}>
          <circle cx={x} cy="74" r="10" fill={COLORS.white} stroke={COLORS.outline} strokeWidth="3" />
          <circle cx={x} cy={mood === 'calm' ? 76 : 74} r="5.5" fill={COLORS.outline} />
          <circle cx={x + 2} cy="71.5" r="1.9" fill={COLORS.white} />
        </g>
      ))}
      {mood === 'wow' ? (
        <ellipse cx="60" cy="96" rx="4.5" ry="5.5" fill={COLORS.outline} />
      ) : (
        <path
          d={mood === 'calm' ? 'M53 94q7 5 14 0' : 'M51 92q9 9 18 0'}
          fill="none"
          stroke={COLORS.outline}
          strokeWidth="3.5"
          strokeLinecap="round"
        />
      )}
    </svg>
  );
}
