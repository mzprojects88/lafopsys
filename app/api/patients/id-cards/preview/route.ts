import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildIdCardsPdf, SAMPLE_CARDS } from "@/lib/pdf/id-card";
import { LAF_LOGO_JPEG } from "@/lib/pdf/laf-logo";
import { normalizeCardTemplate } from "@/lib/utils/id-card-template";

const logo = { jpeg: Buffer.from(LAF_LOGO_JPEG.base64, "base64"), width: LAF_LOGO_JPEG.width, height: LAF_LOGO_JPEG.height };

/**
 * The Patient ID Maker's preview and test sheet (0169): made-up children printed with a draft design, before it
 * is saved. The Super Admin only (the one who edits the design); no child's data is read.
 *   POST { template } -> the PDF (?download=1 to save it)
 */
export async function POST(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  const { data: me } = await supabase.schema("shared").from("staff").select("role").eq("id", auth.user.id).maybeSingle();
  if (me?.role !== "admin") return NextResponse.json({ error: "The ID card design is the Super Admin's" }, { status: 403 });

  const text = await req.text();
  if (text.length > 20_000) return NextResponse.json({ error: "Too large" }, { status: 413 });
  let body: { template?: unknown } = {};
  try {
    body = JSON.parse(text || "{}");
  } catch {
    return NextResponse.json({ error: "Not a design" }, { status: 400 });
  }
  const template = normalizeCardTemplate(body.template ?? null);
  const { data: settings } = await supabase.schema("shared").from("app_settings").select("org_address").maybeSingle();
  const pdf = await buildIdCardsPdf(SAMPLE_CARDS, { logo, address: String(settings?.org_address ?? "").trim(), template });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="LAF-ID-card-test-sheet.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
