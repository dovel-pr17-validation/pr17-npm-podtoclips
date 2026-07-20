import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  ChevronRight,
  Check,
  CircleHelp as CircleHelpIcon,
  CreditCard,
  Download,
  FileAudio,
  Film,
  FolderOpen,
  Grid2X2,
  Link as LinkIcon,
  LockKeyhole,
  Loader2,
  Moon,
  PlayCircle,
  Plus,
  RefreshCw,
  Search,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Upload,
  Video,
  Wand2,
  X,
} from 'lucide-react';
import { Link } from 'react-router';
import { AccountEntitlement, BillingPlanChangeStatus, Clip, Episode, PipelineStage } from '../types';
import { ProductShell } from './ProductShell';
import { useProductTheme } from './useProductPreferences';
import { useAuthenticatedFetch } from '../src/auth/AuthSession';
import { downloadAuthorizedAsset, requestAuthorizedAssetUrl } from '../src/media/authorizedAssets';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005/api').replace(/\/$/, '');
const FREE_MAX_SOURCE_DURATION_SECONDS = 2 * 60 * 60;
const PAID_MAX_SOURCE_DURATION_SECONDS = (4 * 60 * 60) + (20 * 60);
const FREE_MAX_SOURCE_BYTES = 5 * 1024 * 1024 * 1024;
const FREE_SOURCE_LIMIT_COPY = 'Free workspaces support videos up to 2 hours and 5 GiB.';
const PAID_SOURCE_LIMIT_COPY = 'Paid workspaces support videos up to 4 hours 20 minutes.';

const sourceDurationLimitSeconds = (entitlement: AccountEntitlement | null) => (
  entitlement?.plan === 'free' ? FREE_MAX_SOURCE_DURATION_SECONDS : PAID_MAX_SOURCE_DURATION_SECONDS
);

const readLocalMediaDuration = (file: File) => new Promise<number>((resolve, reject) => {
  const media = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
  const objectUrl = URL.createObjectURL(file);
  const cleanup = () => {
    media.removeAttribute('src');
    media.load();
    URL.revokeObjectURL(objectUrl);
  };
  media.preload = 'metadata';
  media.onloadedmetadata = () => {
    const duration = Number(media.duration);
    cleanup();
    if (Number.isFinite(duration) && duration > 0) resolve(duration);
    else reject(new Error('The recording duration could not be read.'));
  };
  media.onerror = () => {
    cleanup();
    reject(new Error('The recording duration could not be read.'));
  };
  media.src = objectUrl;
});

const formatTime = (seconds: number) => {
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
};

const formatDate = (value: string) => new Intl.DateTimeFormat('en', {
  month: 'short',
  day: 'numeric',
  year: 'numeric',
}).format(new Date(value));

const readableStatus: Record<Episode['status'], string> = {
  uploaded: 'Queued',
  processing: 'Creating clips',
  ready: 'Ready',
  failed: 'Needs attention',
  canceled: 'Canceled',
  cancelled: 'Canceled',
};

const isTerminalProjectError = (status: Episode['status']) => status === 'failed' || status === 'canceled' || status === 'cancelled';
const isCanceledProject = (status: Episode['status']) => status === 'canceled' || status === 'cancelled';

export const isFreeSourceLimitMessage = (value?: string | null) => {
  const message = String(value || '');
  return /Free workspaces can (?:upload|process)|FREE_SOURCE_LIMIT_EXCEEDED/i.test(message);
};

const formatBytes = (bytes: number) => {
  if (!bytes) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB'];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
};

const readApiJson = async <T,>(response: Response, fallbackMessage: string): Promise<T> => {
  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error((data && typeof data.error === 'string' && data.error) || fallbackMessage);
  }
  return data as T;
};

export const FreeSourceLimitDialog: React.FC<{ onBack: () => void }> = ({ onBack }) => {
  const backActionRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    backActionRef.current?.focus();
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  return (
    <div className="studio-limit-modal-backdrop">
      <section
        className="studio-limit-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-limit-modal-title"
        aria-describedby="studio-limit-modal-description"
      >
        <span className="studio-limit-modal-icon" aria-hidden="true"><LockKeyhole /></span>
        <p className="studio-eyebrow">Free plan limit</p>
        <h2 id="studio-limit-modal-title">This video exceeds the Free tier limit.</h2>
        <p id="studio-limit-modal-description">{FREE_SOURCE_LIMIT_COPY} Choose another video or select a plan with higher limits.</p>
        <div className="studio-limit-modal-actions">
          <Link ref={backActionRef} to="/app/new" className="studio-button" onClick={onBack}><ArrowLeft />Go back</Link>
          <Link to="/pricing" className="studio-button studio-button-primary">View pricing <ArrowRight /></Link>
        </div>
      </section>
    </div>
  );
};

export type WorkspaceView = 'projects' | 'new' | 'clips' | 'settings';

