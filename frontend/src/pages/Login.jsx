import { useState } from 'react';
import { FiMail, FiEye, FiEyeOff, FiLock, FiArrowRight } from 'react-icons/fi';
import baseUrl from '../api/api';
import { useNavigate } from 'react-router-dom';
import LoadingScreen from '../components/LoadingScreen.jsx';
import { customAlert } from '../utils/customAlert.jsx';
import { SukoyoMark, SukoyoWordmark, BRAND } from '../components/SukoyoLogo.jsx';

const Login = () => {
  const [email, setEmail] = useState('');
  const [EmpId, setEmpId] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [loading, setLoading] = useState(false);
  const navigate = useNavigate();

  const handleSubmit = async (e) => {
    e.preventDefault();
    try {
      setLoading(true);
      const response = await fetch(baseUrl.baseUrl + 'user/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), EmpId: EmpId.trim() }),
      });

      const data = await response.json();

      if (response.ok) {
        localStorage.setItem('rootfinuser', JSON.stringify(data.user));
        navigate('/');
      } else {
        await customAlert('Login failed: ' + (data.message || 'Unknown error'), 'error');
      }
    } catch (error) {
      console.error('Error during login:', error);
      await customAlert('An error occurred during login', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen w-full flex bg-[#0A0A0A] text-white font-sans overflow-hidden relative">
      {loading && <LoadingScreen title="SUKOYO" subtitle="SUKOYO BUSINESS SUITE" />}

      <style>{`
        @keyframes floatOrb {
          0%,100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(30px,-40px) scale(1.08); }
        }
        @keyframes floatOrb2 {
          0%,100% { transform: translate(0,0) scale(1); }
          50% { transform: translate(-40px,30px) scale(1.12); }
        }
        @keyframes riseIn {
          from { opacity: 0; transform: translateY(18px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes fadeIn { from { opacity: 0; } to { opacity: 1; } }
        /* No base opacity:0 — if animations are disabled (reduced motion / battery saver
           on phones) the form must still be visible. "both" applies the 0% frame during the delay. */
        .rise { animation: riseIn .7s cubic-bezier(.2,.7,.2,1) both; }
        @media (prefers-reduced-motion: reduce) { .rise { opacity: 1 !important; transform: none !important; } }
        .d1 { animation-delay: .05s; } .d2 { animation-delay: .15s; }
        .d3 { animation-delay: .25s; } .d4 { animation-delay: .35s; }
        .d5 { animation-delay: .45s; } .d6 { animation-delay: .55s; }
        .sk-input:focus { border-color: ${BRAND.lime}; box-shadow: 0 0 0 3px rgba(198,241,53,.18); }
      `}</style>

      {/* Ambient animated background */}
      <div className="pointer-events-none absolute inset-0 overflow-hidden">
        <div
          className="absolute -top-32 -left-24 w-[520px] h-[520px] rounded-full blur-[120px] opacity-[0.16]"
          style={{ background: BRAND.lime, animation: 'floatOrb 14s ease-in-out infinite' }}
        />
        <div
          className="absolute -bottom-40 left-1/3 w-[460px] h-[460px] rounded-full blur-[130px] opacity-[0.10]"
          style={{ background: BRAND.limeDeep, animation: 'floatOrb2 18s ease-in-out infinite' }}
        />
        <div
          className="absolute inset-0 opacity-[0.04]"
          style={{
            backgroundImage:
              'linear-gradient(rgba(255,255,255,.6) 1px,transparent 1px),linear-gradient(90deg,rgba(255,255,255,.6) 1px,transparent 1px)',
            backgroundSize: '48px 48px',
            maskImage: 'radial-gradient(ellipse at center,black,transparent 72%)',
          }}
        />
      </div>

      {/* LEFT — brand panel (desktop only) */}
      <div className="hidden lg:flex flex-col justify-between w-[46%] relative z-10 p-14 xl:p-16">
        <div className="rise d1">
          <SukoyoWordmark markSize={46} />
        </div>

        <div className="max-w-md">
          <div className="rise d2 inline-flex items-center gap-2 mb-7 px-3 py-1.5 rounded-full border border-white/10 bg-white/[0.03] text-xs font-medium text-zinc-300">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: BRAND.lime }} />
            Business Suite
          </div>
          <h1 className="rise d3 text-5xl xl:text-6xl font-extrabold leading-[1.05] tracking-tight">
            Run your<br />
            business with{' '}
            <span style={{ color: BRAND.lime }}>clarity.</span>
          </h1>
          <p className="rise d4 mt-6 text-zinc-400 text-lg leading-relaxed max-w-sm">
            One place for sales, inventory and finance — fast, precise and built for the way you work.
          </p>
        </div>

        <div className="rise d5 flex items-center gap-6 text-xs text-zinc-500">
          <span>Secure access</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span>Real-time data</span>
          <span className="w-1 h-1 rounded-full bg-zinc-700" />
          <span>© {new Date().getFullYear()} Sukoyo</span>
        </div>
      </div>

      {/* RIGHT — form */}
      <div className="flex-1 flex items-center justify-center p-6 sm:p-10 relative z-10">
        <div className="w-full max-w-[440px]">
          {/* Mobile brand */}
          <div className="lg:hidden flex justify-center mb-8 rise d1">
            <SukoyoMark size={64} />
          </div>

          <div className="rise d2 rounded-[28px] border border-white/[0.08] bg-white/[0.035] backdrop-blur-xl p-8 sm:p-10 shadow-[0_30px_80px_-20px_rgba(0,0,0,0.8)]">
            <h2 className="text-3xl font-extrabold tracking-tight">Welcome back</h2>
            <p className="text-zinc-400 mt-2 mb-8 text-sm">
              Sign in to continue to your Sukoyo workspace.
            </p>

            <form onSubmit={handleSubmit} className="space-y-5">
              {/* Email */}
              <div className="rise d3">
                <label className="block text-xs font-semibold text-zinc-300 mb-2 tracking-wide">
                  EMAIL
                </label>
                <div className="relative">
                  <FiMail className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 text-lg" />
                  <input
                    type="email"
                    className="sk-input w-full bg-black/40 border border-white/10 rounded-xl pl-11 pr-4 py-3.5 text-sm text-white placeholder-zinc-500 outline-none transition-all duration-200"
                    placeholder="you@company.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
              </div>

              {/* Password / Emp Id */}
              <div className="rise d4">
                <label className="block text-xs font-semibold text-zinc-300 mb-2 tracking-wide">
                  PASSWORD
                </label>
                <div className="relative">
                  <FiLock className="absolute left-4 top-1/2 -translate-y-1/2 text-zinc-500 text-lg" />
                  <input
                    type={showPassword ? 'text' : 'password'}
                    className="sk-input w-full bg-black/40 border border-white/10 rounded-xl pl-11 pr-12 py-3.5 text-sm text-white placeholder-zinc-500 outline-none transition-all duration-200"
                    placeholder="Enter your password"
                    value={EmpId}
                    onChange={(e) => setEmpId(e.target.value)}
                    required
                  />
                  <button
                    type="button"
                    className="absolute right-3.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-white transition-colors cursor-pointer"
                    onClick={() => setShowPassword((p) => !p)}
                    aria-label={showPassword ? 'Hide password' : 'Show password'}
                  >
                    {showPassword ? <FiEyeOff /> : <FiEye />}
                  </button>
                </div>
              </div>

              {/* Submit */}
              <div className="rise d5 pt-2">
                <button
                  type="submit"
                  disabled={loading}
                  className="group w-full flex items-center justify-center gap-2 py-3.5 rounded-xl text-base font-bold text-black transition-all duration-200 cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 active:scale-[0.99]"
                  style={{
                    background: loading ? BRAND.limeDeep : BRAND.lime,
                    boxShadow: '0 10px 30px -8px rgba(198,241,53,0.5)',
                  }}
                  onMouseEnter={(e) => !loading && (e.currentTarget.style.background = BRAND.limeSoft)}
                  onMouseLeave={(e) => !loading && (e.currentTarget.style.background = BRAND.lime)}
                >
                  {loading ? 'Signing in…' : 'Sign in'}
                  {!loading && (
                    <FiArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
                  )}
                </button>
              </div>
            </form>
          </div>

          <p className="rise d6 text-center text-xs text-zinc-600 mt-6">
            © {new Date().getFullYear()} Sukoyo. All rights reserved.
          </p>
        </div>
      </div>
    </div>
  );
};

export default Login;
