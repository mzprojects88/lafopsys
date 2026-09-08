// Proves the Backblaze bucket end to end without a browser: sign a PUT,
// upload a 1 KB test object, HEAD it, fetch it through a signed GET, delete
// it. Run: node --env-file=.env.local scripts/smoke-test-files-flow.mjs
// Prints nothing secret.
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

const need = (n) => {
  if (!process.env[n]) {
    console.error(`Missing ${n}`);
    process.exit(1);
  }
  return process.env[n];
};
const bucket = need("B2_BUCKET_NAME");
const s3 = new S3Client({
  endpoint: need("B2_S3_ENDPOINT"),
  region: need("B2_S3_REGION"),
  credentials: { accessKeyId: need("B2_ACCESS_KEY_ID"), secretAccessKey: need("B2_SECRET_ACCESS_KEY") },
  forcePathStyle: true,
  requestChecksumCalculation: "WHEN_REQUIRED",
  responseChecksumValidation: "WHEN_REQUIRED",
});

const key = `_smoke/${Date.now()}-smoke test ñ.txt`;
const body = Buffer.from("lafopsys file library smoke test\n".repeat(32));
const putUrl = await getSignedUrl(s3, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: "text/plain" }), { expiresIn: 120 });
const put = await fetch(putUrl, { method: "PUT", body, headers: { "content-type": "text/plain" } });
console.log("PUT via signed URL:", put.status);
if (!put.ok) {
  console.error(await put.text());
  process.exit(1);
}
const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
console.log("HEAD:", head.ContentLength, "bytes", head.ContentType);
const getUrl = await getSignedUrl(s3, new GetObjectCommand({ Bucket: bucket, Key: key, ResponseContentDisposition: "attachment; filename=\"smoke.txt\"" }), { expiresIn: 120 });
const got = await fetch(getUrl);
const text = await got.text();
console.log("GET via signed URL:", got.status, text.length === body.length ? "bytes match" : "SIZE MISMATCH", "disposition:", got.headers.get("content-disposition"));
const anon = await fetch(`${process.env.B2_S3_ENDPOINT}/${bucket}/${encodeURIComponent(key)}`);
console.log("unsigned GET (must be refused):", anon.status);
await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
const after = await fetch(getUrl);
console.log("after delete, signed GET:", after.status);
