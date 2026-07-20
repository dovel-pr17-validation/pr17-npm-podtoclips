import React, { useEffect, useState } from 'react';
import {
  ChevronDown,
  CircleHelp,
  Clapperboard,
  FolderKanban,
  LogOut,
  Moon,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Sun,
  UserRound,
} from 'lucide-react';
import { Link, useInRouterContext } from 'react-router';
import { useProductTheme } from './useProductPreferences';
import { useAuthenticatedFetch, useAuthSession } from '../src/auth/AuthSession';
import { AccountEntitlement } from '../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005/api').replace(/\/$/, '');

type ProductShellProps = {
  children: React.ReactNode;
  activeItem?: 'projects' | 'new' | 'clips' | 'settings' | 'support';
};

const ProductLink: React.FC<React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string }> = ({ to, children, ...props }) => {
  const inRouter = useInRouterContext();
  return inRouter
    ? <Link to={to} {...props}>{children}</Link>
    : <a href={to} {...props}>{children}</a>;
};

const Brand: React.FC<{ compact?: boolean }> = ({ compact = false }) => (
  <ProductLink className="studio-brand" to="/" aria-label="PodToClips home">
    <span className="studio-brand-mark" aria-hidden="true"><i /><i /></span>
    {!compact && <span className="studio-brand-name">PodToClips</span>}
  </ProductLink>
);

const navItems = [
  { id: 'new' as const, label: 'New project', href: '/app/new', icon: Plus },
  { id: 'projects' as const, label: 'Projects', href: '/app', icon: FolderKanban },
  { id: 'clips' as const, label: 'Clip library', href: '/app/clips', icon: Clapperboard },
];

const mobileNavItems = [
  { id: 'projects' as const, label: 'Projects', href: '/app', icon: FolderKanban },
  { id: 'new' as const, label: 'Create', href: '/app/new', icon: Plus },
  { id: 'clips' as const, label: 'Clips', href: '/app/clips', icon: Clapperboard },
  { id: 'settings' as const, label: 'Settings', href: '/app/settings', icon: Settings2 },
  { id: 'support' as const, label: 'Help', href: '/app/support', icon: CircleHelp },
];

