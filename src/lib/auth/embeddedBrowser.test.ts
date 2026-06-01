import { describe, expect, it } from "vitest";
import { detectEmbeddedBrowser } from "./embeddedBrowser";

// Real UA strings collected from the wild — kept verbatim so future
// changes to the detector are validated against actual values, not
// synthetic test data.
const REAL_WORLD_UAS = {
  safariIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1",
  chromeMac:
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
  instagramIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Instagram 300.0.0.0.0 (iPhone15,3; iOS 17_0; en_US; en-US; scale=3.00; 1290x2796; 500000000)",
  facebookIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 [FBAN/FBIOS;FBAV/450.0.0.0.0;FBBV/000000000;FBDV/iPhone15,3;FBMD/iPhone;FBSN/iOS;FBSV/17.0]",
  messengerAndroid:
    "Mozilla/5.0 (Linux; Android 13; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Mobile Safari/537.36 [FB_IAB/Orca-Android;FBAV/420.0.0.0.0]",
  tiktokIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 musical_ly_30.0.0 JsSdk/2.0 NetType/WIFI Channel/App Store ByteLocale/en Region/US BytedanceWebview/d8a21c6",
  linkedinIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 LinkedInApp",
  wechatIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 MicroMessenger/8.0.42(0x18002A2D)",
  lineIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 Line/13.0.0",
  googleAppIos:
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148 GSA/305.0.0.0",
};

describe("detectEmbeddedBrowser", () => {
  it("returns null for real Safari", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.safariIos)).toBeNull();
  });

  it("returns null for desktop Chrome", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.chromeMac)).toBeNull();
  });

  it("returns null for empty / nullish UAs", () => {
    expect(detectEmbeddedBrowser("")).toBeNull();
    expect(detectEmbeddedBrowser(null)).toBeNull();
    expect(detectEmbeddedBrowser(undefined)).toBeNull();
  });

  it("identifies Instagram", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.instagramIos)).toEqual({
      app: "Instagram",
    });
  });

  it("identifies Facebook iOS app via FBAN/FBIOS", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.facebookIos)).toEqual({
      app: "Facebook",
    });
  });

  it("identifies Messenger Android via FB_IAB", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.messengerAndroid)).toEqual({
      app: "Facebook",
    });
  });

  it("identifies TikTok via BytedanceWebview", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.tiktokIos)).toEqual({
      app: "TikTok",
    });
  });

  it("identifies LinkedIn", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.linkedinIos)).toEqual({
      app: "LinkedIn",
    });
  });

  it("identifies WeChat", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.wechatIos)).toEqual({
      app: "WeChat",
    });
  });

  it("identifies Line", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.lineIos)).toEqual({
      app: "Line",
    });
  });

  it("identifies the Google iOS app", () => {
    expect(detectEmbeddedBrowser(REAL_WORLD_UAS.googleAppIos)).toEqual({
      app: "Google app",
    });
  });
});
