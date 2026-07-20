import {
  ArrowLeft,
  ArrowRight,
  Cookie,
  FileCheck2,
  FileText,
  RefreshCcw,
  Scale,
  ShieldCheck,
} from 'lucide-react';
import React from 'react';

export type LegalDocument = 'overview' | 'terms' | 'privacy' | 'refunds' | 'acceptable-use' | 'cookies';

type LegalSection = {
  title: string;
  paragraphs?: string[];
  bullets?: string[];
};

type LegalDefinition = {
  title: string;
  shortTitle: string;
  description: string;
  icon: React.ComponentType<{ size?: number }>;
  sections: LegalSection[];
};

const EFFECTIVE_DATE = 'July 20, 2026';
const SUPPORT_EMAIL = 'supportcontact584@gmail.com';

const documents: Record<Exclude<LegalDocument, 'overview'>, LegalDefinition> = {
  terms: {
    title: 'Terms of Service',
    shortTitle: 'Terms',
    description: 'The rules that govern access to PodToClips and use of the clipping, editing, and export services.',
    icon: FileText,
    sections: [
      {
        title: '1. Agreement and eligibility',
        paragraphs: [
          'These Terms of Service govern your access to PodToClips, including our website, clipping workflow, editor, exports, and related services. By creating an account or using the service, you agree to these Terms and the policies referenced here.',
          'You must be at least 18 years old and legally capable of entering into a binding agreement. If you use PodToClips for an organization, you confirm that you have authority to bind that organization.',
        ],
      },
      {
        title: '2. Your account',
        bullets: [
          'Provide accurate account information and keep it current.',
          'Protect your login credentials and notify us promptly about suspected unauthorized access.',
          'You are responsible for activity performed through your account unless caused by our breach of these Terms.',
          'One person or organization may not create accounts to evade plan limits, enforcement, or billing restrictions.',
        ],
      },
      {
        title: '3. The service',
        paragraphs: [
          'PodToClips uses automated systems to identify moments, transcribe speech, compose vertical video, generate captions, and prepare editable clips. Automated output can contain errors. You are responsible for reviewing every clip before publishing or relying on it.',
          'Features, supported formats, processing limits, and output behavior may change as the product develops. We may introduce, modify, or retire features when reasonably necessary for security, quality, legal compliance, or product operation.',
        ],
      },
      {
        title: '4. Your content and permissions',
        paragraphs: [
          'You retain ownership of the audio, video, text, logos, music, and other material you submit. You grant PodToClips a limited, non-exclusive license to host, copy, transcode, analyze, modify, and display that content only as needed to provide, secure, troubleshoot, and improve the service.',
          'You confirm that you own your content or have all permissions required to upload it, process it, add music or other assets, and publish the resulting clips. You remain responsible for permissions involving guests, speakers, copyright, publicity rights, privacy, music, trademarks, and confidential information.',
        ],
      },
      {
        title: '5. Generated output',
        paragraphs: [
          'Subject to your rights in the source material and third-party rights, you may use and export clips generated for your account. PodToClips does not guarantee that any suggested moment will achieve a particular level of engagement, revenue, reach, or business performance.',
          'You must not represent synthetic, edited, or context-altered media in a deceptive way. You are responsible for the final review, disclosures, permissions, and publication of every export.',
        ],
      },
      {
        title: '6. Plans, usage, and billing',
        paragraphs: [
          'Free and paid plans include the clip allowances and source-duration limits displayed on the Pricing page. Clip usage is counted when a clip is successfully rendered for your account. Free usage is a lifetime allowance. Paid allowances reset only after a successful subscription renewal and do not roll over unless we expressly state otherwise.',
          'Paid subscriptions renew automatically until cancelled. Plan prices, taxes, billing dates, and renewal terms are shown before purchase. Dodo Payments acts as merchant of record for paid transactions and provides checkout, tax calculation, receipts, and payment processing under its buyer terms.',
          'Except where required by applicable law or expressly approved under our Refund and Cancellation Policy, all subscription payments are final and non-refundable. We do not provide credits or refunds for unused subscription time, unused clip allowances, accidental purchases, change of mind, or failure to cancel before renewal.',
          'You may cancel through the billing portal. Cancellation normally takes effect at the end of the current billing period and prevents the next renewal. It does not reverse or refund the current billing period. Upgrades and scheduled plan changes follow the terms displayed during confirmation.',
        ],
      },
      {
        title: '7. Service availability',
        paragraphs: [
          'We work to provide a reliable service, but uninterrupted operation is not guaranteed. Processing can be delayed or unavailable because of source platforms, cloud providers, third-party APIs, maintenance, abuse prevention, or events outside our reasonable control.',
          'We may suspend access when reasonably necessary to protect users, providers, the service, or the public, or when an account violates these Terms, the Acceptable Use Policy, or applicable law.',
        ],
      },
      {
        title: '8. Disclaimers and liability',
        paragraphs: [
          'To the maximum extent permitted by law, PodToClips is provided on an as-is and as-available basis. We disclaim implied warranties of merchantability, fitness for a particular purpose, non-infringement, and uninterrupted availability.',
          'To the maximum extent permitted by law, PodToClips will not be liable for indirect, incidental, special, consequential, or punitive damages, lost profits, lost data, lost opportunities, or publication decisions. Our aggregate liability for a claim will not exceed the amount you paid for the service during the twelve months before the event giving rise to the claim.',
        ],
      },
      {
        title: '9. Termination and governing law',
        paragraphs: [
          'You may stop using the service at any time. We may suspend or terminate access for material or repeated violations, fraud, unlawful activity, security risk, non-payment, or conduct that threatens the service or another person.',
          'These Terms are governed by the laws of India, without regard to conflict-of-law principles. Courts with competent jurisdiction in India will have jurisdiction, except where mandatory consumer law provides otherwise.',
        ],
      },
      {
        title: '10. Contact and updates',
        paragraphs: [
          `Questions about these Terms can be sent to ${SUPPORT_EMAIL}. We may update these Terms to reflect legal, security, billing, or product changes. Material changes will be communicated through the service, by email, or by updating the effective date on this page.`,
        ],
      },
    ],
  },
  privacy: {
    title: 'Privacy Policy',
    shortTitle: 'Privacy',
    description: 'How PodToClips collects, uses, shares, secures, and deletes account and media information.',
    icon: ShieldCheck,
    sections: [
      {
        title: '1. Scope',
        paragraphs: [
          'This Privacy Policy explains how PodToClips handles personal information when you visit the website, create an account, submit media, generate clips, use the editor, purchase a plan, or contact support. PodToClips is operated from India and serves users through cloud infrastructure in multiple regions.',
        ],
      },
      {
        title: '2. Information we collect',
        bullets: [
          'Account information, including your name, email address, profile image, authentication identifiers, and account settings.',
          'Content you provide, including uploaded or linked audio and video, transcripts, captions, project titles, editing instructions, imported media, and generated clips.',
          'Usage information, including project activity, clip counts, plan entitlement, feature interactions, errors, device and browser information, IP address, and security logs.',
          'Billing information supplied during checkout. Payment-card details are collected and handled by Dodo Payments, not stored directly by PodToClips.',
          'Support information, including the sender email, subject, message, and related diagnostic details you choose to provide.',
        ],
      },
      {
        title: '3. How we use information',
        bullets: [
          'Authenticate accounts and provide account-specific projects, clips, editing, exports, billing, and support.',
          'Transcribe, analyze, frame, caption, render, store, and deliver the media requested by you.',
          'Enforce clip allowances, source-duration limits, fraud controls, and service security.',
          'Diagnose failures, maintain reliability, prevent abuse, and improve product quality.',
          'Communicate about account activity, support requests, billing, security, policy changes, and service operation.',
          'Meet legal, tax, accounting, regulatory, and dispute obligations.',
        ],
      },
      {
        title: '4. Automated and AI processing',
        paragraphs: [
          'PodToClips uses automated tools to transcribe recordings, identify candidate moments, analyze visual scenes, track speakers, generate captions, and render clips. This processing may involve audio, video frames, transcripts, and instructions submitted for a project.',
          'We do not use your uploaded podcasts to train a public foundation model. Third-party processors may handle content under their own service agreements and data-processing terms solely to provide the requested functionality.',
        ],
      },
      {
        title: '5. Service providers',
        paragraphs: [
          'We share the minimum information needed with providers that operate the service. Current categories include authentication through Clerk, hosting and rendering through Google Cloud, media storage through Cloudflare R2, database services through Neon, transcription through AssemblyAI, AI analysis through OpenRouter-connected model providers, workflow orchestration through Inngest, payments through Dodo Payments, and support-email delivery through Brevo.',
          'These providers may process information in countries other than your own. We use contractual and technical safeguards appropriate to the service and the information involved.',
        ],
      },
      {
        title: '6. Sharing and disclosure',
        paragraphs: [
          'We do not sell personal information. We may disclose information to service providers, professional advisers, authorities when legally required, a successor in a merger or acquisition, or another party when necessary to protect rights, safety, users, or the service.',
        ],
      },
      {
        title: '7. Retention and deletion',
        paragraphs: [
          'We retain account, project, and media information for as long as needed to provide the service, maintain security, resolve disputes, meet legal obligations, and operate backups. Retention can vary by data type and plan. We delete or de-identify information when it is no longer reasonably required, subject to legal holds and backup cycles.',
          `You may request account or content deletion by contacting ${SUPPORT_EMAIL}. We may need to verify your identity before completing a request.`,
        ],
      },
      {
        title: '8. Your choices and rights',
        bullets: [
          'Access, correct, export, or delete eligible personal information.',
          'Object to or restrict certain processing where applicable.',
          'Withdraw consent where processing relies on consent.',
          'Cancel your subscription and close your account.',
          'Complain to your local data-protection authority where that right applies.',
        ],
      },
      {
        title: '9. Security and children',
        paragraphs: [
          'We use access controls, account isolation, encryption in transit, managed secret storage, private object access, and operational monitoring. No system is completely secure, and you should avoid uploading information that is unnecessary for your project.',
          'PodToClips is not directed to children under 18, and we do not knowingly collect personal information from children. Contact us if you believe a child has provided information to the service.',
        ],
      },
      {
        title: '10. Contact and updates',
        paragraphs: [
          `Privacy questions and requests can be sent to ${SUPPORT_EMAIL}. We may update this policy when our practices, providers, or legal obligations change. Material changes will be communicated through the service, by email, or through a revised effective date.`,
        ],
      },
    ],
  },
  refunds: {
    title: 'Refund and Cancellation Policy',
    shortTitle: 'Refunds',
    description: 'All purchases are final. This policy explains cancellation and the limited exceptions required by law or payment rules.',
    icon: RefreshCcw,
    sections: [
      {
        title: '1. All sales are final',
        paragraphs: [
          'Except where applicable law requires otherwise or Dodo Payments approves an exception under its buyer terms, every PodToClips purchase and subscription payment is final, non-refundable, and non-creditable once charged.',
          'We do not provide refunds or credits for change of mind, accidental purchases, failure to cancel before renewal, unused subscription time, unused clip allowances, dissatisfaction with generated output, unsupported or low-quality source media, third-party platform failures, policy violations, account suspension, or a decision to stop using the service.',
          'A subscription purchases access to the service and its included processing allowance for the applicable billing period. It does not guarantee a specific number of views, leads, sales, publishing outcomes, or commercially successful clips.',
        ],
      },
      {
        title: '2. Cancelling a subscription',
        paragraphs: [
          'You may cancel a paid subscription through the billing portal. Cancellation takes effect at the end of the current paid billing period, preserves access until that date, and prevents the next scheduled renewal. Cancellation does not refund the current billing period.',
          'Submit a cancellation at least 48 hours before the renewal date to allow time for processing. Deleting projects, removing content, closing a browser window, or using fewer clips than your allowance does not cancel a subscription.',
        ],
      },
      {
        title: '3. Limited exceptions',
        paragraphs: [
          'A refund may be considered only when required by applicable law or when Dodo Payments determines that an exception applies. Examples may include a duplicate charge, an incorrect charge amount, a charge processed after a timely cancellation, an unauthorized transaction, or a verified technical failure that prevented delivery of the purchased service.',
          'Reporting one of these circumstances does not guarantee a refund. Requests are reviewed using account activity, service-delivery records, billing records, fraud controls, applicable law, and Dodo Payments rules. Where a replacement or restoration of service reasonably resolves a delivery issue, that may be the available remedy instead of a refund.',
        ],
      },
      {
        title: '4. Reporting a billing problem',
        bullets: [
          `Email ${SUPPORT_EMAIL} from the address associated with your PodToClips account.`,
          'Contact us within 30 days of the transaction because Dodo Payments may not permit a merchant-initiated refund after that period.',
          'Include the payment date, plan, transaction or invoice identifier, and a concise explanation with relevant evidence.',
          'Do not include full card numbers, passwords, identity documents, or other unnecessary sensitive information.',
          'Allow reasonable time for PodToClips and Dodo Payments to investigate service usage, delivery, fraud, and transaction records.',
        ],
      },
      {
        title: '5. Payment processing and mandatory rights',
        paragraphs: [
          'Dodo Payments is the merchant of record and legal seller for paid PodToClips transactions. It controls payment processing, chargebacks, and refund execution. Any approved refund is returned to the original payment method and remains subject to Dodo Payments buyer terms, payment-network rules, fraud controls, and processing timelines.',
          'Nothing in this policy limits non-waivable rights available under applicable consumer law. If this policy conflicts with a mandatory legal requirement, that requirement controls.',
        ],
      },
    ],
  },
  'acceptable-use': {
    title: 'Acceptable Use Policy',
    shortTitle: 'Acceptable use',
    description: 'The content, safety, ownership, and platform-integrity rules that apply to every account.',
    icon: FileCheck2,
    sections: [
      {
        title: '1. Rights and consent',
        paragraphs: [
          'Only submit media you own or are authorized to process. You must have the permissions required from speakers, guests, copyright holders, music owners, employers, clients, and any person whose privacy or publicity rights may be affected.',
        ],
      },
      {
        title: '2. Prohibited content and conduct',
        bullets: [
          'Illegal content, sexual exploitation, content involving the abuse of minors, credible threats, instructions for serious wrongdoing, or material that promotes terrorism or violent extremism.',
          'Content that infringes copyright, trademark, privacy, publicity, confidentiality, or other rights.',
          'Deceptive impersonation, non-consensual intimate media, fraudulent endorsements, or misleading edits presented as authentic statements.',
          'Malware, phishing, credential theft, spam, scraping, unauthorized surveillance, or attempts to compromise another system or account.',
          'Harassment, hateful abuse, targeted humiliation, or content intended to cause serious harm to an identifiable person or protected group.',
          'Attempts to bypass plan limits, source-duration limits, authentication, billing, access controls, rate limits, or safety systems.',
          'Automated or excessive activity that degrades the service, consumes disproportionate resources, or interferes with other users.',
        ],
      },
      {
        title: '3. Enforcement',
        paragraphs: [
          'We may investigate suspected violations and remove content, restrict processing, suspend exports, limit an account, preserve relevant evidence, or terminate access. We may report conduct to providers or authorities when required by law or reasonably necessary to prevent serious harm.',
          `If you believe an enforcement action was made in error, contact ${SUPPORT_EMAIL} with the account email and relevant project details.`,
        ],
      },
    ],
  },
  cookies: {
    title: 'Cookie Notice',
    shortTitle: 'Cookies',
    description: 'A plain-language explanation of the essential browser storage used by PodToClips.',
    icon: Cookie,
    sections: [
      {
        title: '1. What we use',
        paragraphs: [
          'PodToClips uses cookies and similar browser storage that are necessary to authenticate users, protect sessions, remember security state, route requests, and preserve interface preferences. These technologies help the website and application function correctly.',
        ],
      },
      {
        title: '2. Essential categories',
        bullets: [
          'Authentication and session storage used to keep you signed in and prevent unauthorized access.',
          'Security and fraud-prevention storage used to validate requests and protect the service.',
          'Preference storage used for settings such as interface theme and workspace behavior.',
          'Operational storage used to maintain reliability and understand failures.',
        ],
      },
      {
        title: '3. Advertising and analytics',
        paragraphs: [
          'PodToClips does not currently use third-party advertising cookies. If we add non-essential analytics, advertising, or cross-site tracking technologies, we will update this notice and provide consent controls where required.',
        ],
      },
      {
        title: '4. Managing cookies',
        paragraphs: [
          'You can block or delete cookies through your browser. Blocking essential cookies may prevent login, billing access, project processing, or other core functionality. Browser controls vary by product and device.',
          `Questions about browser storage can be sent to ${SUPPORT_EMAIL}.`,
        ],
      },
    ],
  },
};

