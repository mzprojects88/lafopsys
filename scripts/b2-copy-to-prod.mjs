// Copies every file of a dev Backblaze bucket into its production bucket, same key, same content type.
// Re-runnable: a file already in production with the same size is skipped, so a second run copies only
// what was uploaded since (the final pass at the switch-over). Never deletes anything, never prints a key.
//
//   node scripts/b2-copy-to-prod.mjs opsys|inventory [--dry-run]
//
// Source: the app's dev .env.local (B2_*). Target: ~/.config/laf/b2-prod.env with
//   B2_PROD_S3_ENDPOINT, B2_PROD_S3_REGION,
//   OPSYS_B2_BUCKET, OPSYS_B2_KEY_ID, OPSYS_B2_APP_KEY,
//   INVENTORY_B2_BUCKET, INVENTORY_B2_KEY_ID, INVENTORY_B2_APP_KEY
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { GetObjectCommand, HeadObjectCommand, ListObjectsV2Command, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";

const app = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
if (app !== "opsys" && app !== "inventory") throw new Error("usage: node scripts/b2-copy-to-prod.mjs opsys|inventory [--dry-run]");

const parseEnv = (file) =>
  Object.fromEntries(
    readFileSync(file, "utf8")
      .split(/\r?\n/)
      .map((l) => l.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/))
      .filter(Boolean)
      .map((m) => [m[1], m[2].replace(/^["']|["']$/g, "")])
  );
const root = join(import.meta.dirname, "..", "..");
const dev = parseEnv(join(root, app === "opsys" ? "LAF Operating System" : "laf-inventory", ".env.local"));
const prod = parseEnv(join(homedir(), ".config", "laf", "b2-prod.env"));
const P = app === "opsys" ? "OPSYS" : "INVENTORY";
for (const k of ["B2_PROD_S3_ENDPOINT", "B2_PROD_S3_REGION", `${P}_B2_BUCKET`, `${P}_B2_KEY_ID`, `${P}_B2_APP_KEY`]) {
  if (!prod[k] || /REGION/.test(prod[k])) throw new Error(`${k} is not filled in yet in ~/.config/laf/b2-prod.env`);
}

const client = (endpoint, region, id, secret) =>
  new S3Client({ endpoint, region, credentials: { accessKeyId: id, secretAccessKey: secret }, forcePathStyle: true, requestChecksumCalculation: "WHEN_REQUIRED", responseChecksumValidation: "WHEN_REQUIRED" });
const src = client(dev.B2_S3_ENDPOINT, dev.B2_S3_REGION, dev.B2_ACCESS_KEY_ID, dev.B2_SECRET_ACCESS_KEY);
const dst = client(prod.B2_PROD_S3_ENDPOINT, prod.B2_PROD_S3_REGION, prod[`${P}_B2_KEY_ID`], prod[`${P}_B2_APP_KEY`]);
const SRC = dev.B2_BUCKET_NAME;
const DST = prod[`${P}_B2_BUCKET`];
if (SRC === DST) throw new Error("Source and target bucket are the same");

const objects = [];
let token;
do {
  const r = await src.send(new ListObjectsV2Command({ Bucket: SRC, ContinuationToken: token }));
  objects.push(...(r.Contents ?? []));
  token = r.IsTruncated ? r.NextContinuationToken : undefined;
} while (token);

let copied = 0, skipped = 0, bytes = 0;
const failed = [];
for (const o of objects) {
  const there = await dst.send(new HeadObjectCommand({ Bucket: DST, Key: o.Key })).then((h) => h.ContentLength, () => null);
  if (there === o.Size) { skipped++; continue; }
  if (dryRun) { copied++; bytes += o.Size; continue; }
  try {
    const got = await src.send(new GetObjectCommand({ Bucket: SRC, Key: o.Key }));
    const body = Buffer.from(await got.Body.transformToByteArray());
    await dst.send(new PutObjectCommand({ Bucket: DST, Key: o.Key, Body: body, ContentType: got.ContentType, ...(got.ContentDisposition ? { ContentDisposition: got.ContentDisposition } : {}) }));
    const check = await dst.send(new HeadObjectCommand({ Bucket: DST, Key: o.Key }));
    if (check.ContentLength !== o.Size) throw new Error(`size ${check.ContentLength} != ${o.Size}`);
    copied++; bytes += o.Size;
  } catch (e) {
    failed.push(`${o.Key.split("/")[0]}/…: ${e.message}`);
  }
}
console.log(`${app}: ${objects.length} files in ${SRC} -> ${DST}: ${dryRun ? "would copy" : "copied"} ${copied} (${(bytes / 1048576).toFixed(1)} MB), already there ${skipped}, failed ${failed.length}`);
for (const f of failed.slice(0, 10)) console.log("  failed:", f);
process.exit(failed.length ? 1 : 0);
