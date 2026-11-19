// The external rentals API (rentalapi.rootments.live) has been REMOVED from this app.
//
// Older report pages (Day Book, Revenue, Income/Expense, Security, Booking, ...) still
// contain code that used to merge rental bookings / rent-outs / returns / cancellations
// into their totals. Their rental URLs now point at RENTAL_API_BASE, and the guard below
// answers those requests locally with an empty list — no request ever leaves the browser.
// The pages therefore show only this app's own transactions.

export const RENTAL_API_BASE = "rental-api-removed://GetBooking";

const EMPTY_RESPONSE = { dataSet: { data: [] } };

export const isRemovedRentalUrl = (url) =>
  typeof url === "string" && url.startsWith("rental-api-removed://");

export const installRentalApiBlock = () => {
  if (typeof window === "undefined" || window.__rentalApiBlocked) return;
  const originalFetch = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === "string" ? input : input?.url;
    if (isRemovedRentalUrl(url)) {
      return Promise.resolve(
        new Response(JSON.stringify(EMPTY_RESPONSE), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        })
      );
    }
    return originalFetch(input, init);
  };
  window.__rentalApiBlocked = true;
};
