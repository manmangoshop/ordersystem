import { redirect } from "next/navigation";
import { isAdmin } from "@/lib/auth";
import { login } from "./actions";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  if (await isAdmin()) redirect("/admin");
  const query = await searchParams;
  return <main className="login"><section className="login-card">
    <div className="eyebrow">MANMANGO ADMIN</div>
    <h1>管理後台</h1>
    <p>使用管理密碼登入，工作階段會在八小時後自動失效。</p>
    <form action={login}>
      <div className="form-group"><label>管理密碼</label><input className="field" type="password" name="password" required autoFocus /></div>
      {query.error && <div className="error">密碼不正確。</div>}
      <button className="primary">登入後台</button>
    </form>
  </section></main>;
}
