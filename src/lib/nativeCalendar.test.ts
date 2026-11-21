import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ platform: "ios", available: true, present: vi.fn(), link: vi.fn(), navigate: vi.fn() }));
vi.mock("@capacitor/core", () => ({
  Capacitor: { getPlatform: () => mocks.platform, isPluginAvailable: () => mocks.available },
  registerPlugin: () => ({ presentEvent: mocks.present }),
}));
vi.mock("./calendarLinks", () => ({ createCalendarLink: mocks.link }));
import { addToCalendar, hasNativeCalendar } from "./nativeCalendar";
const event = { id: "game-123", title: "Doubles", date: "2026-09-26", time: "12:30", timezone: "America/Los_Angeles" };

beforeEach(() => { mocks.platform = "ios"; mocks.available = true; vi.clearAllMocks(); mocks.link.mockResolvedValue({url:"http://localhost/calendar/shared/test/event.ics"}); vi.stubGlobal("window", {location:{assign:mocks.navigate}}); });
afterEach(() => vi.unstubAllGlobals());
describe("calendar delivery", () => {
  it.each(["saved", "cancelled"])("returns %s from the native editor", async (status) => {
    mocks.present.mockResolvedValue({ status });
    expect(await addToCalendar(event)).toBe(status);
    expect(mocks.present).toHaveBeenCalledWith(expect.objectContaining({ start: "2026-09-26T19:30:00.000Z", allDay: false }));
    expect(mocks.link).not.toHaveBeenCalled();
  });
  it.each([["web", false], ["ios", false], ["android", true]])("opens hosted calendar on %s with availability %s", async (platform, available) => {
    mocks.platform = platform; mocks.available = available;
    expect(hasNativeCalendar()).toBe(false);
    expect(await addToCalendar(event)).toBe("opened");
    expect(mocks.link).toHaveBeenCalledWith(event, undefined);
    expect(mocks.navigate).toHaveBeenCalledWith("http://localhost/calendar/shared/test/event.ics");
    expect(mocks.present).not.toHaveBeenCalled();
  });
  it("rejects invalid input before either delivery path", async () => {
    await expect(addToCalendar({ ...event, date: "2026-02-30" })).rejects.toThrow();
    expect(mocks.present).not.toHaveBeenCalled(); expect(mocks.link).not.toHaveBeenCalled();
  });
  it("blocks a second presentation and permits another after cancellation", async () => {
    let finish!: (result: { status: "cancelled" }) => void;
    mocks.present.mockImplementationOnce(() => new Promise((resolve) => { finish = resolve; }));
    const first = addToCalendar(event);
    await expect(addToCalendar(event)).rejects.toThrow("already open");
    expect(mocks.present).toHaveBeenCalledTimes(1);
    finish({ status: "cancelled" }); await first;
    mocks.present.mockResolvedValue({ status: "saved" });
    expect(await addToCalendar(event)).toBe("saved");
  });
  it("propagates presentation errors without silently opening a link and clears the lock", async () => {
    mocks.present.mockRejectedValueOnce(new Error("Unavailable"));
    await expect(addToCalendar(event)).rejects.toThrow("Unavailable");
    expect(mocks.link).not.toHaveBeenCalled();
    mocks.present.mockResolvedValue({ status: "saved" });
    expect(await addToCalendar(event)).toBe("saved");
  });
  it("rejects an unexpected bridge response", async () => {
    mocks.present.mockResolvedValue({ status: "unknown" });
    await expect(addToCalendar(event)).rejects.toThrow();
  });
});
