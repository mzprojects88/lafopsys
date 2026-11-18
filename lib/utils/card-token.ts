/** The code in a Patient ID card's QR (0164): https://arkos.littlearkfoundation.org/c/<32 hex>, or the bare
 * code; null for anything else. Pure, so tests/ can run it. */
export function cardToken(text: string): string | null {
  const m = /(?:^|\/c\/)([0-9a-f]{32})(?:[/?#]|$)/.exec(text.trim());
  return m ? m[1]! : null;
}
