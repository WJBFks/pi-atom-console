import { NextResponse } from "next/server";
import { homedir, tmpdir } from "os";

export async function GET() {
  return NextResponse.json({ home: homedir(), temporaryWorkspaceDefault: process.platform === "win32" ? tmpdir() : "~/tmp" });
}
