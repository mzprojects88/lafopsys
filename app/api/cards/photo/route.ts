import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * The photo on a scanned Patient ID card (0165), for whoever may scan cards -- house staff too, who
 * cannot open the patient documents store themselves. The database decides (ops.card_photo_path:
 * an active card, photo consent on, a scanner's role); the file is then read with the service role.
 */
export async function GET(req: Request) {
  const token = new URL(req.url).searchParams.get("token") ?? "";
  if (!/^[0-9a-f]{32}$/.test(token)) return new NextResponse(null, { status: 404 });
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return new NextResponse(null, { status: 401 });

  const { data: path } = await supabase.schema("ops").rpc("card_photo_path", { p_token: token });
  if (typeof path !== "string" || !path) return new NextResponse(null, { status: 404 });
  const { data: file } = await createAdminClient().storage.from("patient-documents").download(path);
  if (!file) return new NextResponse(null, { status: 404 });
  return new NextResponse(file, { headers: { "Content-Type": file.type || "image/jpeg", "Cache-Control": "private, no-store" } });
}
