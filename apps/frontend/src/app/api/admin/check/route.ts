/**
 * Admin Check API
 * 
 * Server-side endpoint to check if the current user is an admin
 */

import { NextRequest, NextResponse } from "next/server";
import { isAdmin } from "@/lib/admin";

export async function GET(request: NextRequest) {
  try {
    // Get user ID from header (set by client)
    const userId = request.headers.get("x-privy-user-id");

    console.log(`[Admin Check API] Received request with userId: ${userId}`);

    if (!userId) {
      console.log(`[Admin Check API] No user ID provided`);
      return NextResponse.json({ isAdmin: false, error: "No user ID provided" }, { status: 401 });
    }

    // Check if user is admin
    const adminStatus = await isAdmin(userId);
    console.log(`[Admin Check API] Admin status for ${userId}: ${adminStatus}`);

    return NextResponse.json({ isAdmin: adminStatus });
  } catch (error: any) {
    console.error("[Admin Check API] Error:", error);
    return NextResponse.json(
      { isAdmin: false, error: error?.message || "Internal server error" },
      { status: 500 }
    );
  }
}

