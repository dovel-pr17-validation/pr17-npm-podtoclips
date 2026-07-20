import React, { FormEvent, useEffect, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Inbox,
  Loader2,
  Mail,
  Send,
  UserRound,
} from 'lucide-react';
import { ProductShell } from './ProductShell';
import { useAuthenticatedFetch, useAuthSession } from '../src/auth/AuthSession';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005/api').replace(/\/$/, '');

type SupportConfig = {
  receiver: string;
  configured: boolean;
};

const readApiError = async (response: Response, fallback: string) => {
  const data = await response.json().catch(() => null);
  return data && typeof data.error === 'string' ? data.error : fallback;
};

export const SupportPage: React.FC = () => {
  const authFetch = useAuthenticatedFetch();
  const { user } = useAuthSession();
  const [config, setConfig] = useState<SupportConfig>({ receiver: '', configured: false });
  const [senderEmail, setSenderEmail] = useState(user?.email || '');
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [isLoadingConfig, setIsLoadingConfig] = useState(true);
  const [isSending, setIsSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  useEffect(() => {
    if (user?.email && !senderEmail) setSenderEmail(user.email);
  }, [senderEmail, user?.email]);

  useEffect(() => {
    let active = true;
    const loadConfig = async () => {
      try {
        const response = await authFetch(`${API_BASE}/support/config`);
        if (!response.ok) throw new Error(await readApiError(response, 'Support could not be loaded.'));
        const nextConfig = await response.json() as SupportConfig;
        if (active) setConfig(nextConfig);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Support could not be loaded.');
      } finally {
        if (active) setIsLoadingConfig(false);
      }
    };
    void loadConfig();
    return () => { active = false; };
  }, [authFetch]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setError(null);
    setSent(false);
    setIsSending(true);
    try {
      const response = await authFetch(`${API_BASE}/support/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ senderEmail, subject, body }),
      });
      if (!response.ok) throw new Error(await readApiError(response, 'Your message could not be sent.'));
      setSent(true);
      setSubject('');
      setBody('');
    } catch (sendError) {
      setError(sendError instanceof Error ? sendError.message : 'Your message could not be sent.');
    } finally {
      setIsSending(false);
    }
  };

  const receiverValue = isLoadingConfig
    ? 'Loading support inbox…'
    : config.receiver || 'Support inbox not configured yet';

  return (
    <ProductShell activeItem="support">
      <main className="studio-workspace studio-support-page" id="main-content">
        <header className="studio-support-header">
          <span className="studio-support-icon" aria-hidden="true"><Mail /></span>
          <p className="studio-eyebrow">Help &amp; support</p>
          <h1>How can we help?</h1>
          <p>We reply within a few hours.</p>
        </header>

        <section className="studio-card studio-support-card" aria-labelledby="support-form-title">
          <div className="studio-support-card-head">
            <div>
              <h2 id="support-form-title">Contact support</h2>
              <p>We will reply directly to the sender address below.</p>
            </div>
            <span><span aria-hidden="true" />Direct to the team</span>
          </div>

          {error && <div className="studio-support-notice is-error" role="alert"><AlertCircle /><span>{error}</span></div>}
          {sent && <div className="studio-support-notice is-success" role="status"><CheckCircle2 /><span>Your message has been sent. We will reply by email.</span></div>}

          <form className="studio-support-form" onSubmit={handleSubmit}>
            <div className="studio-support-addresses">
              <label className="studio-support-field">
                <span>Sender</span>
                <div className="studio-support-control"><UserRound aria-hidden="true" /><input type="email" value={senderEmail} onChange={(event) => setSenderEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" required /></div>
              </label>
              <label className="studio-support-field">
                <span>Receiver <em>Fixed</em></span>
                <div className="studio-support-control is-readonly"><Inbox aria-hidden="true" /><input type="text" value={receiverValue} readOnly aria-readonly="true" /></div>
              </label>
            </div>

            <label className="studio-support-field">
              <span>Subject</span>
              <input type="text" value={subject} onChange={(event) => setSubject(event.target.value)} minLength={3} maxLength={160} placeholder="What do you need help with?" required />
            </label>

            <label className="studio-support-field">
              <span>Message <em>{body.length.toLocaleString()} / 10,000</em></span>
              <textarea value={body} onChange={(event) => setBody(event.target.value)} minLength={10} maxLength={10000} rows={8} placeholder="Describe the issue and include any relevant project or clip details." required />
            </label>

            <footer className="studio-support-footer">
              <p>{config.configured ? 'Your message is delivered securely to the PodToClips team.' : 'Sending will be available when the support inbox is configured.'}</p>
              <button type="submit" className="studio-button studio-button-primary studio-support-submit" disabled={!config.configured || isLoadingConfig || isSending}>
                {isSending ? <Loader2 className="studio-support-spinner" /> : <Send />}
                {isSending ? 'Sending…' : 'Send message'}
              </button>
            </footer>
          </form>
        </section>
      </main>
    </ProductShell>
  );
};

export default SupportPage;
