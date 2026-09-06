import postgres from "postgres";

declare global {
  var manmangoSql: ReturnType<typeof postgres> | undefined;
}

export function db() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL 尚未設定");
  if (!global.manmangoSql) {
    global.manmangoSql = postgres(process.env.DATABASE_URL, {
      ssl: "require",
      max: 5,
      idle_timeout: 20,
      connect_timeout: 10,
    });
  }
  return global.manmangoSql;
}
