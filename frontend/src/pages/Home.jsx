import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Link } from 'react-router-dom';
import Header from '../components/Header';
import {
  Wallet, ShoppingBag, Package, TrendingUp, TrendingDown, ArrowUpRight, ArrowDownRight,
  RefreshCw, Store as StoreIcon, Globe, ReceiptText, Users, AlertCircle,
} from 'lucide-react';
import baseUrl from '../api/api';
import { useSidebar } from '../hooks/useSidebar.js';

/* Animated count-up: eases a number from its previous value → target. */
const useCountUp = (target = 0, duration = 1100) => {
  const [val, setVal] = useState(0);
  const ref = useRef();
  const fromRef = useRef(0);
  useEffect(() => {
    const prefersReduced = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
    if (prefersReduced) { setVal(target); fromRef.current = target; return; }
    const from = fromRef.current;
    const start = performance.now();
    const tick = (now) => {
      const p = Math.min(1, (now - start) / duration);
      const eased = 1 - Math.pow(1 - p, 3);
      setVal(from + (target - from) * eased);
      if (p < 1) ref.current = requestAnimationFrame(tick);
      else { setVal(target); fromRef.current = target; }
    };
    ref.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(ref.current);
  }, [target, duration]);
  return val;
};
const Count = ({ value, format }) => {
  const v = useCountUp(value);
  return <>{format ? format(v) : Math.round(v)}</>;
};

const fmt0 = (v) =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR', maximumFractionDigits: 0 }).format(Math.round(v || 0));
const num = (v) => new Intl.NumberFormat('en-IN').format(Math.round(v || 0));
const compact = (v) => {
  const n = Math.abs(v || 0), s = v < 0 ? '−' : '';
  if (n >= 10000000) return `${s}₹${(n / 10000000).toFixed(1)}Cr`;
  if (n >= 100000) return `${s}₹${(n / 100000).toFixed(1)}L`;
  if (n >= 1000) return `${s}₹${(n / 1000).toFixed(1)}K`;
  return `${s}₹${Math.round(n)}`;
};

/* % change chip. pct === null means there is nothing to compare with yet. */
const Change = ({ pct, dark, invert }) => {
  if (pct === null || pct === undefined) {
    return <span className={`inline-flex items-center text-[11px] font-bold px-2.5 py-1 rounded-full ${dark ? 'bg-white/10 text-zinc-300' : 'bg-gray-100 text-gray-500'}`}>New</span>;
  }
  const up = pct >= 0;
  const good = invert ? !up : up;
  const cls = dark
    ? (good ? 'bg-[#C6F135] text-black' : 'bg-red-500/20 text-red-300')
    : (good ? 'bg-[#f6fce6] text-[#65a30d]' : 'bg-[#fee2e2] text-[#dc2626]');
  const shown = Math.abs(pct) >= 1000 ? `${Math.round(Math.abs(pct) / 100) / 10}k` : Math.abs(pct);
  return (
    <span className={`inline-flex items-center gap-1 text-[12px] font-bold px-2.5 py-1 rounded-full whitespace-nowrap ${cls}`}>
      {up ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />} {shown}%
    </span>
  );
};

const Skeleton = ({ className = '' }) => <div className={`animate-pulse rounded-xl bg-gray-200/70 ${className}`} />;

const RANGES = [
  { key: '12h', label: '12h', prev: 'previous 12h' },
  { key: '24h', label: '24h', prev: 'previous day' },
  { key: 'week', label: '7 days', prev: 'previous 7 days' },
  { key: 'month', label: '30 days', prev: 'previous 30 days' },
];

