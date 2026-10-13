import { test } from "node:test";
import assert from "node:assert/strict";
import { amountInWords, numberToWords } from "../lib/utils/amount-words.ts";

test("numbers to words", () => {
  assert.equal(numberToWords(0), "zero");
  assert.equal(numberToWords(15), "fifteen");
  assert.equal(numberToWords(42), "forty-two");
  assert.equal(numberToWords(100), "one hundred");
  assert.equal(numberToWords(1250), "one thousand two hundred fifty");
  assert.equal(numberToWords(1000000), "one million");
  assert.equal(numberToWords(2500010), "two million five hundred thousand ten");
});

test("amounts in words for the receipt", () => {
  assert.equal(amountInWords(1250.5), "One thousand two hundred fifty pesos and 50/100");
  assert.equal(amountInWords(1), "One peso and 00/100");
  assert.equal(amountInWords(0.07), "Zero pesos and 07/100");
  assert.equal(amountInWords(99.999), "One hundred pesos and 00/100");
  assert.equal(amountInWords(20, "USD"), "Twenty dollars and 00/100");
});