const documentOrder = ['terms', 'privacy', 'refunds', 'acceptable-use', 'cookies'] as const;

const LegalBrand = () => (
  <a className="brand-mark" href="/" aria-label="PodToClips home">
    <span className="brand-glyph" aria-hidden="true" />
    <span className="brand-name">PodToClips</span>
  </a>
);

const LegalFooter = () => (
  <footer className="marketing-footer legal-footer">
    <div className="ee-container">
      <div className="footer-bottom">
        <span>© {new Date().getFullYear()} PodToClips. All rights reserved.</span>
        <nav aria-label="Legal links">
          <a href="/legal/terms">Terms</a>
          <a href="/legal/privacy">Privacy</a>
          <a href="/legal/refunds">Refunds</a>
          <a href={`mailto:${SUPPORT_EMAIL}`}>Contact</a>
        </nav>
      </div>
    </div>
  </footer>
);

const LegalHeader = () => (
  <header className="marketing-header">
    <div className="ee-container marketing-nav legal-nav">
      <LegalBrand />
      <nav className="nav-links" aria-label="Primary navigation">
        <a className="nav-link" href="/">Product</a>
        <a className="nav-link" href="/pricing">Pricing</a>
        <a className="nav-link active" href="/legal">Legal</a>
      </nav>
      <a className="legal-header-action" href="/signup">Create account <ArrowRight size={14} /></a>
    </div>
  </header>
);

