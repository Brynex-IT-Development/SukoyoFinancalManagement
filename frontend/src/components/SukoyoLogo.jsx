// Sukoyo brand wordmark — stacked "SUK / OYO" block mark in brand lime.
// Recreates the logo look with pure CSS/SVG so it scales crisply and theme-adapts.

export const BRAND = {
  lime: '#C6F135',
  limeSoft: '#D7F76A',
  limeDeep: '#A8D11E',
  ink: '#0A0A0A',
  inkSoft: '#141414',
};

/**
 * SukoyoMark — the square stacked logo (SUK over OYO).
 * variant: 'lime' (lime tile, black text) | 'dark' (black tile, lime text) | 'ghost' (transparent, lime text)
 */
export const SukoyoMark = ({ size = 72, variant = 'lime', className = '' }) => {
  const styles = {
    lime: { bg: BRAND.lime, fg: BRAND.ink },
    dark: { bg: BRAND.ink, fg: BRAND.lime },
    ghost: { bg: 'transparent', fg: BRAND.lime },
  }[variant];

  return (
    <div
      className={className}
      style={{
        width: size,
        height: size,
        background: styles.bg,
        borderRadius: size * 0.16,
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        lineHeight: 0.84,
        fontWeight: 800,
        letterSpacing: size * 0.01,
        color: styles.fg,
        fontFamily: '"Instrument Sans", system-ui, sans-serif',
        fontStretch: 'condensed',
        userSelect: 'none',
        padding: size * 0.1,
        boxSizing: 'border-box',
      }}
      aria-label="Sukoyo"
    >
      <span style={{ fontSize: size * 0.34 }}>SUK</span>
      <span style={{ fontSize: size * 0.34 }}>OYO</span>
    </div>
  );
};

/** SukoyoWordmark — horizontal "SUKOYO" lockup (mark + text). */
export const SukoyoWordmark = ({ markSize = 44, text = true, variant = 'lime', className = '' }) => (
  <div className={`flex items-center gap-3 ${className}`}>
    <SukoyoMark size={markSize} variant={variant} />
    {text && (
      <span
        className="font-extrabold tracking-tight"
        style={{
          fontSize: markSize * 0.62,
          color: BRAND.lime,
          fontFamily: '"Instrument Sans", system-ui, sans-serif',
          letterSpacing: '-0.02em',
        }}
      >
        SUKOYO
      </span>
    )}
  </div>
);

/** SukoyoBadge — compact circular mark for the collapsed sidebar rail. */
export const SukoyoBadge = ({ size = 42, className = '' }) => (
  <div
    className={className}
    style={{
      width: size,
      height: size,
      borderRadius: '50%',
      background: BRAND.lime,
      display: 'grid',
      placeItems: 'center',
      color: BRAND.ink,
      fontWeight: 800,
      fontSize: size * 0.5,
      fontFamily: '"Instrument Sans", system-ui, sans-serif',
      lineHeight: 1,
      userSelect: 'none',
      boxShadow: '0 6px 18px -6px rgba(198,241,53,.55)',
    }}
    aria-label="Sukoyo"
  >
    S
  </div>
);

export default SukoyoMark;
