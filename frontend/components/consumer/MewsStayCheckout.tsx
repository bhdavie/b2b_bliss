"use client";

import { useEffect, useState } from "react";
import {
  fetchStayQuote,
  type PublicMerchant,
  type StayQuote,
} from "@/lib/publicApi";
import { CheckoutFlow, type CheckoutCart } from "./CheckoutFlow";
import { MerchantBlock } from "./MerchantBlock";

// Mews rail checkout. The stay is priced by the property's own Mews, for the
// room and number of adults the guest confirms here, and that quote is the
// total the plan preview and the plan itself are built from. The total the
// booking engine put in the link is never used.
//
// The booking engine tells us the room only by name and never the guest
// count, so the guest confirms both. Adults are capped at the room's capacity
// in Mews.

export function MewsStayCheckout({
  merchant,
  cart,
  initialRoom,
  initialCategoryId,
  initialAdults,
  initialFrequency,
  returnUrl,
  feeRate,
}: {
  merchant: PublicMerchant;
  cart: CheckoutCart;
  initialRoom: string | null;
  initialCategoryId: string | null;
  initialAdults: number | null;
  initialFrequency?: "biweekly" | "monthly" | null;
  returnUrl?: string | null;
  feeRate: number;
}) {
  const [categoryId, setCategoryId] = useState<string | null>(initialCategoryId);
  const [adults, setAdults] = useState<number | null>(initialAdults);
  const [quote, setQuote] = useState<StayQuote | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // The booking engine's room label only matters until the guest picks a room here.
  const [room, setRoom] = useState<string | null>(initialRoom);

  const checkout = cart.checkout;

  useEffect(() => {
    if (!checkout) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    void fetchStayQuote(merchant.merchant.slug, {
      checkin: cart.checkin,
      checkout,
      categoryId,
      room,
      adults,
    }).then((result) => {
      if (cancelled) return;
      if (result.ok) {
        setQuote(result.data);
        if (result.data.categoryId && result.data.categoryId !== categoryId) {
          setCategoryId(result.data.categoryId);
        }
        if (result.data.available && result.data.adults !== adults) {
          setAdults(result.data.adults);
        }
      } else {
        setError(result.message);
      }
      setLoading(false);
    });
    return () => {
      cancelled = true;
    };
  }, [merchant.merchant.slug, cart.checkin, checkout, categoryId, room, adults]);

  if (!checkout) {
    return (
      <>
        <MerchantBlock merchant={merchant.merchant} />
        <p className="mt-6 text-[14px] text-brand-navy/70">
          This link is missing a check-out date. Go back to {merchant.merchant.businessName} and
          choose your dates again.
        </p>
      </>
    );
  }

  const rooms = quote?.rooms ?? [];
  const chosenRoom = rooms.find((r) => r.id === categoryId) ?? null;
  const maxAdults = chosenRoom?.capacity ?? 0;

  const picker = (
    <div className="mt-6 space-y-3">
      <div className="text-[12px] text-brand-navy/60">Your stay</div>
      <div className="grid grid-cols-[1fr_auto] gap-3">
        <label className="block">
          <span className="text-[12px] text-brand-navy/60">Room</span>
          <select
            className="mt-1.5 w-full rounded-none border border-brand-neutral bg-white px-3 py-2.5 text-[15px] focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-lavender/40"
            value={categoryId ?? ""}
            disabled={loading && !quote}
            onChange={(e) => {
              setRoom(null);
              setCategoryId(e.target.value || null);
              setAdults(null);
            }}
          >
            <option value="">Choose a room</option>
            {rooms.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-[12px] text-brand-navy/60">Adults</span>
          <select
            className="mt-1.5 w-full rounded-none border border-brand-neutral bg-white px-3 py-2.5 text-[15px] focus:border-brand-purple focus:outline-none focus:ring-2 focus:ring-brand-lavender/40"
            value={adults ?? ""}
            disabled={!chosenRoom}
            onChange={(e) => setAdults(Number(e.target.value))}
          >
            {Array.from({ length: maxAdults }, (_, i) => i + 1).map((n) => (
              <option key={n} value={n}>
                {n}
              </option>
            ))}
          </select>
        </label>
      </div>
      {error ? (
        <p className="text-[13px] text-red-600" role="alert">
          {error}
        </p>
      ) : null}
      {quote?.reason === "sold_out" ? (
        <p className="text-[13px] text-brand-navy/70" role="status">
          {chosenRoom?.name ?? "That room"} is booked for these dates. Try another room, or contact{" "}
          {merchant.merchant.businessName}.
        </p>
      ) : null}
      {loading ? <p className="text-[13px] text-brand-navy/50">Checking your dates</p> : null}
    </div>
  );

  if (!quote?.available || quote.totalCents == null || !quote.categoryId) {
    return (
      <>
        <MerchantBlock merchant={merchant.merchant} />
        {picker}
      </>
    );
  }

  const quotedCart: CheckoutCart = {
    ...cart,
    totalCents: quote.totalCents,
    description: cart.description ?? chosenRoom?.name ?? null,
    mewsStay: { categoryId: quote.categoryId, adults: quote.adults },
  };

  return (
    <>
      {/* Keyed on the quote, so a new room or guest count starts the plan
          preview fresh rather than keeping a frequency chosen for another total. */}
      <CheckoutFlow
        key={`${quote.categoryId}-${quote.adults}-${quote.totalCents}`}
        merchant={merchant}
        cart={quotedCart}
        returnUrl={returnUrl}
        feeRate={feeRate}
        staySlot={picker}
        initialFrequency={initialFrequency}
      />
    </>
  );
}
