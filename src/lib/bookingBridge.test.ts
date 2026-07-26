import { describe, expect, it } from "vitest";
import {
  BRIDGE_SOURCE,
  isBridgeMessage,
  isCheckoutFunnelPath,
  isConfirmationPath,
  parseReceiptFromCheckoutJson,
} from "./bookingBridge";
import checkoutFixture from "./__fixtures__/activenet-checkout.json";

describe("isBridgeMessage", () => {
  it("accepts nav and checkout-complete messages from the bridge", () => {
    expect(
      isBridgeMessage({ source: BRIDGE_SOURCE, type: "nav", path: "/seattle/x" })
    ).toBe(true);
    expect(
      isBridgeMessage({
        source: BRIDGE_SOURCE,
        type: "checkout-complete",
        path: "/seattle/receipt",
        receiptNumber: "A1",
      })
    ).toBe(true);
  });

  it("rejects foreign or malformed payloads", () => {
    expect(isBridgeMessage(null)).toBe(false);
    expect(isBridgeMessage("hello")).toBe(false);
    expect(isBridgeMessage({ source: "someone-else", type: "nav", path: "/x" })).toBe(
      false
    );
    expect(isBridgeMessage({ source: BRIDGE_SOURCE, type: "nav" })).toBe(false); // no path
    expect(
      isBridgeMessage({ source: BRIDGE_SOURCE, type: "other", path: "/x" })
    ).toBe(false);
  });
});

describe("isCheckoutFunnelPath / isConfirmationPath", () => {
  it("detects the cart/checkout funnel", () => {
    expect(isCheckoutFunnelPath("/seattle/onlinecart/index")).toBe(true);
    expect(isCheckoutFunnelPath("/seattle/checkout/payment")).toBe(true);
    expect(isCheckoutFunnelPath("/seattle/reservation/search/detail/281")).toBe(
      false
    );
  });

  it("detects a completed-checkout page", () => {
    expect(isConfirmationPath("/seattle/receipt/12345")).toBe(true);
    expect(isConfirmationPath("/seattle/reservation/complete")).toBe(true);
    expect(isConfirmationPath("/seattle/onlinecart/index")).toBe(false);
  });
});

describe("parseReceiptFromCheckoutJson", () => {
  it("finds the receipt number nested in a checkout response", () => {
    expect(parseReceiptFromCheckoutJson(checkoutFixture)).toEqual({
      receiptNumber: "SEA-2026-0007731",
    });
  });

  it("finds a receipt regardless of key casing/nesting", () => {
    expect(
      parseReceiptFromCheckoutJson({ data: { receiptHeaderId: 998877 } })
    ).toEqual({ receiptNumber: "998877" });
  });

  it("returns null when there is no receipt, ignoring zero/empty values", () => {
    expect(parseReceiptFromCheckoutJson({ headers: { response_code: "0000" } })).toBeNull();
    expect(parseReceiptFromCheckoutJson({ receipt_number: "0" })).toBeNull();
    expect(parseReceiptFromCheckoutJson({ receipt_number: "" })).toBeNull();
    expect(parseReceiptFromCheckoutJson(null)).toBeNull();
  });
});
