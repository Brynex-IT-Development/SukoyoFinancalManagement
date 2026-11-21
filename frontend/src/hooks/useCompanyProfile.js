import { useEffect, useState } from "react";
import { API_URL } from "../utils/retailApi";

// The company profile (F7) is read by every printout. Loaded once per page load and shared;
// the profile page calls setCompanyProfileCache() after saving so open screens pick it up.
let cache = null;
let pending = null;
const listeners = new Set();

const load = () => {
  if (!pending) {
    pending = fetch(`${API_URL}/api/company-profile`)
      .then((r) => (r.ok ? r.json() : { profile: null }))
      .then((d) => { cache = d.profile || null; listeners.forEach((fn) => fn(cache)); return cache; })
      .catch(() => { pending = null; return null; });
  }
  return pending;
};

export const setCompanyProfileCache = (profile) => {
  cache = profile || null;
  pending = Promise.resolve(cache);
  listeners.forEach((fn) => fn(cache));
};

/** Returns the company profile (null until loaded or when none is saved yet). */
export default function useCompanyProfile() {
  const [profile, setProfile] = useState(cache);
  useEffect(() => {
    listeners.add(setProfile);
    if (cache) setProfile(cache);
    else load();
    return () => listeners.delete(setProfile);
  }, []);
  return profile;
}

/** One-line address for headers: "MG Road, Kochi, Kerala - 682001". */
export const companyAddressLine = (p) =>
  p ? [p.address, p.city, [p.state, p.pincode].filter(Boolean).join(" - ")].filter(Boolean).join(", ") : "";
