# Content moderation

- Players can report posts and comments with the flag button, or open a direct,
  group, or team chat message’s actions and choose **Report message**. They can
  block the account while reporting.
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
  and time.
- The pre-publication database filter checks text in new or edited posts,
  comments and messages. Staff review reports for context, images, and videos.
  Apply the content moderation migration before deploying the app changes.
