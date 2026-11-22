import { useEffect, useMemo, useState, useRef } from "react";
import { Link, useLocation } from "react-router-dom";
import {
    FileText,
    ChevronDown,
    ShoppingBag,
    LineChart,
    DollarSign,
    FolderClosed,
    Notebook,
    Store,
    Package,
    Box,
    SlidersHorizontal,
    ArrowLeftRight,
    List,
    Layers,
    ShoppingCart,
    ClipboardList,
    FileText as FileTextIcon,
    Truck,
    RotateCcw,
    ReceiptText,
    Users,
    PackageCheck,
    AlertTriangle,
    ShoppingBasket,
    UserPlus,
    UserCog,
    KeyRound,
    Menu,
    ChevronLeft,
    ArrowDownRight,
    ArrowUpRight,
    Wallet,
    Gift,
    Ticket,
    Building,
    CalendarCheck,
    Landmark,
    GraduationCap
} from "lucide-react";
import salesInventoryAccessConfig from "../config/salesInventoryAccess.json";
import baseUrl from "../api/api.js";
import { getActiveStores, fetchActiveStores } from "../utils/storeService.js";
import { SukoyoWordmark, SukoyoBadge } from "./SukoyoLogo.jsx";

const API_URL = baseUrl?.baseUrl?.replace(/\/$/, "") || "http://localhost:7001";

const formatLocationName = (name) => {
    if (!name) return name;
    let formatted = name.trim();
    if (/^warehouse$/i.test(formatted)) return "Warehouse";
    if (/^brides\s*berry$/i.test(formatted) || /^bridesberry$/i.test(formatted)) return "Brides Berry";
    formatted = formatted.replace(/^([A-Z])([A-Z][a-z])/g, '$1 $2');
    formatted = formatted.replace(/^([A-Z])([a-z])/g, '$1 $2');
    return formatted;
};