const LegalOverview = () => (
  <main id="legal-main" className="legal-main">
    <section className="legal-hero">
      <div className="ee-container legal-hero-inner">
        <span className="legal-eyebrow"><Scale size={14} /> Trust center</span>
        <h1>Legal terms and policies.</h1>
        <p>Review the terms that govern PodToClips accounts, content, privacy, subscriptions, and platform use.</p>
        <span className="legal-effective">Effective {EFFECTIVE_DATE}</span>
      </div>
    </section>
    <section className="legal-library" aria-label="PodToClips legal documents">
      <div className="ee-container legal-card-grid">
        {documentOrder.map((key, index) => {
          const document = documents[key];
          const Icon = document.icon;
          return (
            <a className="legal-card" href={`/legal/${key}`} key={key}>
              <span className="legal-card-number">0{index + 1}</span>
              <span className="legal-card-icon"><Icon size={20} /></span>
              <h2>{document.title}</h2>
              <p>{document.description}</p>
              <span className="legal-card-link">Read policy <ArrowRight size={14} /></span>
            </a>
          );
        })}
      </div>
    </section>
    <section className="legal-commerce-note">
      <div className="ee-container legal-commerce-card">
        <ShieldCheck size={22} />
        <div><h2>Payments with clear accountability</h2><p>Dodo Payments processes paid transactions as merchant of record. PodToClips provides product delivery and technical support.</p></div>
        <a href={`mailto:${SUPPORT_EMAIL}`}>Contact support</a>
      </div>
    </section>
  </main>
);

