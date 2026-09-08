// lib/utils/money.ts -- centavo arithmetic.
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatAmount2, formatPeso2, fromCentavos, halves, mulC, roundHalfUp, roundHalfUp2, toCentavos } from "../lib/utils/money.ts";

describe("money", () => {
  it("rounds half up, both signs", () => {
    assert.equal(roundHalfUp(2.5), 3);
    assert.equal(roundHalfUp(-2.5), -3);
    assert.equal(roundHalfUp(2.4999), 2);
    assert.equal(roundHalfUp2(86.875), 86.88);
    assert.equal(roundHalfUp2(1.005), 1.01);
  });
  it("pesos <-> centavos, strings included", () => {
    assert.equal(toCentavos(21140), 2114000);
    assert.equal(toCentavos("9000.00"), 900000);
    assert.equal(toCentavos("0.1") + toCentavos("0.2"), 30);
    assert.equal(toCentavos(null), 0);
    assert.equal(fromCentavos(123456), 1234.56);
  });
  it("mulC rounds once", () => {
    assert.equal(mulC(8688, 1.69), 14683);
  });
  it("halves sum exactly", () => {
    assert.deepEqual(halves(2114001), [1057001, 1057000]);
    assert.deepEqual(halves(1), [1, 0]);
  });
  it("formats with two decimals", () => {
    assert.equal(formatAmount2(1234567), "12,345.67");
    assert.equal(formatAmount2(-50), "-0.50");
    assert.match(formatPeso2(100000), /1,000\.00/);
  });
});