export const ProductShell: React.FC<ProductShellProps> = ({ children, activeItem = 'projects' }) => {
  const [collapsed, setCollapsed] = useState(() => typeof window !== 'undefined' && window.localStorage.getItem('easyedits-sidebar-collapsed') === '1');
  const [accountOpen, setAccountOpen] = useState(false);
  const [mobileAccountOpen, setMobileAccountOpen] = useState(false);
  const { theme, toggleTheme } = useProductTheme();
  const { enabled: authEnabled, user, signOut } = useAuthSession();
  const authFetch = useAuthenticatedFetch();
  const [entitlement, setEntitlement] = useState<AccountEntitlement | null>(null);
  const clipsUsed = entitlement?.clipsUsed ?? entitlement?.freeClipsUsed ?? 0;
  const clipsLimit = entitlement?.clipsLimit ?? entitlement?.freeClipsLimit ?? null;
  const clipsRemaining = entitlement?.clipsRemaining ?? entitlement?.freeClipsRemaining ?? null;
  const usagePercent = clipsLimit
    ? Math.min(100, Math.round((clipsUsed / clipsLimit) * 100))
    : 0;
  const allowanceLabel = !entitlement
    ? 'Loading allowance…'
    : entitlement.plan === 'enterprise'
      ? 'Unlimited clips'
      : `${clipsRemaining ?? 0} clip${clipsRemaining === 1 ? '' : 's'} remaining`;

  useEffect(() => {
    window.localStorage.setItem('easyedits-sidebar-collapsed', collapsed ? '1' : '0');
  }, [collapsed]);

  useEffect(() => {
    let active = true;
    setEntitlement(null);
    const loadEntitlement = () => authFetch(`${API_BASE}/billing/entitlement`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (active && data) setEntitlement(data); })
      .catch(() => undefined);
    const syncEntitlement = (event: Event) => {
      const detail = (event as CustomEvent<AccountEntitlement>).detail;
      if (detail) setEntitlement(detail);
      else loadEntitlement();
    };
    window.addEventListener('easyedits:entitlement-updated', syncEntitlement);
    window.addEventListener('easyedits:entitlement-refresh', syncEntitlement);
    window.addEventListener('focus', loadEntitlement);
    const interval = window.setInterval(loadEntitlement, 15_000);
    loadEntitlement();
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('easyedits:entitlement-updated', syncEntitlement);
      window.removeEventListener('easyedits:entitlement-refresh', syncEntitlement);
      window.removeEventListener('focus', loadEntitlement);
    };
  }, [authFetch, user?.id]);

  return (
    <div className={`studio-shell is-${theme} ${collapsed ? 'sidebar-is-collapsed' : ''}`}>
      <aside className="studio-sidebar" aria-label="Product navigation">
        <div className="studio-sidebar-head">
          <Brand compact={collapsed} />
          <button
            className="studio-icon-button studio-sidebar-toggle"
            type="button"
            onClick={() => setCollapsed((current) => !current)}
            aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {collapsed ? <PanelLeftOpen /> : <PanelLeftClose />}
          </button>
        </div>

        <nav className="studio-nav">
          <p className="studio-nav-label">Workspace</p>
          {navItems.map(({ id, label, href, icon: Icon }) => (
            <ProductLink
              key={id}
              className={`studio-nav-item ${activeItem === id ? 'is-active' : ''}`}
              to={href}
              title={label}
              aria-current={activeItem === id ? 'page' : undefined}
            >
              <Icon aria-hidden="true" />
              <span>{label}</span>
            </ProductLink>
          ))}
        </nav>

        <div className="studio-sidebar-spacer" />

        <div className="studio-plan-card">
          <span>{entitlement?.planLabel ? `${entitlement.planLabel} workspace` : 'Free workspace'}</span>
          <strong>{allowanceLabel}</strong>
          <div><i style={{ width: `${usagePercent}%` }} /></div>
          <ProductLink to="/pricing">{entitlement?.canGenerateClips === false ? 'Upgrade to continue' : 'View plans'}</ProductLink>
        </div>

        <nav className="studio-nav studio-nav-secondary" aria-label="Secondary navigation">
          <button className="studio-nav-item" type="button" onClick={toggleTheme} title={`Use ${theme === 'light' ? 'dark' : 'light'} mode`} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}>
            {theme === 'light' ? <Moon aria-hidden="true" /> : <Sun aria-hidden="true" />}
            <span>{theme === 'light' ? 'Dark mode' : 'Light mode'}</span>
          </button>
          <ProductLink className={`studio-nav-item ${activeItem === 'settings' ? 'is-active' : ''}`} to="/app/settings" title="Settings" aria-current={activeItem === 'settings' ? 'page' : undefined}>
            <Settings2 aria-hidden="true" /><span>Settings</span>
          </ProductLink>
          <ProductLink className={`studio-nav-item ${activeItem === 'support' ? 'is-active' : ''}`} to="/app/support" title="Help and support" aria-current={activeItem === 'support' ? 'page' : undefined}>
            <CircleHelp aria-hidden="true" /><span>Help & support</span>
          </ProductLink>
        </nav>

        <div className={`studio-account-wrap ${accountOpen ? 'is-open' : ''}`}>
          <button className="studio-account" type="button" aria-label="Open account menu" aria-expanded={accountOpen} onClick={() => setAccountOpen((current) => !current)}>
            <span className="studio-avatar">
              {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : (user?.initials || 'EE')}
            </span>
            <span><strong>{user?.displayName || 'PodToClips'}</strong><small>{user?.email || 'Personal workspace'}</small></span>
            <ChevronDown aria-hidden="true" />
          </button>
          {accountOpen && (
            <div className="studio-account-menu">
              <ProductLink to="/app/settings" onClick={() => setAccountOpen(false)}><UserRound />Account settings</ProductLink>
              {authEnabled && <button type="button" onClick={() => signOut()}><LogOut />Sign out</button>}
            </div>
          )}
        </div>
      </aside>

      <div className="studio-main">
        <header className="studio-mobile-header">
          <Brand />
          <div className="studio-mobile-actions">
            <button type="button" className="studio-icon-button" onClick={toggleTheme} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? <Moon /> : <Sun />}</button>
            <div className={`studio-mobile-account-wrap ${mobileAccountOpen ? 'is-open' : ''}`}>
              <button className="studio-mobile-account" type="button" aria-label="Open mobile account menu" aria-expanded={mobileAccountOpen} onClick={() => setMobileAccountOpen((current) => !current)}>
                <span className="studio-avatar">{user?.imageUrl ? <img src={user.imageUrl} alt="" /> : (user?.initials || 'EE')}</span>
              </button>
              {mobileAccountOpen && (
                <div className="studio-mobile-account-menu">
                  <div><strong>{user?.displayName || 'PodToClips'}</strong><small>{user?.email || 'Personal workspace'}</small></div>
                  <ProductLink to="/app/settings" onClick={() => setMobileAccountOpen(false)}><UserRound />Account settings</ProductLink>
                  <ProductLink to="/pricing" onClick={() => setMobileAccountOpen(false)}><Clapperboard />View plans</ProductLink>
                  {authEnabled && <button type="button" onClick={() => signOut()}><LogOut />Sign out</button>}
                </div>
              )}
            </div>
          </div>
        </header>
        {children}
      </div>

      <nav className="studio-mobile-nav" aria-label="Mobile product navigation">
        {mobileNavItems.map(({ id, label, href, icon: Icon }) => (
          <ProductLink
            key={id}
            className={`studio-mobile-nav-item ${id === 'new' ? 'is-create' : ''} ${activeItem === id ? 'is-active' : ''}`}
            to={href}
            aria-current={activeItem === id ? 'page' : undefined}
          >
            <span><Icon aria-hidden="true" /></span>
            <small>{label}</small>
          </ProductLink>
        ))}
      </nav>
    </div>
  );
};
