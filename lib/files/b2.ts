import "server-only";
import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { b2AccessKeyId, b2Bucket, b2Endpoint, b2Region, b2SecretAccessKey } from "./env";

/**
 * The one door to the Backblaze bucket. Uploads never pass through the
 * server (Vercel caps a function's request body at 4.5 MB): the browser
 * PUTs straight to B2 with a URL signed here, and the server confirms
 * with a HEAD. Downloads are signed GETs that expire in minutes, so a
 * link that leaks stops working. Path-style addressing and no request
 * checksums: B2's S3 layer rejects the CRC32 headers newer SDKs add.
 */

let client: S3Client | null = null;

function s3(): S3Client {
  if (!client) {
    client = new S3Client({
      endpoint: b2Endpoint(),
      region: b2Region(),
      credentials: { accessKeyId: b2AccessKeyId(), secretAccessKey: b2SecretAccessKey() },
      forcePathStyle: true,
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    });
  }
  return client;
}

/** How long a signed link lives. Long enough to click, short enough to be useless if copied later. */
export const SIGNED_URL_SECONDS = 300;

export async function presignPut(key: string, contentType: string): Promise<string> {
  return getSignedUrl(s3(), new PutObjectCommand({ Bucket: b2Bucket(), Key: key, ContentType: contentType }), { expiresIn: SIGNED_URL_SECONDS });
}

/** Encodes a file name for Content-Disposition: ASCII fallback plus the RFC 5987 UTF-8 form. */
export function contentDisposition(fileName: string, inline: boolean): string {
  const ascii = fileName.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const utf8 = encodeURIComponent(fileName).replace(/['()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return `${inline ? "inline" : "attachment"}; filename="${ascii}"; filename*=UTF-8''${utf8}`;
}

export async function presignGet(key: string, fileName: string, contentType: string, inline: boolean): Promise<string> {
  return getSignedUrl(
    s3(),
    new GetObjectCommand({ Bucket: b2Bucket(), Key: key, ResponseContentDisposition: contentDisposition(fileName, inline), ResponseContentType: contentType }),
    { expiresIn: SIGNED_URL_SECONDS }
  );
}

/** Null when the object is not there. */
export async function headObject(key: string): Promise<{ size: number; contentType: string | null } | null> {
  try {
    const r = await s3().send(new HeadObjectCommand({ Bucket: b2Bucket(), Key: key }));
    return { size: r.ContentLength ?? 0, contentType: r.ContentType ?? null };
  } catch (e) {
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status === 404 || (e as { name?: string }).name === "NotFound") return null;
    throw e;
  }
}

export async function deleteObject(key: string): Promise<void> {
  await s3().send(new DeleteObjectCommand({ Bucket: b2Bucket(), Key: key }));
}
