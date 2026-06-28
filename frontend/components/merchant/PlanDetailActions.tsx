"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import {
  cancelPlan,
  devMarkPlanFailed,
  overridePlanState,
  resolvePlan,
  retryPlan,
  type PaymentPlanStatus,
  type PlanDetail,
} from "@/lib/api";

const OVERRIDE_OPTIONS: PaymentPlanStatus[] = [
  "active",
  "payment_failed_in_retry",
  "payment_failed_exhausted",
  "balance_due",
  "completed",
  "defaulted",
  "canceled",
];

export function PlanDetailActions({ plan }: { plan: PlanDetail }) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function runAction(name: string, action: () => Promise<unknown>) {
    setBusy(name);
    setError(null);
    try {
      await action();
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : `Could not ${name}.`);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="card p-5 space-y-4">
      <div className="text-sm font-medium">Take action</div>
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          className="btn-primary disabled:opacity-60"
          disabled={busy !== null || plan.failedInstallment == null}
          onClick={() => runAction("retry", () => retryPlan(plan.id))}
        >
          {busy === "retry" ? "Retrying" : "Retry now"}
        </button>
        <button
          type="button"
          className="btn-ghost disabled:opacity-60"
          disabled={busy !== null || plan.status === "active"}
          onClick={() => runAction("resolve", () => resolvePlan(plan.id))}
        >
          {busy === "resolve" ? "Resolving" : "Mark resolved"}
        </button>
        <button
          type="button"
          className="btn-ghost disabled:opacity-60"
          disabled={busy !== null || plan.status === "canceled"}
          onClick={() => runAction("cancel", () => cancelPlan(plan.id))}
        >
          {busy === "cancel" ? "Cancelling" : "Cancel plan"}
        </button>
      </div>

      <details className="border-t border-brand-neutral pt-3">
        <summary className="cursor-pointer text-xs text-ink-muted">
          Override state (admin)
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {OVERRIDE_OPTIONS.map((status) => (
            <button
              key={status}
              type="button"
              className={`btn-ghost text-[11px] ${
                plan.status === status ? "border-brand-purple text-brand-purple" : ""
              }`}
              disabled={busy !== null || plan.status === status}
              onClick={() => runAction("override", () => overridePlanState(plan.id, status))}
            >
              {status}
            </button>
          ))}
        </div>
      </details>

      <details className="border-t border-brand-neutral pt-3">
        <summary className="cursor-pointer text-xs text-ink-muted">
          Dev-mode failure simulation
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            className="btn-ghost text-[11px]"
            disabled={busy !== null}
            onClick={() => runAction("dev-fail", () => devMarkPlanFailed(plan.id, "fail"))}
          >
            {busy === "dev-fail" ? "Failing" : "Mark next installment failed"}
          </button>
          <button
            type="button"
            className="btn-ghost text-[11px]"
            disabled={busy !== null}
            onClick={() => runAction("dev-exhaust", () => devMarkPlanFailed(plan.id, "exhaust"))}
          >
            {busy === "dev-exhaust" ? "Exhausting" : "Exhaust retries → after-action"}
          </button>
        </div>
      </details>

      {error ? (
        <div className="text-xs text-red-600" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}
