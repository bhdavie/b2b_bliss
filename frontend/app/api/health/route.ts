import { NextResponse } from "next/server";

export function GET() {
  return NextResponse.json({ status: "ok", service: "bliss-b2b-frontend" });
}
