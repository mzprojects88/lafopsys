"use client";

import * as React from "react";
import { installClientErrorReporting } from "@/lib/client-errors";

/** Mounted once in the app layout: browser errors reach the Super Admin (0129). Renders nothing. */
export function ErrorReporter() {
  React.useEffect(() => installClientErrorReporting(), []);
  return null;
}
