import { ArrowRight, Check, CreditCard, Loader2, ShieldCheck, X } from 'lucide-react';
import React, { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { buttonVariants } from '../../components/ui/Button';
import { useAuthenticatedFetch, useAuthSession } from '../../auth/AuthSession';
import { cn } from '../../lib/cn';
import { AccountEntitlement } from '../../../types';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005/api').replace(/\/$/, '');

const plans = [
  {
    id: 'free',
    name: 'Free',
    eyebrow: 'Try the complete workflow',
    price: '$0',
    cadence: '',
    description: 'Create your first set of clips at no cost.',
    features: ['Up to 8 production grade clip generations, forever'],
    action: 'Start free',
    featured: false,
  },
  {
    id: 'creator',
    name: 'Creator',
    eyebrow: 'For consistent publishing',
    price: '$5.99',
    cadence: '/ month',
    description: 'A focused plan for independent creators.',
    features: ['Up to 40 production grade clips per month', '10x more usage compared to OpusClip'],
    action: 'Choose Creator',
    featured: false,
  },
  {
    id: 'growth',
    name: 'Growth',
    eyebrow: 'For a growing content pipeline',
    price: '$14.99',
    cadence: '/ month',
    description: 'More output for teams publishing every week.',
    features: ['Up to 96 production grade clips per month', '10x more usage compared to OpusClip', 'Discord community access'],
    action: 'Choose Growth',
    featured: true,
  },
  {
    id: 'studio',
    name: 'Studio',
    eyebrow: 'For high volume production',
    price: '$24.99',
    cadence: '/ month',
    description: 'Maximum monthly capacity for busy workflows.',
    features: ['Up to 192 production grade clips per month', '11x more usage compared to OpusClip', 'Discord community access', 'High priority for feature requests'],
    action: 'Choose Studio',
    featured: false,
  },
] as const;

type PaidPlan = 'creator' | 'growth' | 'studio';

type PlanChangeStatus = {
  state: 'ready' | 'processing' | 'action_required' | 'completed' | 'failed';
  currentPlan: PaidPlan;
  targetPlan: PaidPlan;
  targetPlanLabel: string;
  paymentStatus: string | null;
  paymentLink: string | null;
  paymentAmount: number | null;
  paymentCurrency: string | null;
};

type PlanChangePreview = {
  currentPlan: PaidPlan;
  targetPlan: PaidPlan;
  targetPlanLabel: string;
  direction: 'upgrade' | 'downgrade';
  effectiveAt: 'immediately' | 'next_billing_date';
  resumesSubscription: boolean;
  chargeCalculatedOnConfirmation: boolean;
  immediateCharge: { currency: string; totalAmount: number; tax: number } | null;
  nextBillingDate: string | null;
  planChange: PlanChangeStatus;
};

const displayMoney = (amount: number, currency: string) => new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency,
}).format(amount / 100);

const planLabel = (plan: PaidPlan) => plan.charAt(0).toUpperCase() + plan.slice(1);

