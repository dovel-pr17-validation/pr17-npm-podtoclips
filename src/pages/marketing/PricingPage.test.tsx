import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PricingPage } from './PricingPage';

describe('PricingPage', () => {
  it('shows the free tier and every paid monthly plan', () => {
    render(<PricingPage />);
    expect(screen.getByRole('heading', { level: 1, name: 'Create enterprise clips.' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Free' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Creator' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Growth' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 2, name: 'Studio' })).toBeInTheDocument();
    expect(screen.getByText('$5.99')).toBeInTheDocument();
    expect(screen.getByText('$14.99')).toBeInTheDocument();
    expect(screen.getByText('$24.99')).toBeInTheDocument();
    expect(screen.getByText('Generate up to eight clips free, forever.')).toBeInTheDocument();
    expect(screen.getByText('Up to 40 production grade clips per month')).toBeInTheDocument();
    expect(screen.getByText('Up to 96 production grade clips per month')).toBeInTheDocument();
    expect(screen.getByText('Up to 192 production grade clips per month')).toBeInTheDocument();
    expect(screen.getByText('High priority for feature requests')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'supportcontact584@gmail.com' })).toHaveAttribute('href', 'mailto:supportcontact584@gmail.com');
  });

  it('provides a conversion action for every plan', () => {
    render(<PricingPage />);
    expect(screen.getByRole('link', { name: 'Product' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'PodToClips home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: /start free/i })).toHaveAttribute('href', '/signup?plan=free');
    expect(screen.getByRole('link', { name: /choose creator/i })).toHaveAttribute('href', '/signup?plan=creator');
    expect(screen.getByRole('link', { name: /choose growth/i })).toHaveAttribute('href', '/signup?plan=growth');
    expect(screen.getByRole('link', { name: /choose studio/i })).toHaveAttribute('href', '/signup?plan=studio');
  });
});
