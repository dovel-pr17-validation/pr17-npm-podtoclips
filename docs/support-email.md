# Support Email Delivery

The authenticated Help & Support page sends messages through the backend. The
browser can edit the sender address, subject, and message, but it cannot choose
or override the receiver.

## Configuration

Set these backend environment values:

```text
BREVO_API_KEY=xkeysib-...
SUPPORT_RECEIVER_EMAIL=supportcontact584@gmail.com
SUPPORT_FROM_EMAIL=PodToClips Support <support@podtoclips.com>
```

Before enabling delivery, verify the domain used by `SUPPORT_FROM_EMAIL` in
Brevo. The support receiver can remain a separate mailbox because it is never
used as the technical sender.

The API sends the verified PodToClips address as `From` and the form's sender
address as `Reply-To`. This avoids sender spoofing while making the email
client's Reply action target the customer.

## Security and failure behavior

- All support routes use the same Clerk-authenticated API boundary as the rest
  of the workspace.
- The receiver is loaded from server configuration and is never accepted from
  a POST body.
- Sender, subject, and message length are validated on the server.
- Each account or local IP can send up to five messages per ten-minute window.
- Provider errors return a safe error to the page instead of reporting a false
  success.
- The page disables sending until all three delivery settings are present.

Changing the receiver later requires only a new value for
`SUPPORT_RECEIVER_EMAIL`; no frontend rebuild is required.
