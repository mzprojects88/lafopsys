"use client";

import * as React from "react";
import { toast } from "sonner";
import { Image as ImageIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { TimePunch } from "@/lib/types/staff";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";

const MISSING: Record<Exclude<TimePunch["photoStatus"], "captured" | "none">, string> = {
  denied: "Camera blocked",
  unavailable: "No camera",
  upload_failed: "Photo not saved",
};

/**
 * The punch's photo, for admins and HR only (0060): the DTR page renders
 * this column for them alone, and the link comes from app/api/dtr/photo,
 * which RLS answers only for them. A punch without a photo says why.
 */
export function PunchPhotoCell({ punch, caption }: { punch: TimePunch; caption: string }) {
  const [url, setUrl] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  if (punch.photoStatus === "none") return <span className="text-muted-foreground">—</span>;
  if (punch.photoStatus !== "captured") {
    return <Badge className={STATUS_TONE_CLASSES.negative}>{MISSING[punch.photoStatus]}</Badge>;
  }

  async function open() {
    setLoading(true);
    try {
      const r = (await (await fetch(`/api/dtr/photo?punch=${punch.id}`)).json()) as { ok: boolean; url?: string; error?: string };
      if (r.ok && r.url) setUrl(r.url);
      else toast.error(r.error ?? "Couldn't open the photo.");
    } catch {
      toast.error("Couldn't open the photo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <Button
        size="sm"
        variant="outline"
        className="h-7 gap-1.5"
        disabled={loading}
        onClick={(e) => {
          e.stopPropagation();
          void open();
        }}
      >
        <ImageIcon className="size-3.5" />
        {loading ? "Opening…" : "Photo"}
      </Button>
      <Dialog open={!!url} onOpenChange={(o) => !o && setUrl(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle>Punch photo</DialogTitle>
            <DialogDescription>{caption}</DialogDescription>
          </DialogHeader>
          {/* A five-minute signed link from the private bucket; next/image cannot optimise it. */}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {url ? <img src={url} alt={caption} className="w-full rounded-lg" /> : null}
        </DialogContent>
      </Dialog>
    </>
  );
}
