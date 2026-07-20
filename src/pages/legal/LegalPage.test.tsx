import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LegalPage } from './LegalPage';

describe('LegalPage', () => {
  it('provides a public legal center with every launch policy', () => {
    render(<LegalPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Legal terms and policies.' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /terms of service/i })).toHaveAttribute('href', '/legal/terms');
    expect(screen.getByRole('link', { name: /privacy policy/i })).toHaveAttribute('href', '/legal/privacy');
    expect(screen.getByRole('link', { name: /refund and cancellation policy/i })).toHaveAttribute('href', '/legal/refunds');
    expect(screen.getByRole('link', { name: /acceptable use policy/i })).toHaveAttribute('href', '/legal/acceptable-use');
    expect(screen.getByRole('link', { name: /cookie notice/i })).toHaveAttribute('href', '/legal/cookies');
  });

  it('publishes the product-specific privacy subprocessors and contact route', () => {
    render(<LegalPage document="privacy" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Privacy Policy' })).toBeInTheDocument();
    expect(screen.getByText(/authentication through Clerk/i)).toBeInTheDocument();
    expect(screen.getByText(/payments through Dodo Payments/i)).toBeInTheDocument();
    expect(screen.getByText(/support-email delivery through Brevo/i)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /email support/i })).toHaveAttribute('href', 'mailto:supportcontact584@gmail.com');
  });

  it('states the final-sale rule, cancellation effect, and narrow exceptions clearly', () => {
    render(<LegalPage document="refunds" />);
    expect(screen.getByRole('heading', { level: 1, name: 'Refund and Cancellation Policy' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: '1. All sales are final' })).toBeInTheDocument();
    expect(screen.getByText(/every PodToClips purchase and subscription payment is final, non-refundable, and non-creditable/i)).toBeInTheDocument();
    expect(screen.getByText(/cancel a paid subscription through the billing portal/i)).toBeInTheDocument();
    expect(screen.getByText(/cancellation does not refund the current billing period/i)).toBeInTheDocument();
    expect(screen.getByText(/nothing in this policy limits non-waivable rights/i)).toBeInTheDocument();
    expect(screen.getByText(/Dodo Payments is the merchant of record and legal seller/i)).toBeInTheDocument();
  });
});
