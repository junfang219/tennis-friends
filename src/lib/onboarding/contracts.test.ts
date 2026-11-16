import { describe,it,expect } from "vitest";
import { saveOnboardingSchema } from "./contracts";
const player={id:"11111111-1111-4111-8111-111111111111",name:"Sam",phone:"(206) 555-0101",email:"",confirmedAt:null};
const draft={name:"Team",teamNumber:"",deadline:"",includeUsta:false};
describe("production team onboarding input",()=>{
 it("normalizes phones and discards client-supplied acceptance and token fields",()=>{
  const result=saveOnboardingSchema.parse({draft,players:[{...player,memberId:"spoof",token:"spoof",acceptedAt:"spoof"}]});
  expect(result.players[0].phone).toBe("+12065550101");
  expect(result.players[0]).not.toHaveProperty("token");expect(result.players[0]).not.toHaveProperty("memberId");
 });
 it("rejects duplicate contacts after normalization",()=>{
  expect(saveOnboardingSchema.safeParse({draft,players:[player,{...player,id:"22222222-2222-4222-8222-222222222222",phone:"+12065550101"}]}).success).toBe(false);
 });
 it("rejects invalid account associations, contact details, and empty teams",()=>{
  expect(saveOnboardingSchema.safeParse({draft,players:[{...player,associatedAccountId:"sample-friend-sam"}]}).success).toBe(false);
  expect(saveOnboardingSchema.safeParse({draft,players:[{...player,phone:"",email:""}]}).success).toBe(false);
  expect(saveOnboardingSchema.safeParse({draft:{...draft,name:""},players:[]}).success).toBe(false);
 });
});
