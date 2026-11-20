import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { ArrowLeft } from "lucide-react";
import Header from "../components/Header";
import useSidebar from "../hooks/useSidebar";
import { api, getCurrentUser, normalizePhone, ui } from "../utils/retailApi";

const EMPTY = { name: "", phone: "", email: "", address: "", city: "", state: "", pincode: "", gstin: "" };

// Create (/sales/customers/new) and edit (/sales/customers/:id/edit) a customer.
const CustomerCreate = () => {
  const isSidebarOpen = useSidebar();
  const navigate = useNavigate();
  const { id } = useParams();
  const isEdit = Boolean(id);
  const [form, setForm] = useState(EMPTY);
  const [loading, setLoading] = useState(isEdit);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!isEdit) return;
    api(`/customers/${id}`)
      .then(({ customer }) => setForm({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, customer[k] || ""])) }))
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, isEdit]);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const save = async (e) => {
    e.preventDefault();
    setError("");
    if (!form.name.trim()) return setError("Customer name is required.");
    if (!normalizePhone(form.phone)) return setError("Enter a valid phone number (10-digit mobile, or 6–15 digits).");
    setSaving(true);
    try {
      const saved = isEdit
        ? await api(`/customers/${id}`, { method: "PUT", body: form })
        : await api("/customers", { method: "POST", body: { ...form, locCode: getCurrentUser().locCode } });
      navigate(`/sales/customers/${saved._id}`);
    } catch (err) {
      if (err.status === 409 && err.data?.customerId) {
        if (window.confirm(`${err.message}\n\nOpen that customer?`)) navigate(`/sales/customers/${err.data.customerId}`);
      } else {
        setError(err.message);
      }
    } finally {
      setSaving(false);
    }
  };

  const field = (k, label, props = {}) => (
    <div>
      <label className={ui.label}>{label}{props.required && <span className="text-red-500"> *</span>}</label>
      <input value={form[k]} onChange={set(k)} className={ui.input} {...props} />
    </div>
  );

  return (
    <>
      <Header title={isEdit ? "Edit Customer" : "New Customer"} />
      <div className={`${ui.page} ${isSidebarOpen ? "ml-64" : "ml-0"}`}>
        <div className={ui.topBar}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <h1 className={ui.h1}>{isEdit ? "Edit Customer" : "New Customer"}</h1>
              <p className={ui.sub}>The phone number identifies the customer at billing.</p>
            </div>
            <Link to={isEdit ? `/sales/customers/${id}` : "/sales/customers"} className={ui.btn}>
              <ArrowLeft size={14} /> Back
            </Link>
          </div>
        </div>

        <div className="px-6 py-6">
          {loading ? (
            <p className="text-xs text-[#6B7280]">Loading...</p>
          ) : (
            <form onSubmit={save} className={`${ui.card} max-w-3xl p-6 space-y-5`}>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {field("name", "Name", { required: true, placeholder: "Customer name" })}
                {field("phone", "Phone", { required: true, placeholder: "10-digit mobile", inputMode: "tel" })}
                {field("email", "Email", { type: "email", placeholder: "Optional" })}
                {field("gstin", "GSTIN", { placeholder: "Optional", maxLength: 15, style: { textTransform: "uppercase" } })}
              </div>
              <div>
                <label className={ui.label}>Address</label>
                <textarea value={form.address} onChange={set("address")} rows={2}
                  className="w-full px-3 py-2 rounded-none border border-[#E5E7EB] bg-white text-xs text-[#111827] focus:border-[#1C1F26] focus:outline-none" />
              </div>
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {field("city", "City")}
                {field("state", "State")}
                {field("pincode", "Pincode", { inputMode: "numeric", maxLength: 6 })}
              </div>
              {error && <p className="text-xs font-semibold text-red-600">{error}</p>}
              <div className="flex justify-end gap-2.5 pt-2">
                <Link to={isEdit ? `/sales/customers/${id}` : "/sales/customers"} className={ui.btn}>Cancel</Link>
                <button type="submit" disabled={saving} className={ui.btnDark}>{saving ? "Saving..." : isEdit ? "Save Changes" : "Create Customer"}</button>
              </div>
            </form>
          )}
        </div>
      </div>
    </>
  );
};

export default CustomerCreate;
