import { redirect } from "next/navigation";
import { AdminSidebar } from "@/components/admin/AdminSidebar";
import { fetchAdminSession } from "@/lib/auth";

/**
 * Guard and frame for the Bliss internal admin, mirroring the merchant
 * authenticated layout.
 *
 * <p>The guard is server-side and it is the real one: middleware only checks
 * that the cookie EXISTS, which a forged or expired value would satisfy.
 * fetchAdminSession round-trips to /api/v1/admin/auth/me, where the backend
 * verifies the signature, requires role=admin and an adminUserId claim, and
 * confirms the admin_users row still exists. Deleting that row signs the
 * session out on the next request.
 */
export default async function AdminAuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const admin = await fetchAdminSession();
  if (!admin) {
    redirect("/admin/login");
  }

  // Same ground, column width and padding as the merchant shell, so the two
  // internal surfaces read as one product.
  return (
    <div className="min-h-screen bg-sand-100 font-inter text-[14px] font-normal leading-[1.4] text-ink-900">
      <AdminSidebar email={admin.email} name={admin.name} />
      <main className="md:pl-[264px]">
        <div className="mx-auto max-w-[1320px] px-4 pb-10 pt-6 xl:px-6">
          {children}
        </div>
      </main>
    </div>
  );
}
