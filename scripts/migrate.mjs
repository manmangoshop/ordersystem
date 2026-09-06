import fs from "node:fs/promises";
import path from "node:path";
import postgres from "postgres";

if (!process.env.DATABASE_URL) {
  console.error("缺少 DATABASE_URL");
  process.exit(1);
}

const sql = postgres(process.env.DATABASE_URL, { ssl: "require", max: 1 });
const schema = await fs.readFile(path.join(process.cwd(), "db/schema.sql"), "utf8");

try {
  await sql.unsafe(schema);
  console.log("資料庫結構建立完成");
} finally {
  await sql.end();
}
