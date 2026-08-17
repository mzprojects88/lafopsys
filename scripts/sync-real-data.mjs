// Copies the cleaned real-data JSON (produced by scripts/clean-real-data.py)
// from ../DATA/clean (sibling of this repo, never tracked by git) into
// lib/mock-data/real/ (gitignored) so the app can statically import it.
//
// Next.js/webpack needs a project-relative path to bundle JSON into both
// server and client bundles, so the real data has to live inside the repo
// tree -- this script is what keeps that copy fresh without ever committing
// it. Runs automatically via the predev/prebuild npm hooks.
//
// If ../DATA/clean isn't present (a different machine, CI), missing files
// are filled with an empty array so the build never breaks.

import { existsSync, mkdirSync, copyFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE_DIR = resolve(REPO_ROOT, "..", "DATA", "clean");
const DEST_DIR = join(REPO_ROOT, "lib", "mock-data", "real");

const FILES = [
  "patients.json",
  "carers.json",
  "donors.json",
  "donations.json",
  "cash-entries.json",
  "patients-dswd-delta.json",
  "metric-snapshots.json",
  "meal-services.json",
  "care-cart-logs.json",
  "census-history.json",
  "calendar-events.json",
];

mkdirSync(DEST_DIR, { recursive: true });

for (const file of FILES) {
  const src = join(SOURCE_DIR, file);
  const dest = join(DEST_DIR, file);
  if (existsSync(src)) {
    copyFileSync(src, dest);
  } else if (!existsSync(dest)) {
    writeFileSync(dest, "[]\n");
  }
}

console.log(
  existsSync(SOURCE_DIR)
    ? `Synced real data from ${SOURCE_DIR} -> ${DEST_DIR}`
    : `${SOURCE_DIR} not found -- using empty placeholders in ${DEST_DIR}`
);
