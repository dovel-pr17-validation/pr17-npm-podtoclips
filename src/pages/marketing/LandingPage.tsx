import * as Accordion from '@radix-ui/react-accordion';
import * as Dialog from '@radix-ui/react-dialog';
import {
  ArrowRight,
  AudioLines,
  Captions,
  Check,
  CirclePlay,
  Download,
  FileVideo2,
  Layers3,
  Link2,
  Menu,
  Music2,
  Plus,
  ScanFace,
  Scissors,
  Sparkles,
  Target,
  UploadCloud,
  WandSparkles,
  X,
  Zap,
} from 'lucide-react';
import { LazyMotion, MotionConfig, m } from 'motion/react';
import React from 'react';
import { buttonVariants } from '../../components/ui/Button';
import { cn } from '../../lib/cn';

const productHuntBadgeEnabled = import.meta.env.VITE_PRODUCT_HUNT_BADGE_ENABLED === '1';

const navigation = [
  { label: 'Product', href: '#product' },
  { label: 'How it works', href: '#workflow' },
  { label: 'Editor', href: '#editor' },
  { label: 'vs OpusClip', href: '#vs-opusclip' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'Use cases', href: '#use-cases' },
];

const loadMotionFeatures = () => import('../../lib/motionFeatures').then((module) => module.default);

const revealTransition = { duration: .72, ease: [0.16, 1, 0.3, 1] } as const;
const revealViewport = { once: true, amount: .14 } as const;

const comparisonRows = [
  { label: 'Clip standard', icon: Sparkles, podTitle: 'Production grade', podNote: 'Enterprise level output', opusTitle: 'TikTok style', opusNote: 'Short social snippets' },
  { label: 'Story integrity', icon: Target, podTitle: 'Complete ideas', podNote: 'Context stays intact', opusTitle: 'Hook first', opusNote: 'Excerpt focused' },
  { label: 'Final control', icon: Scissors, podTitle: 'Full final cut', podNote: 'Timeline, audio, captions', opusTitle: 'Quick AI draft', opusNote: 'Social first workflow' },
  { label: 'Creator plan', icon: Zap, podTitle: '40 clips for $5.99', podNote: 'Scale to 192 monthly', opusTitle: '1× usage baseline', opusNote: '10× less usage' },
];

export type LandingVariant = 'original' | 'podcast' | 'optimized';

const originalMoments = [
  { number: '01', title: 'The decision that changed everything', time: '04:18 to 04:55', score: '96' },
  { number: '02', title: 'Why the obvious advice fails', time: '12:09 to 12:52', score: '93' },
  { number: '03', title: 'A lesson no one warns you about', time: '19:41 to 20:23', score: '91' },
  { number: '04', title: 'The uncomfortable truth about growth', time: '27:03 to 27:46', score: '89' },
];

const podcastMoments = [
  { number: '01', title: 'The founder lesson no playbook teaches', time: '04:18 to 04:55', score: '96' },
  { number: '02', title: 'Why expertise alone does not build demand', time: '12:09 to 12:52', score: '93' },
  { number: '03', title: 'The mistake behind our first launch', time: '19:41 to 20:23', score: '91' },
  { number: '04', title: 'What small audiences get right', time: '27:03 to 27:46', score: '89' },
];

const optimizedMoments = [
  { number: '01', title: 'The market shift most people are missing', time: '04:18 to 04:55', score: '96' },
  { number: '02', title: 'Why the standard advice no longer works', time: '12:09 to 12:52', score: '93' },
  { number: '03', title: 'The lesson behind a difficult decision', time: '19:41 to 20:23', score: '91' },
  { number: '04', title: 'A better way to think about growth', time: '27:03 to 27:46', score: '89' },
];

const originalWorkflow = [
  {
    number: '01',
    title: 'Find the thought worth sharing.',
    copy: 'PodToClips reads the complete transcript, finds the strongest moments, and keeps enough context for each idea to land.',
    visual: 'transcript',
  },
  {
    number: '02',
    title: 'Frame the story, not just the face.',
    copy: 'Speaker tracking keeps people in view while protecting source graphics, titles, and screen-led moments.',
    visual: 'frame',
  },
  {
    number: '03',
    title: 'Finish it in your own cut.',
    copy: 'Split clips, add music, tune volume, choose transitions, and export from a focused multitrack editor.',
    visual: 'editor',
  },
];

const podcastWorkflow = [
  {
    number: '01',
    title: 'Find the insight your audience will repeat.',
    copy: 'PodToClips reads the complete episode to surface useful stories, contrarian ideas, and teachable moments, not random sentence fragments.',
    visual: 'transcript',
  },
  {
    number: '02',
    title: 'Make every speaker feel intentionally framed.',
    copy: 'Speaker tracking builds a clean 9:16 composition while preserving important titles, graphics, and screen-led sections.',
    visual: 'frame',
  },
  {
    number: '03',
    title: 'Shape the cut for where you sell and teach.',
    copy: 'Split, reorder, add music, tune volume, and export clips ready for LinkedIn, X, Shorts, or Reels.',
    visual: 'editor',
  },
];

const optimizedWorkflow = [
  {
    number: '01',
    title: 'Identify high-value moments.',
    copy: 'AI reviews the full recording and ranks complete insights, stories, and explanations.',
    visual: 'transcript',
  },
  {
    number: '02',
    title: 'Produce vertical-ready clips.',
    copy: 'Speaker tracking, captions, and adaptive framing prepare each moment for 9:16 channels.',
    visual: 'frame',
  },
  {
    number: '03',
    title: 'Approve and export.',
    copy: 'Refine the timeline, manage audio, and export the final MP4 with your team in control.',
    visual: 'editor',
  },
];

