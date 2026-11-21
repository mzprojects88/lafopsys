import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { buildIdCardsPdf, type IdCard } from "@/lib/pdf/id-card";
import { LAF_LOGO_JPEG } from "@/lib/pdf/laf-logo";
import { signatureImage } from "@/lib/pdf/png";
import { formatDate } from "@/lib/utils/date";

import { normalizeCardTemplate } from "@/lib/utils/id-card-template";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const logo = { jpeg: Buffer.from(LAF_LOGO_JPEG.base64, "base64"), width: LAF_LOGO_JPEG.width, height: LAF_LOGO_JPEG.height };

/**
 * Patient ID cards (0164) to print: the active card of each child asked for, three a page.
 * Everything is read with the caller's session, so only staff who may see Patients get a sheet
 * (RLS on patients, cards, carers and the photo store). A photo is printed only while the
 * child's photo consent is on; otherwise the card shows initials.
 */
export async function GET(req: Request) {
  const supabase = await createClient();
  const { data: auth } = await supabase.auth.getUser();
  if (!auth.user) return NextResponse.json({ error: "Not signed in" }, { status: 401 });

  const ids = [...new Set((new URL(req.url).searchParams.get("patients") ?? "").split(",").filter((id) => UUID.test(id)))].slice(0, 60);
  if (!ids.length) return NextResponse.json({ error: "Choose the children whose cards to print" }, { status: 400 });

  const ops = supabase.schema("ops");
  const [patients, cards, carers, stays, photos, settings] = await Promise.all([
    ops.from("patients").select("id, first_name, last_name, case_number, photo_consent_granted").in("id", ids),
    ops.from("patient_cards").select("patient_id, token, version, issued_at").in("patient_id", ids).eq("status", "active"),
    ops.from("carers").select("id, patient_id, name, relationship, effective_from").in("patient_id", ids).order("effective_from", { ascending: false }),
    ops.from("stays").select("patient_id, carer_id").in("patient_id", ids).in("status", ["in_house", "overdue"]),
    ops.from("patient_documents").select("patient_id, storage_path").in("patient_id", ids).eq("document_type", "patient_photo").not("storage_path", "is", null),
    supabase.schema("shared").from("app_settings").select("org_address, id_card_template").maybeSingle(),
  ]);
  const failed = [patients, cards, carers, stays, photos].find((r) => r.error);
  if (failed?.error) return NextResponse.json({ error: failed.error.message }, { status: 500 });

  const cardOf = new Map((cards.data ?? []).map((c) => [c.patient_id as string, c]));
  const out: IdCard[] = [];
  // In the order asked for; children without an active card are left out.
  for (const id of ids) {
    const p = (patients.data ?? []).find((x) => x.id === id);
    const card = cardOf.get(id);
    if (!p || !card) continue;
    // The carer staying tonight, else the latest carer on the record.
    const tonight = (stays.data ?? []).find((s) => s.patient_id === id)?.carer_id;
    const carer = (carers.data ?? []).find((c) => c.id === tonight) ?? (carers.data ?? []).find((c) => c.patient_id === id);
    let photo: IdCard["photo"];
    const path = p.photo_consent_granted ? (photos.data ?? []).find((d) => d.patient_id === id)?.storage_path : null;
    if (path) {
      const { data: file } = await supabase.storage.from("patient-documents").download(path);
      if (file) photo = signatureImage(new Uint8Array(await file.arrayBuffer()), file.type || "image/jpeg") ?? undefined;
    }
    out.push({
      name: `${p.first_name} ${p.last_name}`.trim(),
      caseNumber: p.case_number ?? null,
      carer: carer ? { name: carer.name, relationship: carer.relationship ?? null } : null,
      version: card.version,
      issuedOn: formatDate(card.issued_at, "MMM d, yyyy"),
      token: card.token,
      photo,
    });
  }
  if (!out.length) return NextResponse.json({ error: "None of these children has a card yet: issue one first" }, { status: 404 });

  // The one design every card prints with (0169), cleaned; none saved = the LAF design.
  const template = normalizeCardTemplate(settings.data?.id_card_template ?? null);
  const pdf = await buildIdCardsPdf(out, { logo, address: String(settings.data?.org_address ?? "").trim(), template });
  const download = new URL(req.url).searchParams.get("download") === "1";
  return new NextResponse(new Uint8Array(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="LAF-ID-cards.pdf"`,
      "Cache-Control": "no-store",
    },
  });
}
