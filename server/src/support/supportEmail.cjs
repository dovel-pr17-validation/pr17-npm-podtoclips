const BREVO_EMAILS_URL = 'https://api.brevo.com/v3/smtp/email';

function parseSender(value) {
  const sender = String(value || '').trim();
  const mailboxMatch = sender.match(/^\s*(.*?)\s*<([^<>]+)>\s*$/);
  if (mailboxMatch) {
    return {
      name: mailboxMatch[1].trim(),
      email: mailboxMatch[2].trim(),
    };
  }
  return { email: sender };
}

function supportEmailConfig() {
  const receiver = String(process.env.SUPPORT_RECEIVER_EMAIL || '').trim();
  const from = String(process.env.SUPPORT_FROM_EMAIL || '').trim();
  const apiKey = String(process.env.BREVO_API_KEY || '').trim();
  return {
    receiver,
    from,
    configured: Boolean(receiver && from && apiKey),
  };
}

async function sendSupportEmail({ senderEmail, subject, body, requestId }, fetchImpl = fetch) {
  const config = supportEmailConfig();
  if (!config.configured) {
    const error = new Error('Support email delivery is not configured yet.');
    error.statusCode = 503;
    throw error;
  }

  const response = await fetchImpl(BREVO_EMAILS_URL, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'api-key': String(process.env.BREVO_API_KEY || '').trim(),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      sender: parseSender(config.from),
      to: [{ email: config.receiver }],
      replyTo: { email: senderEmail },
      subject: `[PodToClips Support] ${subject}`,
      textContent: `Sender: ${senderEmail}\n\n${body}`,
      headers: { 'Idempotency-Key': requestId },
      tags: ['support-request'],
    }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.message || 'The support email could not be sent.');
    error.statusCode = 502;
    throw error;
  }
  return { id: data.messageId };
}

module.exports = {
  sendSupportEmail,
  supportEmailConfig,
  parseSender,
};