const originalCapabilities = [
  {
    icon: Captions,
    title: 'Captions that stay out of the way.',
    copy: 'Stable, readable captions sit inside safe zones without a heavy box covering the video.',
    className: 'large',
  },
  {
    icon: ScanFace,
    title: 'Speaker-aware reframing.',
    copy: 'Face tracking follows the active speaker while keeping motion smooth and the final 9:16 composition intentional.',
    className: 'medium',
  },
  {
    icon: Target,
    title: 'Complete context',
    copy: 'Clip boundaries finish the sentence and the idea without turning every short into a long video.',
    className: 'third',
  },
  {
    icon: Layers3,
    title: 'Graphic-safe framing',
    copy: 'Source titles, animations, and editorial cards stay visible instead of being enlarged out of frame.',
    className: 'third',
  },
  {
    icon: AudioLines,
    title: 'Clean exports',
    copy: 'Combine program audio and music, adjust both independently, and download a finished vertical MP4.',
    className: 'third',
  },
];

const podcastCapabilities = [
  {
    icon: Captions,
    title: 'Captions made for expert ideas.',
    copy: 'Readable captions keep the argument clear on silent autoplay without covering the face or taking over the frame.',
    className: 'large',
  },
  {
    icon: ScanFace,
    title: 'Your guest stays in frame.',
    copy: 'Speaker-aware tracking follows the conversation while keeping the final 9:16 crop stable and intentional.',
    className: 'medium',
  },
  {
    icon: Target,
    title: 'The whole point, intact',
    copy: 'Context-aware boundaries finish the sentence, answer, and idea so a strong insight never ends halfway through.',
    className: 'third',
  },
  {
    icon: Layers3,
    title: 'Your source graphics survive',
    copy: 'Episode titles, slides, animations, and product screens remain visible instead of being zoomed out of bounds.',
    className: 'third',
  },
  {
    icon: AudioLines,
    title: 'Ready for your channels',
    copy: 'Add music, balance audio, and download a finished vertical MP4 for the platforms you already use.',
    className: 'third',
  },
];

const optimizedCapabilities = [
  {
    icon: Captions,
    title: 'Captions built for clarity.',
    copy: 'Stable captions keep every point readable on silent feeds.',
    className: 'large',
  },
  {
    icon: ScanFace,
    title: 'Speakers stay correctly framed.',
    copy: 'Face tracking converts horizontal footage into stable 9:16 compositions.',
    className: 'medium',
  },
  {
    icon: Target,
    title: 'Complete context',
    copy: 'Clip boundaries preserve the full question, answer, and conclusion.',
    className: 'third',
  },
  {
    icon: Layers3,
    title: 'Source graphics remain visible',
    copy: 'Adaptive framing protects titles, slides, animations, and product screens.',
    className: 'third',
  },
  {
    icon: AudioLines,
    title: 'Final approval stays with you',
    copy: 'Edit clips, balance audio, add media, and export the final MP4.',
    className: 'third',
  },
];

const originalUseCases = [
  {
    title: 'Podcasts & interviews',
    copy: 'Turn long conversations into self-contained insights that preserve the speaker’s complete point.',
  },
  {
    title: 'Founder content',
    copy: 'Surface sharp opinions, lessons, and stories without losing the nuance that makes them credible.',
  },
  {
    title: 'Educational video',
    copy: 'Extract clear explanations and keep on-screen diagrams or source graphics safely composed.',
  },
  {
    title: 'Product walkthroughs',
    copy: 'Protect screen-led sections, titles, and animations while adapting the recording for vertical viewing.',
  },
];

const podcastUseCases = [
  {
    title: 'Solo podcasters',
    copy: 'Keep a consistent clip pipeline without turning the day after every episode into an editing shift.',
  },
  {
    title: 'B2B founder podcasts',
    copy: 'Turn customer insight, category opinions, and hard-earned lessons into clips that support your point of view.',
  },
  {
    title: 'Course creators',
    copy: 'Extract the teaching moments that demonstrate expertise and lead naturally back to your course or digital product.',
  },
  {
    title: 'Lean podcast teams',
    copy: 'Give a small team a repeatable clipping workflow without adding another specialist to every episode.',
  },
];

const optimizedUseCases = [
  {
    title: 'Podcasts and interviews',
    copy: 'Create a dependable stream of clips from every recorded conversation.',
  },
  {
    title: 'Executive and founder content',
    copy: 'Publish clear points of view without adding editing overhead.',
  },
  {
    title: 'Educational content',
    copy: 'Convert detailed explanations into concise, self-contained videos.',
  },
  {
    title: 'Brand and product content',
    copy: 'Repurpose demonstrations and screen-led footage without losing key visuals.',
  },
];

const customerFaqs = [
  {
    question: 'Why choose PodToClips instead of OpusClip?',
    answer: 'PodToClips is built to produce production grade enterprise level clips, not just quick TikTok style snippets. It preserves complete ideas, protects important visuals, and gives you a real editor for the final cut.',
  },
  {
    question: 'How exactly are PodToClips clips better?',
    answer: 'Every clip is selected for a complete thought, reframed for the active speaker, captioned for clarity, and kept editable. The result is a finished vertical MP4 that is ready for a brand, customer, or campaign.',
  },
  {
    question: 'How many clips do I get for $5.99?',
    answer: 'The Creator plan includes up to 40 production grade clip generations every month for $5.99. That is 10 times more usage than the current OpusClip benchmark used across our plans.',
  },
  {
    question: 'Will clips preserve the complete point?',
    answer: 'Yes. Context aware boundaries avoid unfinished questions, answers, and explanations. The complete idea stays intact while the clip remains concise.',
  },
  {
    question: 'What happens to titles, slides, and product screens?',
    answer: 'Adaptive framing protects important text, graphics, animations, and screen content. Speaker focused sections stay dynamic without cropping essential source material away.',
  },
  {
    question: 'Can my team edit every generated clip?',
    answer: 'Yes. Use the timeline to split or remove sections, add media or music, balance audio, choose transitions, and export the final MP4.',
  },
];

