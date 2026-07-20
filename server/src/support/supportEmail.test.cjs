const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSender, sendSupportEmail, supportEmailConfig } = require('./supportEmail.cjs');

const supportKeys = ['BREVO_API_KEY', 'SUPPORT_RECEIVER_EMAIL', 'SUPPORT_FROM_EMAIL'];

async function withSupportEnvironment(values, callback) {
  const previous = Object.fromEntries(supportKeys.map((key) => [key, process.env[key]]));
  supportKeys.forEach((key) => delete process.env[key]);
  Object.assign(process.env, values);
  try {
    return await callback();
  } finally {
    supportKeys.forEach((key) => {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    });
  }
}

test('support delivery remains disabled until every server setting is present', async () => {
  await withSupportEnvironment({ SUPPORT_RECEIVER_EMAIL: 'team@example.com' }, async () => {
    assert.deepEqual(supportEmailConfig(), {
      receiver: 'team@example.com',
      from: '',
      configured: false,
    });
    await assert.rejects(
      sendSupportEmail({ senderEmail: 'person@example.com', subject: 'Help me', body: 'A detailed issue', requestId: 'request-1' }),
      (error) => error.statusCode === 503,
    );
  });
});

test('support delivery uses the fixed server recipient and customer as reply-to', async () => {
  await withSupportEnvironment({
    BREVO_API_KEY: 'xkeysib-test-key',
    SUPPORT_RECEIVER_EMAIL: 'team@example.com',
    SUPPORT_FROM_EMAIL: 'PodToClips Support <support@updates.example.com>',
  }, async () => {
    let request;
    const result = await sendSupportEmail({
      senderEmail: 'customer@example.com',
      subject: 'Clip output question',
      body: 'The framing on project 42 needs review.',
      requestId: '08fd82e7-6c0b-4c31-a95f-1e9b0ee55e52',
    }, async (url, init) => {
      request = { url, init };
      return { ok: true, json: async () => ({ messageId: 'email_42' }) };
    });

    assert.equal(result.id, 'email_42');
    assert.equal(request.url, 'https://api.brevo.com/v3/smtp/email');
    assert.equal(request.init.headers['api-key'], 'xkeysib-test-key');
    assert.deepEqual(JSON.parse(request.init.body), {
      sender: { name: 'PodToClips Support', email: 'support@updates.example.com' },
      to: [{ email: 'team@example.com' }],
      replyTo: { email: 'customer@example.com' },
      subject: '[PodToClips Support] Clip output question',
      textContent: 'Sender: customer@example.com\n\nThe framing on project 42 needs review.',
      headers: { 'Idempotency-Key': '08fd82e7-6c0b-4c31-a95f-1e9b0ee55e52' }, // gitleaks:allow, deterministic non-secret test fixture
      tags: ['support-request'],
    });
  });
});

test('support sender accepts a plain email address', () => {
  assert.deepEqual(parseSender('support@example.com'), { email: 'support@example.com' });
});

test('support delivery exposes provider failures as a safe gateway error', async () => {
  await withSupportEnvironment({
    BREVO_API_KEY: 'xkeysib-test-key',
    SUPPORT_RECEIVER_EMAIL: 'team@example.com',
    SUPPORT_FROM_EMAIL: 'support@updates.example.com',
  }, async () => {
    await assert.rejects(
      sendSupportEmail({
        senderEmail: 'customer@example.com',
        subject: 'Clip output question',
        body: 'The framing on project 42 needs review.',
        requestId: 'b401dcad-20c2-452b-bc94-cab6e2d228ee',
      }, async () => ({ ok: false, json: async () => ({ message: 'Provider rejected the request.' }) })),
      (error) => error.statusCode === 502 && /Provider rejected/.test(error.message),
    );
  });
});
