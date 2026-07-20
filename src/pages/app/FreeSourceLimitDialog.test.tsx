import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { describe, expect, it, vi } from 'vitest';
import { FreeSourceLimitDialog } from '../../../components/PodcastPage';

describe('FreeSourceLimitDialog', () => {
  it('presents the limit in a modal with only the requested actions', () => {
    const onBack = vi.fn();
    render(<MemoryRouter><FreeSourceLimitDialog onBack={onBack} /></MemoryRouter>);

    expect(screen.getByRole('dialog', { name: 'This video exceeds the Free tier limit.' })).toBeInTheDocument();
    expect(screen.getByText(/2 hours and 5 GiB/i)).toBeInTheDocument();

    const actions = screen.getAllByRole('link');
    expect(actions).toHaveLength(2);
    expect(screen.getByRole('link', { name: 'Go back' })).toHaveAttribute('href', '/app/new');
    expect(screen.getByRole('link', { name: 'View pricing' })).toHaveAttribute('href', '/pricing');
    expect(screen.getByRole('link', { name: 'Go back' })).toHaveFocus();

    fireEvent.click(screen.getByRole('link', { name: 'Go back' }));
    expect(onBack).toHaveBeenCalledOnce();
  });
});
