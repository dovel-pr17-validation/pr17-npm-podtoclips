import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { ProductShell } from '../../../components/ProductShell';

describe('ProductShell', () => {
  beforeEach(() => window.localStorage.clear());

  it('uses distinct product routes instead of hash-only workspace jumps', () => {
    render(<ProductShell activeItem="clips"><div>Clip workspace</div></ProductShell>);

    expect(screen.getAllByRole('link', { name: 'Projects' }).some((link) => link.getAttribute('href') === '/app')).toBe(true);
    expect(screen.getAllByRole('link', { name: 'New project' }).some((link) => link.getAttribute('href') === '/app/new')).toBe(true);
    expect(screen.getByRole('link', { name: 'Clip library' })).toHaveAttribute('href', '/app/clips');
    expect(screen.getAllByRole('link', { name: /help/i }).some((link) => link.getAttribute('href') === '/app/support')).toBe(true);
  });

  it('provides complete mobile navigation and account access', () => {
    const { container } = render(<ProductShell activeItem="clips"><div>Clip workspace</div></ProductShell>);

    const mobileNavigation = screen.getByRole('navigation', { name: 'Mobile product navigation' });
    expect(mobileNavigation).toBeInTheDocument();
    expect(mobileNavigation.querySelectorAll('a')).toHaveLength(5);
    expect(mobileNavigation.querySelector('a[aria-current="page"]')).toHaveAttribute('href', '/app/clips');

    fireEvent.click(screen.getByRole('button', { name: 'Open mobile account menu' }));
    expect(container.querySelector('.studio-mobile-account-menu a[href="/app/settings"]')).toBeInTheDocument();
    expect(container.querySelector('.studio-mobile-account-menu a[href="/pricing"]')).toBeInTheDocument();
  });

  it('collapses the sidebar and persists the preference', () => {
    const { container } = render(<ProductShell><div>Workspace</div></ProductShell>);
    expect(container.querySelector('.studio-sidebar .studio-brand-name')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Collapse sidebar' }));

    expect(container.firstElementChild).toHaveClass('sidebar-is-collapsed');
    expect(container.querySelector('.studio-sidebar .studio-brand-mark')).toBeInTheDocument();
    expect(container.querySelector('.studio-sidebar .studio-brand-name')).not.toBeInTheDocument();
    expect(window.localStorage.getItem('easyedits-sidebar-collapsed')).toBe('1');
    expect(screen.getByRole('button', { name: 'Expand sidebar' })).toBeInTheDocument();
  });

  it('switches and persists the product theme', () => {
    const { container } = render(<ProductShell><div>Workspace</div></ProductShell>);
    fireEvent.click(screen.getAllByRole('button', { name: 'Use dark mode' })[0]);

    expect(container.firstElementChild).toHaveClass('is-dark');
    expect(window.localStorage.getItem('easyedits-product-theme')).toBe('dark');
  });
});
