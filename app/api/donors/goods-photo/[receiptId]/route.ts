import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const RECEIPT_ID = /^[A-Za-z0-9_-]{1,64}$/;

/**
 * The photo of the goods on one LAF Inventory receipt (Inventory 0064), for Donors > Totals. The
 * key comes from ops.gik_goods_photo_key with the caller's session (Donors view or nothing), and
 * the image is fetched here and streamed, so the storage link never reaches the browser.
 * INVENTORY_PHOTO_BASE_URL is LAF Inventory's bucket address (not a secret).
 */
export async function GET(_req: Request, { params }: { params: Promise<{ receiptId: string }> }) {
  const { receiptId } = await params;
  if (!RECEIPT_ID.test(receiptId)) return NextResponse.json({ error: "Bad receipt id" }, { status: 400 });
  const base = process.env.INVENTORY_PHOTO_BASE_URL;
  if (!base) return NextResponse.json({ error: "INVENTORY_PHOTO_BASE_URL is not configured on the server." }, { status: 500 });

  const supabase = await createClient();
  const { data: userData } = await supabase.auth.getUser();
  if (!userData.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: key, error } = await supabase.schema("ops").rpc("gik_goods_photo_key", { p_receipt_id: receiptId });
  if (error) return NextResponse.json({ error: error.message }, { status: error.code === "42501" ? 403 : 500 });
  if (typeof key !== "string" || !key.startsWith(`goods-photos/${receiptId}-`)) return NextResponse.json({ error: "No photo" }, { status: 404 });

  const res = await fetch(`${base.replace(/\/$/, "")}/${key.split("/").map(encodeURIComponent).join("/")}`, { cache: "no-store" });
  if (!res.ok) return NextResponse.json({ error: "Couldn't read the photo" }, { status: 502 });
  return new NextResponse(res.body, {
    headers: { "Content-Type": res.headers.get("content-type") ?? "image/jpeg", "Cache-Control": "private, max-age=300" },
  });
}