const PricingAction: React.FC<{
  plan: typeof plans[number];
  entitlement: AccountEntitlement | null;
  entitlementLoaded: boolean;
}> = ({ plan, entitlement, entitlementLoaded }) => {
  const { enabled, isSignedIn, user } = useAuthSession();
  const authFetch = useAuthenticatedFetch();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PlanChangePreview | null>(null);
  const [showStandaloneError, setShowStandaloneError] = useState(false);

  useEffect(() => {
    const state = preview?.planChange.state;
    const pendingTarget = preview?.planChange.targetPlan;
    if (!pendingTarget || !['processing', 'action_required'].includes(state || '')) return undefined;
    let active = true;
    const refreshStatus = async () => {
      try {
        const response = await authFetch(`${API_BASE}/billing/plan-change/status`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: pendingTarget }),
        });
        const payload = await response.json().catch(() => ({}));
        if (active && response.ok) {
          setPreview((current) => current ? { ...current, planChange: payload as PlanChangeStatus } : current);
        }
      } catch {
        // Keep the current processing state and retry on the next interval.
      }
    };
    const interval = window.setInterval(refreshStatus, 2500);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [authFetch, preview?.planChange.state, preview?.planChange.targetPlan]);

  if (plan.id === 'free' || !enabled || !isSignedIn) {
    return <a className={buttonVariants({ variant: plan.featured ? 'primary' : 'secondary' })} href={`/signup?plan=${plan.id}`}>{plan.action} <ArrowRight size={15} /></a>;
  }

  if (!entitlementLoaded) {
    return <button className={buttonVariants({ variant: plan.featured ? 'primary' : 'secondary' })} type="button" disabled><Loader2 className="animate-spin" size={15} /> Loading plan…</button>;
  }

  if (entitlement?.isPaid && entitlement.plan === plan.id) {
    return <button className={buttonVariants({ variant: plan.featured ? 'primary' : 'secondary' })} type="button" disabled><Check size={15} /> Current plan</button>;
  }

  const beginPlanAction = async () => {
    setLoading(true);
    setError(null);
    setShowStandaloneError(false);
    try {
      if (entitlement?.isPaid) {
        const response = await authFetch(`${API_BASE}/billing/plan-change/preview`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ plan: plan.id as PaidPlan }),
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload.error || 'The plan change could not be prepared.');
        setPreview(payload as PlanChangePreview);
        setLoading(false);
        return;
      }
      const response = await authFetch(`${API_BASE}/billing/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: plan.id as PaidPlan, email: user?.email, name: user?.displayName }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || !payload.checkoutUrl) throw new Error(payload.error || 'Checkout could not be started.');
      window.location.assign(payload.checkoutUrl);
    } catch (checkoutError) {
      setError(checkoutError instanceof Error ? checkoutError.message : 'Checkout could not be started.');
      setShowStandaloneError(true);
      setLoading(false);
    }
  };

  const confirmPlanChange = async () => {
    if (!preview) return;
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE}/billing/plan-change`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ plan: preview.targetPlan, requestId: crypto.randomUUID() }),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || 'The plan could not be changed.');
      setPreview((current) => current ? { ...current, planChange: payload.planChange as PlanChangeStatus } : current);
      setLoading(false);
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : 'The plan could not be changed.');
      setLoading(false);
    }
  };

  const closePlanDialog = () => {
    if (loading) return;
    const returnToProjects = ['processing', 'completed'].includes(preview?.planChange.state || '');
    if (returnToProjects) {
      window.location.assign('/app');
      return;
    }
    setPreview(null);
    setError(null);
    setShowStandaloneError(false);
  };

  const returnsToProjects = ['processing', 'completed'].includes(preview?.planChange.state || '');

  const dialog = preview ? (
    <div className="pricing-change-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePlanDialog(); }}>
      <section className="pricing-change-dialog" role="dialog" aria-modal="true" aria-labelledby={`change-${preview.targetPlan}-title`}>
        {returnsToProjects ? (
          <a className="pricing-change-close" href="/app" aria-label="Close and return to projects"><X /></a>
        ) : (
          <button className="pricing-change-close" type="button" onClick={closePlanDialog} disabled={loading} aria-label="Close and return to pricing"><X /></button>
        )}
        {preview.planChange.state === 'completed' ? (
          <div className="pricing-change-state pricing-change-success">
            <span><Check /></span>
            <p className="pricing-change-kicker">Plan updated</p>
            <h2 id={`change-${preview.targetPlan}-title`}>You are now on {preview.planChange.targetPlanLabel}.</h2>
            <p>Your new monthly conversion allowance is ready.</p>
            <a className={buttonVariants({ variant: 'primary' })} href="/app">Go to projects</a>
          </div>
        ) : preview.planChange.state === 'processing' ? (
          <div className="pricing-change-state">
            <span className="pricing-change-state-icon is-processing"><Loader2 className="animate-spin" /></span>
            <p className="pricing-change-kicker">Payment processing</p>
            <h2 id={`change-${preview.targetPlan}-title`}>Your {preview.planChange.targetPlanLabel} upgrade is in progress.</h2>
            <p>Your saved payment method is being charged automatically. There is no separate checkout page while the payment is processing.</p>
            <dl className="pricing-change-summary is-stacked">
              <div><dt>Plan</dt><dd>{planLabel(preview.planChange.currentPlan)} <ArrowRight /> {preview.planChange.targetPlanLabel}</dd></div>
              <div><dt>Payment</dt><dd>{preview.planChange.paymentAmount && preview.planChange.paymentCurrency ? displayMoney(preview.planChange.paymentAmount, preview.planChange.paymentCurrency) : 'Prorated amount'} <span className="pricing-status-pill">Processing</span></dd></div>
            </dl>
            <p className="pricing-change-footnote">You can close this window. Your plan will update as soon as payment confirmation arrives.</p>
          </div>
        ) : preview.planChange.state === 'action_required' ? (
          <div className="pricing-change-state">
            <span className="pricing-change-state-icon"><CreditCard /></span>
            <p className="pricing-change-kicker">Payment confirmation</p>
            <h2 id={`change-${preview.targetPlan}-title`}>One more step to activate {preview.planChange.targetPlanLabel}.</h2>
            <p>Your bank requires a secure payment confirmation before the plan can change.</p>
            {preview.planChange.paymentLink && <a className={buttonVariants({ variant: 'primary' })} href={preview.planChange.paymentLink}>Complete payment <ArrowRight /></a>}
          </div>
        ) : preview.planChange.state === 'failed' ? (
          <div className="pricing-change-state">
            <span className="pricing-change-state-icon is-error"><X /></span>
            <p className="pricing-change-kicker">Payment incomplete</p>
            <h2 id={`change-${preview.targetPlan}-title`}>The plan change was not completed.</h2>
            <p>Your current plan remains active and no new allowance was applied. Close this window and manage your payment method from Settings before trying again.</p>
            <a className={buttonVariants({ variant: 'primary' })} href="/app/settings">Open billing settings</a>
          </div>
        ) : (
          <>
            <div className="pricing-change-heading">
              <span className="pricing-change-state-icon"><ShieldCheck /></span>
              <div>
                <p className="pricing-change-kicker">{preview.direction === 'upgrade' ? 'Review upgrade' : 'Review plan change'}</p>
                <h2 id={`change-${preview.targetPlan}-title`}>{planLabel(preview.currentPlan)} to {preview.targetPlanLabel}</h2>
                <p>{preview.direction === 'upgrade' ? 'Start the larger monthly allowance today.' : 'Keep your current allowance until the next renewal.'}</p>
              </div>
            </div>
            <dl className="pricing-change-summary">
              <div><dt>New plan</dt><dd>{preview.targetPlanLabel}</dd></div>
              <div><dt>Effective</dt><dd>{preview.effectiveAt === 'immediately' ? 'Immediately' : preview.nextBillingDate ? new Date(preview.nextBillingDate).toLocaleDateString() : 'Next renewal'}</dd></div>
              <div className="is-wide"><dt>Charge now</dt><dd>{preview.immediateCharge ? displayMoney(preview.immediateCharge.totalAmount, preview.immediateCharge.currency) : preview.chargeCalculatedOnConfirmation ? 'Prorated automatically' : 'No immediate charge'}</dd></div>
            </dl>
            <p className="pricing-change-payment-note"><CreditCard /> {preview.direction === 'upgrade' ? 'Your saved payment method will be charged automatically when you confirm.' : 'No payment is required today.'}</p>
            {preview.resumesSubscription && <p className="pricing-change-resume">Confirming removes your scheduled cancellation and keeps the subscription active.</p>}
            {error && <p className="pricing-action-error" role="alert">{error}</p>}
            <div className="pricing-change-actions"><button type="button" className={buttonVariants({ variant: 'secondary' })} onClick={closePlanDialog} disabled={loading}>Cancel</button><button type="button" className={buttonVariants({ variant: 'primary' })} onClick={confirmPlanChange} disabled={loading}>{loading ? <Loader2 className="animate-spin" /> : null}{loading ? 'Processing…' : preview.direction === 'upgrade' ? 'Confirm and pay' : 'Confirm change'}</button></div>
          </>
        )}
      </section>
    </div>
  ) : null;

  const errorDialog = showStandaloneError && error ? (
    <div className="pricing-change-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closePlanDialog(); }}>
      <section className="pricing-change-dialog pricing-change-error-dialog" role="alertdialog" aria-modal="true" aria-labelledby="pricing-error-title">
        <button className="pricing-change-close" type="button" onClick={closePlanDialog} aria-label="Close and return to pricing"><X /></button>
        <span className="pricing-change-state-icon is-error"><X /></span>
        <p className="pricing-change-kicker">Plan change unavailable</p>
        <h2 id="pricing-error-title">We could not prepare this change.</h2>
        <p>{error}</p>
        <button type="button" className={buttonVariants({ variant: 'secondary' })} onClick={closePlanDialog}>Return to pricing</button>
      </section>
    </div>
  ) : null;

  return (
    <>
      <button className={buttonVariants({ variant: plan.featured ? 'primary' : 'secondary' })} type="button" onClick={beginPlanAction} disabled={loading}>
        {loading ? <Loader2 className="animate-spin" size={15} /> : null}{loading ? (entitlement?.isPaid ? 'Preparing change…' : 'Opening checkout…') : entitlement?.isPaid ? `${plan.id === 'creator' ? 'Move' : 'Change'} to ${plan.name}` : plan.action}{!loading && <ArrowRight size={15} />}
      </button>
      {typeof document !== 'undefined' && dialog ? createPortal(dialog, document.body) : null}
      {typeof document !== 'undefined' && errorDialog ? createPortal(errorDialog, document.body) : null}
    </>
  );
};

