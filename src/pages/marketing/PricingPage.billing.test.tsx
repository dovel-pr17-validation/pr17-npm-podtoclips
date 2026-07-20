import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricingPage } from './PricingPage';

const authFetch = vi.fn();

vi.mock('../../auth/AuthSession', () => ({
  useAuthSession: () => ({
    enabled: true,
    isSignedIn: true,
    user: { displayName: 'Test User', email: 'test@example.com' },
  }),
  useAuthenticatedFetch: () => authFetch,
}));

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

describe('PricingPage billing states', () => {
  afterEach(() => {
    authFetch.mockReset();
  });

  it('shows a centered processing dialog instead of redirecting for a pending upgrade', async () => {
    authFetch.mockImplementation(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.endsWith('/billing/entitlement')) {
        return jsonResponse({
          plan: 'creator',
          planLabel: 'Creator',
          subscriptionStatus: 'active',
          isPaid: true,
          conversionsLimit: 5,
          conversionsUsed: 0,
          conversionsRemaining: 5,
        });
      }
      if (url.endsWith('/billing/plan-change/preview')) {
        return jsonResponse({
          currentPlan: 'creator',
          targetPlan: 'growth',
          targetPlanLabel: 'Growth',
          direction: 'upgrade',
          effectiveAt: 'immediately',
          resumesSubscription: false,
          chargeCalculatedOnConfirmation: false,
          immediateCharge: null,
          nextBillingDate: null,
          planChange: {
            state: 'processing',
            currentPlan: 'creator',
            targetPlan: 'growth',
            targetPlanLabel: 'Growth',
            paymentStatus: 'processing',
            paymentLink: null,
            paymentAmount: 106390,
            paymentCurrency: 'INR',
          },
        });
      }
      return jsonResponse({}, 404);
    });

    render(<PricingPage />);
    const changeButton = await screen.findByRole('button', { name: /change to growth/i });
    fireEvent.click(changeButton);

    const dialog = await screen.findByRole('dialog', { name: /your growth upgrade is in progress/i });
    expect(dialog).toHaveTextContent('Payment processing');
    expect(dialog).toHaveTextContent('There is no separate checkout page while the payment is processing.');
    expect(dialog).toHaveTextContent('₹1,063.90');
    expect(screen.getByRole('link', { name: /close and return to projects/i })).toHaveAttribute('href', '/app');
  });

  it('shows the signed-in account avatar instead of login and signup actions', async () => {
    authFetch.mockResolvedValue(jsonResponse({
      plan: 'free',
      planLabel: 'Free',
      subscriptionStatus: 'none',
      isPaid: false,
      conversionsLimit: 1,
      conversionsUsed: 0,
      conversionsRemaining: 1,
    }));

    render(<PricingPage />);

    expect(screen.queryByRole('link', { name: /log in/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /sign up/i })).not.toBeInTheDocument();
    for (const accountLink of screen.getAllByRole('link', { name: /open account settings/i })) {
      expect(accountLink).toHaveAttribute('href', '/app/settings');
    }
    expect(screen.getByRole('link', { name: 'Product' })).toHaveAttribute('href', '/app');
    expect(screen.getByRole('link', { name: 'PodToClips home' })).toHaveAttribute('href', '/app');
  });
});
