import { describe,it,expect } from "vitest";
import { saveOnboardingSchema, storedOnboardingSchema } from "./contracts";
import { registrationMessage } from "../registrationOnboarding";
const player={id:"11111111-1111-4111-8111-111111111111",name:"Sam",phone:"(206) 555-0101",email:"",confirmedAt:null};
const draft={name:"Team",teamNumber:"",deadline:"",includeUsta:false};
describe("production team onboarding input",()=>{
 it("includes an edited description when reopening and saving a legacy opted-out draft",()=>{
  const loaded=storedOnboardingSchema.parse({config:{...draft,description:"Original description",includeDescription:false},players:[]});
  expect(loaded.config.includeDescription).toBe(true);
  const saved=saveOnboardingSchema.parse({draft:{...loaded.config,description:"Updated team description"},players:[player]});
  // The database's public invitation lookup still reads this compatibility
  // field, so the normalized value must survive the save, not just the preview.
  expect(saved.draft.includeDescription).toBe(true);
  const reopened=storedOnboardingSchema.parse(JSON.parse(JSON.stringify({config:saved.draft,players:[]})));
  expect(registrationMessage({...reopened.config,players:[]},"https://example.com/join")).toContain("Updated team description");
  expect(reopened.config.includeUsta).toBe(false);
 });
 it.each(["2026-11-16T05:37:17.457Z","2026-11-16T05:37:17.457+00:00","2026-11-15T21:37:17.457-08:00"])("preserves a registration confirmation when saving the returned timestamp %s",confirmedAt=>{
  const result=saveOnboardingSchema.parse({draft,players:[{...player,confirmedAt}]});
  expect(result.players[0].confirmedAt).toBe(confirmedAt);
 });
 it.each(["2026-11-16T05:37:17.457","not-a-date","2026-11-16T05:37:17+25:00"])("rejects invalid or unzoned confirmation timestamp %s",confirmedAt=>{
  expect(saveOnboardingSchema.safeParse({draft,players:[{...player,confirmedAt}]}).success).toBe(false);
 });
 it("normalizes phones and discards client-supplied acceptance and token fields",()=>{
  const result=saveOnboardingSchema.parse({draft,players:[{...player,memberId:"spoof",token:"spoof",acceptedAt:"spoof"}]});
  expect(result.players[0].phone).toBe("+12065550101");
  expect(result.players[0]).not.toHaveProperty("token");expect(result.players[0]).not.toHaveProperty("memberId");
 });
 it("allows a name-only roster and a team with no pre-entered players",()=>{
  expect(saveOnboardingSchema.parse({draft,players:[{id:player.id,name:"Sam",email:"",confirmedAt:null}]}).players[0].phone).toBe("");
  expect(saveOnboardingSchema.safeParse({draft,players:[]}).success).toBe(true);
 });
 it("rejects duplicate contacts after normalization",()=>{
  expect(saveOnboardingSchema.safeParse({draft,players:[player,{...player,id:"22222222-2222-4222-8222-222222222222",phone:"+12065550101"}]}).success).toBe(false);
 });
 it("rejects invalid account associations and empty team names",()=>{
  expect(saveOnboardingSchema.safeParse({draft,players:[{...player,associatedAccountId:"sample-friend-sam"}]}).success).toBe(false);
  expect(saveOnboardingSchema.safeParse({draft,players:[{...player,phone:"",email:"invalid"}]}).success).toBe(false);
  expect(saveOnboardingSchema.safeParse({draft:{...draft,name:""},players:[]}).success).toBe(false);
 });
});
