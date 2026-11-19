import React from 'react';
import { SukoyoMark, BRAND } from './SukoyoLogo.jsx';

const LoadingScreen = ({
  fullScreen = true,
  title = 'SUKOYO',
  subtitle = 'SUKOYO BUSINESS SUITE',
}) => {
  return (
    <div
      className={`${fullScreen ? 'fixed inset-0 z-[9999]' : 'w-full h-full min-h-[400px]'} bg-black flex flex-col items-center justify-center p-6 text-white font-sans select-none overflow-hidden transition-all duration-300`}
    >
      <style>{`
        @keyframes skPulseGlow {
          0%,100% { filter: drop-shadow(0 0 10px rgba(198,241,53,0.35)); transform: scale(1); }
          50% { filter: drop-shadow(0 0 28px rgba(198,241,53,0.85)); transform: scale(1.04); }
        }
        @keyframes skBar {
          0% { transform: scaleX(0); } 50% { transform: scaleX(1); } 100% { transform: scaleX(0); }
        }
        .sk-glow { animation: skPulseGlow 1.6s ease-in-out infinite; }
      `}</style>

      <div className="flex flex-col items-center justify-center">
        <div className="sk-glow">
          <SukoyoMark size={112} variant="lime" />
        </div>

        {title && (
          <p
            className="mt-7 text-xl font-extrabold tracking-[0.25em]"
            style={{ color: BRAND.lime }}
          >
            {title}
          </p>
        )}

        {/* progress bar */}
        <div className="mt-6 w-40 h-[3px] rounded-full bg-white/10 overflow-hidden">
          <div
            className="h-full w-full origin-left rounded-full"
            style={{ background: BRAND.lime, animation: 'skBar 1.6s ease-in-out infinite' }}
          />
        </div>

        {subtitle && (
          <p className="text-[8px] sm:text-[9px] font-semibold tracking-[0.35em] text-zinc-500 uppercase mt-6 opacity-85">
            {subtitle}
          </p>
        )}
      </div>
    </div>
  );
};

export default LoadingScreen;