const PricingBrand: React.FC<{ href: string }> = ({ href }) => (
  <a className="brand-mark" href={href} aria-label="PodToClips home">
    <span className="brand-glyph" aria-hidden="true" />
    <span className="brand-name">PodToClips</span>
  </a>
);

const PricingAccountLink: React.FC<{
  user: ReturnType<typeof useAuthSession>['user'];
}> = ({ user }) => (
  <a className="pricing-account-link" href="/app/settings" aria-label="Open account settings" title={user?.displayName || 'Account settings'}>
    {user?.imageUrl ? <img src={user.imageUrl} alt="" /> : <span>{user?.initials || 'EE'}</span>}
  </a>
);

export const PricingPage: React.FC = () => {
  const { enabled, isSignedIn, user } = useAuthSession();
  const homeHref = enabled && isSignedIn ? '/app' : '/';
  const authFetch = useAuthenticatedFetch();
  const [entitlement, setEntitlement] = useState<AccountEntitlement | null>(null);
  const [entitlementLoaded, setEntitlementLoaded] = useState(!enabled || !isSignedIn);

  useEffect(() => {
    if (!enabled || !isSignedIn) {
      setEntitlementLoaded(true);
      return;
    }
    setEntitlementLoaded(false);
    let active = true;
    authFetch(`${API_BASE}/billing/entitlement`)
      .then(async (response) => response.ok ? response.json() : null)
      .then((data) => { if (active) setEntitlement(data); })
      .catch(() => undefined)
      .finally(() => { if (active) setEntitlementLoaded(true); });
    return () => { active = false; };
  }, [authFetch, enabled, isSignedIn]);

  return (
  <div className="marketing-page pricing-page">
    <a className="skip-link" href="#pricing-plans">Skip to pricing</a>
    <header className="marketing-header">
      <div className="ee-container marketing-nav pricing-nav">
        <PricingBrand href={homeHref} />
        <nav className="nav-links" aria-label="Primary navigation"><a className="nav-link" href={homeHref}>Product</a><a className="nav-link active" href="/pricing" aria-current="page">Pricing</a></nav>
        <div className="nav-actions">{enabled && isSignedIn ? <PricingAccountLink user={user} /> : <><a className={buttonVariants({ variant: 'ghost', size: 'small' })} href="/login">Log in</a><a className={buttonVariants({ variant: 'primary', size: 'small' })} href="/signup">Sign up <ArrowRight size={14} /></a></>}</div>
        <div className="pricing-mobile-actions"><a href={homeHref}>Home</a>{enabled && isSignedIn ? <PricingAccountLink user={user} /> : <a className={buttonVariants({ variant: 'primary', size: 'small' })} href="/signup">Sign up</a>}</div>
      </div>
    </header>

    <main>
      <section className="pricing-hero" aria-labelledby="pricing-title"><div className="ee-container pricing-hero-inner"><h1 id="pricing-title">Create enterprise clips.</h1><p className="pricing-preview-note">Generate up to eight clips free, forever.</p></div></section>
      <section className="pricing-section" id="pricing-plans" aria-label="Pricing plans">
        <div className="ee-container pricing-grid">
          {plans.map((plan) => (
            <article className={cn('pricing-card', plan.featured && 'featured')} key={plan.id}>
              <div className="pricing-card-topline"><p className="pricing-card-eyebrow">{plan.eyebrow}</p>{plan.featured && <span className="pricing-card-badge">Most popular</span>}</div><h2>{plan.name}</h2>
              <div className="pricing-price"><strong>{plan.price}</strong>{plan.cadence && <span>{plan.cadence}</span>}</div>
              <p className="pricing-description">{plan.description}</p>
              <ul>{plan.features.map((feature) => <li key={feature}><Check size={15} /><span>{feature}</span></li>)}</ul>
              <PricingAction plan={plan} entitlement={entitlement} entitlementLoaded={entitlementLoaded} />
            </article>
          ))}
        </div>
      </section>
      <section className="pricing-bottom" aria-labelledby="pricing-bottom-title"><div className="ee-container pricing-bottom-card"><div><p className="section-kicker">Custom operations</p><h2 id="pricing-bottom-title">Need enterprise volume?</h2></div><p>Contact the team for custom processing requirements and support at <a href="mailto:supportcontact584@gmail.com">supportcontact584@gmail.com</a>.</p></div></section>
    </main>
    <footer className="marketing-footer pricing-footer"><div className="ee-container footer-bottom"><span>© {new Date().getFullYear()} PodToClips. All rights reserved.</span><nav className="footer-legal-links" aria-label="Legal"><a href="/legal/terms">Terms</a><a href="/legal/privacy">Privacy</a><a href="/legal/refunds">Refunds</a></nav><a href="/">Return to product</a></div></footer>
  </div>
  );
};