const Nav = () => {
    const location = useLocation();
    const currentuser = JSON.parse(localStorage.getItem("rootfinuser")) || {};

    const userEmail = currentuser?.email?.toLowerCase() || "";
    const userLocCode = (currentuser?.locCode || currentuser?.locationCode || "").toString().trim();
    const isAdmin = currentuser?.power === 'admin';
    const isSuperAdmin = (currentuser?.role || "").toLowerCase() === "superadmin";
    const isAdminOrSuperAdmin = isAdmin || isSuperAdmin;
    const isClusterManager = (currentuser?.role || "").toLowerCase() === "cluster_manager";
    const isFinancialHead = (currentuser?.role || "").toLowerCase() === "financial_head";
    const isWarehouse = currentuser?.power === 'warehouse' || userLocCode === '858' || userLocCode === '103';
    const isBridesBerry = userLocCode === '155' || userEmail.includes('bridesberry') || (currentuser?.username || "").toLowerCase().includes('bridesberry');

    const isInAllowedList = (salesInventoryAccessConfig?.allowedEmails || [])
        .map(email => email.toLowerCase())
        .includes(userEmail);
    const hasSalesInventoryAccess = isAdmin || isInAllowedList;

    const activePath = location.pathname;

    const [isHovered, setIsHovered] = useState(false);
    // Phones & tablets (< 1024px): the rail is hidden and opens as a slide-in drawer.
    const [mobileOpen, setMobileOpen] = useState(false);
    const isDesktop = () => typeof window !== "undefined" && window.matchMedia("(min-width: 1024px)").matches;
    const isOpen = isHovered || mobileOpen;

    useEffect(() => {
        const toggle = () => setMobileOpen((o) => !o);
        const close = () => setMobileOpen(false);
        const onResize = () => { if (isDesktop()) setMobileOpen(false); };
        window.addEventListener("sk-toggle-nav", toggle);
        window.addEventListener("sk-close-nav", close);
        window.addEventListener("resize", onResize);
        return () => {
            window.removeEventListener("sk-toggle-nav", toggle);
            window.removeEventListener("sk-close-nav", close);
            window.removeEventListener("resize", onResize);
        };
    }, []);

    // Close the drawer after navigating, and lock page scroll while it is open.
    useEffect(() => { setMobileOpen(false); setIsHovered(false); }, [location.pathname]);
    // Flag the body while the sidebar is shown (not on the login page).
    useEffect(() => {
        const on = location.pathname !== "/login";
        document.body.classList.toggle("sk-nav-on", on);
        return () => document.body.classList.remove("sk-nav-on");
    }, [location.pathname]);
    useEffect(() => {
        document.body.classList.toggle("sk-nav-locked", mobileOpen);
        return () => document.body.classList.remove("sk-nav-locked");
    }, [mobileOpen]);

    const [allLocations, setAllLocations] = useState(() => getActiveStores());
    const [showUserMenu, setShowUserMenu] = useState(false);
    const [showLocationMenu, setShowLocationMenu] = useState(false);
    const userMenuRef = useRef(null);
    const locationMenuRef = useRef(null);

    const getInitialUser = () => {
        try {
            return JSON.parse(localStorage.getItem("rootfinuser")) || {};
        } catch {
            return {};
        }
    };
    const [currentUser, setCurrentUser] = useState(getInitialUser());

    useEffect(() => {
        const loadStores = async () => {
            try {
                const stores = await fetchActiveStores();
                if (stores && Array.isArray(stores) && stores.length > 0) {
                    setAllLocations(stores);
                }
            } catch (error) {
                console.error("Error fetching stores in Nav:", error);
            }
        };
        loadStores();
    }, []);

    // Close menus when clicking outside
    useEffect(() => {
        const handleClickOutside = (event) => {
            if (userMenuRef.current && !userMenuRef.current.contains(event.target)) {
                setShowUserMenu(false);
            }
            if (locationMenuRef.current && !locationMenuRef.current.contains(event.target)) {
                setShowLocationMenu(false);
            }
        };
        document.addEventListener("mousedown", handleClickOutside);
        return () => document.removeEventListener("mousedown", handleClickOutside);
    }, []);

    useEffect(() => {
        const handleToggleSidebar = () => {
            setIsHovered(prev => !prev);
        };
        document.addEventListener("toggle-sidebar", handleToggleSidebar);
        return () => document.removeEventListener("toggle-sidebar", handleToggleSidebar);
    }, []);

    const handleChangeLocation = (e) => {
        const selectedCode = e.target.value;
        const selectedItem = allLocations.find(item => item.locCode === selectedCode);
        if (selectedItem) {
            const updatedUser = {
                ...currentUser,
                locCode: selectedItem.locCode,
                username: selectedItem.locName,
            };
            localStorage.setItem("rootfinuser", JSON.stringify(updatedUser));
            setCurrentUser(updatedUser);
            window.location.reload();
        }
    };

    const handleLogout = () => {
        try {
            localStorage.removeItem("rootfinuser");
            window.location.reload();
        } catch (error) {
            console.error("Logout error:", error);
        }
    };

    const locationDisplayName =
        allLocations.find(loc => loc.locCode === currentUser?.locCode)?.locName ||
        currentUser?.storeName ||
        currentUser?.username ||
        currentUser?.locName ||
        "";

    // Determine user display name for the profile tab
    const getDisplayName = () => {
        if (currentUser?.power === "admin" || currentUser?.role === "admin" || currentUser?.role === "superadmin") {
            return "Admin";
        }
        if (isClusterManager) {
            return "Cluster Manager";
        }
        if (isFinancialHead) {
            return "Financial Head";
        }
        const candidateName = currentUser?.name || currentUser?.username;
        const isStoreName = allLocations.some(
            loc => loc.locName?.toLowerCase().trim() === candidateName?.toLowerCase().trim()
        );
        if (candidateName && !isStoreName) {
            return candidateName;
        }
        return "Staff User";
    };

    const displayName = getDisplayName();

    useEffect(() => {
        document.body.classList.add("sidebar-closed");
        document.body.classList.remove("sidebar-open");
        window.dispatchEvent(new CustomEvent("sidebar-changed", { detail: { isOpen: false } }));
    }, []);

    const getInitialSection = useMemo(() => {
        if (activePath === "/reports/sales" || activePath === "/reports/sales-by-invoice" || activePath === "/reports/inventory" || activePath === "/reports/income-expense" || activePath === "/securityReport" || activePath === "/Revenuereport" || activePath === "/BookingReport" || activePath === "/RentOutReport" || activePath === "/reports/sales-by-group" || activePath.startsWith("/reports/vendor-") || activePath === "/reports/expiring-batches" || activePath === "/reports/stock-health" || activePath === "/reports/purchases" || activePath === "/reports/bill-profit" || activePath === "/reports/profit-loss") {
            return "reports";
        }
        if (activePath.startsWith("/inventory") ||
            activePath.startsWith("/shoe-sales/items") ||
            activePath.startsWith("/shoe-sales/item-groups") ||
            activePath.startsWith("/shoe-sales/inactive")) {
            return "inventory";
        }
        if (activePath.startsWith("/sales")) {
            return "sales";
        }
        if (activePath.startsWith("/offers")) {
            return "offers";
        }
        if (activePath.startsWith("/staff")) {
            return "staff";
        }
        if (activePath.startsWith("/purchase")) {
            return "purchase";
        }
        if (activePath.startsWith("/manage-users")) {
            return "manageUsers";
        }
        return null;
    }, [activePath]);

    const [openSection, setOpenSection] = useState(getInitialSection);

    useEffect(() => {
        setOpenSection(getInitialSection);
    }, [getInitialSection]);

    const isReportsOpen = openSection === "reports";
    const isInventoryOpen = openSection === "inventory";
    const isSalesOpen = openSection === "sales";
    const isPurchaseOpen = openSection === "purchase";
    const isManageUsersOpen = openSection === "manageUsers";
    const isOffersOpen = openSection === "offers";
    const isStaffOpen = openSection === "staff";

    const inventoryLinks = [
        { to: "/shoe-sales/items", label: "Items", Icon: List },
        // Only show these for admin and warehouse users
        ...(currentuser.power === 'admin' || currentuser.power === 'warehouse' ? [
            { to: "/shoe-sales/item-groups", label: "Item Groups", Icon: Layers },
            { to: "/inventory/adjustments", label: "Inventory Adjustments", Icon: SlidersHorizontal },
        ] : []),
        // Repacking (F19): admins, warehouse users and store managers
        ...(currentuser.power === 'admin' || currentuser.power === 'warehouse' || currentuser.role === 'store_manager' ? [
            { to: "/inventory/repacks", label: "Repacking", Icon: Package },
        ] : []),
        { to: "/inventory/transfer-orders", label: "Transfer Orders", Icon: ArrowLeftRight },
        { to: "/inventory/store-orders", label: "Store Orders", Icon: ShoppingBasket },
        // Only show these for admin and warehouse users
        ...(currentuser.power === 'admin' || currentuser.power === 'warehouse' ? [
            { to: "/inventory/reorder-alerts", label: "Reorder Alerts", Icon: AlertTriangle },
            { to: "/shoe-sales/inactive", label: "Inactive", Icon: FolderClosed }
        ] : [])
    ];
    const salesLinks = [
        { to: "/sales/invoices", label: "Invoices", Icon: FileTextIcon },
        { to: "/sales/returns", label: "Invoice Return", Icon: RotateCcw },
        { to: "/sales/customers", label: "Customers", Icon: Users },
        { to: "/sales/credit-notes", label: "Store Credit", Icon: ReceiptText },
        { to: "/sales/enquiries", label: "Enquiries", Icon: ClipboardList },
    ];
    const offersLinks = [
        { to: "/offers/gift-cards", label: "Gift Cards", Icon: Gift },
        { to: "/offers/vouchers", label: "Vouchers", Icon: Ticket },
        ...(currentuser?.power === 'admin' || currentuser?.role === 'admin' || currentuser?.role === 'superadmin'
            ? [{ to: "/offers/loyalty-settings", label: "Loyalty Settings", Icon: SlidersHorizontal }]
            : []),
    ];
    const isOffersActive = activePath.startsWith("/offers");
    // Staff (F15): attendance screens
    const staffLinks = [
        { to: "/staff/attendance/mark", label: "Mark Attendance" },
        { to: "/staff/attendance/daily", label: "Daily Attendance" },
        { to: "/staff/attendance/monthly", label: "Monthly Attendance" },
        { to: "/staff/attendance/person", label: "Staff Member" },
    ];
    const isStaffActive = activePath.startsWith("/staff");
    const isInventoryActive = inventoryLinks.some((link) => link.to === activePath) || activePath.startsWith("/inventory/repacks") ||
        activePath.startsWith("/shoe-sales/items") ||
        ((currentuser?.power === 'admin' || currentuser?.power === 'warehouse' || isBridesBerry) && activePath.startsWith("/shoe-sales/item-groups")) ||
        ((currentuser?.power === 'admin' || currentuser?.power === 'warehouse' || isBridesBerry) && activePath.startsWith("/shoe-sales/inactive")) ||
        activePath.startsWith("/inventory/store-orders");
    const isSalesActive = salesLinks.some((link) => link.to === activePath) ||
        activePath.startsWith("/sales/customers") || activePath.startsWith("/sales/credit-notes") || activePath.startsWith("/sales/enquiries");
    const purchaseLinks = [
        { to: "/purchase/orders", label: "Purchase Orders", Icon: ClipboardList },
        { to: "/purchase/receives", label: "Purchase Receives", Icon: PackageCheck },
        { to: "/purchase/bills", label: "Bills", Icon: ReceiptText },
        { to: "/purchase/payments", label: "Payments Made", Icon: Wallet },
        { to: "/purchase/vendor-credits", label: "Purchase Return", Icon: ReceiptText },
        { to: "/purchase/vendors", label: "Vendors", Icon: Users },
    ];
    const isPurchaseActive = purchaseLinks.some((link) => link.to === activePath);

    const manageUsersLinks = [
        { to: "/manage-users/add-store", label: "Add New Store", Icon: Store },
        { to: "/manage-users/add-user", label: "Add New User", Icon: UserPlus },
        { to: "/manage-users/existing-users", label: "Existing Users", Icon: UserCog },
        { to: "/manage-users/reset-password", label: "Reset Password", Icon: KeyRound },
        { to: "/manage-users/company-profile", label: "Company Profile", Icon: Building },
    ];
    const isManageUsersActive = manageUsersLinks.some((link) => link.to === activePath);

    const isReportsActive = [
        "/securityReport",
        "/Revenuereport",
        "/BookingReport",
        "/RentOutReport",
        "/reports/income-expense",
        "/reports/sales-by-group",
        "/reports/vendor-outstanding",
        "/reports/vendor-aging",
        "/reports/vendor-statement",
        "/reports/expiring-batches",
        "/reports/stock-health",
        "/reports/purchases",
        "/reports/bill-profit",
        "/reports/profit-loss",
        ...(hasSalesInventoryAccess ? ["/reports/sales", "/reports/sales-by-invoice", "/reports/inventory"] : [])
    ].includes(activePath);

    const groupButtonClasses = (sectionOpen, hasActiveChild) => {
        return `sidebar-button sk-row flex items-center text-[14px] font-medium rounded-[16px] transition-all duration-200 ${isOpen ? "justify-between w-full px-4 py-2.5" : "justify-center w-[52px] h-[52px] mx-auto"} ${hasActiveChild
            ? "bg-[#C6F135] text-black font-semibold shadow-sm shadow-[#C6F135]/25"
            : "text-zinc-400 hover:text-white hover:bg-[#27272a]/70"
        }`;
    };

    const subLinkClasses = (path) =>
        `block w-full pl-6 pr-4 py-2.5 text-[13px] whitespace-nowrap truncate transition-colors duration-200 rounded-full ${activePath === path
            ? "bg-[#C6F135] text-black font-semibold"
            : "text-zinc-400 font-medium hover:text-white hover:bg-[#27272a]/40"
        }`;

    const singleLinkClasses = (path) => {
        const isActive = activePath === path ||
            (path === "/" && activePath === "/dashboard") ||
            (path === "/record-expense" && (activePath === "/record-expense" || activePath === "/direct-expenses" || activePath === "/indirect-expenses"));
        return `sk-row flex items-center gap-3.5 text-[14px] font-medium whitespace-nowrap truncate transition-all duration-200 rounded-[16px] ${isOpen ? "px-4 py-2.5 w-full" : "justify-center w-[52px] h-[52px] mx-auto"} ${isActive
            ? "bg-[#C6F135] text-black font-semibold shadow-sm shadow-[#C6F135]/25"
            : "text-zinc-400 hover:text-white hover:bg-[#27272a]/70"
        }`;
    };

    return (
        <div className={`${location.pathname === "/login" ? "hidden" : "block sk-nav-visible"} no-print`}>
            {/* Mobile / tablet: menu button (pages leave room for it at the top-left) */}
            <button
                type="button"
                onClick={() => setMobileOpen(true)}
                aria-label="Open menu"
                className={`sk-menu-btn no-hover-anim lg:hidden fixed top-3 left-3 z-[99990] grid place-items-center w-10 h-10 rounded-xl bg-[#15171D] text-[#C6F135] shadow-lg active:scale-95 transition ${mobileOpen ? "opacity-0 pointer-events-none" : ""}`}
            >
                <Menu size={20} />
            </button>

            {/* Backdrop (mobile / tablet drawer only) */}
            {mobileOpen && (
                <div
                    className="fixed inset-0 bg-black/50 backdrop-blur-[1px] z-[99998] lg:hidden sk-fade"
                    onClick={() => setMobileOpen(false)}
                />
            )}

            {/* Persistent icon rail — expands to full panel on hover */}
            <div
                onMouseEnter={() => { if (isDesktop()) setIsHovered(true); }}
                onMouseLeave={() => setIsHovered(false)}
                className={`sk-rail fixed top-0 left-0 h-full z-[99999] flex flex-col justify-between bg-[#0E0E10] text-white shadow-2xl border-r border-white/[0.06] transition-[width,transform] duration-300 ease-[cubic-bezier(.4,0,.2,1)] ${isOpen ? "w-64 max-w-[85vw]" : "w-[76px] sidebar-collapsed"} ${mobileOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"}`}
            >
                <div className="flex flex-col flex-1 overflow-hidden">
                    {/* Logo */}
                    <div className={`pt-6 pb-8 flex items-center ${isOpen ? "pl-6 pr-5 justify-start" : "justify-center"}`}>
                        <Link to="/" className="flex items-center transition-transform duration-200 hover:scale-[1.05]">
                            {isOpen ? <SukoyoWordmark markSize={34} /> : <SukoyoBadge size={44} />}
                        </Link>
                        {mobileOpen && (
                            <button
                                type="button"
                                onClick={() => setMobileOpen(false)}
                                aria-label="Close menu"
                                className="no-hover-anim sidebar-button lg:hidden ml-auto grid place-items-center w-9 h-9 rounded-xl text-zinc-400 hover:text-white hover:bg-white/10"
                            >
                                <ChevronLeft size={20} />
                            </button>
                        )}
                    </div>
                    <nav className={`space-y-1.5 overflow-y-auto overflow-x-hidden pb-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden ${isOpen ? "px-3" : "px-2"}`}>

                        {/* ── CLUSTER MANAGER: only Financial Summary + Reports ── */}
                        {isClusterManager ? (
                            <>
                                <Link to="/datewisedaybook" className={singleLinkClasses("/datewisedaybook")}>
                                    <FileTextIcon size={18} className="shrink-0" />
                                    <span>Financial Summary</span>
                                </Link>

                                <div>
                                    <button
                                        onClick={() => setOpenSection(isReportsOpen ? null : "reports")}
                                        className={groupButtonClasses(isReportsOpen, isReportsActive)}
                                    >
                                        <div className="flex w-full items-center gap-3.5">
                                            <LineChart size={18} className="shrink-0" />
                                            <span className="flex-1 text-left whitespace-nowrap truncate">Reports</span>
                                            <ChevronDown size={16} className={`shrink-0 transition-transform ${isReportsOpen ? "rotate-180" : "rotate-0"} ${isReportsActive ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />
                                        </div>
                                    </button>
                                    {isReportsOpen && (
                                        <div className="mt-1 space-y-0.5 border-l border-[#27272a] ml-[25px]">
                                            <Link to="/reports/sales-by-invoice" className={subLinkClasses('/reports/sales-by-invoice')}><span>Sales by Invoice</span></Link>
                                            <Link to="/reports/sales" className={subLinkClasses('/reports/sales')}><span>Sales Report</span></Link>
                                            <Link to="/reports/sales-by-group" className={subLinkClasses('/reports/sales-by-group')}><span>Sales by Group</span></Link>
                                            <Link to="/reports/inventory" className={subLinkClasses('/reports/inventory')}><span>Inventory Report</span></Link>
                                            <Link to="/reports/income-expense" className={subLinkClasses('/reports/income-expense')}><span>Income &amp; Expense</span></Link>
                                        </div>
                                    )}
                                </div>
                            </>
                        ) : isFinancialHead ? (
                            <>
                                {/* Day Book */}
                                <Link to="/daybook" className={singleLinkClasses("/daybook")}>
                                    <FileText size={18} className="shrink-0" />
                                    <span>Day Book</span>
                                </Link>

                                {/* Financial Summary */}
                                <Link to="/datewisedaybook" className={singleLinkClasses("/datewisedaybook")}>
                                    <FileTextIcon size={18} className="shrink-0" />
                                    <span>Financial Summary</span>
                                </Link>

                                {/* Record Expense */}
                                <Link to="/record-expense" className={singleLinkClasses("/record-expense")}>
                                    <Wallet size={18} className="shrink-0" />
                                    <span>Record Expense</span>
                                </Link>

                                {/* Reports */}
                                <div>
                                    <button
                                        onClick={() => setOpenSection(isReportsOpen ? null : "reports")}
                                        className={groupButtonClasses(isReportsOpen, isReportsActive)}
                                    >
                                        <div className="flex w-full items-center gap-3.5">
                                            <LineChart size={18} className="shrink-0" />
                                            <span className="flex-1 text-left whitespace-nowrap truncate">Reports</span>
                                            <ChevronDown size={16} className={`shrink-0 transition-transform ${isReportsOpen ? "rotate-180" : "rotate-0"} ${isReportsActive ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />
                                        </div>
                                    </button>
                                    {isReportsOpen && (
                                        <div className="mt-1 space-y-0.5 border-l border-[#27272a] ml-[25px]">
                                            <Link to="/reports/sales-by-invoice" className={subLinkClasses('/reports/sales-by-invoice')}><span>Sales by Invoice</span></Link>
                                            <Link to="/reports/sales" className={subLinkClasses('/reports/sales')}><span>Sales Report</span></Link>
                                            <Link to="/reports/sales-by-group" className={subLinkClasses('/reports/sales-by-group')}><span>Sales by Group</span></Link>
                                            <Link to="/reports/inventory" className={subLinkClasses('/reports/inventory')}><span>Inventory Report</span></Link>
                                            <Link to="/reports/income-expense" className={subLinkClasses('/reports/income-expense')}><span>Income &amp; Expense</span></Link>
                                            <Link to="/reports/vendor-outstanding" className={subLinkClasses('/reports/vendor-outstanding')}><span>Vendor Outstanding</span></Link>
                                            <Link to="/reports/vendor-aging" className={subLinkClasses('/reports/vendor-aging')}><span>Vendor Aging</span></Link>
                                            <Link to="/reports/vendor-statement" className={subLinkClasses('/reports/vendor-statement')}><span>Vendor Statement</span></Link>
                                            <Link to="/reports/profit-loss" className={subLinkClasses('/reports/profit-loss')}><span>Profit &amp; Loss</span></Link>
                                            <Link to="/reports/bill-profit" className={subLinkClasses('/reports/bill-profit')}><span>Bill-wise Profit</span></Link>
                                            <Link to="/reports/purchases" className={subLinkClasses('/reports/purchases')}><span>Purchase Reports</span></Link>
                                            <Link to="/reports/stock-health" className={subLinkClasses('/reports/stock-health')}><span>Stock Health</span></Link>
                                            <Link to="/reports/expiring-batches" className={subLinkClasses('/reports/expiring-batches')}><span>Expiring Batches</span></Link>
                                        </div>
                                    )}
                                </div>

                                {/* Income & Expenses */}
                                <Link to="/income" className={singleLinkClasses("/income")}><DollarSign size={18} className="shrink-0" /><span>Income</span></Link>
                                <Link to="/expenses" className={singleLinkClasses("/expenses")}><DollarSign size={18} className="shrink-0" /><span>Expenses</span></Link>
                            </>
                        ) : (
                            <>
                                {/* Dashboard - Only for Admin / Super Admin */}
                                {isAdminOrSuperAdmin && (
                                    <Link to="/" className={singleLinkClasses("/")}>
                                        <LineChart size={18} className="shrink-0" />
                                        <span>Dashboard</span>
                                    </Link>
                                )}

                                {/* Day Book - Standalone */}
                                <Link to="/daybook" className={singleLinkClasses("/daybook")}>
                                    <FileText size={18} className="shrink-0" />
                                    <span>Day Book</span>
                                </Link>

                                {/* Financial Summary - Standalone */}
                                <Link to="/datewisedaybook" className={singleLinkClasses("/datewisedaybook")}>
                                    <FileTextIcon size={18} className="shrink-0" />
                                    <span>Financial Summary</span>
                                </Link>

                                {/* Sales */}
                                {hasSalesInventoryAccess && (
                                    <div>
                                        <button onClick={() => setOpenSection(isSalesOpen ? null : "sales")} className={groupButtonClasses(isSalesOpen, isSalesActive)}>
                                            <div className="flex w-full items-center gap-3.5">
                                                <ShoppingCart size={18} className="shrink-0" />
                                                <span className="flex-1 text-left whitespace-nowrap truncate">Sales</span>
                                                <ChevronDown size={16} className={`shrink-0 transition-transform ${isSalesOpen ? "rotate-180" : "rotate-0"} ${isSalesActive ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />
                                            </div>
                                        </button>
                                        {isSalesOpen && (
                                            <div className="mt-1 space-y-0.5 border-l border-[#27272a] ml-[25px]">
                                                {salesLinks.map(({ to, label }) => (
                                                    <Link key={to} to={to} className={subLinkClasses(to)}><span>{label}</span></Link>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Staff: attendance */}
                                <div>
                                    <button onClick={() => setOpenSection(isStaffOpen ? null : "staff")} className={groupButtonClasses(isStaffOpen, isStaffActive)}>
                                        <div className="flex w-full items-center gap-3.5">
                                            <CalendarCheck size={18} className="shrink-0" />
                                            <span className="flex-1 text-left whitespace-nowrap truncate">Staff</span>
                                            <ChevronDown size={16} className={`shrink-0 transition-transform ${isStaffOpen ? "rotate-180" : "rotate-0"} ${isStaffActive ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />
                                        </div>
                                    </button>
                                    {isStaffOpen && (
                                        <div className="mt-1 space-y-0.5 border-l border-[#27272a] ml-[25px]">
                                            {staffLinks.map(({ to, label }) => (
                                                <Link key={to} to={to} className={subLinkClasses(to)}><span>{label}</span></Link>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* Classes, tutors and bookings (F20) */}
                                <Link to="/classes/classes" className={singleLinkClasses(activePath.startsWith("/classes") ? activePath : "/classes/classes")}><GraduationCap size={18} className="shrink-0" /><span>Classes</span></Link>

                                {/* Offers: gift cards, vouchers, loyalty settings */}
                                {hasSalesInventoryAccess && (
                                    <div>
                                        <button onClick={() => setOpenSection(isOffersOpen ? null : "offers")} className={groupButtonClasses(isOffersOpen, isOffersActive)}>
                                            <div className="flex w-full items-center gap-3.5">
                                                <Gift size={18} className="shrink-0" />
                                                <span className="flex-1 text-left whitespace-nowrap truncate">Offers</span>
                                                <ChevronDown size={16} className={`shrink-0 transition-transform ${isOffersOpen ? "rotate-180" : "rotate-0"} ${isOffersActive ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />
                                            </div>
                                        </button>
                                        {isOffersOpen && (
                                            <div className="mt-1 space-y-0.5 border-l border-[#27272a] ml-[25px]">
                                                {offersLinks.map(({ to, label }) => (
                                                    <Link key={to} to={to} className={subLinkClasses(to)}><span>{label}</span></Link>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Inventory */}
                                {hasSalesInventoryAccess && (
                                    <div>
                                        <button onClick={() => setOpenSection(isInventoryOpen ? null : "inventory")} className={groupButtonClasses(isInventoryOpen, isInventoryActive)}>
                                            <div className="flex w-full items-center gap-3.5">
                                                <Box size={18} className="shrink-0" />
                                                <span className="flex-1 text-left whitespace-nowrap truncate">Inventory</span>
                                                <ChevronDown size={16} className={`shrink-0 transition-transform ${isInventoryOpen ? "rotate-180" : "rotate-0"} ${isInventoryActive ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />
                                            </div>
                                        </button>
                                        {isInventoryOpen && (
                                            <div className="mt-1 space-y-0.5 border-l border-[#27272a] ml-[25px]">
                                                {inventoryLinks.map(({ to, label }) => (
                                                    <Link key={to} to={to} className={subLinkClasses(to)}><span>{label}</span></Link>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Purchase */}
                                {(currentuser?.power === 'admin' || currentuser?.power === 'warehouse' || isBridesBerry) && (
                                    <div>
                                        <button onClick={() => setOpenSection(isPurchaseOpen ? null : "purchase")} className={groupButtonClasses(isPurchaseOpen, isPurchaseActive)}>
                                            <div className="flex w-full items-center gap-3.5">
                                                <Truck size={18} className="shrink-0" />
                                                <span className="flex-1 text-left whitespace-nowrap truncate">Purchase</span>
                                                <ChevronDown size={16} className={`shrink-0 transition-transform ${isPurchaseOpen ? "rotate-180" : "rotate-0"} ${isPurchaseActive ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />
                                            </div>
                                        </button>
                                        {isPurchaseOpen && (
                                            <div className="mt-1 space-y-0.5 border-l border-[#27272a] ml-[25px]">
                                                {purchaseLinks.map(({ to, label }) => (
                                                    <Link key={to} to={to} className={subLinkClasses(to)}><span>{label}</span></Link>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}

                                {/* Reports */}
                                <div>
                                    <button onClick={() => setOpenSection(isReportsOpen ? null : "reports")} className={groupButtonClasses(isReportsOpen, isReportsActive)}>
                                        <div className="flex w-full items-center gap-3.5">
                                            <LineChart size={18} className="shrink-0" />
                                            <span className="flex-1 text-left whitespace-nowrap truncate">Reports</span>
                                            <ChevronDown size={16} className={`shrink-0 transition-transform ${isReportsOpen ? "rotate-180" : "rotate-0"} ${isReportsActive ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />
                                        </div>
                                    </button>
                                    {isReportsOpen && (
                                        <div className="mt-1 space-y-0.5 border-l border-[#27272a] ml-[25px]">
                                            {hasSalesInventoryAccess && (
                                                <>
                                                    <Link to="/reports/sales-by-invoice" className={subLinkClasses('/reports/sales-by-invoice')}><span>Sales by Invoice</span></Link>
                                                    <Link to="/reports/sales" className={subLinkClasses('/reports/sales')}><span>Sales Report</span></Link>
                                                    <Link to="/reports/sales-by-group" className={subLinkClasses('/reports/sales-by-group')}><span>Sales by Group</span></Link>
                                                    <Link to="/reports/inventory" className={subLinkClasses('/reports/inventory')}><span>Inventory Report</span></Link>
                                                    <Link to="/reports/aging" className={subLinkClasses('/reports/aging')}><span>Aging Report</span></Link>
                                                </>
                                            )}
                                            <Link to="/reports/income-expense" className={subLinkClasses('/reports/income-expense')}><span>Income &amp; Expense</span></Link>
                                            {(currentuser?.power === 'admin' || currentuser?.power === 'warehouse' || isBridesBerry) && (
                                                <>
                                                    <Link to="/reports/vendor-outstanding" className={subLinkClasses('/reports/vendor-outstanding')}><span>Vendor Outstanding</span></Link>
                                                    <Link to="/reports/vendor-aging" className={subLinkClasses('/reports/vendor-aging')}><span>Vendor Aging</span></Link>
                                                    <Link to="/reports/vendor-statement" className={subLinkClasses('/reports/vendor-statement')}><span>Vendor Statement</span></Link>
                                                    <Link to="/reports/profit-loss" className={subLinkClasses('/reports/profit-loss')}><span>Profit &amp; Loss</span></Link>
                                                    <Link to="/reports/bill-profit" className={subLinkClasses('/reports/bill-profit')}><span>Bill-wise Profit</span></Link>
                                                    <Link to="/reports/purchases" className={subLinkClasses('/reports/purchases')}><span>Purchase Reports</span></Link>
                                                    <Link to="/reports/stock-health" className={subLinkClasses('/reports/stock-health')}><span>Stock Health</span></Link>
                                                    <Link to="/reports/expiring-batches" className={subLinkClasses('/reports/expiring-batches')}><span>Expiring Batches</span></Link>
                                                </>
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Income & Expenses */}
                                <Link to="/income" className={singleLinkClasses("/income")}><DollarSign size={18} className="shrink-0" /><span>Income</span></Link>
                                <Link to="/record-expense" className={singleLinkClasses("/record-expense")}><Wallet size={18} className="shrink-0" /><span>Record Expense</span></Link>
                                <Link to="/expenses" className={singleLinkClasses("/expenses")}><DollarSign size={18} className="shrink-0" /><span>All Expenses</span></Link>
                                {(currentuser?.power === 'admin' || currentuser?.role === 'admin' || currentuser?.role === 'superadmin') && (
                                    <Link to="/bank-accounts" className={singleLinkClasses("/bank-accounts")}><Landmark size={18} className="shrink-0" /><span>Bank Accounts</span></Link>
                                )}

                                {/* Admin only */}
                                {(currentuser?.power === 'admin' || currentuser?.locCode === '102') && (
                                    <>
                                        {currentuser?.power === 'admin' && (
                                            <Link to="/CloseReport" className={singleLinkClasses("/CloseReport")}><FolderClosed size={18} className="shrink-0" /><span>Close Report</span></Link>
                                        )}
                                        {(currentuser?.power === 'admin' || currentuser?.role === 'superadmin') && (
                                            <Link to="/AdminClose" className={singleLinkClasses("/AdminClose")}><Notebook size={18} className="shrink-0" /><span>Admin Close</span></Link>
                                        )}
                                        
                                        {(currentuser?.power === 'admin' || currentuser?.role === 'superadmin') && (
                                            <Link to="/PendingDaybookClosures" className={singleLinkClasses("/PendingDaybookClosures")}><Notebook size={18} className="shrink-0" /><span>Late Closures</span></Link>
                                        )}

                                        {/* Manage Users — admin and super admin */}
                                        {(currentuser?.power === 'admin' || currentuser?.role === 'superadmin') && (
                                            <div>
                                                <button onClick={() => setOpenSection(isManageUsersOpen ? null : "manageUsers")} className={groupButtonClasses(isManageUsersOpen, isManageUsersActive)}>
                                                    <div className="flex w-full items-center gap-3.5">
                                                        <Users size={18} className="shrink-0" />
                                                        <span className="flex-1 text-left whitespace-nowrap truncate">Manage Users</span>
                                                        <ChevronDown size={16} className={`shrink-0 transition-transform ${isManageUsersOpen ? "rotate-180" : "rotate-0"} ${isManageUsersActive ? "text-white" : "text-zinc-400 group-hover:text-white"}`} />
                                                    </div>
                                                </button>
                                                {isManageUsersOpen && (
                                                    <div className="mt-1 space-y-0.5 border-l border-[#27272a] ml-[25px]">
                                                        {manageUsersLinks.map(({ to, label }) => (
                                                            <Link key={to} to={to} className={subLinkClasses(to)}><span>{label}</span></Link>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </>
                                )}
                            </>
                        )}
                    </nav>
                </div>

                {/* Fixed Bottom Section: User Profile Tab */}
                <div className={`bg-[#0E0E10] ${isOpen ? "p-4" : "p-2.5"}`}>
                    <div className="relative" ref={userMenuRef}>
                        {/* User Menu Popover */}
                        {showUserMenu && (
                            <div
                                className="absolute bottom-full left-0 right-0 mb-2 bg-[#18181b] border border-zinc-700 shadow-2xl rounded-2xl p-4 text-white z-50 space-y-3"
                                onClick={(e) => e.stopPropagation()}
                            >
                                <div className="pb-3 border-b border-zinc-800 flex items-center gap-3">
                                    <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-[#C6F135] to-[#A8D11E] flex items-center justify-center shrink-0 shadow-lg text-black font-bold text-lg">
                                        {displayName?.charAt(0)?.toUpperCase() || "U"}
                                    </div>
                                    <div className="flex flex-col overflow-hidden">
                                        <span className="text-sm font-bold text-white truncate">
                                            {displayName}
                                        </span>
                                        <span className="text-[11px] text-purple-400 capitalize font-medium">
                                            {currentUser?.power === 'admin' ? 'Administrator' : (currentUser?.role ? currentUser.role.replace('_', ' ') : 'Staff User')}
                                        </span>
                                    </div>
                                </div>

                                <button
                                    onClick={handleLogout}
                                    className="w-full py-2.5 bg-red-600 hover:bg-red-700 active:scale-[0.99] text-white font-semibold rounded-xl text-xs transition-colors flex items-center justify-center gap-2 shadow-md cursor-pointer mt-2"
                                >
                                    <span>Logout</span>
                                </button>
                            </div>
                        )}

                        {/* Profile Tab Trigger */}
                        <div
                            onClick={() => {
                                setShowUserMenu(prev => !prev);
                                setShowLocationMenu(false);
                            }}
                            className={`flex items-center gap-3 bg-[#27272a] hover:bg-[#3f3f46] transition-all rounded-full cursor-pointer border ${isOpen ? "p-1.5 pr-4" : "p-1.5 justify-center"} ${showUserMenu ? "border-[#C6F135]/50" : "border-transparent"
                                }`}
                        >
                            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-[#C6F135] to-[#A8D11E] flex items-center justify-center shrink-0 text-black font-bold text-[15px] shadow-sm">
                                {displayName?.charAt(0)?.toUpperCase() || "U"}
                            </div>
                            <div className="sk-profile-text flex flex-col overflow-hidden text-left">
                                <span className="text-[13px] font-semibold text-white truncate leading-tight">
                                    {displayName}
                                </span>
                                <span className="text-[11px] text-zinc-400 truncate">
                                    {currentUser?.email || "admin@gmail.com"}
                                </span>
                            </div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default Nav;
