import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LandingPage } from './LandingPage';

describe('LandingPage', () => {
  it('presents the optimized product promise without changing the approved hero', () => {
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 1, name: /one recording.*your next month of content/i })).toBeInTheDocument();
    expect(screen.getByText(/turn podcasts and interviews into a massive number of production grade enterprise level clips/i)).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Executive and founder content' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Brand and product content' })).toBeInTheDocument();
  });

  it('preserves the original approved landing-page variant', () => {
    render(<LandingPage variant="original" />);
    expect(screen.getByRole('heading', { level: 1, name: /one recording.*your next month of content/i })).toBeInTheDocument();
    expect(screen.getByText(/keeps the full thought intact/i)).toBeInTheDocument();
  });

  it('preserves the audience-focused podcast variant', () => {
    render(<LandingPage variant="podcast" />);
    expect(screen.getByRole('heading', { level: 1, name: /the ai podcast clipper.*for teams of one/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 3, name: 'Solo podcasters' })).toBeInTheDocument();
  });

  it('explains the monthly usage advantage over OpusClip', () => {
    render(<LandingPage />);
    expect(screen.getByRole('heading', { level: 2, name: 'Enterprise grade clips. At massive volume.' })).toBeInTheDocument();
    expect(screen.getByRole('table', { name: 'PodToClips compared with OpusClip' })).toBeInTheDocument();
    expect(screen.getByText('Production grade')).toBeInTheDocument();
    expect(screen.getByText('TikTok style')).toBeInTheDocument();
    expect(screen.getAllByText('OpusClip').length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByRole('link', { name: 'vs OpusClip' }).every((link) => link.getAttribute('href') === '#vs-opusclip')).toBe(true);
  });

  it('includes working login and signup entry points', () => {
    render(<LandingPage />);
    const loginLinks = screen.getAllByRole('link', { name: 'Log in' });
    const signupLinks = screen.getAllByRole('link', { name: /Sign up/i });
    expect(loginLinks.some((link) => link.getAttribute('href') === '/login')).toBe(true);
    expect(signupLinks.some((link) => link.getAttribute('href') === '/signup')).toBe(true);
  });

  it('shows the Launch and Product Hunt listings', () => {
    render(<LandingPage />);
    const launchLink = screen.getByRole('link', { name: 'PodToClips featured on Launch' });
    const productHuntLink = screen.getByRole('link', { name: 'PodToClips AI featured on Product Hunt' });

    expect(launchLink).toHaveAttribute('href', 'https://trylaunch.ai/launch/podtoclips');
    expect(launchLink).toHaveAttribute('target', '_blank');
    expect(launchLink.querySelector('img')).toHaveAttribute('src', '/brand/podtoclips-launch-badge-white.png');
    expect(productHuntLink).toHaveAttribute('href', expect.stringContaining('https://www.producthunt.com/products/podtoclips-ai'));
    expect(productHuntLink).toHaveAttribute('target', '_blank');
    expect(productHuntLink.querySelector('img')).toHaveAttribute('src', expect.stringContaining('post_id=1204585'));
  });

  it('submits pasted video links to the new-project route', () => {
    const { container } = render(<LandingPage />);
    const form = container.querySelector('form');
    const input = screen.getByRole('textbox', { name: 'Video URL' });
    expect(form).toHaveAttribute('action', '/app/new');
    expect(form).toHaveAttribute('method', 'get');
    expect(input).toHaveAttribute('name', 'source');
    expect(screen.getByRole('button', { name: /^generate clips$/i })).toHaveAttribute('type', 'submit');
  });

  it('reveals accessible FAQ answers', () => {
    render(<LandingPage />);
    const trigger = screen.getByRole('button', { name: 'Why choose PodToClips instead of OpusClip?' });
    fireEvent.click(trigger);
    expect(screen.getByText(/built to produce production grade enterprise level clips/i)).toBeVisible();
  });
});
