import { databaseReady, sql } from "@/server/database/database";

export const dynamic = "force-dynamic";

export async function GET() {
  await databaseReady;
  await sql.query("SELECT 1");

  return Response.json({
    success: true,
    service: "radiocare-backend",
    database: "connected",
    engine: "MariaDB",
  });
}
