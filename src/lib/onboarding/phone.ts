import { z } from "zod";
import { parsePhoneNumberFromString } from "libphonenumber-js";
/** US/Canada national format is the default; international numbers need +country code. */
export const invitationPhoneSchema = z.string().trim().max(40).transform((value, ctx): string => {
  const phone = parsePhoneNumberFromString(value, "US");
  if (!phone?.isValid()) { ctx.addIssue({ code: "custom", message: "Enter a valid phone number, including country code outside the US or Canada" }); return z.NEVER; }
  return phone.number;
});
