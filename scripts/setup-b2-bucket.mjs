// One-time bucket setup for the file library (0045): make the bucket
// private (every link the app hands out is signed) and allow the browser
// to PUT straight to it from the app's origins. Uses Backblaze's native API
// because the S3 layer has no bucket-type call; the S3 key id and secret
// double as the B2 key id and application key.
//
//   node --env-file=.env.local scripts/setup-b2-bucket.mjs
//
// Idempotent; prints nothing secret. If the key lacks writeBuckets, set the
// same things in the B2 console: Bucket Settings -> Private, and CORS Rules
// -> custom with the origins below.
const ORIGINS = ["https://lafopsys.vercel.app", "https://*.vercel.app", "http://localhost:3000"];
const need = (n) => {
  if (!process.env[n]) {
    console.error(`Missing ${n}`);
    process.exit(1);
  }
  return process.env[n];
};
const bucketName = need("B2_BUCKET_NAME");
const auth = Buffer.from(`${need("B2_ACCESS_KEY_ID")}:${need("B2_SECRET_ACCESS_KEY")}`).toString("base64");
const a = await fetch("https://api.backblazeb2.com/b2api/v3/b2_authorize_account", { headers: { Authorization: `Basic ${auth}` } });
const account = await a.json();
if (!a.ok) {
  console.error("authorize failed:", a.status, account.code);
  process.exit(1);
}
const api = account.apiInfo.storageApi;
if (!api.capabilities.includes("writeBuckets")) {
  console.error("This key cannot change bucket settings (no writeBuckets). Set Private + CORS in the B2 console.");
  process.exit(1);
}
const call = (name, body) =>
  fetch(`${api.apiUrl}/b2api/v3/${name}`, { method: "POST", headers: { Authorization: account.authorizationToken, "content-type": "application/json" }, body: JSON.stringify(body) }).then(async (r) => {
    const j = await r.json();
    if (!r.ok) throw new Error(`${name}: ${r.status} ${j.code} ${j.message}`);
    return j;
  });
const { buckets } = await call("b2_list_buckets", { accountId: account.accountId, bucketName });
const bucket = buckets[0];
if (!bucket) {
  console.error(`No bucket named ${bucketName} visible to this key.`);
  process.exit(1);
}
console.log("before:", bucket.bucketName, bucket.bucketType, "cors rules:", bucket.corsRules.length);
const corsRules = [
  {
    corsRuleName: "lafopsys-app-uploads",
    allowedOrigins: ORIGINS,
    allowedOperations: ["s3_put", "s3_get", "s3_head"],
    allowedHeaders: ["*"],
    exposeHeaders: ["etag"],
    maxAgeSeconds: 3600,
  },
];
const updated = await call("b2_update_bucket", { accountId: account.accountId, bucketId: bucket.bucketId, bucketType: "allPrivate", corsRules });
console.log("after: ", updated.bucketName, updated.bucketType, "cors rules:", updated.corsRules.map((r) => `${r.corsRuleName} [${r.allowedOrigins.join(", ")}] ${r.allowedOperations.join(",")}`).join("; "));
