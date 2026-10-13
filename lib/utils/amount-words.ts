/** "PHP 1,250.50" in words for receipts: "One thousand two hundred fifty pesos and 50/100". */
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const SCALES = ["", "thousand", "million", "billion"];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) parts.push(`${ONES[Math.floor(n / 100)]} hundred`);
  const rest = n % 100;
  if (rest >= 20) parts.push(TENS[Math.floor(rest / 10)]! + (rest % 10 ? `-${ONES[rest % 10]}` : ""));
  else if (rest > 0) parts.push(ONES[rest]!);
  return parts.join(" ");
}

export function numberToWords(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "";
  if (n === 0) return "zero";
  const groups: string[] = [];
  let rest = Math.floor(n);
  let scale = 0;
  while (rest > 0 && scale < SCALES.length) {
    const chunk = rest % 1000;
    if (chunk) groups.unshift(`${below1000(chunk)}${SCALES[scale] ? ` ${SCALES[scale]}` : ""}`);
    rest = Math.floor(rest / 1000);
    scale += 1;
  }
  return groups.join(" ");
}

/** Whole units in words, centavos as a fraction; capitalised for the receipt line. */
export function amountInWords(amount: number, currency: "PHP" | "USD" = "PHP"): string {
  const cents = Math.round(amount * 100);
  const whole = Math.floor(cents / 100);
  const fraction = cents % 100;
  const unit = currency === "USD" ? (whole === 1 ? "dollar" : "dollars") : (whole === 1 ? "peso" : "pesos");
  const words = `${numberToWords(whole)} ${unit} and ${String(fraction).padStart(2, "0")}/100`;
  return words.charAt(0).toUpperCase() + words.slice(1);
}
