import { Badge } from "@/components/ui/badge";
import { formatDistance } from "@/lib/utils/site";
import { STATUS_TONE_CLASSES } from "@/lib/utils/status-colors";
import type { PunchLocationStatus, TimePunch } from "@/lib/types/staff";

// Where a punch was made (0063), shared by the Punches page.

/** Why a punch has no address, in words a person can act on. */
export const LOCATION_STATUS_LABELS: Record<PunchLocationStatus, string> = {
  captured: "Captured",
  permission_denied: "Location not captured — permission denied",
  unavailable: "Location not captured — unavailable on this device",
  geocode_failed: "Coordinates recorded, address lookup failed",
};

function mapsHref(punch: TimePunch) {
  return `https://www.openstreetmap.org/?mlat=${punch.latitude}&mlon=${punch.longitude}#map=18/${punch.latitude}/${punch.longitude}`;
}

/** On-site / off-site against the LAF House pin, as judged when punched (0063). */
export function SiteBadge({ punch, isDriver }: { punch: TimePunch; isDriver: boolean }) {
  if (punch.siteStatus === "on_site") {
    return <Badge className={STATUS_TONE_CLASSES.positive}>LAF House</Badge>;
  }
  if (punch.siteStatus !== "off_site") return null;
  return (
    <Badge className={STATUS_TONE_CLASSES[isDriver ? "neutral" : "warning"]}>
      Off-site{punch.siteDistanceM !== undefined ? ` · ${formatDistance(punch.siteDistanceM)} away` : ""}
    </Badge>
  );
}

export function LocationCell({ punch, isDriver = false }: { punch: TimePunch; isDriver?: boolean }) {
  // At the house the badge says it all; anywhere else, the address the phone was at.
  if (punch.siteStatus === "on_site") return <SiteBadge punch={punch} isDriver={isDriver} />;
  if (punch.locationStatus === "captured" && punch.addressLabel) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <SiteBadge punch={punch} isDriver={isDriver} />
        <span className="break-words">{punch.addressLabel}</span>
        <a
          href={mapsHref(punch)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-fit text-theme-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {punch.latitude?.toFixed(5)}, {punch.longitude?.toFixed(5)}
          {punch.accuracyMeters !== undefined && ` · ±${Math.round(punch.accuracyMeters)}m`}
        </a>
      </div>
    );
  }
  if (punch.locationStatus === "geocode_failed" && punch.latitude !== undefined) {
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <span className="italic text-muted-foreground">Address lookup failed</span>
        <a
          href={mapsHref(punch)}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="w-fit text-theme-xs text-muted-foreground underline underline-offset-2 hover:text-foreground"
        >
          {punch.latitude?.toFixed(5)}, {punch.longitude?.toFixed(5)}
        </a>
      </div>
    );
  }
  return <span className="italic text-muted-foreground">{LOCATION_STATUS_LABELS[punch.locationStatus]}</span>;
}
