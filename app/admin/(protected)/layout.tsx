import Link from "next/link";
import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { logout } from "./actions";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  if (!(await isAdmin())) redirect("/admin/login");
  return <div className="admin-wrap">
    <nav className="admin-nav"><div className="shell">
      <Link href="/admin" className="admin-title">満満菓營運後台</Link>
      <form action={logout}><button className="secondary">登出</button></form>
    </div></nav>
    {children}
  </div>;
}
