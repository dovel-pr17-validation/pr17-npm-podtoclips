import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupportPage } from '../../../components/SupportPage';

describe('SupportPage', () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.restoreAllMocks();
  });

  it('shows the server-owned receiver as read-only', async () => {
    vi.stubGlobal('fetch', vi.fn().mockImplementation((input: RequestInfo | URL) => {
      const data = String(input).includes('/billing/entitlement')
        ? { plan: 'free', isPaid: false, freeConversionsRemaining: 1, canConvertPodcast: true }
        : { receiver: 'team@example.com', configured: true };
      return Promise.resolve(new Response(JSON.stringify(data), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    }));

    render(<SupportPage />);

    const receiver = await screen.findByDisplayValue('team@example.com');
    expect(receiver).toHaveAttribute('readonly');
    expect(screen.getByRole('link', { name: 'Help & support' })).toHaveAttribute('href', '/app/support');
  });

  it('sends only sender, subject, and message fields to the API', async () => {
    const fetchMock = vi.fn().mockImplementation((input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const data = url.includes('/billing/entitlement')
        ? { plan: 'free', isPaid: false, freeConversionsRemaining: 1, canConvertPodcast: true }
        : init?.method === 'POST'
          ? { sent: true, messageId: 'email_1' }
          : { receiver: 'team@example.com', configured: true };
      return Promise.resolve(new Response(JSON.stringify(data), {
        status: init?.method === 'POST' ? 201 : 200,
        headers: { 'Content-Type': 'application/json' },
      }));
    });
    vi.stubGlobal('fetch', fetchMock);

    render(<SupportPage />);
    await screen.findByDisplayValue('team@example.com');

    fireEvent.change(screen.getByPlaceholderText('you@company.com'), { target: { value: 'customer@example.com' } });
    fireEvent.change(screen.getByPlaceholderText('What do you need help with?'), { target: { value: 'Clip output question' } });
    fireEvent.change(screen.getByPlaceholderText('Describe the issue and include any relevant project or clip details.'), { target: { value: 'Please review the framing on my latest project.' } });
    fireEvent.click(screen.getByRole('button', { name: 'Send message' }));

    await screen.findByText('Your message has been sent. We will reply by email.');
    await waitFor(() => expect(fetchMock.mock.calls.some(([, init]) => init?.method === 'POST')).toBe(true));
    const [, request] = fetchMock.mock.calls.find(([, init]) => init?.method === 'POST')!;
    expect(JSON.parse(request.body)).toEqual({
      senderEmail: 'customer@example.com',
      subject: 'Clip output question',
      body: 'Please review the framing on my latest project.',
    });
  });
});
