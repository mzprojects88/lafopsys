/**
 * A phone photo, shrunk in the browser to a JPEG data URL before it is sent
 * (odometer photos and receipts, 0078): a 12-megapixel camera file would be
 * slow on a weak signal, and the AI reads digits and receipts fine at
 * 1280-1600 px. The camera's rotation is applied by createImageBitmap.
 */
export async function shrinkImage(file: File, maxSide: number, quality = 0.82): Promise<string> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  return canvas.toDataURL("image/jpeg", quality);
}
