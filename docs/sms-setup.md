# Set up TennisFriends SMS invitations

## Check your Twilio account

1. Open the [Twilio Console](https://console.twilio.com/) and select the intended account. Check for a **Trial** banner or **Upgrade** prompt.
2. In the legacy Console, open **Phone Numbers → Manage → Active numbers**. Open a number and check its **SMS** capability. If the new Console uses **Numbers & Senders**, inspect its phone-number inventory. A verified personal phone or a Verify service is not an invitation sender.
3. If using a Messaging Service, check its sender pool contains an SMS-capable number. A Messaging Service SID starts with `MG`; an Account SID starts with `AC`.

Current trials offer verified-recipient tests with predefined message content. A Console trial test does not prove custom invitation messages are enabled; see [Twilio's current SMS trial guide](https://www.twilio.com/docs/usage/trials/try-out-sms). Older accounts can have a different trial experience. Check the account's actual restrictions before upgrading or acquiring a sender.

For US messaging, follow the sender's registration instructions in Twilio: [A2P 10DLC](https://www.twilio.com/docs/messaging/compliance/a2p-10dlc) for local numbers or [toll-free verification](https://www.twilio.com/docs/messaging/compliance/toll-free/console-onboarding) for toll-free numbers. A purchased SMS-capable number alone does not establish registration approval. Complete the applicable setup before testing custom invitations.

## Connect the local app

Copy the real account's Account SID and Auth Token from Twilio into the gitignored `.env.development.local` file. Use live account credentials, not Twilio test credentials. Never paste tokens into chat or commit them. Set one sender option:

```dotenv
TWILIO_ACCOUNT_SID=AC_REPLACE_WITH_ACCOUNT_SID
TWILIO_AUTH_TOKEN=REPLACE_WITH_AUTH_TOKEN
TWILIO_FROM_NUMBER=+1_REPLACE_WITH_TWILIO_SENDER
# Or use a Messaging Service instead of TWILIO_FROM_NUMBER:
# TWILIO_MESSAGING_SERVICE_SID=MG_REPLACE_WITH_SERVICE_SID
ONBOARDING_SMS_PUBLIC_ORIGIN=https://mytennisfriends.com
```

The SMS origin makes the phone's personal invitation link open the public app, while the captain can keep using localhost. It must serve `/team-invitations/:token` and use the same database; the current TennisFriends production app supports that route. Other environments should use their own compatible deployment. This setting does not change local email or shared-link origins.

Restart the local dev server after changing environment settings, then reload **Invite players**. The setup note should disappear. Readiness checks confirm credential shape and a public HTTPS link address; they do not verify the Twilio account, sender registration, balance, or carrier delivery. Configure Preview/Production environment variables separately and redeploy when those environments are ready to send.

## Test one invitation

Use a test team and one consenting recipient. Confirm permission in the SMS form, optionally include clearly labeled test USTA instructions, and send once. Re-entering an existing unsent phone number reuses that draft. Issued invitations stay in **Pending invitations**; use their existing controls instead of creating another entry.

Check Twilio Messaging logs for the provider status. Provider acceptance is not handset delivery. Have the recipient confirm receipt, open the link, sign in to the intended account, accept, then reopen and verify exactly one team membership. If the app reports an uncertain/pending send, reconcile it in Twilio before retrying. This revision does not enable automatic SMS USTA reminders.