const landingCopy = {
  original: {
    heroEyebrow: 'Context-first AI video clipping',
    heroLineOne: 'One recording.',
    heroLineTwo: 'Your next month of',
    heroEmphasis: 'content.',
    heroCopy: 'PodToClips finds the moments worth sharing, keeps the full thought intact, reframes every scene for vertical viewing, and gives you the final cut.',
    proofs: ['Complete-context clips', 'Speaker-aware 9:16 framing', 'Editable MP4 exports'],
    importLabel: 'Start with a recording',
    importPlaceholder: 'Paste a YouTube or video link',
    importAction: 'Create clips',
    uploadTitle: 'Upload audio or video',
    signals: ['Paste a supported video link', 'Upload audio or video', 'Download vertical MP4 clips'],
    productKicker: 'The complete workflow',
    productTitle: 'From full recording to finished short without losing the point.',
    productCopy: 'Moment discovery, vertical composition, captions, editing, and export live in one focused path.',
    workflowTitle: 'Three decisions between upload and done.',
    capabilityKicker: 'Built for the actual footage',
    capabilityTitle: 'Every frame treated like it matters.',
    capabilityCopy: 'The system changes its approach when the source changes, from a speaking face to a title card, animation, or screen recording.',
    editorKicker: 'Your final cut',
    editorTitle: 'Generated by AI. Finished by you.',
    editorCopy: 'The editor keeps the familiar timeline model: move the playhead, split, delete, add media, place music, and export.',
    editorPoints: ['Split at the playhead and delete the section you do not want.', 'Add music to its own lane and control video and music volume separately.', 'Choose a clean cut or a fade at each clip boundary.'],
    editorAction: 'Start creating',
    useCaseKicker: 'Made for long-form ideas',
    useCaseTitle: 'One engine. Different kinds of stories.',
    faqTitle: 'Before you choose your clipper.',
    faqNote: 'Clear answers about quality, usage, pricing, and control.',
    finalTitle: 'The best moment is already in your recording.',
    finalCopy: 'Find it, frame it, finish it, and make it ready to share.',
    finalAction: 'Create your first clips',
    footerCopy: 'Turn long recordings into complete, polished vertical clips and keep control of the final edit.',
  },
  podcast: {
    heroEyebrow: 'The podcast clipping tool for teams of one',
    heroLineOne: 'The AI podcast clipper',
    heroLineTwo: 'for teams of',
    heroEmphasis: 'one.',
    heroCopy: 'Turn one full podcast episode into context complete vertical clips without handing your week to an editing queue or hiring a social team.',
    proofs: ['Up to 8 ranked moments', 'No editing team required', 'Built-in timeline editor'],
    importLabel: 'Turn an episode into clips',
    importPlaceholder: 'Paste your podcast video link',
    importAction: 'Find podcast clips',
    uploadTitle: 'Upload a podcast episode',
    signals: ['Upload one full episode', 'Find complete podcast moments', 'Export clips for your channels'],
    productKicker: 'Your episode, working harder',
    productTitle: 'The clips your audience needs to hear are already in the conversation.',
    productCopy: 'PodToClips finds them across the full episode, finishes the thought, frames the speaker, and leaves you in control of the final cut.',
    workflowTitle: 'Publish the episode. Keep showing up all month.',
    capabilityKicker: 'Built for lean podcast operations',
    capabilityTitle: 'A clipping workflow that respects your time and your expertise.',
    capabilityCopy: 'Made for podcasters who also have a company, course, product, audience, or client work to run.',
    editorKicker: 'Control without complexity',
    editorTitle: 'A real editor without becoming a video editor.',
    editorCopy: 'Use the timeline model you already understand. Move the playhead, split, delete, add media or music, and export the version you want to publish.',
    editorPoints: ['Remove the slow setup and keep the complete insight.', 'Add music and balance it independently from the conversation.', 'Prepare one clean vertical file for LinkedIn, X, Shorts, or Reels.'],
    editorAction: 'Clip your next episode',
    useCaseKicker: 'For independent experts',
    useCaseTitle: 'Built for podcasters growing more than a show.',
    faqTitle: 'Before you choose your clipper.',
    faqNote: 'Clear answers about quality, usage, pricing, and control.',
    finalTitle: 'One episode should do more than publish once.',
    finalCopy: 'Turn the expertise already in your podcast into clips you can keep sharing long after release day.',
    finalAction: 'Turn an episode into clips',
    footerCopy: 'The AI podcast clipping workflow for solo creators, lean teams, founders, and independent experts.',
  },
  optimized: {
    heroEyebrow: 'AI podcast clipping at scale',
    heroLineOne: 'One recording.',
    heroLineTwo: 'Your next month of',
    heroEmphasis: 'content.',
    heroCopy: 'Turn podcasts and interviews into a massive number of production grade enterprise level clips.',
    proofs: ['Up to 8 ranked clips', 'Production-ready 9:16 video', 'Review before export'],
    importLabel: 'Start a clipping workflow',
    importPlaceholder: 'Paste a podcast or video link',
    importAction: 'Generate clips',
    uploadTitle: 'Upload a podcast or interview',
    signals: ['Import a recording', 'Generate ranked moments', 'Export vertical clips'],
    productKicker: 'Podcast repurposing at scale',
    productTitle: 'Turn every recording into a repeatable content pipeline.',
    productCopy: 'Find high-value moments, create vertical clips, and complete the final edit in one workflow.',
    workflowTitle: 'Three steps from recording to publishable clips.',
    capabilityKicker: 'Production-ready output',
    capabilityTitle: 'More usable clips. Less editing overhead.',
    capabilityCopy: 'Built for changing speakers, graphics, titles, animations, and screen content.',
    editorKicker: 'Review and approval',
    editorTitle: 'Move from AI draft to approved clip.',
    editorCopy: 'Start with a generated edit. Make the final decisions in a focused timeline.',
    editorPoints: ['Split and remove unwanted sections.', 'Add media or music and balance audio.', 'Select a transition and export the final MP4.'],
    editorAction: 'Start a clipping workflow',
    useCaseKicker: 'Built for expert-led growth',
    useCaseTitle: 'Turn recorded expertise into distribution assets.',
    faqTitle: 'Before you choose your clipper.',
    faqNote: 'Clear answers about quality, usage, pricing, and control.',
    finalTitle: 'Make every recording work beyond launch day.',
    finalCopy: 'Build a repeatable pipeline of approved clips from the conversations you already produce.',
    finalAction: 'Generate clips',
    footerCopy: 'Turn podcasts and interviews into complete, captioned vertical clips with final approval built in.',
  },
} as const;

