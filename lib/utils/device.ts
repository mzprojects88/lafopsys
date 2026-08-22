import type { PunchDeviceType } from "@/lib/types/staff";

export interface ParsedDevice {
  /** e.g. "iOS 17.5 · Safari 17", "Windows 10/11 · Chrome 127". */
  label: string;
  type: PunchDeviceType;
}

const UNKNOWN: ParsedDevice = { label: "Unknown device", type: "unknown" };

/**
 * Turns a User-Agent string into a short, readable device label for the DTR.
 *
 * Deliberately small and approximate rather than a full UA database. Two reasons
 * that is the right trade here: `ops.time_punches.user_agent` stores the raw
 * string verbatim, so a label that turns out wrong for some device can be
 * re-derived later without losing anything; and User-Agent strings are
 * self-reported by the client and freely spoofable, so treating them as
 * authoritative would be a mistake regardless of how carefully they're parsed.
 *
 * Known limitation, stated rather than papered over: iPadOS 13+ Safari reports
 * itself as "Macintosh" by default, so those punches are labelled as macOS
 * desktop. There is no server-side way to tell them apart.
 */
export function parseUserAgent(userAgent: string | null | undefined): ParsedDevice {
  const ua = userAgent?.trim();
  if (!ua) return UNKNOWN;

  const os = detectOs(ua);
  const browser = detectBrowser(ua);

  const parts = [os.name, browser].filter(Boolean);
  if (parts.length === 0) return { label: "Unrecognised device", type: os.type };

  return { label: parts.join(" · "), type: os.type };
}

function detectOs(ua: string): { name: string; type: PunchDeviceType } {
  if (/iPhone|iPod/.test(ua)) {
    return { name: `iOS${versionSuffix(/OS (\d+)[._](\d+)/.exec(ua))}`, type: "mobile" };
  }
  if (/iPad/.test(ua)) {
    return { name: `iPadOS${versionSuffix(/OS (\d+)[._](\d+)/.exec(ua))}`, type: "tablet" };
  }
  if (/Android/.test(ua)) {
    // Android tablets omit the "Mobile" token that phones carry.
    return {
      name: `Android${versionSuffix(/Android (\d+)(?:\.(\d+))?/.exec(ua))}`,
      type: /Mobile/.test(ua) ? "mobile" : "tablet",
    };
  }
  if (/CrOS/.test(ua)) return { name: "ChromeOS", type: "desktop" };
  if (/Windows NT/.test(ua)) {
    // Windows 11 is indistinguishable from 10 in the UA string -- it reports
    // "Windows NT 10.0" too. Saying "10/11" is honest; picking one would not be.
    const nt = /Windows NT ([\d.]+)/.exec(ua)?.[1];
    const name = nt === "10.0" ? "Windows 10/11" : nt === "6.3" ? "Windows 8.1" : nt === "6.1" ? "Windows 7" : "Windows";
    return { name, type: "desktop" };
  }
  if (/Mac OS X/.test(ua)) {
    return { name: `macOS${versionSuffix(/Mac OS X (\d+)[._](\d+)/.exec(ua))}`, type: "desktop" };
  }
  if (/Linux/.test(ua)) return { name: "Linux", type: "desktop" };
  return { name: "", type: "unknown" };
}

function detectBrowser(ua: string): string {
  // Order matters: Chrome's UA contains "Safari", Edge's contains both, and the
  // iOS browsers all contain "Safari" regardless of engine.
  const checks: [RegExp, string][] = [
    [/Edg(?:iOS|A|)\/(\d+)/, "Edge"],
    [/OPR\/(\d+)/, "Opera"],
    [/SamsungBrowser\/(\d+)/, "Samsung Internet"],
    [/(?:Firefox|FxiOS)\/(\d+)/, "Firefox"],
    [/CriOS\/(\d+)/, "Chrome"],
    [/Chrome\/(\d+)/, "Chrome"],
    [/Version\/(\d+)[\d._]*.*Safari/, "Safari"],
  ];
  for (const [pattern, name] of checks) {
    const match = pattern.exec(ua);
    if (match) return match[1] ? `${name} ${match[1]}` : name;
  }
  if (/Safari/.test(ua)) return "Safari";
  return "";
}

/** " 17.5" from a [full, major, minor] match, " 17" when there's no minor, "" when no match. */
function versionSuffix(match: RegExpExecArray | null): string {
  if (!match?.[1]) return "";
  return match[2] ? ` ${match[1]}.${match[2]}` : ` ${match[1]}`;
}

/**
 * The client's public IP, read from the proxy headers Vercel and most hosts set.
 * `x-forwarded-for` is a comma-separated chain appended to by each hop, so the
 * original client is the first entry.
 */
export function clientIpFromHeaders(headers: Headers): string | undefined {
  const forwarded = headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip")?.trim() || undefined;
}
