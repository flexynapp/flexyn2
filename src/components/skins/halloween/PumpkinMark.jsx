// src/components/skins/halloween/PumpkinMark.jsx
//
// The Halloween skin's one ornament. Drawn rather than an icon because
// lucide has no pumpkin, and drawn from tokens so it follows light/dark:
// the body is --primary (the brand orange already is pumpkin) and the
// stem is the foreground ink. No new hue.

export default function PumpkinMark({ className = 'w-4 h-4', face = false, style }) {
  return (
    <svg viewBox="0 0 24 24" className={className} style={style} aria-hidden="true" focusable="false">
      <path
        d="M12.4 6.2c.2-1.6 1-2.8 2.4-3.4"
        fill="none"
        stroke="hsl(var(--foreground))"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <ellipse cx="7.6" cy="13.6" rx="5" ry="7" fill="hsl(var(--primary))" />
      <ellipse cx="16.4" cy="13.6" rx="5" ry="7" fill="hsl(var(--primary))" />
      <ellipse cx="12" cy="13.6" rx="4.4" ry="7.4" fill="hsl(var(--primary))" />
      <path
        d="M12 6.8v13.6M8.6 7.6c-1.6 3.6-1.6 8.4 0 12M15.4 7.6c1.6 3.6 1.6 8.4 0 12"
        fill="none"
        stroke="hsl(var(--foreground) / 0.25)"
        strokeWidth="1"
      />
      {face && (
        // Carved face, cut in the background colour so it reads as a hole.
        <path
          d="M6.6 11.4L9.4 11.4L8 9.2ZM14.6 11.4L17.4 11.4L16 9.2ZM11.2 13.4L12.8 13.4L12 12.2ZM6.4 15.2Q12 19.6 17.6 15.2L16 16.2L15 15.4L13.6 16.6L12 15.6L10.4 16.6L9 15.4L8 16.2Z"
          fill="hsl(var(--background))"
        />
      )}
    </svg>
  );
}