const Brand = ({ compact = false }: { compact?: boolean }) => (
  <a className="brand-mark" href="/" aria-label="PodToClips home">
    <span className="brand-glyph" aria-hidden="true" />
    <span className="brand-name">PodToClips</span>
  </a>
);

const MobileNavigation = () => (
  <Dialog.Root>
    <Dialog.Trigger asChild>
      <button className="mobile-menu-button" aria-label="Open navigation menu">
        <Menu size={20} aria-hidden="true" />
      </button>
    </Dialog.Trigger>
    <Dialog.Portal>
      <Dialog.Overlay className="mobile-menu-overlay" />
      <Dialog.Content className="mobile-menu" aria-describedby={undefined}>
        <div className="mobile-menu-head">
          <Dialog.Title asChild><Brand compact /></Dialog.Title>
          <Dialog.Close className="mobile-menu-close" aria-label="Close navigation menu">
            <X size={19} aria-hidden="true" />
          </Dialog.Close>
        </div>
        <nav className="mobile-menu-links" aria-label="Mobile navigation">
          {navigation.map((item) => (
            <Dialog.Close asChild key={item.href}>
              <a href={item.href}>{item.label}</a>
            </Dialog.Close>
          ))}
        </nav>
        <div className="mobile-menu-actions">
          <a className={buttonVariants({ variant: 'secondary' })} href="/login">Log in</a>
          <a className={buttonVariants({ variant: 'primary' })} href="/signup">Sign up</a>
        </div>
      </Dialog.Content>
    </Dialog.Portal>
  </Dialog.Root>
);

const ProductStage = ({ variant }: { variant: LandingVariant }) => {
  const moments = variant === 'podcast' ? podcastMoments : variant === 'optimized' ? optimizedMoments : originalMoments;
  const isPodcast = variant === 'podcast';
  const isOptimized = variant === 'optimized';
  return (
  <div className="product-stage" aria-label="PodToClips product interface preview">
    <aside className="stage-sidebar" aria-hidden="true">
      <div className="stage-brand"><span className="brand-glyph" /> PodToClips</div>
      <div className="stage-nav">
        <div className="stage-nav-item"><FileVideo2 size={13} /> Projects</div>
        <div className="stage-nav-item active"><Sparkles size={13} /> Best moments</div>
        <div className="stage-nav-item"><Scissors size={13} /> Editor</div>
        <div className="stage-nav-item"><Download size={13} /> Exports</div>
      </div>
    </aside>
    <div className="stage-main">
      <div className="stage-toolbar">
        <div>
          <h3>{isPodcast ? 'The Founder-Led Podcast · Episode 24' : isOptimized ? 'The Expert-Led Podcast · Episode 24' : 'The conversation that changed my mind'}</h3>
          <p>8 complete moments found · 42:16 source</p>
        </div>
        <span className="stage-ready"><Check size={10} /> Ready</span>
      </div>
      <div className="moment-list">
        {moments.map((moment, index) => (
          <div className={cn('moment-card', index === 0 && 'selected')} key={moment.number}>
            <span className="moment-number">{moment.number}</span>
            <span className="moment-copy"><strong>{moment.title}</strong><span>{moment.time} · Context complete</span></span>
            <span className="moment-score">{moment.score}</span>
          </div>
        ))}
      </div>
      <div className="stage-timeline" aria-hidden="true">
        <div className="stage-timeline-head"><span>00:00</span><span>10:00</span><span>20:00</span><span>30:00</span><span>42:16</span></div>
        <div className="stage-wave">{Array.from({ length: 52 }, (_, index) => <span key={index} />)}</div>
        <span className="stage-playhead" />
      </div>
    </div>
    <div className="stage-preview">
      <div className="phone-preview" aria-hidden="true">
        <div className="preview-topline"><span className="preview-pill">Speaker tracked</span><span>9:16</span></div>
        <div className="caption-preview">{isPodcast ? <>Your best marketing ideas are often already <em>inside the conversation.</em></> : isOptimized ? <>The strongest short-form content often begins as <em>a complete conversation.</em></> : <>The best decision wasn’t the safest one. It was the one that <em>made the lesson unavoidable.</em></>}</div>
        <div className="preview-controls">
          <span className="preview-play"><CirclePlay size={13} fill="currentColor" /></span>
          <span className="preview-progress" />
          <span className="preview-time">00:31</span>
        </div>
      </div>
    </div>
    <div className="floating-note"><Check size={12} /> {isPodcast ? 'Ready for your channels' : isOptimized ? 'Complete clip ready' : 'Full thought preserved'}</div>
  </div>
  );
};

