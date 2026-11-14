import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sealCalendarLink, openCalendarLink, CalendarLinkExpiredError, CalendarLinkConfigurationError, CalendarLinkSizeError } from "./calendarLinkToken";
import { normalizeCalendarEvent } from "./calendarExport";
const input = { id: "match-test", payload: normalizeCalendarEvent({id:"match-test",title:"Private tennis match",date:"2026-09-26",time:"12:30",timezone:"America/Los_Angeles",location:"Backyard"}) };
const extract = (path: string) => path.split("/")[3];
beforeEach(() => vi.stubEnv("CALENDAR_LINK_SECRET", "ab".repeat(32)));
afterEach(() => vi.unstubAllEnvs());
describe("protected calendar links", () => {
 it("round trips an immutable snapshot, without readable event data in the URL", () => {
  const link = sealCalendarLink(input, 1000);
  const opened = openCalendarLink(extract(link.path), 1001);
  expect(opened.payload).toEqual(input.payload);
  expect(opened.id).toBe(input.id);
  expect(link.path).not.toContain("Private");
  expect(sealCalendarLink(input,1000).path).not.toBe(link.path);
 });
 it("does not include the RSVP capability in the snapshot", () => {
  const result = openCalendarLink(extract(sealCalendarLink({...input,guestToken:"roster-secret"}).path));
  expect(result).not.toHaveProperty("guestToken");
 });
 it("expires at the advertised deadline", () => {
  const link = sealCalendarLink(input, 1000);
  const deadline = Date.parse(link.expiresAt);
  expect(() => openCalendarLink(extract(link.path), deadline-1)).not.toThrow();
  expect(() => openCalendarLink(extract(link.path), deadline)).toThrow(CalendarLinkExpiredError);
 });
 it("rejects tampering and key rotation", () => {
  const token = extract(sealCalendarLink(input).path);
  const bytes = Buffer.from(token,"base64url"); bytes[30] ^= 1;
  expect(() => openCalendarLink(bytes.toString("base64url"))).toThrow();
  vi.stubEnv("CALENDAR_LINK_SECRET","cd".repeat(32));
  expect(() => openCalendarLink(token)).toThrow();
 });
 it("requires a dedicated configured key", () => {
  vi.stubEnv("CALENDAR_LINK_SECRET", "");
  expect(() => sealCalendarLink(input)).toThrow(CalendarLinkConfigurationError);
 });
 it("bounds data and rejects invalid IDs", () => {
  expect(() => sealCalendarLink({...input,payload:{...input.payload,notes:"x".repeat(5000)}})).toThrow(CalendarLinkSizeError);
  expect(() => sealCalendarLink({...input,id:"foo\r\nBEGIN:VEVENT"})).toThrow();
  expect(() => openCalendarLink("x".repeat(6000))).toThrow();
 });
});
