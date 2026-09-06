"use server";

import { timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { COOKIE_NAME, createAdminSession } from "@/lib/auth";

export async function login(formData: FormData) {
  const entered = String(formData.get("password") ?? "");
  const expected = process.env.ADMIN_PASSWORD ?? "";
  const valid = expected.length >= 12 && entered.length === expected.length && timingSafeEqual(Buffer.from(entered), Buffer.from(expected));
  if (!valid) redirect("/admin/login?error=1");
  (await cookies()).set(COOKIE_NAME, createAdminSession(), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    path: "/",
    maxAge: 8 * 60 * 60,
  });
  redirect("/admin");
}
