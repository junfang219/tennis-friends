# Content moderation

- Players can report posts and comments with the flag button, or open a direct,
  group, or team chat message’s actions and choose **Report message**. Players
  can also report profiles, album titles and descriptions, individual album
  attachments, and court reviews. They can
  block the account while reporting. In shared chats, blocked participants'
  messages and push alerts are hidden from each other. Their group membership
  and other members’ views are unaffected.
- Reports preserve the submitted reason, details, text, and links to eligible
  attachments. Only authorized staff can see the queue. It opens at
  /moderation and shows the 50 oldest pending reports.
- Grant access by setting `content_moderator: true` in the staff account’s
  Supabase Auth **app metadata** using a trusted admin tool. Merge the flag with
  existing app metadata. Remove the flag when access ends.
- Configure the existing `RESEND_API_KEY` and `REPORT_EMAIL` for new-report
  notifications. Emails link to the queue and contain no report text or
  attachments. Monitor the queue directly if email is unavailable.
- Review reports each day. Open attachments only as needed to decide. Dismiss
  reports that do not warrant removal or confirm **Remove content**. Removal
  deletes the item from the app using its existing database relationships and
  closes other pending reports for that item. The decision records the reviewer
  and time. Unreferenced attachments uploaded by the author are removed from
  Storage. If a Storage request fails, use **Retry attachment removal** in the
  queue. A player can report a changed item again after a dismissal.
- The pre-publication database filter checks text in new or edited posts,
  comments, messages, profiles, albums, and court reviews. New image and video
  files stay visible to their uploader and staff until approved. Review
  **Uploads awaiting screening** in the moderation queue. A rejection keeps
  the file private to its uploader and staff.
- The App Store safety migration moves existing managed media links to a
  same-origin route and makes the underlying buckets private. Coordinate the
  database and web release so older public links are replaced as the new route
  becomes available. Existing uploaded media retains its publication status
  and follows its parent row’s visibility after the migration.
- For a fresh iOS release, run `npm run ios:prod` before archiving. The command
  checks that the archive inputs include a packaged entry page and use the
  production HTTPS URL.
- Native Sign in with Apple can save an encrypted grant after sign-in for
  deletion-time revocation. Set `APPLE_NATIVE_CLIENT_SECRET` to an Apple
  client secret for `com.tennisfriend.app` and set
  `APPLE_REVOCATION_ENCRYPTION_KEY` to a stable, base64-encoded 32-byte key on
  the server. Accounts without a revocable grant can still delete and receive
  instructions for removing Apple authorization in Settings.
