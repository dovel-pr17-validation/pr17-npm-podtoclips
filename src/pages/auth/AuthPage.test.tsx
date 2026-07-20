import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it } from 'vitest';
import { AuthConfigurationPage } from './AuthPage';

describe('authentication entry', () => {
  it('uses PodToClips branding without provider-facing UI copy', () => {
    render(<MemoryRouter><AuthConfigurationPage /></MemoryRouter>);
    expect(screen.getByRole('link', { name: 'PodToClips home' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Authentication is ready to connect' })).toBeInTheDocument();
    expect(document.body.textContent?.toLowerCase()).not.toContain('clerk');
  });
});