const LegalDocumentPage = ({ documentKey }: { documentKey: Exclude<LegalDocument, 'overview'> }) => {
  const document = documents[documentKey];
  return (
    <main id="legal-main" className="legal-main legal-document-page">
      <section className="legal-document-hero">
        <div className="ee-container">
          <a className="legal-back" href="/legal"><ArrowLeft size={15} /> All legal documents</a>
          <p className="legal-eyebrow">Official PodToClips policy</p>
          <h1>{document.title}</h1>
          <p>{document.description}</p>
          <span className="legal-effective">Effective {EFFECTIVE_DATE}</span>
        </div>
      </section>
      <div className="ee-container legal-document-layout">
        <aside className="legal-document-index" aria-label="Legal documents">
          <span>Documents</span>
          {documentOrder.map((key) => <a className={key === documentKey ? 'active' : undefined} href={`/legal/${key}`} key={key}>{documents[key].shortTitle}</a>)}
        </aside>
        <article className="legal-prose">
          <div className="legal-summary"><ShieldCheck size={18} /><p>This policy is written to explain the service clearly. Contact us if any part needs clarification.</p></div>
          {document.sections.map((section) => (
            <section key={section.title}>
              <h2>{section.title}</h2>
              {section.paragraphs?.map((paragraph) => <p key={paragraph}>{paragraph}</p>)}
              {section.bullets && <ul>{section.bullets.map((bullet) => <li key={bullet}>{bullet}</li>)}</ul>}
            </section>
          ))}
          <div className="legal-contact-card">
            <div><span>Questions about this policy?</span><strong>{SUPPORT_EMAIL}</strong></div>
            <a href={`mailto:${SUPPORT_EMAIL}`}>Email support <ArrowRight size={14} /></a>
          </div>
        </article>
      </div>
    </main>
  );
};

export const LegalPage = ({ document = 'overview' }: { document?: LegalDocument }) => (
  <div className="marketing-page legal-page">
    <a className="skip-link" href="#legal-main">Skip to legal content</a>
    <LegalHeader />
    {document === 'overview' ? <LegalOverview /> : <LegalDocumentPage documentKey={document} />}
    <LegalFooter />
  </div>
);

export const legalPageMetadata = (document: LegalDocument) => {
  if (document === 'overview') return { title: 'Legal Center | PodToClips', description: 'PodToClips terms, privacy, refund, acceptable use, and cookie policies.' };
  return { title: `${documents[document].title} | PodToClips`, description: documents[document].description };
};