const WorkflowVisual = ({ type }: { type: string }) => {
  if (type === 'transcript') {
    return <div className="workflow-visual transcript-lines" aria-hidden="true"><span /><span /><span /><span /></div>;
  }
  if (type === 'frame') {
    return (
      <div className="workflow-visual frame-visual" aria-hidden="true">
        <span className="frame-rect" /><span className="frame-arrow"><ArrowRight size={20} /></span><span className="frame-rect vertical" />
      </div>
    );
  }
  return (
    <div className="workflow-visual editor-visual" aria-hidden="true">
      <div className="mini-lane"><span /><span /><span /></div><div className="mini-audio" />
    </div>
  );
};

const EditorBoard = ({ variant }: { variant: LandingVariant }) => (
  <div className="editor-board" aria-label="Multitrack video editor preview">
    <div className="editor-board-bar">
      <span className="window-dots" aria-hidden="true"><span /><span /><span /></span>
      <span className="editor-board-title">{variant === 'podcast' ? 'Episode 24 · Founder lesson' : variant === 'optimized' ? 'Episode 24 · Market insight' : 'The decision that changed everything'}</span>
      <span className="export-button">Export MP4</span>
    </div>
    <div className="editor-board-workspace">
      <aside className="editor-library" aria-hidden="true">
        <div className="library-title">Media</div>
        <div className="library-clip" /><div className="library-clip" /><div className="library-clip" />
      </aside>
      <div className="editor-canvas">
        <div className="editor-player" aria-hidden="true">
          <div className="editor-player-caption">{variant === 'podcast' ? 'One episode. A month of useful ideas.' : variant === 'optimized' ? 'One recording. A month of publishable clips.' : 'A complete thought makes a stronger clip.'}</div>
        </div>
        <div className="editor-timeline" aria-hidden="true">
          <div className="timeline-ruler"><span>00:00</span><span>00:10</span><span>00:20</span><span>00:30</span><span>00:42</span></div>
          <div className="timeline-lane"><span className="timeline-clip" /><span className="timeline-clip" /><span className="timeline-clip" /></div>
          <div className="timeline-audio" />
          <span className="timeline-playhead" />
        </div>
      </div>
    </div>
  </div>
);

const UsageComparison = () => (
  <m.section
    className="section usage-comparison"
    id="vs-opusclip"
    aria-labelledby="usage-comparison-title"
    initial={{ opacity: 0, y: 36 }}
    whileInView={{ opacity: 1, y: 0 }}
    transition={{ duration: .72, ease: [0.16, 1, 0.3, 1] }}
    viewport={{ once: true, amount: .12 }}
  >
    <div className="ee-container">
      <div className="usage-comparison-heading">
        <p className="section-kicker">PodToClips vs OpusClip</p>
        <h2 className="section-title" id="usage-comparison-title">Enterprise grade clips. At massive volume.</h2>
        <p>40 production grade clips for $5.99. Scale to 192 every month.</p>
      </div>

      <m.div
        className="comparison-board"
        initial={{ opacity: 0, scale: .975 }}
        whileInView={{ opacity: 1, scale: 1 }}
        transition={{ duration: .7, delay: .14, ease: [0.16, 1, 0.3, 1] }}
        viewport={{ once: true, amount: .18 }}
      >
        <span className="comparison-scan" aria-hidden="true" />
        <div className="comparison-board-header">
          <span className="comparison-board-label">Output benchmark</span>
          <div className="comparison-brand comparison-brand-pod">
            <span className="brand-glyph" aria-hidden="true" />
            <span><strong>PodToClips</strong><small>Built to publish</small></span>
            <em>Best value</em>
          </div>
          <div className="comparison-brand comparison-brand-opus">
            <span className="opus-glyph" aria-hidden="true">O</span>
            <span><strong>OpusClip</strong><small>Built for social</small></span>
          </div>
        </div>

        <div className="comparison-matrix" role="table" aria-label="PodToClips compared with OpusClip">
          {comparisonRows.map((item, index) => {
            const Icon = item.icon;
            return (
              <m.div
                className="comparison-row"
                role="row"
                key={item.label}
                initial={{ opacity: 0, x: -18 }}
                whileInView={{ opacity: 1, x: 0 }}
                transition={{ duration: .48, delay: .22 + index * .08, ease: [0.16, 1, 0.3, 1] }}
                viewport={{ once: true }}
              >
                <span className="comparison-criterion" role="rowheader"><Icon size={15} />{item.label}</span>
                <span className="comparison-cell comparison-cell-pod" role="cell"><Check size={15} /><span><strong>{item.podTitle}</strong><small>{item.podNote}</small></span></span>
                <span className="comparison-cell comparison-cell-opus" role="cell"><span className="comparison-minus">−</span><span><strong>{item.opusTitle}</strong><small>{item.opusNote}</small></span></span>
              </m.div>
            );
          })}
        </div>

        <div className="comparison-usage" aria-label="PodToClips offers ten times the usage of the OpusClip baseline on the Creator plan">
          <div className="comparison-usage-copy">
            <span>Creator plan usage</span>
            <strong><em>10×</em> more room to create</strong>
          </div>
          <div className="comparison-usage-meter">
            <div className="comparison-meter-row">
              <span>PodToClips</span>
              <div className="comparison-meter-blocks" aria-hidden="true">
                {Array.from({ length: 10 }, (_, index) => (
                  <m.i key={index} initial={{ scaleX: 0 }} whileInView={{ scaleX: 1 }} transition={{ duration: .32, delay: .48 + index * .045 }} viewport={{ once: true }} />
                ))}
              </div>
              <strong>10×</strong>
            </div>
            <div className="comparison-meter-row is-opus">
              <span>OpusClip</span>
              <div className="comparison-meter-blocks" aria-hidden="true"><i /></div>
              <strong>1×</strong>
            </div>
          </div>
        </div>
      </m.div>

      <p className="comparison-footnote">Comparison reflects publicly listed plan information reviewed July 20, 2026. Platforms measure usage differently. OpusClip is a trademark of its respective owner and is not affiliated with PodToClips.</p>
    </div>
  </m.section>
);

