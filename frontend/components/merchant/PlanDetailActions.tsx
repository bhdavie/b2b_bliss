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
import { Button } from "@/components/ui/Button";
import { Card } from "@/components/ui/Card";

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
    <Card padding="md" className="space-y-4">
      <div className="text-sm font-medium">Take action</div>
      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="primary"
          className="disabled:opacity-60"
          disabled={busy !== null || plan.failedInstallment == null}
          onClick={() => runAction("retry", () => retryPlan(plan.id))}
        >
          {busy === "retry" ? "Retrying" : "Retry now"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="disabled:opacity-60"
          disabled={busy !== null || plan.status === "active"}
          onClick={() => runAction("resolve", () => resolvePlan(plan.id))}
        >
          {busy === "resolve" ? "Resolving" : "Mark resolved"}
        </Button>
        <Button
          type="button"
          variant="ghost"
          className="disabled:opacity-60"
          disabled={busy !== null || plan.status === "canceled"}
          onClick={() => runAction("cancel", () => cancelPlan(plan.id))}
        >
          {busy === "cancel" ? "Cancelling" : "Cancel plan"}
        </Button>
      </div>

      <details className="border-t border-brand-neutral pt-3">
        <summary className="cursor-pointer text-xs text-ink-muted">
          Override state (admin)
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          {OVERRIDE_OPTIONS.map((status) => (
            <Button
              key={status}
              type="button"
              variant="ghost"
              className={`text-[11px] ${
                plan.status === status ? "border-brand-purple text-brand-purple" : ""
              }`}
              disabled={busy !== null || plan.status === status}
              onClick={() => runAction("override", () => overridePlanState(plan.id, status))}
            >
              {status}
            </Button>
          ))}
        </div>
      </details>

      <details className="border-t border-brand-neutral pt-3">
        <summary className="cursor-pointer text-xs text-ink-muted">
          Dev-mode failure simulation
        </summary>
        <div className="mt-3 flex flex-wrap gap-2">
          <Button
            type="button"
            variant="ghost"
            className="text-[11px]"
            disabled={busy !== null}
            onClick={() => runAction("dev-fail", () => devMarkPlanFailed(plan.id, "fail"))}
          >
            {busy === "dev-fail" ? "Failing" : "Mark next installment failed"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="text-[11px]"
            disabled={busy !== null}
            onClick={() => runAction("dev-exhaust", () => devMarkPlanFailed(plan.id, "exhaust"))}
          >
            {busy === "dev-exhaust" ? "Exhausting" : "Exhaust retries → after-action"}
          </Button>
        </div>
      </details>

      {error ? (
        <div className="text-xs text-red-600" role="alert">
          {error}
        </div>
      ) : null}
    </Card>
  );
}
