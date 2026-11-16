import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";
import { presignGet } from "@/lib/files/b2";
import { signatureImage } from "@/lib/pdf/png";
import type { PdfImage } from "@/lib/pdf/page";
import type { SignatureDoc } from "./docs";

/**
 * Signatures on generated documents (0153). A person's signature goes on a document only when THEY allowed that kind
 * of document (My signature), and every use is logged first: whose, which document, who generated it. If the log
 * can't be written, nothing is attached. Callers pass only the people the document already names, and only after
 * checking the viewer may open the document; the pictures never reach the browser except on that document.
 */
async function allowed(doc: SignatureDoc, staffIds: readonly (string | null | undefined)[], ref: string, by: string | null) {
  const ids = [...new Set(staffIds.filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const db = createAdminClient().schema("shared");
  const { data } = await db.from("staff_signatures").select("staff_id, object_key, content_type").in("staff_id", ids).contains("allowed_docs", [doc]);
  const rows = (data ?? []) as { staff_id: string; object_key: string; content_type: string }[];
  if (!rows.length) return [];
  const { error } = await db.from("signature_uses").insert(rows.map((r) => ({ staff_id: r.staff_id, doc_type: doc, doc_ref: ref.slice(0, 120) || "-", by_staff_id: by })));
  return error ? [] : rows;
}

/** Five-minute private links, for the pages printed from the browser (voucher, time record, manifest). */
export async function signatureLinks(doc: SignatureDoc, staffIds: readonly (string | null | undefined)[], ref: string, by: string | null): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  await Promise.all(
    (await allowed(doc, staffIds, ref, by)).map(async (r) => {
      try {
        out.set(r.staff_id, await presignGet(r.object_key, "signature", r.content_type, true));
      } catch {
        // Storage not set up on this hosting: the document prints without the picture.
      }
    }),
  );
  return out;
}

/** The pictures themselves, for the PDFs built on the server. One that can't be read is left out. */
export async function signatureImages(doc: SignatureDoc, staffIds: readonly (string | null | undefined)[], ref: string, by: string | null): Promise<Map<string, PdfImage>> {
  const out = new Map<string, PdfImage>();
  await Promise.all(
    (await allowed(doc, staffIds, ref, by)).map(async (r) => {
      try {
        const res = await fetch(await presignGet(r.object_key, "signature", r.content_type, true), { cache: "no-store" });
        if (!res.ok) return;
        const img = signatureImage(new Uint8Array(await res.arrayBuffer()), r.content_type);
        if (img) out.set(r.staff_id, img);
      } catch {
        // No storage, or an unreadable file: the document prints without the picture.
      }
    }),
  );
  return out;
}
