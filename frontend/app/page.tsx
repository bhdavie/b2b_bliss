import Link from "next/link";

export default function HomePage() {
  return (
    <main className="min-h-screen flex flex-col items-center justify-center px-6 text-center">
      <h1 className="text-2xl font-medium tracking-tight">bliss</h1>
      <p className="mt-2 text-ink-muted">
        Save-first payment plans for the booking economy.
      </p>
      <div className="mt-6 flex gap-3">
        <Link href="/login" className="btn-primary">
          Merchant sign in
        </Link>
        <Link href="/signup" className="btn-ghost">
          Create account
        </Link>
      </div>
    </main>
  );
}
