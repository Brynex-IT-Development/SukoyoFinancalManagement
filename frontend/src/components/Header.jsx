import { useState, useEffect, useRef } from "react";
import { Link } from "react-router-dom";
import { Bell, ChevronDown, MapPin, LogOut, Check } from "lucide-react";
import baseUrl from '../api/api';
import { getActiveStores, fetchActiveStores, FALLBACK_STORES } from "../utils/storeService.js";

const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7001";

// Function to format location names with proper spacing
const formatLocationName = (name) => {
    if (!name) return name;
    
    let formatted = name.trim();
    
    // Exact overrides for known stores
    if (/^warehouse$/i.test(formatted)) {
        return "Warehouse";
    }
    if (/^g[-.\s]?mg\s*road$/i.test(formatted) || /^mg\s*road$/i.test(formatted) || /^suitorguy\s+mg\s*road$/i.test(formatted)) {
        return "MG Road";
    }
    
    // Pattern: G- or Z- prefix with capital letter
    formatted = formatted.replace(/^([A-Z])-([A-Z][a-z])/g, '$1 $2');
    
    return formatted;
};

const Header = (prop) => {
    // Tell the layout this page has the shared header (mobile menu-button spacing).
    useEffect(() => {
        window.__skHeaderCount = (window.__skHeaderCount || 0) + 1;
        document.body.classList.add("sk-has-header");
        return () => {
            window.__skHeaderCount = Math.max(0, (window.__skHeaderCount || 1) - 1);
            if (!window.__skHeaderCount) document.body.classList.remove("sk-has-header");
        };
    }, []);

    const [AllLoation, setAllLoation] = useState(() => getActiveStores());

    const [Value, setValue] = useState({ locCode: '', locName: '' });

    const [logOut, setlogOut] = useState(false);
    const [selectedValue, setSelectedValue] = useState("");
    const [pendingClosuresCount, setPendingClosuresCount] = useState(0);
    const [isNotificationOpen, setIsNotificationOpen] = useState(false);
    const notificationRef = useRef(null);
    const profileRef = useRef(null);
    
    // Initialize currentUser from localStorage immediately to prevent blank display
    const getInitialUser = () => {
        try {
            const storedUser = JSON.parse(localStorage.getItem("rootfinuser"));
            return storedUser || {};
        } catch (error) {
            return {};
        }
    };
    const [currentUser, setCurrentUser] = useState(getInitialUser());

    // Function to sync user from localStorage
    const syncUserFromStorage = (locations) => {
        try {
            const storedUser = JSON.parse(localStorage.getItem("rootfinuser"));
            if (storedUser) {
                const foundLoc = locations.find(loc => loc.locCode === storedUser.locCode);
                const activeLoc = foundLoc || locations[0];
                if (activeLoc) {
                    const updatedUser = {
                        ...storedUser,
                        locCode: activeLoc.locCode,
                        username: activeLoc.locName
                    };
                    if (!foundLoc && locations.length > 0) {
                        try {
                            localStorage.setItem("rootfinuser", JSON.stringify(updatedUser));
                        } catch (e) {}
                    }
                    setCurrentUser(updatedUser);
                    setSelectedValue(activeLoc.locCode);
                } else {
                    setCurrentUser(storedUser);
                    setSelectedValue(storedUser.locCode);
                }
            }
        } catch (error) {
            console.error("Error syncing user from storage:", error);
        }
    };

    useEffect(() => {
        const load = async () => {
            const locations = await fetchActiveStores();
            if (locations && locations.length > 0) {
                setAllLoation(locations);
                syncUserFromStorage(locations);
            }
        };
        load();

        const handleStoresUpdated = (e) => {
            if (e.detail && Array.isArray(e.detail)) {
                setAllLoation(e.detail);
                syncUserFromStorage(e.detail);
            }
        };

        window.addEventListener("rootfin-stores-updated", handleStoresUpdated);
        return () => window.removeEventListener("rootfin-stores-updated", handleStoresUpdated);
    }, []);

    // Fetch pending closures count for admins
    useEffect(() => {
        const fetchNotifications = async () => {
            const user = getInitialUser();
            if (user?.power === 'admin' || user?.role === 'superadmin') {
                try {
                    const res = await fetch(`${API_URL}/user/pendingClosures`);
                    if (res.ok) {
                        const data = await res.json();
                        setPendingClosuresCount(data.data?.length || 0);
                    }
                } catch (e) {
                    console.error("Error fetching pending closures", e);
                }
            }
        };

        fetchNotifications();
        const interval = setInterval(fetchNotifications, 30000); // Check every 30s
        return () => clearInterval(interval);
    }, []);

    // Close notifications on outside click
    useEffect(() => {
        const handleClickOutside = (e) => {
            if (notificationRef.current && !notificationRef.current.contains(e.target)) {
                setIsNotificationOpen(false);
            }
            if (profileRef.current && !profileRef.current.contains(e.target)) {
                setlogOut(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    // Additional useEffect to periodically sync user from localStorage
    // This ensures the location stays visible even if state is lost
    useEffect(() => {
        const syncInterval = setInterval(() => {
            if (AllLoation.length > 0) {
                syncUserFromStorage(AllLoation);
            }
        }, 1000); // Check every second

        // Also listen for storage changes (in case localStorage is updated from another tab/window)
        const handleStorageChange = (e) => {
            if (e.key === 'rootfinuser' && AllLoation.length > 0) {
                syncUserFromStorage(AllLoation);
            }
        };
        window.addEventListener('storage', handleStorageChange);

        return () => {
            clearInterval(syncInterval);
            window.removeEventListener('storage', handleStorageChange);
        };
    }, [AllLoation]);

    const handleChange = (e) => {
        const selectedCode = e.target.value;
        const selectedItem = AllLoation.find(item => item.locCode === selectedCode);
        if (selectedItem) {
            setSelectedValue(selectedItem.locCode);
            setValue({
                locCode: selectedItem.locCode,
                locName: selectedItem.locName,
            });

            const updatedUser = {
                ...currentUser,
                locCode: selectedItem.locCode,
                username: selectedItem.locName,
            };

            localStorage.setItem("rootfinuser", JSON.stringify(updatedUser));
            setCurrentUser(updatedUser);
            window.location.reload()
        }
    };

    const selectLocation = (code) => {
        const selectedItem = AllLoation.find((item) => item.locCode === code);
        if (!selectedItem) return;
        setSelectedValue(selectedItem.locCode);
        setValue({ locCode: selectedItem.locCode, locName: selectedItem.locName });
        const updatedUser = { ...currentUser, locCode: selectedItem.locCode, username: selectedItem.locName };
        localStorage.setItem("rootfinuser", JSON.stringify(updatedUser));
        setCurrentUser(updatedUser);
        window.location.reload();
    };

    const HanndleRemove = () => {
        try {
            localStorage.removeItem("rootfinuser");
            window.location.reload();
        } catch (error) {
            console.error("Logout error:", error);
        }
    };

    // Get display name with fallback to localStorage
    const getDisplayName = () => {
        if (currentUser?.username) {
            return currentUser.username;
        }
        // Fallback: try to get from localStorage directly
        try {
            const storedUser = JSON.parse(localStorage.getItem("rootfinuser"));
            if (storedUser?.username) {
                return storedUser.username;
            }
        } catch (error) {
            // Ignore errors
        }
        return "";
    };

    const displayName = getDisplayName();

    return (
        <nav className="sk-header bg-white border-b border-gray-200 shadow-sm">
            <div className="max-w-full pl-16 pr-3 sm:pr-6 py-2.5 sm:py-3.5 min-h-[64px] flex items-center justify-between gap-3 mx-auto">
                <div className="flex items-center gap-3 min-w-0">
                    {prop.title && (
                        <h1 className="text-base sm:text-xl font-bold text-gray-800 truncate">{prop.title}</h1>
                    )}
                </div>

                <div className="flex items-center gap-2 sm:gap-4 shrink-0">
                    {/* Notification bell for admin */}
                    {(currentUser.power === 'admin' || currentUser.role === 'superadmin') && (
                        <div className="relative" ref={notificationRef}>
                            <button
                                type="button"
                                onClick={() => setIsNotificationOpen(!isNotificationOpen)}
                                className="relative p-2 rounded-full text-gray-500 hover:bg-gray-100 transition-colors cursor-pointer"
                            >
                                <Bell size={20} />
                                {pendingClosuresCount > 0 && (
                                    <span className="absolute top-0 right-0 inline-flex items-center justify-center px-1.5 py-0.5 text-xs font-bold leading-none text-white bg-red-600 rounded-full transform translate-x-1/4 -translate-y-1/4">
                                        {pendingClosuresCount}
                                    </span>
                                )}
                            </button>

                            {isNotificationOpen && (
                                <div className="dropdown-animate absolute right-0 mt-2 w-72 max-w-[calc(100vw-24px)] bg-white rounded-2xl shadow-xl border border-gray-100 z-50 overflow-hidden">
                                    <div className="px-4 py-3 border-b border-gray-100 bg-[#f6f7f5]">
                                        <h3 className="text-sm font-semibold text-gray-800">Pending Requests</h3>
                                    </div>
                                    <div className="max-h-64 overflow-y-auto">
                                        {pendingClosuresCount > 0 ? (
                                            <Link 
                                                to="/PendingDaybookClosures" 
                                                onClick={() => setIsNotificationOpen(false)}
                                                className="block px-4 py-3 hover:bg-purple-50 transition-colors border-b border-gray-50"
                                            >
                                                <div className="flex items-center justify-between">
                                                    <div>
                                                        <p className="text-sm font-medium text-gray-800">Late Daybook Closures</p>
                                                        <p className="text-xs text-gray-500 mt-0.5">Require super admin approval</p>
                                                    </div>
                                                    <span className="bg-red-100 text-red-700 text-xs font-bold px-2 py-1 rounded-full">{pendingClosuresCount}</span>
                                                </div>
                                            </Link>
                                        ) : (
                                            <div className="px-4 py-6 text-center text-sm text-gray-500">
                                                No pending requests.
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>
                    )}

                    {/* Profile + location */}
                    <div className="relative" ref={profileRef}>
                        <button
                            type="button"
                            onClick={() => setlogOut((prev) => !prev)}
                            className={`flex items-center gap-2.5 pl-1.5 pr-3 py-1.5 rounded-full border transition-all cursor-pointer ${logOut ? "border-[#C6F135] bg-[#f9fde8]" : "border-gray-200 hover:bg-gray-50"}`}
                        >
                            <span className="grid place-items-center w-9 h-9 rounded-full bg-gradient-to-tr from-[#C6F135] to-[#A8D11E] text-black font-bold text-[15px] shadow-sm">
                                {(formatLocationName(displayName) || "U").charAt(0).toUpperCase()}
                            </span>
                            <span className="hidden sm:flex flex-col items-start leading-tight">
                                <span className="text-[11px] text-gray-400 font-medium">Location</span>
                                <span className="text-[13px] font-semibold text-gray-800 max-w-[140px] truncate">{formatLocationName(displayName) || "—"}</span>
                            </span>
                            <ChevronDown size={16} className={`text-gray-400 transition-transform duration-200 ${logOut ? "rotate-180" : ""}`} />
                        </button>

                        {logOut && (
                            <div className="dropdown-animate absolute right-0 mt-2 w-72 max-w-[calc(100vw-24px)] rounded-2xl shadow-xl bg-white border border-gray-100 z-50 overflow-hidden">
                                <div className="p-4 bg-[#f6f7f5] border-b border-gray-100">
                                    <div className="flex items-center gap-3">
                                        <span className="grid place-items-center w-11 h-11 rounded-full bg-gradient-to-tr from-[#C6F135] to-[#A8D11E] text-black font-bold text-lg shadow-sm">
                                            {(formatLocationName(displayName) || "U").charAt(0).toUpperCase()}
                                        </span>
                                        <div className="min-w-0">
                                            <p className="text-[11px] text-gray-400 font-medium">Current Location</p>
                                            <p className="text-sm font-bold text-gray-900 truncate">{formatLocationName(displayName) || "—"}</p>
                                        </div>
                                    </div>
                                </div>

                                {(currentUser.power === 'admin' || (currentUser.role || '').toLowerCase() === 'cluster_manager') && (
                                    <div className="p-3 border-b border-gray-100">
                                        <p className="flex items-center gap-1.5 text-[11px] font-semibold text-gray-500 uppercase tracking-wide px-1 mb-2">
                                            <MapPin size={12} /> Switch Location
                                        </p>
                                        <div className="max-h-56 overflow-y-auto space-y-0.5 pr-0.5">
                                            {(currentUser.power === 'admin'
                                                ? AllLoation
                                                : AllLoation.filter(item => (currentUser.allowedLocCodes || []).includes(item.locCode))
                                            ).map((item) => {
                                                const active = item.locCode === (selectedValue || currentUser.locCode);
                                                return (
                                                    <button
                                                        key={item.locCode}
                                                        onClick={() => selectLocation(item.locCode)}
                                                        className={`w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-xl text-[13px] font-medium transition-colors cursor-pointer ${active ? "bg-[#f6fce6] text-gray-900" : "text-gray-600 hover:bg-gray-50"}`}
                                                    >
                                                        <span className="truncate">{formatLocationName(item.locName)}</span>
                                                        {active && <Check size={15} className="text-[#65a30d] shrink-0" />}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                )}

                                <div className="p-3">
                                    <button
                                        className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-[#15171D] text-white rounded-xl hover:bg-black cursor-pointer font-semibold text-sm transition-colors active:scale-[0.99]"
                                        onClick={HanndleRemove}
                                    >
                                        <LogOut size={16} /> Logout
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </nav>
    );
};

export default Header;