type LandingPageProps = {
  variant?: LandingVariant;
};

export const LandingPage = ({ variant = 'optimized' }: LandingPageProps) => {
  const content = landingCopy[variant];
  const workflow = variant === 'podcast' ? podcastWorkflow : variant === 'optimized' ? optimizedWorkflow : originalWorkflow;
  const capabilities = variant === 'podcast' ? podcastCapabilities : variant === 'optimized' ? optimizedCapabilities : originalCapabilities;
  const useCases = variant === 'podcast' ? podcastUseCases : variant === 'optimized' ? optimizedUseCases : originalUseCases;
  const faqs = customerFaqs;
  const editorIcons = [Scissors, Music2, Sparkles];

  return (
  <LazyMotion features={loadMotionFeatures}>
  <MotionConfig reducedMotion="user">
  <div className="marketing-page">
    <a className="skip-link" href="#main-content">Skip to content</a>
    <header className="marketing-header">
      <div className="ee-container marketing-nav">
        <Brand />
        <nav className="nav-links" aria-label="Primary navigation">
          {navigation.map((item) => <a className="nav-link" href={item.href} key={item.href}>{item.label}</a>)}
        </nav>
        <div className="nav-actions">
          <a className={buttonVariants({ variant: 'ghost', size: 'small' })} href="/login">Log in</a>
          <a className={buttonVariants({ variant: 'primary', size: 'small' })} href="/signup">Sign up <ArrowRight size={14} /></a>
        </div>
        <MobileNavigation />
      </div>
    </header>

    <main id="main-content">
      <m.section className="hero" aria-labelledby="hero-title" initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ duration: .5 }}>
        <div className="ee-container hero-grid">
          <m.div className="hero-copy-block" initial={{ opacity: 0, y: 28 }} animate={{ opacity: 1, y: 0 }} transition={{ ...revealTransition, delay: .08 }}>
            <span className="eyebrow"><span className="eyebrow-dot"><Zap size={11} fill="currentColor" /></span> {content.heroEyebrow}</span>
            <h1 className="hero-title" id="hero-title">{content.heroLineOne}<br />{content.heroLineTwo} <span className="hero-title-emphasis">{content.heroEmphasis}</span></h1>
            <p className="hero-copy">{content.heroCopy}</p>
            <div className="hero-proof" aria-label="Product capabilities">
              {content.proofs.map((proof) => <span key={proof}><Check size={14} /> {proof}</span>)}
            </div>
            <div className="hero-recognition" aria-label="PodToClips launch listings">
              <span className="hero-recognition-label">Featured on</span>
              <div className="hero-recognition-badges">
                <a className="hero-recognition-link is-launch" href="https://trylaunch.ai/launch/podtoclips" target="_blank" rel="dofollow noopener noreferrer" aria-label="PodToClips featured on Launch">
                  <img src="/brand/podtoclips-launch-badge-white.png" alt="Featured on Launch" width="201" height="54" />
                </a>
                {productHuntBadgeEnabled && (
                  <a className="hero-recognition-link is-product-hunt" href="https://www.producthunt.com/products/podtoclips-ai?embed=true&amp;utm_source=badge-featured&amp;utm_medium=badge&amp;utm_campaign=badge-podtoclips-ai" target="_blank" rel="noopener noreferrer" aria-label="PodToClips AI featured on Product Hunt">
                    <img src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1204585&amp;theme=light&amp;t=1784810386035" alt="PodToClips AI - Podcast to mass production grade clips at the cheapest cost. | Product Hunt" width="250" height="54" loading="eager" />
                  </a>
                )}
              </div>
            </div>
          </m.div>

          <m.div className="import-card-wrap" initial={{ opacity: 0, y: 34, scale: .975 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...revealTransition, delay: .18 }}>
            <div className="hero-signal-graphic" aria-hidden="true">
              <span /><span /><span /><span /><span /><span /><span />
            </div>
            <form className="import-card" action="/app/new" method="get">
              <div className="import-card-head">
                <span className="import-card-label">{content.importLabel}</span>
                <span className="import-card-status"><span className="status-dot" /> Private workspace</span>
              </div>
              <label className="sr-only" htmlFor="landing-video-url">Video URL</label>
              <div className="import-field">
                <Link2 size={17} aria-hidden="true" />
                <input id="landing-video-url" name="source" type="url" inputMode="url" autoComplete="url" placeholder={content.importPlaceholder} aria-label="Video URL" required />
                <button className={cn(buttonVariants({ variant: 'primary', size: 'small' }), 'import-submit')} type="submit">{content.importAction} <ArrowRight size={14} /></button>
              </div>
              <div className="import-separator">or</div>
              <a className="upload-dropzone" href="/app/new?mode=upload">
                <span className="upload-icon"><UploadCloud size={19} /></span>
                <span className="dropzone-copy"><strong>{content.uploadTitle}</strong><span>Choose a file from your device</span></span>
              </a>
              <p className="import-fine-print">Processing begins only after you submit. Review every generated clip before export.</p>
            </form>
          </m.div>
        </div>
      </m.section>

      <m.div className="signal-strip" aria-label="Supported workflow" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: .55, delay: .4, ease: [0.16, 1, 0.3, 1] }}>
        <div className="ee-container signal-strip-inner">
          <div className="signal-item"><Link2 size={17} /> {content.signals[0]}</div><span className="signal-divider" />
          <div className="signal-item"><UploadCloud size={17} /> {content.signals[1]}</div><span className="signal-divider" />
          <div className="signal-item"><Download size={17} /> {content.signals[2]}</div>
        </div>
      </m.div>

      <UsageComparison />

      <m.section className="section product-section" id="product" aria-labelledby="product-title" initial={{ opacity: 0, y: 34 }} whileInView={{ opacity: 1, y: 0 }} transition={revealTransition} viewport={revealViewport}>
        <div className="ee-container">
          <div className="product-heading-row">
            <div>
              <p className="section-kicker">{content.productKicker}</p>
              <h2 className="section-title" id="product-title">{content.productTitle}</h2>
            </div>
            <p className="section-copy">{content.productCopy}</p>
          </div>
          <m.div initial={{ opacity: 0, y: 26, scale: .985 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...revealTransition, delay: .12 }} viewport={revealViewport}>
            <ProductStage variant={variant} />
          </m.div>
        </div>
      </m.section>

      <m.section className="section" id="workflow" aria-labelledby="workflow-title" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} transition={revealTransition} viewport={revealViewport}>
        <div className="ee-container">
          <p className="section-kicker">How it works</p>
          <h2 className="section-title" id="workflow-title">{content.workflowTitle}</h2>
          <div className="workflow-grid">
            {workflow.map((item, index) => (
              <m.article className="workflow-card" key={item.number} initial={{ opacity: 0, y: 24 }} whileInView={{ opacity: 1, y: 0 }} transition={{ ...revealTransition, duration: .58, delay: index * .09 }} viewport={revealViewport}>
                <div className="workflow-index"><span>Step {item.number}</span><WandSparkles size={15} /></div>
                <h3>{item.title}</h3>
                <p>{item.copy}</p>
                <WorkflowVisual type={item.visual} />
              </m.article>
            ))}
          </div>
        </div>
      </m.section>

      <m.section className="section capabilities" aria-labelledby="capabilities-title" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} transition={revealTransition} viewport={revealViewport}>
        <div className="ee-container">
          <p className="section-kicker">{content.capabilityKicker}</p>
          <h2 className="section-title" id="capabilities-title">{content.capabilityTitle}</h2>
          <p className="section-copy">{content.capabilityCopy}</p>
          <div className="capability-grid">
            {capabilities.map((capability, index) => {
              const Icon = capability.icon;
              return (
                <m.article className={cn('capability-card', capability.className)} key={capability.title} initial={{ opacity: 0, y: 22, scale: .99 }} whileInView={{ opacity: 1, y: 0, scale: 1 }} transition={{ ...revealTransition, duration: .58, delay: index * .065 }} viewport={revealViewport}>
                  <span className="capability-icon"><Icon size={20} /></span>
                  <h3>{capability.title}</h3>
                  <p>{capability.copy}</p>
                  {index === 0 && (
                    <div className="caption-stack" aria-hidden="true">
                      <div className="caption-chip">{variant === 'podcast' ? 'Your episode is already recorded.' : variant === 'optimized' ? 'Your best ideas are already recorded.' : 'You don’t need more content.'}</div>
                      <div className="caption-chip active">{variant === 'podcast' ? 'Find the idea worth sharing.' : variant === 'optimized' ? 'Turn the complete moment into a clip.' : 'You need the right moment.'}</div>
                      <div className="caption-chip">{variant === 'podcast' ? 'Keep the whole point intact.' : variant === 'optimized' ? 'Caption, review, and export.' : 'And the complete thought.'}</div>
                    </div>
                  )}
                  {index === 1 && <div className="tracking-orbit" aria-hidden="true" />}
                </m.article>
              );
            })}
          </div>
        </div>
      </m.section>

      <m.section className="section editor-showcase" id="editor" aria-labelledby="editor-title" initial={{ opacity: 0, y: 32 }} whileInView={{ opacity: 1, y: 0 }} transition={revealTransition} viewport={revealViewport}>
        <div className="ee-container editor-showcase-grid">
          <m.div className="editor-showcase-copy" initial={{ opacity: 0, x: -24 }} whileInView={{ opacity: 1, x: 0 }} transition={{ ...revealTransition, delay: .05 }} viewport={revealViewport}>
            <p className="section-kicker">{content.editorKicker}</p>
            <h2 className="section-title" id="editor-title">{content.editorTitle}</h2>
            <p className="section-copy">{content.editorCopy}</p>
            <div className="editor-points">
              {content.editorPoints.map((point, index) => {
                const Icon = editorIcons[index];
                return <div className="editor-point" key={point}><span className="editor-point-icon"><Icon size={14} /></span><span>{point}</span></div>;
              })}
            </div>
            <a className={cn(buttonVariants({ variant: 'dark', size: 'large' }), 'mt-9')} href="/signup">{content.editorAction} <ArrowRight size={17} /></a>
          </m.div>
          <m.div className="editor-board-motion" initial={{ opacity: 0, x: 28, scale: .98 }} whileInView={{ opacity: 1, x: 0, scale: 1 }} transition={{ ...revealTransition, delay: .14 }} viewport={revealViewport}>
            <EditorBoard variant={variant} />
          </m.div>
        </div>
      </m.section>

      <m.section className="section use-cases" id="use-cases" aria-labelledby="use-cases-title" initial={{ opacity: 0, y: 30 }} whileInView={{ opacity: 1, y: 0 }} transition={revealTransition} viewport={revealViewport}>
        <div className="ee-container">
          <p className="section-kicker">{content.useCaseKicker}</p>
          <h2 className="section-title" id="use-cases-title">{content.useCaseTitle}</h2>
          <div className="use-case-list">
            {useCases.map((useCase, index) => (
              <m.a className="use-case-item" href="/signup" key={useCase.title} initial={{ opacity: 0, x: -18 }} whileInView={{ opacity: 1, x: 0 }} transition={{ ...revealTransition, duration: .52, delay: index * .07 }} viewport={revealViewport}>
                <span className="use-case-number">0{index + 1}</span>
                <h3>{useCase.title}</h3>
                <p>{useCase.copy}</p>
                <span className="use-case-arrow"><ArrowRight size={17} /></span>
              </m.a>
            ))}
          </div>
        </div>
      </m.section>

      <m.section className="section landing-faq-section" aria-labelledby="faq-title" initial={{ y: 30 }} whileInView={{ y: 0 }} transition={revealTransition} viewport={revealViewport}>
        <div className="ee-container faq-grid">
          <m.div className="faq-heading" initial={{ opacity: 0, x: -18 }} whileInView={{ opacity: 1, x: 0 }} transition={{ ...revealTransition, delay: .05 }} viewport={revealViewport}>
            <p className="section-kicker">Good questions</p>
            <h2 className="section-title" id="faq-title">{content.faqTitle}</h2>
            <p className="faq-contact">{content.faqNote}</p>
            <div className="faq-signal" aria-hidden="true"><span /><span /><span /><span /><span /><i /></div>
          </m.div>
          <m.div initial={{ x: 20 }} whileInView={{ x: 0 }} transition={{ ...revealTransition, delay: .12 }} viewport={revealViewport}>
            <Accordion.Root className="faq-list" type="single" collapsible>
              {faqs.map((faq, index) => (
                <Accordion.Item className="faq-item" value={`faq-${index}`} key={faq.question}>
                  <Accordion.Header>
                    <Accordion.Trigger className="faq-trigger">{faq.question}<Plus size={19} aria-hidden="true" /></Accordion.Trigger>
                  </Accordion.Header>
                  <Accordion.Content className="faq-content"><div className="faq-content-inner">{faq.answer}</div></Accordion.Content>
                </Accordion.Item>
              ))}
            </Accordion.Root>
          </m.div>
        </div>
      </m.section>

      <m.section className="final-cta" aria-labelledby="final-cta-title" initial={{ opacity: 0, y: 34 }} whileInView={{ opacity: 1, y: 0 }} transition={revealTransition} viewport={revealViewport}>
        <div className="ee-container final-cta-card">
          <div className="final-cta-content">
            <h2 id="final-cta-title">{content.finalTitle}</h2>
            <p>{content.finalCopy}</p>
            <a className={buttonVariants({ variant: 'secondary', size: 'large' })} href="/signup">{content.finalAction} <ArrowRight size={17} /></a>
          </div>
          <div className="final-cta-visual" aria-hidden="true">
            <span className="final-clip final-clip-one"><i /><i /><b>01</b></span>
            <span className="final-clip final-clip-two"><i /><i /><b>02</b></span>
            <span className="final-clip final-clip-three"><i /><i /><b>03</b></span>
            <span className="final-export-ready"><Check size={13} /> Production ready</span>
          </div>
        </div>
      </m.section>
    </main>

    <footer className="marketing-footer">
      <div className="ee-container">
        <div className="footer-top">
          <div className="footer-intro"><Brand /><p>{content.footerCopy}</p></div>
          <div className="footer-column"><h3>Product</h3><a href="#product">Overview</a><a href="#workflow">How it works</a><a href="#editor">Editor</a><a href="#vs-opusclip">vs OpusClip</a><a href="/pricing">Pricing</a></div>
          <div className="footer-column"><h3>Use cases</h3><a href="#use-cases">{variant === 'podcast' ? 'Solo podcasters' : 'Podcasts'}</a><a href="#use-cases">{variant === 'podcast' ? 'Founder podcasts' : 'Education'}</a><a href="#use-cases">{variant === 'podcast' ? 'Course creators' : 'Product video'}</a></div>
          <div className="footer-column"><h3>Get started</h3><a href="/login">Log in</a><a href="/signup">Sign up</a><span>{variant === 'podcast' ? 'Built for teams of one' : 'Built for long-form video'}</span></div>
        </div>
        <div className="footer-bottom"><span>© {new Date().getFullYear()} PodToClips. All rights reserved.</span><nav className="footer-legal-links" aria-label="Legal"><a href="/legal/terms">Terms</a><a href="/legal/privacy">Privacy</a><a href="/legal/refunds">Refunds</a></nav><span className="footer-status"><span className="status-dot" /> {variant === 'podcast' ? 'Podcast-to-clips workflow ready' : '9:16 workflow ready'}</span></div>
      </div>
    </footer>
  </div>
  </MotionConfig>
  </LazyMotion>
  );
};