const Home = ({ isSidebarOpen: propSidebarOpen }) => {
  const sidebarHookState = useSidebar();
  const isSidebarOpen = propSidebarOpen !== undefined ? propSidebarOpen : sidebarHookState;

  const currentUser = (() => { try { return JSON.parse(localStorage.getItem('rootfinuser')) || {}; } catch { return {}; } })();
  const myStore = { locCode: currentUser.locCode || '', locName: currentUser.username || currentUser.locName || 'This store' };

  const [scope, setScope] = useState(() => {
    try { return localStorage.getItem('sk_dash_scope') || 'all'; } catch { return 'all'; }
  });
  const [range, setRange] = useState('week');
  const [chartMode, setChartMode] = useState('weekly');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [mounted, setMounted] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const qs = scope === 'store' && myStore.locCode
        ? `?locCode=${encodeURIComponent(myStore.locCode)}&locName=${encodeURIComponent(myStore.locName)}`
        : '';
      const res = await fetch(`${baseUrl.baseUrl}api/dashboard/summary${qs}`);
      const json = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(json.message || 'Could not load the dashboard.');
      setData(json);
      setTimeout(() => setMounted(true), 60);
    } catch (e) {
      setError(e.message === 'Failed to fetch' ? 'Could not reach the server. Is the backend running?' : e.message);
    } finally {
      setLoading(false);
    }
  }, [scope, myStore.locCode, myStore.locName]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { try { localStorage.setItem('sk_dash_scope', scope); } catch { /* ignore */ } }, [scope]);

  const d = data;
  const order = d?.orders?.[range] || { count: 0, prevCount: 0, revenue: 0, changePct: 0 };
  const orderBar = Math.max(order.count, order.prevCount) > 0 ? (order.count / Math.max(order.count, order.prevCount)) * 100 : 0;

  const cust = d?.customers || { newThisMonth: 0, activeThisMonth: 0, total: 0, changePct: 0 };
  const newShare = cust.activeThisMonth ? cust.newThisMonth / cust.activeThisMonth : 0;
  const gaugeAnim = useCountUp(newShare * 100);

  const series = d?.chart?.[chartMode] || [];
  const maxVal = Math.max(1, ...series.map((s) => Math.max(0, s.value)));
  const maxIdx = series.findIndex((s) => s.value === maxVal);
  const seriesTotal = series.reduce((s, x) => s + x.value, 0);
  const seriesOrders = series.reduce((s, x) => s + (x.orders || 0), 0);

  const topItems = d?.topItems || [];
  const maxQty = Math.max(1, ...topItems.map((t) => t.quantity));

  const monthName = new Date().toLocaleDateString('en-IN', { month: 'long' });
  const card = 'rounded-[26px] bg-white border border-gray-100 p-6 shadow-sm';

  return (
    <>
      <Header />
      <div className={`transition-all duration-300 p-3 sm:p-6 bg-[#f4f5f3] min-h-screen pb-20 ${isSidebarOpen ? 'lg:ml-64 ml-0' : 'ml-0'}`}>

        {/* ── Page header ── */}
        <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-[32px] sm:text-[38px] font-extrabold text-gray-900 tracking-tight leading-none">Sales Overview</h1>
            <p className="text-[14px] text-gray-500 mt-2">
              {monthName} so far · {scope === 'store' ? myStore.locName : 'All stores'}
              {d?.generatedAt && <> · updated {new Date(d.generatedAt).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })}</>}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="flex items-center gap-1 p-1 rounded-full bg-white border border-gray-200 shadow-sm">
              {[
                { key: 'all', label: 'All stores', icon: Globe },
                ...(myStore.locCode ? [{ key: 'store', label: myStore.locName, icon: StoreIcon }] : []),
              ].map(({ key, label, icon: Icon }) => (
                <button
                  key={key}
                  onClick={() => setScope(key)}
                  className={`no-hover-anim inline-flex items-center gap-1.5 h-8 px-3.5 rounded-full text-[12px] font-semibold transition ${scope === key ? 'bg-[#15171D] text-white' : 'text-gray-500 hover:text-gray-900'}`}
                >
                  <Icon size={13} /> <span className="max-w-[140px] truncate">{label}</span>
                </button>
              ))}
            </div>
            <button
              onClick={load}
              disabled={loading}
              className="no-hover-anim grid place-items-center w-10 h-10 rounded-full bg-white border border-gray-200 shadow-sm text-gray-500 hover:text-gray-900 disabled:opacity-50"
              title="Refresh"
            >
              <RefreshCw size={15} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        {error && (
          <div className="mb-5 flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <span className="inline-flex items-center gap-2"><AlertCircle size={16} /> {error}</span>
            <button onClick={load} className="no-hover-anim font-semibold underline underline-offset-4">Try again</button>
          </div>
        )}

        {/* ── Row 1 : key metrics ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">

          <div className="flex flex-col gap-5">
            {/* Total Sales */}
            <div className="relative overflow-hidden rounded-[26px] bg-[#15171D] text-white p-6 flex-1 shadow-sm">
              <div className="absolute -top-16 -right-16 w-48 h-48 rounded-full bg-[#C6F135]/10 blur-2xl pointer-events-none" />
              <div className="flex items-start justify-between relative">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-white/10 grid place-items-center"><Wallet size={17} /></div>
                  <span className="text-[14px] font-medium text-zinc-300">Net Sales · this month</span>
                </div>
                <Link to="/reports/sales" className="text-[12px] font-semibold text-zinc-400 hover:text-[#C6F135]">Report →</Link>
              </div>
              {!d ? <Skeleton className="mt-6 h-10 w-48 bg-white/10" /> : (
                <>
                  <div className="mt-6 flex items-end gap-3 flex-wrap relative">
                    <h2 className="text-[34px] sm:text-[40px] font-extrabold tracking-tight leading-none tabular-nums"><Count value={d.sales.net} format={fmt0} /></h2>
                    <span className="mb-1"><Change pct={d.sales.changePct} dark /></span>
                  </div>
                  <p className="text-[13px] text-zinc-400 mt-2 relative">
                    {num(d.sales.invoices)} invoices
                    {d.sales.returns !== 0 && <> · {fmt0(Math.abs(d.sales.returns))} returned</>}
                    {' '}· vs {fmt0(d.sales.prevNet)} same time last month
                  </p>
                </>
              )}
            </div>

            {/* Total Purchase */}
            <div className={`${card} flex-1`}>
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-9 h-9 rounded-xl bg-[#f3f4f6] text-gray-700 grid place-items-center"><ShoppingBag size={17} /></div>
                  <span className="text-[14px] font-medium text-gray-500">Purchases · this month</span>
                </div>
                <Link to="/purchase/bills" className="text-[12px] font-semibold text-gray-400 hover:text-gray-900">Bills →</Link>
              </div>
              {!d ? <Skeleton className="mt-6 h-10 w-48" /> : (
                <>
                  <div className="mt-6 flex items-end gap-3 flex-wrap">
                    <h2 className="text-[34px] sm:text-[40px] font-extrabold tracking-tight leading-none text-gray-900 tabular-nums"><Count value={d.purchases.total} format={fmt0} /></h2>
                    <span className="mb-1"><Change pct={d.purchases.changePct} invert /></span>
                  </div>
                  <p className="text-[13px] text-gray-400 mt-2">
                    {num(d.purchases.bills)} bills · vs {fmt0(d.purchases.prevTotal)} same time last month
                  </p>
                </>
              )}
            </div>
          </div>

          {/* Orders */}
          <div className={`${card} flex flex-col`}>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-[15px] font-bold text-gray-900"><ReceiptText size={16} /> Orders</span>
              <Link to="/sales/invoices" className="text-[12px] font-semibold text-gray-400 hover:text-gray-900">Invoices →</Link>
            </div>
            <div className="flex gap-1.5 mt-4 text-[11px] font-semibold">
              {RANGES.map((r) => (
                <button
                  key={r.key}
                  onClick={() => setRange(r.key)}
                  className={`no-hover-anim px-3 py-1.5 rounded-full transition-all ${range === r.key ? 'bg-[#15171D] text-white' : 'bg-gray-100 text-gray-500 hover:bg-gray-200'}`}
                >
                  {r.label}
                </button>
              ))}
            </div>
            {!d ? <Skeleton className="mt-6 h-10 w-32" /> : (
              <>
                <div className="flex items-center gap-3 mt-6">
                  <h2 className="text-[40px] font-extrabold tracking-tight text-gray-900 leading-none tabular-nums"><Count value={order.count} format={num} /></h2>
                  <Change pct={order.changePct} />
                </div>
                <p className="text-[13px] text-gray-500 mt-2">{fmt0(order.revenue)} in sales</p>
                <div className="mt-auto pt-6">
                  <div className="h-5 w-full rounded-full bg-gray-100 overflow-hidden">
                    <div
                      className="h-full rounded-full transition-[width] duration-700 ease-out"
                      style={{ width: mounted ? `${orderBar}%` : '0%', backgroundImage: 'repeating-linear-gradient(45deg,#C6F135,#C6F135 8px,#bfe82f 8px,#bfe82f 16px)' }}
                    />
                  </div>
                  <div className="flex justify-between items-center mt-3">
                    <p className="text-[13px] text-gray-400">{num(order.prevCount)} in the {RANGES.find((r) => r.key === range)?.prev}</p>
                    <span className="text-[13px] font-bold text-gray-700">{num(d.orders.today)} today</span>
                  </div>
                </div>
              </>
            )}
          </div>

          {/* Customers gauge */}
          <div className={`${card} flex flex-col`}>
            <div className="flex items-center justify-between">
              <span className="inline-flex items-center gap-2 text-[15px] font-bold text-gray-900"><Users size={16} /> Customers</span>
              {d && <span className="text-[12px] font-semibold text-gray-400">{num(cust.total)} total</span>}
            </div>
            <div className="relative flex-1 flex items-center justify-center mt-2 min-h-[170px]">
              <svg viewBox="0 0 240 134" className="w-full max-w-[260px]">
                {Array.from({ length: 34 }).map((_, i) => {
                  const t = i / 33;
                  const ang = Math.PI * (1 + t);
                  const cx = 120, cy = 122, rI = 80, rO = 106;
                  const on = cust.activeThisMonth > 0 && t <= gaugeAnim / 100;
                  return (
                    <line key={i}
                      x1={cx + rI * Math.cos(ang)} y1={cy + rI * Math.sin(ang)}
                      x2={cx + rO * Math.cos(ang)} y2={cy + rO * Math.sin(ang)}
                      stroke={on ? '#C6F135' : '#E7EAEE'} strokeWidth="6" strokeLinecap="round" />
                  );
                })}
              </svg>
              <div className="absolute inset-0 flex flex-col items-center justify-end pb-1">
                {!d ? <Skeleton className="h-10 w-16" /> : (
                  <span className="text-[46px] font-extrabold text-gray-900 leading-none tabular-nums"><Count value={cust.newThisMonth} /></span>
                )}
                <span className="text-[13px] text-gray-400 mt-1">New customers this month</span>
              </div>
            </div>
            <div className="flex items-center justify-center gap-2 mt-3 bg-[#f6f7f5] rounded-full py-2 px-3 text-center">
              <span className="text-[12px] text-gray-500">
                {cust.activeThisMonth ? `${Math.round(newShare * 100)}% of ${num(cust.activeThisMonth)} buyers are new` : 'No buyers yet this month'}
              </span>
              {d && <Change pct={cust.changePct} />}
            </div>
          </div>
        </div>

        {/* ── Row 2 : sales chart + top items ── */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-5 mt-5">

          {/* Sales chart */}
          <div className={`lg:col-span-2 ${card}`}>
            <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
              <span className="text-[15px] font-bold text-gray-900">Sales trend</span>
              <div className="flex items-center gap-1 p-1 rounded-full bg-gray-100">
                {[['weekly', 'Last 7 days'], ['monthly', 'Last 6 months']].map(([k, l]) => (
                  <button
                    key={k}
                    onClick={() => setChartMode(k)}
                    className={`no-hover-anim h-7 px-3 rounded-full text-[12px] font-semibold transition ${chartMode === k ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-900'}`}
                  >
                    {l}
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-col sm:flex-row items-stretch gap-6">
              <div className="shrink-0 sm:w-[170px] flex flex-col justify-end">
                {!d ? <Skeleton className="h-10 w-32" /> : (
                  <h3 className="text-[34px] font-extrabold text-gray-900 leading-none tabular-nums"><Count value={seriesTotal} format={compact} /></h3>
                )}
                <p className="text-[13px] text-gray-500 mt-2 leading-snug">
                  Net sales, {chartMode === 'weekly' ? 'last 7 days' : 'last 6 months'}
                  <br />{num(seriesOrders)} orders
                </p>
              </div>

              <div className="flex-1 flex items-end justify-between gap-2 sm:gap-3 h-[220px]">
                {(d ? series : Array.from({ length: 7 }, (_, i) => ({ label: '', value: 0, changePct: 0, key: i }))).map((s, i) => {
                  const h = s.value > 0 ? Math.max(6, (s.value / maxVal) * 100) : 3;
                  const top = d && i === maxIdx && s.value > 0;
                  return (
                    <div key={s.date || i} className="group relative flex-1 flex flex-col items-center justify-end h-full gap-2 min-w-0">
                      {d && s.value !== 0 && s.changePct !== null ? (
                        <span className={`inline-flex items-center gap-0.5 text-[10px] font-bold px-1.5 py-0.5 rounded-md whitespace-nowrap ${s.changePct < 0 ? 'bg-[#fee2e2] text-[#dc2626]' : (top ? 'bg-[#f6fce6] text-[#65a30d]' : 'bg-gray-100 text-gray-500')}`}>
                          {s.changePct < 0 ? <ArrowDownRight size={10} /> : <ArrowUpRight size={10} />}{Math.abs(s.changePct) >= 1000 ? '999+' : Math.round(Math.abs(s.changePct))}%
                        </span>
                      ) : <span className="h-[18px]" />}
                      <div className="w-full flex items-end justify-center h-full">
                        <div
                          className={`w-full max-w-[46px] rounded-t-lg transition-[height] duration-700 ease-out ${top ? 'bg-[#C6F135]' : 'bg-gray-200'}`}
                          style={{ height: `${mounted ? h : 0}%`, transitionDelay: `${i * 60}ms`, backgroundImage: top ? 'none' : 'repeating-linear-gradient(45deg,#e5e7eb,#e5e7eb 5px,#eef0f2 5px,#eef0f2 10px)' }}
                        />
                      </div>
                      <span className="text-[11px] font-medium text-gray-400">{s.label}</span>
                      {d && (
                        <span className="pointer-events-none absolute -top-9 left-1/2 -translate-x-1/2 whitespace-nowrap rounded-lg bg-[#15171D] px-2 py-1 text-[11px] font-semibold text-white opacity-0 group-hover:opacity-100 transition">
                          {fmt0(s.value)} · {s.orders} orders
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>

          {/* Most ordered items */}
          <div className={`${card} flex flex-col`}>
            <div className="flex items-center justify-between mb-5">
              <span className="text-[15px] font-bold text-gray-900">Most Ordered Items</span>
              <span className="text-[12px] font-semibold text-gray-400">Last 30 days</span>
            </div>
            <div className="flex flex-col gap-3 flex-1">
              {!d && [0, 1, 2].map((i) => <Skeleton key={i} className="h-[64px]" />)}
              {d && topItems.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-center py-8 text-gray-400">
                  <Package size={28} className="mb-2" />
                  <p className="text-sm">No items sold in the last 30 days.</p>
                </div>
              )}
              {topItems.map((t, i) => {
                const isDark = i === 0;
                return (
                  <div key={`${t.sku}-${i}`} className={`relative overflow-hidden rounded-2xl p-3.5 pr-4 flex items-center gap-3 ${isDark ? 'bg-[#15171D]' : 'bg-[#f6f7f5]'}`}>
                    <div
                      className={`absolute inset-y-0 left-0 ${isDark ? 'bg-white/5' : 'bg-[#C6F135]/20'}`}
                      style={{ width: `${(t.quantity / maxQty) * 100}%` }}
                    />
                    <span className={`relative grid place-items-center w-8 h-8 rounded-full text-[12px] font-extrabold shrink-0 ${isDark ? 'bg-[#C6F135] text-black' : 'bg-white text-gray-700 shadow-sm'}`}>#{i + 1}</span>
                    <div className="relative flex-1 min-w-0">
                      <p className={`text-[13px] font-bold truncate ${isDark ? 'text-white' : 'text-gray-800'}`} title={t.name}>{t.name || t.sku || 'Unnamed item'}</p>
                      <p className={`text-[12px] truncate ${isDark ? 'text-zinc-400' : 'text-gray-500'}`}>
                        {num(t.orders)} {t.orders === 1 ? 'order' : 'orders'} · {fmt0(t.revenue)}
                      </p>
                    </div>
                    <div className="relative text-right shrink-0">
                      <p className={`text-[15px] font-extrabold tabular-nums ${isDark ? 'text-white' : 'text-gray-900'}`}>{num(t.quantity)}</p>
                      <p className={`text-[10px] font-semibold uppercase tracking-wider ${isDark ? 'text-zinc-500' : 'text-gray-400'}`}>sold</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      </div>
    </>
  );
};

export default Home;
