import { BlissWordmark } from "@/components/BlissWordmark";
import { Button } from "@/components/ui/Button";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center font-body">
      <BlissWordmark className="text-2xl tracking-tight text-brand-navy" />
      <p className="mt-2 text-ink-muted">
        Save-first payment plans for the booking economy.
      </p>
      <div className="mt-6 flex gap-3">
        <Button href="/login" variant="primary">
          Merchant sign in
        </Button>
        <Button href="/signup" variant="ghost">
          Create account
        </Button>
      </div>
    </main>
  );
}
