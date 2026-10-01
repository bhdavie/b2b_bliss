"use client";

import Link from "next/link";
import { Input } from "@/components/ui/Input";
import {
  currencySymbol,
  minorDigits,
  minorToInput,
  parseMoneyInput,
  type MoneyContext,
} from "@/lib/money";

/** Where a property without a currency goes to set one (Account settings). */
export const CURRENCY_SETTINGS_HREF = "/dashboard#currency";

/**
 * An amount field in the property's currency, prefixed with its symbol.
 * Replaces the old dollar-only input on Plan rules and Policies.
 *
 * `money` null means the property has no currency yet: the field renders
 * disabled with no prefix, and its value is never parsed or submitted.
 */
export function MoneyInput({
  label,
  value,
  onChange,
  placeholder,
  money,
  labelClassName = "text-[14px] text-ink-500",
}: {
  label: string;
  labelClassName?: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  money: MoneyContext | null;
}) {
  const symbol = money ? currencySymbol(money) : "";
  // Room for the prefix: "$" and "£" need little, "CA$" or "CHF" more.
  const padLeft = symbol ? `${0.75 + 0.55 * symbol.length + 0.25}rem` : undefined;
  return (
    <label className="block">
      <span className={labelClassName}>{label}</span>
      <div className="relative mt-1.5">
        {symbol ? (
          <span
            className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[13px] text-ink-500"
            aria-hidden="true"
          >
            {symbol}
          </span>
        ) : null}
        <Input
          type="text"
          inputMode={money && minorDigits(money.currency) === 0 ? "numeric" : "decimal"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          style={padLeft ? { paddingLeft: padLeft } : undefined}
          placeholder={placeholder}
          disabled={money === null}
          aria-label={money ? `${label} (${money.currency})` : label}
        />
      </div>
    </label>
  );
}

/** Shown in place of amount fields for a property that has no currency yet. */
export function CurrencyMissingNote() {
  return (
    <p className="rounded-md bg-sand-100 px-3 py-2 text-[13px] text-ink-900" role="status">
      Connect your PMS or Stripe to set your currency.{" "}
      <Link href={CURRENCY_SETTINGS_HREF} className="text-brand-violet underline-offset-2 hover:underline">
        Set it in account settings
      </Link>
    </p>
  );
}

/**
 * Minor units to the text an amount field starts with, dropping a zero
 * fraction so a whole amount reads "200" rather than "200.00". Blank for null.
 */
export function minorToFieldText(minor: number | null, currency: string | null): string {
  if (minor == null || !currency) return "";
  const d = minorDigits(currency);
  if (minor % 10 ** d === 0) return String(minor / 10 ** d);
  return minorToInput(minor, currency);
}

/**
 * Parses an optional amount field: null for blank, minor units for a valid
 * positive amount, undefined for anything else (so the caller can say so).
 */
export function parseOptionalMoney(input: string, currency: string): number | null | undefined {
  if (input.trim() === "") return null;
  const minor = parseMoneyInput(input, currency);
  if (minor === null || minor <= 0) return undefined;
  return minor;
}