export const PodcastPage: React.FC<{
  view?: WorkspaceView;
  focusEpisodeId?: string | null;
  onOpenEditor: (clipId: string) => void;
  onProjectCreated?: (episodeId: string) => void;
}> = ({ view = 'projects', focusEpisodeId = null, onOpenEditor, onProjectCreated }) => {
  const authFetch = useAuthenticatedFetch();
  const initialSource = new URLSearchParams(window.location.search).get('source') || '';
  const initialMode = new URLSearchParams(window.location.search).get('mode');
  const [episodes, setEpisodes] = useState<Episode[]>([]);
  const [selectedEpisodeId, setSelectedEpisodeId] = useState<string | null>(focusEpisodeId);
  const [selectedEpisode, setSelectedEpisode] = useState<Episode | null>(null);
  const [clips, setClips] = useState<Clip[]>([]);
  const [selectedClip, setSelectedClip] = useState<Clip | null>(null);
  const [sourceMode, setSourceMode] = useState<'file' | 'url'>(initialSource && initialMode !== 'upload' ? 'url' : 'file');
  const [file, setFile] = useState<File | null>(null);
  const [fileDurationSeconds, setFileDurationSeconds] = useState<number | null>(null);
  const [videoUrl, setVideoUrl] = useState(initialSource);
  const [isUploading, setIsUploading] = useState(false);
  const [isReprocessing, setIsReprocessing] = useState(false);
  const [isRenderingClip, setIsRenderingClip] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFreeLimitDialog, setShowFreeLimitDialog] = useState(false);
  const [projectQuery, setProjectQuery] = useState('');
  const [clipQuery, setClipQuery] = useState('');
  const [clipCategory, setClipCategory] = useState<string>('all');
  const [projectLimit, setProjectLimit] = useState(10);
  const [entitlement, setEntitlement] = useState<AccountEntitlement | null>(null);
  const [billingPlanChange, setBillingPlanChange] = useState<BillingPlanChangeStatus | null>(null);
  const [isOpeningBilling, setIsOpeningBilling] = useState(false);
  const { theme, setTheme } = useProductTheme();

  const fetchEpisodes = async () => {
    const response = await authFetch(`${API_BASE}/podcasts`);
    const data = await readApiJson<Episode[]>(response, 'Failed to load episodes.');
    if (!Array.isArray(data)) throw new Error('Episodes API returned an invalid response.');
    setEpisodes(data);
    if (!selectedEpisodeId && data[0]) setSelectedEpisodeId(data[0].id);
  };

  const fetchEntitlement = async () => {
    const response = await authFetch(`${API_BASE}/billing/entitlement`);
    const data = await readApiJson<AccountEntitlement>(response, 'Failed to load account access.');
    setEntitlement(data);
    window.dispatchEvent(new CustomEvent('easyedits:entitlement-updated', { detail: data }));
  };

  const fetchBillingPlanChange = async () => {
    const response = await authFetch(`${API_BASE}/billing/plan-change/current`);
    const data = await readApiJson<BillingPlanChangeStatus | null>(response, 'Failed to load plan change status.');
    setBillingPlanChange(data);
  };

  const openBillingPortal = async () => {
    setIsOpeningBilling(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE}/billing/portal`, { method: 'POST' });
      const data = await readApiJson<{ portalUrl: string }>(response, 'Failed to open billing settings.');
      window.location.assign(data.portalUrl);
    } catch (portalError) {
      setError(portalError instanceof Error ? portalError.message : 'Failed to open billing settings.');
      setIsOpeningBilling(false);
    }
  };

  const fetchSelectedEpisode = async (episodeId: string) => {
    const [episodeResponse, clipsResponse] = await Promise.all([
      authFetch(`${API_BASE}/podcasts/${episodeId}`),
      authFetch(`${API_BASE}/podcasts/${episodeId}/clips`),
    ]);

    const episode = await readApiJson<Episode>(episodeResponse, 'Failed to load episode.');
    const episodeClips = await readApiJson<Clip[]>(clipsResponse, 'Failed to load clips.');
    if (!Array.isArray(episodeClips)) throw new Error('Clips API returned an invalid response.');
    setSelectedEpisode(episode);
    setClips(episodeClips);
    setSelectedClip((current) => current && episodeClips.find((clip: Clip) => clip.id === current.id) ? current : episodeClips[0] || null);
  };

  useEffect(() => {
    fetchEpisodes().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load episodes.'));
    fetchEntitlement().catch((err) => setError(err instanceof Error ? err.message : 'Failed to load account access.'));
    fetchBillingPlanChange().catch(() => setBillingPlanChange(null));
  }, []);

  useEffect(() => {
    if (!billingPlanChange?.hasPendingChange) return undefined;
    const interval = window.setInterval(() => {
      fetchBillingPlanChange().catch(() => undefined);
      fetchEntitlement().catch(() => undefined);
    }, 5000);
    return () => window.clearInterval(interval);
  }, [billingPlanChange?.hasPendingChange, billingPlanChange?.targetPlan]);

  useEffect(() => {
    if (focusEpisodeId) setSelectedEpisodeId(focusEpisodeId);
  }, [focusEpisodeId]);

  useEffect(() => {
    if (!selectedEpisodeId) return;
    fetchSelectedEpisode(selectedEpisodeId).catch((err) => setError(err instanceof Error ? err.message : 'Failed to load episode.'));
  }, [selectedEpisodeId]);

  useEffect(() => {
    if (!selectedEpisodeId || selectedEpisode?.status === 'ready' || isTerminalProjectError(selectedEpisode?.status)) return;
    const interval = window.setInterval(() => {
      fetchEpisodes().catch(() => undefined);
      fetchSelectedEpisode(selectedEpisodeId).catch(() => undefined);
    }, 1500);
    return () => window.clearInterval(interval);
  }, [selectedEpisodeId, selectedEpisode?.status]);

  const completedStages = useMemo(() => {
    if (!selectedEpisode) return 0;
    return selectedEpisode.stages.filter((stage) => stage.status === 'completed').length;
  }, [selectedEpisode]);

  const filteredEpisodes = useMemo(() => {
    const query = projectQuery.trim().toLowerCase();
    if (!query) return episodes;
    return episodes.filter((episode) => `${episode.title} ${episode.source.originalName}`.toLowerCase().includes(query));
  }, [episodes, projectQuery]);

  const filteredClips = useMemo(() => {
    const query = clipQuery.trim().toLowerCase();
    return clips.filter((clip) => {
      const matchesQuery = !query || `${clip.title} ${clip.transcript}`.toLowerCase().includes(query);
      const matchesCategory = clipCategory === 'all' || clip.category === clipCategory;
      return matchesQuery && matchesCategory;
    });
  }, [clips, clipCategory, clipQuery]);

  const selectedEpisodeClipsReady = useMemo(
    () => selectedEpisode ? areEpisodeClipsReady(selectedEpisode, clips) : false,
    [clips, selectedEpisode],
  );

  useEffect(() => {
    if (!selectedEpisode) return;
    const quotaMayHaveChanged = selectedEpisode.clips.length > 0
      || selectedEpisode.status === 'ready'
      || isTerminalProjectError(selectedEpisode.status);
    if (!quotaMayHaveChanged) return;
    fetchEntitlement().catch(() => undefined);
  }, [selectedEpisode?.id, selectedEpisode?.clips.length, selectedEpisode?.status, selectedEpisodeClipsReady]);

  useEffect(() => {
    if (!selectedEpisode || !isTerminalProjectError(selectedEpisode.status) || !isFreeSourceLimitMessage(selectedEpisode.error)) return;
    setError(null);
    setShowFreeLimitDialog(true);
  }, [selectedEpisode?.id, selectedEpisode?.status, selectedEpisode?.error]);

  const readyClipCount = useMemo(() => episodes.reduce((total, episode) => total + (episode.status === 'ready' ? episode.clips.length : 0), 0), [episodes]);
  const processingCount = useMemo(() => episodes.filter((episode) => episode.status === 'processing' || episode.status === 'uploaded').length, [episodes]);

  const handleUpload = async (event: React.FormEvent) => {
    event.preventDefault();
    if (sourceMode === 'file' && !file) {
      setError('Choose a podcast audio or video file first.');
      return;
    }
    if (sourceMode === 'url' && !videoUrl.trim()) {
      setError('Paste a podcast or video URL first.');
      return;
    }
    if (sourceMode === 'file') {
      const isFree = entitlement?.plan === 'free';
      if (isFree && (file as File).size > FREE_MAX_SOURCE_BYTES) {
        setError(null);
        setShowFreeLimitDialog(true);
        return;
      }
      if (!fileDurationSeconds || fileDurationSeconds > sourceDurationLimitSeconds(entitlement)) {
        if (fileDurationSeconds) {
          if (isFree) {
            setError(null);
            setShowFreeLimitDialog(true);
          } else {
            setError(PAID_SOURCE_LIMIT_COPY);
          }
        } else {
          setError('The recording duration could not be verified.');
        }
        return;
      }
    }

    setError(null);
    setIsUploading(true);

    try {
      let response: Response;
      if (sourceMode === 'file') {
        const selectedFile = file as File;
        const directRequest = await authFetch(`${API_BASE}/podcasts/upload-direct/request`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileName: selectedFile.name,
            mimeType: selectedFile.type || 'application/octet-stream',
            size: selectedFile.size,
            durationSeconds: fileDurationSeconds,
            title: selectedFile.name,
          }),
        });
        if (directRequest.ok) {
          const direct = await directRequest.json();
          const uploadResponse = await fetch(direct.uploadUrl, {
            method: direct.method || 'PUT',
            headers: direct.headers || { 'Content-Type': selectedFile.type || 'application/octet-stream' },
            body: selectedFile,
          });
          if (!uploadResponse.ok) throw new Error('Direct podcast upload failed. Check the R2 CORS policy.');
          response = await authFetch(`${API_BASE}/podcasts/upload-direct/complete`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ episodeId: direct.episode.id }),
          });
        } else if (directRequest.status === 501) {
          const form = new FormData();
          form.append('file', selectedFile);
          form.append('title', selectedFile.name);
          response = await authFetch(`${API_BASE}/podcasts/upload`, { method: 'POST', body: form });
        } else {
          response = directRequest;
        }
      } else {
        response = await authFetch(`${API_BASE}/podcasts/import-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            videoUrl: videoUrl.trim(),
          }),
        });
      }

      const episode = await readApiJson<Episode>(response, 'Upload failed.');

      setFile(null);
      setFileDurationSeconds(null);
      setVideoUrl('');
      setSelectedEpisodeId(episode.id);
      await fetchEpisodes();
      await fetchEntitlement();
      await fetchSelectedEpisode(episode.id);
      onProjectCreated?.(episode.id);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Upload failed.';
      if (isFreeSourceLimitMessage(message)) {
        setError(null);
        setShowFreeLimitDialog(true);
      } else {
        setError(message);
      }
    } finally {
      setIsUploading(false);
    }
  };

  const handleFileSelected = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const selectedFile = event.target.files?.[0] || null;
    setError(null);
    setFile(null);
    setFileDurationSeconds(null);
    if (!selectedFile) return;
    if (entitlement?.plan === 'free' && selectedFile.size > FREE_MAX_SOURCE_BYTES) {
      setShowFreeLimitDialog(true);
      event.target.value = '';
      return;
    }
    try {
      const duration = await readLocalMediaDuration(selectedFile);
      if (duration > sourceDurationLimitSeconds(entitlement)) {
        if (entitlement?.plan === 'free') setShowFreeLimitDialog(true);
        else setError(PAID_SOURCE_LIMIT_COPY);
        event.target.value = '';
        return;
      }
      setFileDurationSeconds(duration);
      setFile(selectedFile);
    } catch (durationError) {
      setError(durationError instanceof Error ? durationError.message : 'The recording duration could not be read.');
      event.target.value = '';
    }
  };

  const handleReprocess = async (episode: Episode) => {
    setError(null);
    setIsReprocessing(true);

    try {
      const response = await authFetch(`${API_BASE}/podcasts/${episode.id}/reprocess`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Reprocess failed.');
      setSelectedEpisode(data);
      await fetchEpisodes();
      await fetchSelectedEpisode(episode.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Reprocess failed.');
    } finally {
      setIsReprocessing(false);
    }
  };

  const handleRenderClipLocally = async (clip: Clip) => {
    setError(null);
    setIsRenderingClip(true);

    try {
      const response = await authFetch(`${API_BASE}/clips/${clip.id}/render-local`, { method: 'POST' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Local render failed.');
      setSelectedClip(data);
      if (selectedEpisodeId) await fetchSelectedEpisode(selectedEpisodeId);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Local render failed.');
    } finally {
      setIsRenderingClip(false);
    }
  };

  const refreshWorkspace = () => {
    fetchEpisodes();
    if (selectedEpisodeId) fetchSelectedEpisode(selectedEpisodeId);
  };

  const episodePicker = (
    <label className="studio-project-switcher">
      <span className="studio-sr-only">Source project</span>
      <Video aria-hidden="true" />
      <select value={selectedEpisodeId || ''} onChange={(event) => setSelectedEpisodeId(event.target.value)}>
        {episodes.map((episode) => <option key={episode.id} value={episode.id}>{episode.title}</option>)}
      </select>
    </label>
  );

  return (
    <ProductShell activeItem={view}>
      <main className={`studio-workspace studio-view-${view}`} id="main-content">
        {error && <div className="studio-alert"><AlertCircle aria-hidden="true" /><span>{error}</span></div>}

        {view === 'new' && (
          <>
            <header className="studio-create-header">
              <Link to="/app"><ArrowLeft />Projects</Link>
              <div><h1>Create a new project</h1>{entitlement && <span className={`studio-create-access ${entitlement.canGenerateClips ? '' : 'is-locked'}`}>{`${entitlement.clipsRemaining ?? 'Unlimited'} clip${entitlement.clipsRemaining === 1 ? '' : 's'} remaining`}</span>}</div>
            </header>
            {entitlement?.canGenerateClips === false ? (
              <section className="studio-create-gate studio-card">
                <span><LockKeyhole /></span>
                <p className="studio-eyebrow">Conversion allowance reached</p>
                <h2>{entitlement.plan === 'free' ? 'Upgrade to create another project.' : 'Your monthly allowance is complete.'}</h2>
                <p>{entitlement.plan === 'free' ? 'Your free account includes eight lifetime clips. Choose a paid plan to continue generating clips.' : `Your ${entitlement.planLabel} plan includes ${entitlement.clipsLimit} clips per billing period.`}</p>
                <div><Link to="/pricing" className="studio-button studio-button-primary">View paid plans <ArrowRight /></Link><Link to="/app" className="studio-button">Return to projects</Link></div>
              </section>
            ) : <section className="studio-create-shell studio-card">
              <form onSubmit={handleUpload} className="studio-create-form">
                <div className="studio-create-section">
                  <div className="studio-create-section-heading is-single"><span><FileAudio /></span><div><h2>Choose a source</h2><p>Paste a link or upload a recording.</p></div></div>
                  <div className="studio-source-options" aria-label="Choose import source">
                    <button type="button" onClick={() => setSourceMode('url')} className={sourceMode === 'url' ? 'is-active' : ''} aria-pressed={sourceMode === 'url'}><span><LinkIcon /></span><div><strong>Import from link</strong><small>YouTube or direct video URL</small></div>{sourceMode === 'url' && <Check />}</button>
                    <button type="button" onClick={() => setSourceMode('file')} className={sourceMode === 'file' ? 'is-active' : ''} aria-pressed={sourceMode === 'file'}><span><Upload /></span><div><strong>Upload a file</strong><small>Video or audio from your device</small></div>{sourceMode === 'file' && <Check />}</button>
                  </div>
                  <div className="studio-source-panel">
                  {sourceMode === 'url' ? (
                    <label className="studio-field">
                      <span>Recording URL</span>
                      <div className="studio-input-with-icon"><LinkIcon /><input value={videoUrl} onChange={(event) => setVideoUrl(event.target.value)} placeholder="https://youtube.com/watch?v=..." autoFocus /></div>
                      <small>Previously imported sources are reused.</small>
                    </label>
                  ) : (
                    <label className={`studio-dropzone ${file ? 'has-file' : ''}`}>
                      <input type="file" accept="audio/*,video/*" onChange={handleFileSelected} />
                      <span className="studio-dropzone-icon"><FileAudio /></span>
                      <span><strong>{file ? file.name : 'Drop your recording here'}</strong><small>{file ? `${formatBytes(file.size)} · ${formatTime(fileDurationSeconds || 0)}` : entitlement?.plan === 'free' ? 'MP4, MOV, MP3, M4A or WAV · Free limit 2h 30m' : 'MP4, MOV, MP3, M4A or WAV'}</small></span>
                      <span className="studio-button studio-button-compact">Choose file</span>
                    </label>
                  )}
                  </div>
                </div>
                <footer className="studio-create-footer"><p>Processing continues in the background.</p><div><Link to="/app" className="studio-button">Cancel</Link><button type="submit" disabled={isUploading} className="studio-button studio-button-primary">{isUploading ? <Loader2 className="animate-spin" /> : <Sparkles />}{isUploading ? 'Creating project…' : 'Generate clips'}{!isUploading && <ArrowRight />}</button></div></footer>
              </form>
            </section>}
          </>
        )}

        {view === 'projects' && (
          <>
            <header className="studio-page-header studio-projects-header">
              <div className="studio-projects-heading-row">
                <h1>Your content workspace.</h1>
                <div className="studio-header-actions"><button type="button" onClick={refreshWorkspace} className="studio-button"><RefreshCw />Refresh</button><Link to="/app/new" className="studio-button studio-button-primary"><Plus />New project</Link></div>
              </div>
            </header>
            <section className="studio-stats" aria-label="Workspace summary">
              <div><span>Projects</span><strong>{episodes.length}</strong><small>All recordings</small></div>
              <div><span>Ready clips</span><strong>{readyClipCount}</strong><small>Available to edit</small></div>
              <div><span>In progress</span><strong>{processingCount}</strong><small>{processingCount === 1 ? 'Project is processing' : 'Projects are processing'}</small></div>
            </section>
            <section className="studio-project-layout">
              <div className="studio-card studio-project-list-card">
                <div className="studio-list-toolbar"><div><h2>All projects</h2><span>{Math.min(projectLimit, filteredEpisodes.length)} of {filteredEpisodes.length} shown</span></div><label className="studio-search"><Search /><input value={projectQuery} onChange={(event) => { setProjectQuery(event.target.value); setProjectLimit(10); }} placeholder="Search projects" aria-label="Search projects" /></label></div>
                {filteredEpisodes.length === 0 ? (
                  <div className="studio-empty"><FolderOpen /><h3>{episodes.length ? 'No matching projects' : 'No projects yet'}</h3><p>{episodes.length ? 'Try a different search.' : 'Import your first recording to create a clip library.'}</p>{!episodes.length && <Link className="studio-button studio-button-primary" to="/app/new">Create project</Link>}</div>
                ) : (
                  <div className="studio-project-list">{filteredEpisodes.slice(0, projectLimit).map((episode) => (
                    <button key={episode.id} type="button" onClick={() => setSelectedEpisodeId(episode.id)} className={selectedEpisodeId === episode.id ? 'is-active' : ''}>
                      <ProjectArtwork episode={episode} />
                      <span className="studio-project-copy"><strong>{episode.title}</strong><small>{formatDate(episode.createdAt)} · {episode.clips.length} clips</small></span>
                      <span className={`studio-status is-${episode.status}`}><i />{readableStatus[episode.status]}</span>
                      <ChevronRight />
                    </button>
                  ))}{filteredEpisodes.length > 10 && <div className="studio-list-footer"><button type="button" onClick={() => setProjectLimit((current) => current >= filteredEpisodes.length ? 10 : Math.min(filteredEpisodes.length, current + 10))}>{projectLimit >= filteredEpisodes.length ? 'Show fewer' : `Show ${Math.min(10, filteredEpisodes.length - projectLimit)} more`}</button></div>}</div>
                )}
              </div>
              <aside className="studio-card studio-project-detail">
                {selectedEpisode ? (
                  <>
                    <ProjectArtwork episode={selectedEpisode} large />
                    <div className="studio-project-detail-copy"><span className={`studio-status is-${selectedEpisode.status}`}><i />{readableStatus[selectedEpisode.status]}</span><h2>{selectedEpisode.title}</h2><p>{formatBytes(selectedEpisode.source.size)} · Added {formatDate(selectedEpisode.createdAt)}</p></div>
                    <ProjectProgress episode={selectedEpisode} history={episodes} clips={clips} clipsReady={selectedEpisodeClipsReady} />
                    <div className="studio-project-detail-actions">{selectedEpisodeClipsReady ? <Link to={`/app/clips?episode=${encodeURIComponent(selectedEpisode.id)}`} className="studio-button studio-button-primary">Open clips <ArrowRight /></Link> : <button type="button" className="studio-button studio-button-primary" disabled>Open clips <ArrowRight /></button>}{isTerminalProjectError(selectedEpisode.status) && <button type="button" className="studio-button" onClick={() => handleReprocess(selectedEpisode)} disabled={isReprocessing}>{isReprocessing ? <Loader2 className="animate-spin" /> : <RefreshCw />}Try again</button>}</div>
                  </>
                ) : <div className="studio-empty"><Grid2X2 /><h3>Select a project</h3><p>Project details will appear here.</p></div>}
              </aside>
            </section>
          </>
        )}

        {view === 'clips' && (
          <>
            <header className="studio-clips-header">
              <div><h1>Clip library</h1><span>{clips.length} clips</span></div>
              <div className="studio-clips-header-actions">{episodes.length > 0 && episodePicker}<Link to="/app/new" className="studio-button studio-button-primary"><Plus />New project</Link></div>
            </header>
            {selectedEpisode ? (
              <>
                <div className="studio-clips-layout">
                  <section className="studio-card studio-ranked-clips">
                    <div className="studio-section-heading"><div className="studio-section-heading-main"><span><Grid2X2 /></span><div><h2>Ranked clips</h2><p>Best moments first</p></div></div><span>{filteredClips.length}</span></div>
                    <div className="studio-library-controls">
                      <label className="studio-search"><Search /><input value={clipQuery} onChange={(event) => setClipQuery(event.target.value)} placeholder="Search clips" aria-label="Search clips" /></label>
                      <label className="studio-type-filter"><SlidersHorizontal aria-hidden="true" /><span className="studio-sr-only">Filter by type</span><select value={clipCategory} onChange={(event) => setClipCategory(event.target.value)} aria-label="Filter clips by type"><option value="all">All types</option><option value="insight">Insight</option><option value="opinion">Opinion</option><option value="emotion">Emotion</option><option value="funny">Funny</option><option value="show_and_tell">Show and tell</option></select></label>
                    </div>
                    {filteredClips.length === 0 ? <div className="studio-empty"><Film /><h3>{clips.length ? 'No matching clips' : selectedEpisode.status === 'processing' ? 'Finding the strongest moments' : 'No clips available'}</h3><p>{clips.length ? 'Change your filters or search.' : 'Results will appear here when processing is complete.'}</p></div> : <div className="studio-clip-list">{filteredClips.map((clip, index) => <button key={clip.id} type="button" aria-pressed={selectedClip?.id === clip.id} onClick={() => setSelectedClip(clip)} className={selectedClip?.id === clip.id ? 'is-active' : ''}><span className="studio-clip-rank">{String(index + 1).padStart(2, '0')}</span><span className="studio-clip-copy"><span><strong>{clip.title}</strong><em>{Math.round(clip.confidence * 100)}% match</em></span><small>{clip.transcript}</small><span className="studio-clip-meta"><Badge>{clip.category.replace('_', ' ')}</Badge><Badge>{formatTime(clip.start)}–{formatTime(clip.end)}</Badge>{clip.render?.outputAssetKey && <Badge tone="green">Ready to review</Badge>}</span></span><span className="studio-clip-open"><ChevronRight /></span></button>)}</div>}
                  </section>
                  <ClipInspector clip={selectedClip} isRenderingClip={isRenderingClip} onRenderClipLocally={handleRenderClipLocally} onOpenEditor={onOpenEditor} />
                </div>
              </>
            ) : <section className="studio-card studio-empty studio-empty-page"><Film /><h2>No clip library yet</h2><p>Create a project to find your strongest moments.</p><Link className="studio-button studio-button-primary" to="/app/new">Create project</Link></section>}
          </>
        )}

        {view === 'settings' && (
          <>
            <header className="studio-page-header"><div className="studio-page-header-copy"><p className="studio-eyebrow">Settings</p><h1>Workspace preferences.</h1><p>Choose how your workspace looks. Production output settings stay consistent across projects.</p></div></header>
            <section className="studio-settings-layout">
              <div className="studio-card studio-settings-section"><div className="studio-settings-heading"><span><Sun /></span><div><h2>Appearance</h2><p>Select a theme for this device.</p></div></div><div className="studio-theme-options"><button type="button" aria-label="Use light theme" className={theme === 'light' ? 'is-active' : ''} onClick={() => setTheme('light')}><span className="studio-theme-preview is-light" aria-hidden="true"><i /><i /><i /></span><span><Sun />Light</span>{theme === 'light' && <Check />}</button><button type="button" aria-label="Use dark theme" className={theme === 'dark' ? 'is-active' : ''} onClick={() => setTheme('dark')}><span className="studio-theme-preview is-dark" aria-hidden="true"><i /><i /><i /></span><span><Moon />Dark</span>{theme === 'dark' && <Check />}</button></div></div>
              <div className="studio-card studio-settings-section"><div className="studio-settings-heading"><span><SlidersHorizontal /></span><div><h2>Output defaults</h2><p>The baseline used for every generated clip.</p></div></div><dl className="studio-settings-list"><div><dt>Canvas</dt><dd>Vertical · 9:16</dd></div><div><dt>Captions</dt><dd>Enabled</dd></div><div><dt>Editor</dt><dd>Available after render</dd></div></dl></div>
              <div className="studio-card studio-settings-section studio-settings-wide"><div className="studio-settings-heading"><span><CreditCard /></span><div><h2>Plan and billing</h2><p>{entitlement ? `${entitlement.planLabel} · ${entitlement.clipsUsed} of ${entitlement.clipsLimit ?? 'unlimited'} clips used${entitlement.plan === 'free' ? ' lifetime' : ' this period'}.` : 'Loading your current allowance…'}</p></div><div className="studio-settings-actions"><Link className="studio-button" to="/pricing">View plans</Link>{entitlement?.canManageBilling && <button className="studio-button studio-button-primary" type="button" onClick={openBillingPortal} disabled={isOpeningBilling}>{isOpeningBilling ? <Loader2 className="animate-spin" /> : null}{isOpeningBilling ? 'Opening…' : 'Manage billing'}</button>}</div></div>{billingPlanChange?.hasPendingChange && <div className="studio-billing-pending" role="status"><span><Loader2 className="animate-spin" /></span><div><strong>{billingPlanChange.targetPlanLabel} upgrade processing</strong><p>Your current plan stays active until payment confirmation. This status updates automatically.</p></div><Link to="/pricing">View details <ArrowRight /></Link></div>}</div>
              <div className="studio-card studio-settings-section studio-settings-wide"><div className="studio-settings-heading"><span><CircleHelpIcon /></span><div><h2>Need help?</h2><p>Questions about a project or output quality can be sent directly to the team.</p></div><Link className="studio-button" to="/app/support">Contact support</Link></div></div>
            </section>
          </>
        )}
      </main>
      {showFreeLimitDialog && <FreeSourceLimitDialog onBack={() => setShowFreeLimitDialog(false)} />}
    </ProductShell>
  );
};

const ProjectArtwork: React.FC<{ episode: Episode; large?: boolean }> = ({ episode, large = false }) => {
  const thumbnail = episode.source.import?.thumbnailUrl;
  return (
    <span className={`studio-project-art ${large ? 'is-large' : ''} ${thumbnail ? '' : 'is-placeholder'}`}>
      {thumbnail ? <img src={thumbnail} alt="" /> : <Film aria-hidden="true" />}
    </span>
  );
};

export const areEpisodeClipsReady = (episode: Episode, episodeClips: Clip[]) => {
  if (!episode.clips.length) return false;
  const clipsById = new Map(episodeClips.map((clip) => [clip.id, clip]));
  return episode.clips.every((clipId) => {
    const clip = clipsById.get(clipId);
    return clip?.episodeId === episode.id
      && clip.render?.status === 'rendered'
      && Boolean(clip.render.outputAssetKey);
  });
};

const ETA_STAGE_DEFAULTS: Record<string, (episode: Episode) => number> = {
  ingest: (episode) => episode.source.inputType === 'url'
    ? Math.max(35, (episode.source.import?.durationSeconds || 300) * 0.12)
    : 12,
  transcribe: (episode) => Math.max(45, (episode.transcript?.durationSeconds || episode.source.import?.durationSeconds || 300) * 0.22),
  score_transcript: (episode) => Math.max(40, Math.min(210, (episode.transcript?.durationSeconds || episode.source.import?.durationSeconds || 600) * 0.075)),
  visual_verification: () => 55,
  ui_flow_extraction: () => 24,
  rank_and_plan: () => 24,
  render_clips: (episode) => Math.max(130, Math.min(420, Math.max(1, episode.clips.length) * 32)),
  delivery: () => 8,
};

const stageDurationSeconds = (stage: PipelineStage) => {
  if (!stage.startedAt || !stage.completedAt) return null;
  const duration = (new Date(stage.completedAt).getTime() - new Date(stage.startedAt).getTime()) / 1000;
  return Number.isFinite(duration) && duration > 0 ? duration : null;
};

const median = (values: number[]) => {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

const estimateStageSeconds = (stageName: string, episode: Episode, history: Episode[]) => {
  const fallback = ETA_STAGE_DEFAULTS[stageName]?.(episode) || 30;
  const historicalDurations = history
    .filter((item) => item.id !== episode.id)
    .map((item) => item.stages.find((stage) => stage.name === stageName))
    .filter((stage): stage is PipelineStage => Boolean(stage))
    .map(stageDurationSeconds)
    .filter((duration): duration is number => duration !== null && duration < 60 * 30);
  if (!historicalDurations.length) return fallback;
  const learned = median(historicalDurations);
  return historicalDurations.length >= 3 ? learned : learned * 0.65 + fallback * 0.35;
};

const TERMINAL_RENDER_STATUSES = new Set(['rendered', 'failed', 'failed_qc']);

const activeStageFraction = (stage: PipelineStage, expected: number, nowMs: number, clips: Clip[]) => {
  if (stage.status !== 'running' || !stage.startedAt) return 0;
  const elapsed = Math.max(0, (nowMs - new Date(stage.startedAt).getTime()) / 1000);
  const timeFraction = 0.9 * (1 - Math.exp(-(elapsed / Math.max(15, expected)) * 2));
  if (stage.name !== 'render_clips' || !clips.length) return Math.min(0.9, timeFraction);

  const terminalClips = clips.filter((clip) => TERMINAL_RENDER_STATUSES.has(clip.render?.status)).length;
  if (terminalClips >= clips.length) return 0.99;
  const exactFraction = terminalClips / clips.length;
  return Math.min(0.97, exactFraction + (1 - exactFraction) * timeFraction);
};

export const calculateProjectProgressPercent = (episode: Episode, history: Episode[], clips: Clip[], nowMs = Date.now()) => {
  if (episode.status === 'ready' || areEpisodeClipsReady(episode, clips)) return 100;
  const weighted = episode.stages.map((stage) => ({
    stage,
    seconds: estimateStageSeconds(stage.name, episode, history),
  }));
  const totalWeight = weighted.reduce((total, item) => total + item.seconds, 0);
  if (!totalWeight) return 0;
  const earned = weighted.reduce((total, { stage, seconds }) => {
    if (stage.status === 'completed' || stage.status === 'skipped') return total + seconds;
    return total + seconds * activeStageFraction(stage, seconds, nowMs, clips);
  }, 0);
  return Math.min(99, Math.max(0, (earned / totalWeight) * 100));
};

export const calculateProjectEtaSeconds = (episode: Episode, history: Episode[], nowMs = Date.now(), clips: Clip[] = []) => {
  if (episode.status === 'ready' || isTerminalProjectError(episode.status)) return 0;
  const completedCalibration = episode.stages
    .filter((stage) => stage.status === 'completed')
    .map((stage) => {
      const actual = stageDurationSeconds(stage);
      const expected = ETA_STAGE_DEFAULTS[stage.name]?.(episode);
      return actual && expected ? actual / expected : null;
    })
    .filter((factor): factor is number => factor !== null && Number.isFinite(factor));
  const speedFactor = completedCalibration.length
    ? Math.min(2.5, Math.max(0.5, median(completedCalibration)))
    : 1;

  const remaining = episode.stages.reduce((total, stage) => {
    if (stage.status === 'completed' || stage.status === 'skipped') return total;
    const expected = estimateStageSeconds(stage.name, episode, history) * speedFactor;
    if (stage.status !== 'running' || !stage.startedAt) return total + expected;
    const elapsed = Math.max(0, (nowMs - new Date(stage.startedAt).getTime()) / 1000);
    if (stage.name === 'render_clips' && clips.length) {
      const terminalClips = clips.filter((clip) => TERMINAL_RENDER_STATUSES.has(clip.render?.status)).length;
      if (terminalClips > 0 && terminalClips < clips.length) {
        const observedTotal = elapsed / (terminalClips / clips.length);
        return total + Math.max(8, observedTotal - elapsed);
      }
    }
    return total + Math.max(8, expected - elapsed);
  }, 0);
  return Math.max(0, Math.round(remaining));
};

const formatEta = (seconds: number) => {
  if (seconds < 60) return 'Finalizing';
  const minutes = Math.max(1, Math.ceil(seconds / 60));
  return `≈ ${minutes} min remaining`;
};

export const projectEtaLabel = (episode: Episode, clipsReady: boolean, etaSeconds: number) => (
  clipsReady || episode.status === 'ready' ? 'Done' : formatEta(etaSeconds)
);

export const projectProgressStatusLabel = (episode: Episode, clips: Clip[], clipsReady: boolean, etaSeconds: number) => {
  const doneLabel = projectEtaLabel(episode, clipsReady, etaSeconds);
  const renderRunning = episode.stages.find((stage) => stage.name === 'render_clips')?.status === 'running';
  if (!renderRunning || !clips.length || doneLabel === 'Done') return doneLabel;
  const rendered = clips.filter((clip) => clip.render?.status === 'rendered' && clip.render?.outputAssetKey).length;
  return `${rendered} of ${clips.length} clips ready · ${doneLabel}`;
};

const PROJECT_MILESTONES = [
  { label: 'Recording added', target: 'ingest', stages: ['ingest'] },
  { label: 'Transcript ready', target: 'transcribe', stages: ['transcribe'] },
  { label: 'Moments selected', target: 'rank_and_plan', stages: ['score_transcript', 'visual_verification', 'ui_flow_extraction', 'rank_and_plan'] },
  { label: 'Clips ready', target: 'delivery', stages: ['render_clips', 'delivery'] },
];

export const getProjectMilestoneStates = (episode: Episode) => {
  const terminalError = isTerminalProjectError(episode.status);
  const stageByName = new Map<string, PipelineStage>(episode.stages.map((stage) => [stage.name, stage]));
  return PROJECT_MILESTONES.map((milestone, index) => {
    const targetStatus = stageByName.get(milestone.target)?.status;
    const complete = episode.status === 'ready' || targetStatus === 'completed' || targetStatus === 'skipped';
    const priorComplete = PROJECT_MILESTONES.slice(0, index).every((prior) => {
      const priorStatus = stageByName.get(prior.target)?.status;
      return episode.status === 'ready' || priorStatus === 'completed' || priorStatus === 'skipped';
    });
    const groupRunning = milestone.stages.some((stageName) => stageByName.get(stageName)?.status === 'running');
    return { ...milestone, complete, active: !terminalError && !complete && (groupRunning || priorComplete) };
  });
};

const ProjectProgress: React.FC<{ episode: Episode; history: Episode[]; clips: Clip[]; clipsReady: boolean }> = ({ episode, history, clips, clipsReady }) => {
  const { stages, status, error } = episode;
  const [nowMs, setNowMs] = useState(Date.now());
  const progressRef = useRef({ episodeId: episode.id, value: 0 });
  useEffect(() => {
    if (clipsReady || status === 'ready' || isTerminalProjectError(status)) return undefined;
    const interval = window.setInterval(() => setNowMs(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, [clipsReady, status]);

  const terminalError = isTerminalProjectError(status);
  const canceled = isCanceledProject(status);
  const estimatedProgress = terminalError ? 100 : calculateProjectProgressPercent(episode, history, clips, nowMs);
  if (progressRef.current.episodeId !== episode.id) progressRef.current = { episodeId: episode.id, value: 0 };
  progressRef.current.value = Math.max(progressRef.current.value, estimatedProgress);
  const progressPercent = progressRef.current.value;
  const etaSeconds = calculateProjectEtaSeconds(episode, history, nowMs, clips);
  const milestoneStates = getProjectMilestoneStates(episode).map((milestone) => (
    clipsReady && milestone.target === 'delivery'
      ? { ...milestone, complete: true, active: false }
      : milestone
  ));
  return (
    <div className={`studio-project-progress ${terminalError ? 'is-error' : ''}`}>
      <div className="studio-progress-copy"><span>{terminalError ? (canceled ? 'Generation canceled' : 'Generation failed') : <>Project progress <small>{projectProgressStatusLabel(episode, clips, clipsReady, etaSeconds)}</small></>}</span><strong>{terminalError ? 'Error' : `${Math.round(progressPercent)}%`}</strong></div>
      <div className="studio-progress-track"><i style={{ width: `${progressPercent}%` }} /></div>
      <ol>{milestoneStates.map((milestone) => <li key={milestone.label} className={terminalError ? 'is-error' : milestone.complete ? 'is-complete' : milestone.active ? 'is-active' : ''}><span>{terminalError ? <X /> : milestone.complete ? <Check /> : milestone.active ? <Loader2 className="studio-progress-spinner" /> : null}</span>{milestone.label}</li>)}</ol>
      {terminalError && <div className="studio-project-progress-error"><AlertCircle /><span><strong>{canceled ? 'Clip generation was canceled.' : 'Clip generation could not be completed.'}</strong><small>{error || (canceled ? 'Restart the project when you are ready.' : 'Review the project and try the generation again.')}</small></span></div>}
    </div>
  );
};

const ClipInspector: React.FC<{
  clip: Clip | null;
  isRenderingClip: boolean;
  onRenderClipLocally: (clip: Clip) => void;
  onOpenEditor: (clipId: string) => void;
}> = ({ clip, isRenderingClip, onRenderClipLocally, onOpenEditor }) => {
  const authFetch = useAuthenticatedFetch();
  const [outputExists, setOutputExists] = useState<boolean | null>(null);
  const [outputUrl, setOutputUrl] = useState<string | null>(null);
  const [isDownloading, setIsDownloading] = useState(false);

  useEffect(() => {
    let isMounted = true;
    setOutputExists(null);
    setOutputUrl(null);

    if (!clip?.render?.outputAssetKey) {
      setOutputExists(false);
      return;
    }

    requestAuthorizedAssetUrl(authFetch, API_BASE, clip.render.outputAssetKey)
      .then((url) => {
        if (isMounted) {
          setOutputUrl(url);
          setOutputExists(true);
        }
      })
      .catch(() => {
        if (isMounted) setOutputExists(false);
      });

    return () => {
      isMounted = false;
    };
  }, [authFetch, clip?.id, clip?.render?.outputAssetKey]);

  if (!clip) {
    return (
      <aside className="studio-card studio-clip-inspector studio-empty">
        <PlayCircle />
        <h3>Select a clip</h3>
        <p>Its preview and publishing tools will appear here.</p>
      </aside>
    );
  }

  const handleDownload = async () => {
    if (!clip.render.outputAssetKey || isDownloading) return;
    setIsDownloading(true);
    try {
      await downloadAuthorizedAsset(authFetch, API_BASE, clip.render.outputAssetKey, `${clip.title || 'podtoclips-clip'}.mp4`);
    } finally {
      setIsDownloading(false);
    }
  };

  return (
    <aside className="studio-clip-inspector">
      {outputUrl && outputExists && (
        <section className="studio-card studio-preview-card">
          <div className="studio-preview-head"><div><span className="studio-live-status"><i />Ready to edit</span><h2>Clip preview</h2></div><Badge>{formatTime(clip.end - clip.start)}</Badge></div>
          <div className="studio-video-wrap"><video src={outputUrl} controls playsInline preload="metadata" /></div>
          <div className="studio-preview-actions">
            <button type="button" onClick={() => onOpenEditor(clip.id)} className="studio-button studio-button-primary"><Wand2 />Open editor</button>
            {clip.render.outputAssetKey && <button type="button" onClick={handleDownload} disabled={isDownloading} className="studio-button studio-button-icon" aria-label="Download clip">{isDownloading ? <Loader2 className="animate-spin" /> : <Download />}</button>}
          </div>
        </section>
      )}

      {(!outputUrl || outputExists === false) && (
        <section className="studio-card studio-missing-preview">
          <span><Film /></span>
          <h2>Preview not available yet</h2>
          <p>The moment is selected. Create its video preview when you are ready.</p>
          <button type="button" onClick={() => onRenderClipLocally(clip)} disabled={isRenderingClip} className="studio-button studio-button-dark">
            {isRenderingClip ? <Loader2 className="animate-spin" /> : <Film />}{isRenderingClip ? 'Rendering…' : 'Render preview'}
          </button>
        </section>
      )}

      <section className="studio-card studio-insight-card">
        <div className="studio-inspector-title"><span><PlayCircle /></span><h2>Why this clip works</h2></div>
        <p>{clip.reasoning}</p>
        <div className="studio-clip-facts"><span><strong>{Math.round(clip.confidence * 100)}%</strong>match score</span><span><strong>{formatTime(clip.end - clip.start)}</strong>duration</span></div>
      </section>

    </aside>
  );
};

const Badge: React.FC<{ children: React.ReactNode; tone?: 'default' | 'violet' | 'green' }> = ({ children, tone = 'default' }) => {
  return <span className={`studio-badge is-${tone}`}>{children}</span>;
};
