/**
 * The Backblaze B2 bucket that holds the app's uploaded files (0045). Read
 * only on the server: the key signs upload and download URLs, the browser
 * never sees it. B2_PUBLIC_URL_BASE in .env.local is not used -- the
 * bucket is private and every link is signed.
 */

function required(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(`Missing ${name} — set the Backblaze variables in .env.local (and in Vercel for production).`);
  }
  return value;
}

export function b2Endpoint(): string {
  return required("B2_S3_ENDPOINT", process.env.B2_S3_ENDPOINT);
}

export function b2Region(): string {
  return required("B2_S3_REGION", process.env.B2_S3_REGION);
}

export function b2AccessKeyId(): string {
  return required("B2_ACCESS_KEY_ID", process.env.B2_ACCESS_KEY_ID);
}

export function b2SecretAccessKey(): string {
  return required("B2_SECRET_ACCESS_KEY", process.env.B2_SECRET_ACCESS_KEY);
}

export function b2Bucket(): string {
  return required("B2_BUCKET_NAME", process.env.B2_BUCKET_NAME);
}
