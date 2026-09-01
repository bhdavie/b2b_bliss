import { AuthShell } from "@/components/auth/AuthShell";

// Guest counterpart to /check-email. It lives under /account because the
// middleware routes /account/* to the guest host and /check-email to the
// merchant one, so the merchant page could not be reused for this.
type SearchParams = { email?: string };

export default async function GuestCheckEmailPage(props: {
  searchParams: Promise<SearchParams>;
}) {
  const { email } = await props.searchParams;

  return (
    <AuthShell
      heading="Check your email"
      subhead={
        email
          ? `We sent a sign-in link to ${email}. It expires shortly and can only be used once.`
          : "We sent you a sign-in link. It expires shortly and can only be used once."
      }
      footer={
        <>
          Wrong address, or no email?{" "}
          <a href="/account/login" className="font-medium text-brand-violet">
            Try again
          </a>
        </>
      }
    />
  );
}
