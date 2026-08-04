import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "web",
    status: "alive",
    timestamp: new Date().toISOString(),
  });
}
