import React, { useEffect, useMemo, useRef, useState } from 'react';
import { ArrowLeft, Check, Download, Film, Loader2, MonitorUp, Moon, Music2, Pause, Play, Scissors, Sun, Upload, Volume2, X } from 'lucide-react';
import { Clip } from '../types';
import { TimelineScrubber } from './TimelineScrubber';
import { useProductTheme } from './useProductPreferences';
import { useAuthenticatedFetch } from '../src/auth/AuthSession';
import { downloadAuthorizedAsset, requestAuthorizedAssetUrl } from '../src/media/authorizedAssets';

const API_BASE = (import.meta.env.VITE_API_BASE_URL || 'http://localhost:3005/api').replace(/\/$/, '');

type Segment = { id: string; clipId: string; title: string; assetKey: string; start: number; end: number; sourceDuration: number };
type MusicAsset = { assetKey: string; name: string; url: string };
type ImportedVideo = { id: string; assetKey: string; name: string; duration: number };
type PlaybackMode = 'idle' | 'playing' | 'scrubbing' | 'loading' | 'ended';
type EditorSnapshot = {
  segments: Segment[];
  music: MusicAsset | null;
  transitions: Record<string, 'none' | 'fade'>;
  activeSegmentId: string | null;
  playhead: number;
};

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${Math.floor(seconds % 60).toString().padStart(2, '0')}`;
const clipDuration = (clip: Clip) => Math.max(0.1, clip.end - clip.start);
const newSegment = (clip: Clip): Segment => ({
  id: `${clip.id}-${crypto.randomUUID()}`,
  clipId: clip.id,
  title: clip.title,
  assetKey: clip.render.outputAssetKey,
  start: 0,
  end: clipDuration(clip),
  sourceDuration: clipDuration(clip),
});
const newImportedSegment = (video: ImportedVideo): Segment => ({ id: `upload-${crypto.randomUUID()}`, clipId: video.id, title: video.name, assetKey: video.assetKey, start: 0, end: video.duration, sourceDuration: video.duration });

const locateTimelinePosition = (segments: Segment[], requestedTime: number) => {
  const duration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const timelineTime = Math.max(0, Math.min(duration, requestedTime));
  let timelineStart = 0;
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const segmentDuration = segment.end - segment.start;
    const timelineEnd = timelineStart + segmentDuration;
    if (timelineTime < timelineEnd || index === segments.length - 1) {
      return {
        index,
        segment,
        timelineTime,
        timelineStart,
        sourceTime: Math.max(segment.start, Math.min(segment.end, segment.start + timelineTime - timelineStart)),
      };
    }
    timelineStart = timelineEnd;
  }
  return null;
};

const fileDuration = (file: File) => new Promise<number>((resolve, reject) => {
  const element = document.createElement(file.type.startsWith('audio/') ? 'audio' : 'video');
  const url = URL.createObjectURL(file);
  element.onloadedmetadata = () => { URL.revokeObjectURL(url); resolve(element.duration); };
  element.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Could not read this media file.')); };
  element.src = url;
});

export const VideoEditorPage: React.FC<{ clipId: string; onBack: () => void }> = ({ clipId, onBack }) => {
  const authFetch = useAuthenticatedFetch();
  const { theme, toggleTheme } = useProductTheme();
  const [clip, setClip] = useState<Clip | null>(null);
  const [library, setLibrary] = useState<Clip[]>([]);
  const [segments, setSegments] = useState<Segment[]>([]);
  const [activeSegmentId, setActiveSegmentId] = useState<string | null>(null);
  const [music, setMusic] = useState<MusicAsset | null>(null);
  const [uploadedMusic, setUploadedMusic] = useState<MusicAsset | null>(null);
  const [importedVideos, setImportedVideos] = useState<ImportedVideo[]>([]);
  const [musicVolume, setMusicVolume] = useState(22);
  const [videoVolume, setVideoVolume] = useState(100);
  const [transitionsBySegmentId, setTransitionsBySegmentId] = useState<Record<string, 'none' | 'fade'>>({});
  const [selectedBoundarySegmentId, setSelectedBoundarySegmentId] = useState<string | null>(null);
  const [playhead, setPlayhead] = useState(0);
  const [isPreviewPlaying, setIsPreviewPlaying] = useState(false);
  const [pendingPreviewSeek, setPendingPreviewSeek] = useState<{ segmentId: string; sourceTime: number; autoplay: boolean } | null>(null);
  const [isUploadingMusic, setIsUploadingMusic] = useState(false);
  const [isExporting, setIsExporting] = useState(false);
  const [exportElapsedSeconds, setExportElapsedSeconds] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [exportUrl, setExportUrl] = useState<string | null>(null);
  const [exportAssetKey, setExportAssetKey] = useState<string | null>(null);
  const [isPreviewFaded, setIsPreviewFaded] = useState(false);
  const [authorizedAssetUrls, setAuthorizedAssetUrls] = useState<Record<string, string>>({});
  const videoRef = useRef<HTMLVideoElement>(null);
  const musicRef = useRef<HTMLAudioElement>(null);
  const playbackModeRef = useRef<PlaybackMode>('idle');
  const undoHistoryRef = useRef<EditorSnapshot[]>([]);

  useEffect(() => {
    if (!isExporting) {
      setExportElapsedSeconds(0);
      return undefined;
    }
    const startedAt = Date.now();
    const interval = window.setInterval(() => {
      setExportElapsedSeconds(Math.max(1, Math.round((Date.now() - startedAt) / 1000)));
    }, 1000);
    return () => window.clearInterval(interval);
  }, [isExporting]);

  useEffect(() => {
    let cancelled = false;
    Promise.resolve().then(async () => {
      const response = await authFetch(`${API_BASE}/clips/${clipId}`);
      const currentClip = await response.json();
      if (!response.ok) throw new Error(currentClip.error || 'Could not load this clip.');
      const libraryResponse = await authFetch(`${API_BASE}/podcasts/${currentClip.episodeId}/clips`);
      const episodeClips = await libraryResponse.json();
      if (!libraryResponse.ok) throw new Error(episodeClips.error || 'Could not load your clips.');
      if (cancelled) return;
      setClip(currentClip);
      setLibrary(episodeClips.filter((item: Clip) => item.render?.outputAssetKey));
      const initial = newSegment(currentClip);
      setSegments([initial]);
      setActiveSegmentId(initial.id);
      undoHistoryRef.current = [];
    }).catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : 'Could not load editor.'));
    return () => { cancelled = true; };
  }, [clipId]);

  const activeSegment = segments.find((segment) => segment.id === activeSegmentId) || segments[0] || null;
  const totalDuration = useMemo(() => segments.reduce((total, segment) => total + segment.end - segment.start, 0), [segments]);
  const preloadAssetKeys = useMemo(() => [...new Set(segments.map((segment) => segment.assetKey))], [segments]);
  const selectedTransition = selectedBoundarySegmentId ? transitionsBySegmentId[selectedBoundarySegmentId] || 'none' : null;

  useEffect(() => {
    let cancelled = false;
    const keys = [...new Set([...preloadAssetKeys, uploadedMusic?.assetKey, music?.assetKey].filter((key): key is string => Boolean(key)))];
    const missingKeys = keys.filter((key) => !authorizedAssetUrls[key]);
    if (!missingKeys.length) return undefined;
    Promise.all(missingKeys.map(async (key) => [key, await requestAuthorizedAssetUrl(authFetch, API_BASE, key)] as const))
      .then((entries) => {
        if (!cancelled) setAuthorizedAssetUrls((current) => ({ ...current, ...Object.fromEntries(entries) }));
      })
      .catch((reason) => !cancelled && setError(reason instanceof Error ? reason.message : 'Could not authorize editor media.'));
    return () => { cancelled = true; };
  }, [authFetch, music?.assetKey, preloadAssetKeys, uploadedMusic?.assetKey]);

  const saveUndoPoint = () => {
    undoHistoryRef.current.push({
      segments: segments.map((segment) => ({ ...segment })),
      music: music ? { ...music } : null,
      transitions: { ...transitionsBySegmentId },
      activeSegmentId,
      playhead,
    });
    if (undoHistoryRef.current.length > 50) undoHistoryRef.current.shift();
  };

  const replaceTimelineSegments = (next: Segment[], nextActiveId: string | null = activeSegmentId) => {
    saveUndoPoint();
    setSegments(next);
    setActiveSegmentId(nextActiveId);
    setExportUrl(null);
    setExportAssetKey(null);
  };

  const placeMusic = (nextMusic: MusicAsset | null) => {
    if (nextMusic?.assetKey === music?.assetKey) return;
    saveUndoPoint();
    setMusic(nextMusic);
    setExportUrl(null);
    setExportAssetKey(null);
  };

  const applyTransition = (segmentId: string, animation: 'none' | 'fade') => {
    if ((transitionsBySegmentId[segmentId] || 'none') === animation) return;
    saveUndoPoint();
    setTransitionsBySegmentId((current) => ({ ...current, [segmentId]: animation }));
    setExportUrl(null);
    setExportAssetKey(null);
  };

  const syncMusicPosition = (timelineTime: number) => {
    const element = musicRef.current;
    if (!element || !Number.isFinite(element.duration) || element.duration <= 0) return;
    const target = timelineTime % element.duration;
    if (Math.abs(element.currentTime - target) > 0.08) element.currentTime = target;
  };

  const playMusicAt = (timelineTime: number) => {
    if (!musicRef.current || !music) return;
    syncMusicPosition(timelineTime);
    musicRef.current.play().catch(() => undefined);
  };

  useEffect(() => {
    if (videoRef.current) videoRef.current.volume = videoVolume / 100;
  }, [videoVolume, activeSegment?.assetKey]);

  useEffect(() => {
    if (!musicRef.current) return;
    musicRef.current.volume = musicVolume / 100;
  }, [musicVolume, music?.assetKey]);

  useEffect(() => {
    if (!musicRef.current || !music) return;
    syncMusicPosition(playhead);
    if (playbackModeRef.current === 'playing') musicRef.current.play().catch(() => undefined);
  }, [music?.assetKey]);

  const addClip = (nextClip: Clip) => {
    const segment = newSegment(nextClip);
    replaceTimelineSegments([...segments, segment], segment.id);
  };

  const setPlayheadFromTimeline = (seconds: number, autoplay = false, precise = false) => {
    const location = locateTimelinePosition(segments, seconds);
    if (!location) return;
    setPlayhead(location.timelineTime);
    setIsPreviewFaded(false);
    if (precise || playbackModeRef.current !== 'scrubbing') syncMusicPosition(location.timelineTime);

    const element = videoRef.current;
    if (element && location.segment.assetKey === activeSegment?.assetKey) {
      setPendingPreviewSeek(null);
      setActiveSegmentId(location.segment.id);
      if (Math.abs(element.currentTime - location.sourceTime) > 0.001) {
        const fastSeek = (element as HTMLVideoElement & { fastSeek?: (time: number) => void }).fastSeek;
        if (!precise && playbackModeRef.current === 'scrubbing' && typeof fastSeek === 'function') fastSeek.call(element, location.sourceTime);
        else element.currentTime = location.sourceTime;
      }
      if (autoplay) {
        playbackModeRef.current = 'playing';
        playMusicAt(location.timelineTime);
        element.play().catch(() => { playbackModeRef.current = 'idle'; });
      }
      return;
    }

    playbackModeRef.current = autoplay ? 'loading' : playbackModeRef.current;
    setPendingPreviewSeek({ segmentId: location.segment.id, sourceTime: location.sourceTime, autoplay });
    setActiveSegmentId(location.segment.id);
  };

  const splitActiveSegment = () => {
    if (!activeSegment) return;
    const playhead = videoRef.current?.currentTime ?? activeSegment.start;
    if (playhead <= activeSegment.start + 0.2 || playhead >= activeSegment.end - 0.2) {
      setError('Move the preview playhead inside the selected clip before cutting.');
      return;
    }
    const first = { ...activeSegment, id: `${activeSegment.id}-a`, end: playhead };
    const second = { ...activeSegment, id: `${activeSegment.id}-b`, start: playhead };
    replaceTimelineSegments(segments.flatMap((item) => item.id === activeSegment.id ? [first, second] : [item]), second.id);
  };

  const deleteSelectedClip = () => {
    if (!activeSegment) return;
    const removedIndex = segments.findIndex((segment) => segment.id === activeSegment.id);
    const next = segments.filter((segment) => segment.id !== activeSegment.id);
    const nextActive = next.length ? next[Math.min(Math.max(0, removedIndex), next.length - 1)] : null;
    replaceTimelineSegments(next, nextActive?.id || null);
    playbackModeRef.current = 'idle';
    videoRef.current?.pause();
    musicRef.current?.pause();
    setPlayhead(0);
    if (nextActive) setPendingPreviewSeek({ segmentId: nextActive.id, sourceTime: nextActive.start, autoplay: false });
  };

  const undoLastEdit = () => {
    const snapshot = undoHistoryRef.current.pop();
    if (!snapshot) return;
    playbackModeRef.current = 'idle';
    videoRef.current?.pause();
    musicRef.current?.pause();
    setSegments(snapshot.segments);
    setMusic(snapshot.music);
    setTransitionsBySegmentId(snapshot.transitions);
    setActiveSegmentId(snapshot.activeSegmentId);
    setPlayhead(snapshot.playhead);
    setExportUrl(null);
    setExportAssetKey(null);
    const location = locateTimelinePosition(snapshot.segments, snapshot.playhead);
    if (!location) return;
    if (videoRef.current && location.segment.assetKey === activeSegment?.assetKey) {
      videoRef.current.currentTime = location.sourceTime;
      setPendingPreviewSeek(null);
    } else {
      setPendingPreviewSeek({ segmentId: location.segment.id, sourceTime: location.sourceTime, autoplay: false });
    }
  };

  const uploadMedia = async (event: React.ChangeEvent<HTMLInputElement>, kind: 'music' | 'video') => {
    const file = event.target.files?.[0];
    if (!file) return;
    setIsUploadingMusic(true); setError(null); setExportUrl(null); setExportAssetKey(null);
    try {
      const duration = kind === 'video' ? await fileDuration(file) : 0;
      const form = new FormData(); form.append('file', file);
      const response = await authFetch(`${API_BASE}/editor/assets/upload`, { method: 'POST', body: form });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Media upload failed.');
      const authorizedUrl = await requestAuthorizedAssetUrl(authFetch, API_BASE, data.assetKey);
      setAuthorizedAssetUrls((current) => ({ ...current, [data.assetKey]: authorizedUrl }));
      if (kind === 'music') setUploadedMusic({ assetKey: data.assetKey, name: data.name, url: authorizedUrl });
      else setImportedVideos((items) => [...items, { id: `upload-${crypto.randomUUID()}`, assetKey: data.assetKey, name: data.name, duration }]);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Media upload failed.'); }
    finally { setIsUploadingMusic(false); event.target.value = ''; }
  };

  const exportProject = async () => {
    if (!segments.length) return;
    setIsExporting(true); setError(null); setExportUrl(null); setExportAssetKey(null);
    try {
      const response = await authFetch(`${API_BASE}/editor/exports`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ segments: segments.map(({ assetKey, start, end }) => ({ assetKey, start, end })), music: music ? { assetKey: music.assetKey, volume: musicVolume / 100 } : null, programVolume: videoVolume / 100, transitions: segments.slice(0, -1).map((segment) => transitionsBySegmentId[segment.id] || 'none') }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || 'Export failed.');
      const downloadUrl = await downloadAuthorizedAsset(authFetch, API_BASE, data.outputAssetKey, `podtoclips-export-${Date.now()}.mp4`);
      setExportUrl(downloadUrl);
      setExportAssetKey(data.outputAssetKey);
    } catch (reason) { setError(reason instanceof Error ? reason.message : 'Export failed.'); }
    finally { setIsExporting(false); }
  };

  const downloadCompletedExport = async () => {
    if (!exportAssetKey) return;
    try {
      const nextUrl = await downloadAuthorizedAsset(authFetch, API_BASE, exportAssetKey, 'podtoclips-export.mp4');
      setExportUrl(nextUrl);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Export download failed.');
    }
  };

  const handlePreviewLoaded = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!activeSegment) return;
    const request = pendingPreviewSeek?.segmentId === activeSegment.id ? pendingPreviewSeek : null;
    event.currentTarget.currentTime = request?.sourceTime ?? activeSegment.start;
    if (request?.autoplay && playbackModeRef.current !== 'scrubbing') {
      playbackModeRef.current = 'playing';
      playMusicAt(playhead);
      event.currentTarget.play().catch(() => { playbackModeRef.current = 'idle'; });
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => setIsPreviewFaded(false)));
    } else if (playbackModeRef.current === 'loading') {
      playbackModeRef.current = 'idle';
      setIsPreviewFaded(false);
    }
    if (request) setPendingPreviewSeek(null);
  };

  const handlePreviewPlay = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (playbackModeRef.current !== 'playing') {
      event.currentTarget.pause();
      setIsPreviewPlaying(false);
      return;
    }
    setIsPreviewPlaying(true);
  };

  const togglePreviewPlayback = () => {
    if (!videoRef.current) return;
    if (!videoRef.current.paused) {
      playbackModeRef.current = 'idle';
      videoRef.current.pause();
      musicRef.current?.pause();
      return;
    }
    if (playhead >= totalDuration - 0.01) {
      setPlayheadFromTimeline(0, true);
      return;
    }
    playbackModeRef.current = 'playing';
    playMusicAt(playhead);
    videoRef.current.play().catch(() => { playbackModeRef.current = 'idle'; });
  };

  const handlePreviewTimeUpdate = (event: React.SyntheticEvent<HTMLVideoElement>) => {
    if (!activeSegment || playbackModeRef.current !== 'playing') return;
    const element = event.currentTarget;
    const activeIndex = segments.findIndex((segment) => segment.id === activeSegment.id);
    const before = segments.slice(0, activeIndex).reduce((sum, item) => sum + item.end - item.start, 0);
    const segmentDuration = activeSegment.end - activeSegment.start;
    const reachedCut = element.currentTime >= activeSegment.end - 0.04;
    const transition = transitionsBySegmentId[activeSegment.id] || 'none';
    const fadingOut = transition === 'fade' && element.currentTime >= activeSegment.end - 0.35;

    if (!reachedCut) {
      setIsPreviewFaded(fadingOut);
      const nextPlayhead = Math.min(totalDuration, before + element.currentTime - activeSegment.start);
      setPlayhead(nextPlayhead);
      if (musicRef.current && Number.isFinite(musicRef.current.duration) && musicRef.current.duration > 0) {
        const expectedMusicTime = nextPlayhead % musicRef.current.duration;
        if (Math.abs(musicRef.current.currentTime - expectedMusicTime) > 0.3) musicRef.current.currentTime = expectedMusicTime;
      }
      return;
    }

    setPlayhead(Math.min(totalDuration, before + segmentDuration));
    const following = segments[activeIndex + 1];
    if (!following) {
      playbackModeRef.current = 'ended';
      element.pause();
      musicRef.current?.pause();
      element.currentTime = activeSegment.end;
      setIsPreviewPlaying(false);
      return;
    }
    if (following.assetKey === activeSegment.assetKey) {
      setIsPreviewFaded(transition === 'fade');
      element.currentTime = following.start;
      setActiveSegmentId(following.id);
      if (transition === 'fade') {
        window.requestAnimationFrame(() => window.requestAnimationFrame(() => setIsPreviewFaded(false)));
      }
      return;
    }
    setIsPreviewFaded(transition === 'fade');
    playbackModeRef.current = 'loading';
    element.pause();
    setPendingPreviewSeek({ segmentId: following.id, sourceTime: following.start, autoplay: true });
    setActiveSegmentId(following.id);
  };

  const beginManualScrub = () => {
    playbackModeRef.current = 'scrubbing';
    setPendingPreviewSeek((current) => current ? { ...current, autoplay: false } : current);
    videoRef.current?.pause();
    musicRef.current?.pause();
    setIsPreviewPlaying(false);
    setIsPreviewFaded(false);
  };

  const endManualScrub = (finalTime: number) => {
    setPlayheadFromTimeline(finalTime, false, true);
    playbackModeRef.current = 'idle';
  };

  useEffect(() => {
    const handleEditorShortcut = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditingField = Boolean(target?.closest('input, textarea, select, [contenteditable="true"]'));
      if (isEditingField) return;

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z' && !event.shiftKey) {
        event.preventDefault();
        undoLastEdit();
        return;
      }

      if (!event.metaKey && !event.ctrlKey && !event.altKey && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        deleteSelectedClip();
      }
    };

    window.addEventListener('keydown', handleEditorShortcut);
    return () => window.removeEventListener('keydown', handleEditorShortcut);
  }, [activeSegmentId, segments, music, transitionsBySegmentId, playhead]);

  if (!clip) return error ? <main className="editor-loading-error"><button onClick={onBack}><ArrowLeft />Back to clips</button><p>{error}</p></main> : <main className="editor-loading" aria-label="Loading video editor"><Loader2 className="editor-loading-spinner" /></main>;

  return <main className={`editor-shell is-${theme}`}>
    <section className="editor-mobile-gate" aria-labelledby="editor-mobile-title">
      <div className="editor-mobile-gate-brand"><span><i /><i /></span>PodToClips</div>
      <div className="editor-mobile-gate-card">
        <span className="editor-mobile-gate-icon"><MonitorUp /></span>
        <p>Desktop editing workspace</p>
        <h1 id="editor-mobile-title">Finish this edit on a larger screen.</h1>
        <p>Your project is safe. Review and download clips on mobile, then use the complete timeline editor on desktop for precise cuts, audio, and transitions.</p>
        <ul>
          <li><Check />Your generated clips stay ready</li>
          <li><Check />No edits or project data are lost</li>
          <li><Check />The full editor remains unchanged on desktop</li>
        </ul>
        <button type="button" onClick={onBack}><ArrowLeft />Back to clip library</button>
      </div>
    </section>
    <header className="editor-topbar">
      <div className="editor-topbar-inner">
        <button onClick={onBack} className="editor-back"><ArrowLeft />Back to clips</button>
        <div className="editor-project-title"><p>Video editor</p><h1>{clip.title}</h1></div>
        <div className="editor-topbar-actions"><button type="button" className="editor-theme-toggle" onClick={toggleTheme} aria-label={`Use ${theme === 'light' ? 'dark' : 'light'} mode`}>{theme === 'light' ? <Moon /> : <Sun />}</button><button onClick={exportProject} disabled={isExporting || !segments.length} className="editor-export">
          {isExporting ? <Loader2 className="animate-spin" /> : <Download />}{isExporting ? `Exporting ${exportElapsedSeconds}s` : 'Export MP4'}
        </button></div>
      </div>
    </header>
    <div className="editor-layout">
      <aside className="editor-panel editor-library-panel">
        <div className="editor-panel-title"><span><Film /></span><div><h2>Media</h2><p>Clips & uploads</p></div></div>
        <p className="editor-panel-copy">Add clips to your sequence.</p>
        <label className="editor-import"><Upload />Import media<input onChange={(event) => uploadMedia(event, 'video')} type="file" accept="video/*" className="hidden" /></label>
        <div className="editor-media-list">
          {library.map((item) => <button key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('application/easyed-clip', item.id)} onClick={() => addClip(item)}>
            <span className="editor-media-thumb"><Film /></span><span><strong>{item.title}</strong><small>{formatTime(clipDuration(item))} · Add to timeline</small></span>
          </button>)}
          {importedVideos.map((item) => <button key={item.id} draggable onDragStart={(event) => event.dataTransfer.setData('application/easyed-imported-video', item.id)} onClick={() => { const segment = newImportedSegment(item); replaceTimelineSegments([...segments, segment], segment.id); }} className="is-imported"><span className="editor-media-thumb"><Upload /></span><span><strong>{item.name}</strong><small>Imported · {formatTime(item.duration)}</small></span></button>)}
        </div>
      </aside>
      <section className="editor-center">
        <div className="editor-stage">
          {activeSegment ? <div className="editor-preview"><div className="editor-preview-video"><video ref={videoRef} key={activeSegment.assetKey} playsInline preload="auto" src={authorizedAssetUrls[activeSegment.assetKey]} onLoadedMetadata={(event) => { event.currentTarget.volume = videoVolume / 100; handlePreviewLoaded(event); }} onTimeUpdate={handlePreviewTimeUpdate} onPlay={handlePreviewPlay} onPause={() => setIsPreviewPlaying(false)} /><div aria-hidden="true" className={`editor-preview-fade ${isPreviewFaded ? 'is-visible' : ''}`} /></div><div className="editor-preview-controls"><button onClick={togglePreviewPlayback} aria-label={isPreviewPlaying ? 'Pause preview' : 'Play preview'}>{isPreviewPlaying ? <Pause /> : <Play />}</button><TimelineScrubber value={playhead} duration={totalDuration} onScrubStart={beginManualScrub} onChange={(time) => setPlayheadFromTimeline(time)} onScrubEnd={endManualScrub} /><span>{formatTime(playhead)} <i>/</i> {formatTime(totalDuration)}</span></div></div> : <p className="editor-stage-empty">Add a clip to begin.</p>}
          <div className="hidden" aria-hidden="true">{preloadAssetKeys.filter((assetKey) => assetKey !== activeSegment?.assetKey && authorizedAssetUrls[assetKey]).map((assetKey) => <video key={assetKey} preload="auto" muted src={authorizedAssetUrls[assetKey]} />)}</div>
        </div>
        <section className="editor-panel editor-timeline-panel">
          <div className="editor-timeline-head">
            <div className="editor-timeline-title"><Scissors /><h2>Timeline</h2><span>{formatTime(totalDuration)} total</span></div>
            {activeSegment && <div className="editor-timeline-actions"><button onClick={splitActiveSegment}><Scissors />Split</button><button onClick={deleteSelectedClip} className="is-danger"><X />Delete</button></div>}
          </div>
          <Timeline
            segments={segments} activeSegmentId={activeSegment?.id || null} playhead={playhead} music={music}
            onSelect={setActiveSegmentId} onSeek={setPlayheadFromTimeline} onSeekStart={beginManualScrub} onSeekEnd={endManualScrub} onChangeSegments={(next) => replaceTimelineSegments(next)}
            onDropClip={(id) => { const next = library.find((item) => item.id === id); if (next) addClip(next); }}
            onDropImportedVideo={(id) => { const item = importedVideos.find((video) => video.id === id); if (item) { const segment = newImportedSegment(item); replaceTimelineSegments([...segments, segment], segment.id); } }}
            transitionsBySegmentId={transitionsBySegmentId} onSetTransition={applyTransition}
            selectedBoundarySegmentId={selectedBoundarySegmentId} onSelectBoundary={setSelectedBoundarySegmentId}
            onDropMusic={() => uploadedMusic && placeMusic(uploadedMusic)} onRemoveMusic={() => placeMusic(null)}
          />
        </section>
      </section>
      <aside className="editor-panel editor-inspector-panel">
        <section className="editor-inspector-section">
          <div className="editor-panel-title"><span><Music2 /></span><div><h2>Audio</h2><p>Music and levels</p></div></div>
          <label className="editor-audio-upload"><Upload />{isUploadingMusic ? 'Uploading…' : 'Upload music'}<input onChange={(event) => uploadMedia(event, 'music')} type="file" accept="audio/*" className="hidden" /></label>
          {uploadedMusic && <div draggable onDragStart={(event) => event.dataTransfer.setData('application/easyed-music', uploadedMusic.assetKey)} className="editor-audio-asset"><Music2 /><div><strong>{uploadedMusic.name}</strong><small>Ready to add</small></div><button onClick={() => placeMusic(uploadedMusic)}>Add</button></div>}
          {music && <div className="editor-active-audio"><div><Music2 /><span><strong>{music.name}</strong><small>On timeline</small></span></div><audio ref={musicRef} className="hidden" loop preload="auto" src={authorizedAssetUrls[music.assetKey] || music.url} onLoadedMetadata={(event) => { event.currentTarget.volume = musicVolume / 100; syncMusicPosition(playhead); }} /><label className="editor-volume-control"><span><Volume2 />Music volume</span><strong>{musicVolume}%</strong><input type="range" min="0" max="100" value={musicVolume} onChange={(event) => setMusicVolume(Number(event.target.value))} /></label><button onClick={() => placeMusic(null)} className="editor-remove-audio">Remove from timeline</button></div>}
        </section>
        <section className="editor-inspector-section"><h2>Clip settings</h2><label className="editor-volume-control"><span><Volume2 />Video volume</span><strong>{videoVolume}%</strong><input type="range" min="0" max="100" value={videoVolume} onChange={(event) => setVideoVolume(Number(event.target.value))} /></label><div className="editor-transition-card"><div><strong>Transition</strong><small>{selectedBoundarySegmentId ? 'Choose the selected junction style.' : 'Select a junction on the timeline.'}</small></div><div className="editor-transition-options"><button disabled={!selectedBoundarySegmentId} onClick={() => selectedBoundarySegmentId && applyTransition(selectedBoundarySegmentId, 'none')} className={selectedTransition === 'none' ? 'is-active' : ''}>Cut</button><button disabled={!selectedBoundarySegmentId} onClick={() => selectedBoundarySegmentId && applyTransition(selectedBoundarySegmentId, 'fade')} className={selectedTransition === 'fade' ? 'is-active is-fade' : ''}>Fade</button></div></div></section>
        <section className="editor-inspector-section editor-export-section"><h2>Export</h2><p>Vertical 1080 × 1920 MP4</p>{isExporting && <p className="editor-export-status">Preparing download · {exportElapsedSeconds}s</p>}{error && <p className="editor-error-status">{error}</p>}{exportUrl && exportAssetKey && <button type="button" onClick={downloadCompletedExport} className="editor-download-result"><Download />Download exported MP4</button>}</section>
      </aside>
    </div>
  </main>;
};

const PIXELS_PER_SECOND = 32;

export const timelineTimeFromClientX = (clientX: number, canvasLeft: number, duration: number) => (
  Math.max(0, Math.min(duration, (clientX - canvasLeft) / PIXELS_PER_SECOND))
);

const Timeline: React.FC<{
  segments: Segment[];
  activeSegmentId: string | null;
  playhead: number;
  music: MusicAsset | null;
  onSelect: (id: string) => void;
  onSeek: (seconds: number) => void;
  onSeekStart: () => void;
  onSeekEnd: (seconds: number) => void;
  onChangeSegments: (segments: Segment[]) => void;
  onDropClip: (clipId: string) => void;
  onDropImportedVideo: (videoId: string) => void;
  transitionsBySegmentId: Record<string, 'none' | 'fade'>;
  onSetTransition: (segmentId: string, animation: 'none' | 'fade') => void;
  selectedBoundarySegmentId: string | null;
  onSelectBoundary: (segmentId: string) => void;
  onDropMusic: () => void;
  onRemoveMusic: () => void;
}> = ({ segments, activeSegmentId, playhead, music, onSelect, onSeek, onSeekStart, onSeekEnd, onChangeSegments, onDropClip, onDropImportedVideo, transitionsBySegmentId, onSetTransition, selectedBoundarySegmentId, onSelectBoundary, onDropMusic, onRemoveMusic }) => {
  const timelineRef = useRef<HTMLDivElement>(null);
  const dragPointerRef = useRef<number | null>(null);
  const pendingSeekRef = useRef(playhead);
  const seekFrameRef = useRef<number | null>(null);
  const contentDuration = segments.reduce((sum, segment) => sum + segment.end - segment.start, 0);
  const timelineDuration = Math.max(20, contentDuration + 4);
  const timelineWidth = timelineDuration * PIXELS_PER_SECOND;
  const rulerMarks = Array.from({ length: Math.ceil(timelineDuration / 2) + 1 }, (_, index) => index * 2);

  useEffect(() => () => {
    if (seekFrameRef.current !== null) window.cancelAnimationFrame(seekFrameRef.current);
  }, []);

  const positionFromClientX = (clientX: number) => {
    const bounds = timelineRef.current?.getBoundingClientRect();
    if (!bounds) return 0;
    return timelineTimeFromClientX(clientX, bounds.left, contentDuration);
  };

  const scheduleSeek = (time: number) => {
    pendingSeekRef.current = time;
    if (seekFrameRef.current !== null) return;
    seekFrameRef.current = window.requestAnimationFrame(() => {
      seekFrameRef.current = null;
      onSeek(pendingSeekRef.current);
    });
  };

  const beginTimelineSeek = (event: React.PointerEvent<HTMLElement>) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    dragPointerRef.current = event.pointerId;
    event.currentTarget.setPointerCapture?.(event.pointerId);
    onSeekStart();
    const time = positionFromClientX(event.clientX);
    pendingSeekRef.current = time;
    onSeek(time);
  };

  const moveTimelineSeek = (event: React.PointerEvent<HTMLElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    scheduleSeek(positionFromClientX(event.clientX));
  };

  const finishTimelineSeek = (event: React.PointerEvent<HTMLElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    const finalTime = positionFromClientX(event.clientX);
    if (seekFrameRef.current !== null) {
      window.cancelAnimationFrame(seekFrameRef.current);
      seekFrameRef.current = null;
    }
    pendingSeekRef.current = finalTime;
    onSeek(finalTime);
    dragPointerRef.current = null;
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture?.(event.pointerId);
    onSeekEnd(finalTime);
  };

  const cancelTimelineSeek = (event: React.PointerEvent<HTMLElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    if (seekFrameRef.current !== null) {
      window.cancelAnimationFrame(seekFrameRef.current);
      seekFrameRef.current = null;
    }
    dragPointerRef.current = null;
    onSeekEnd(pendingSeekRef.current);
  };

  const lostTimelineCapture = (event: React.PointerEvent<HTMLElement>) => {
    if (dragPointerRef.current !== event.pointerId) return;
    if (seekFrameRef.current !== null) {
      window.cancelAnimationFrame(seekFrameRef.current);
      seekFrameRef.current = null;
    }
    dragPointerRef.current = null;
    onSeekEnd(pendingSeekRef.current);
  };

  const reorderBefore = (fromId: string, targetId: string) => {
    if (fromId === targetId) return;
    const next = [...segments];
    const fromIndex = next.findIndex((item) => item.id === fromId);
    const targetIndex = next.findIndex((item) => item.id === targetId);
    if (fromIndex < 0 || targetIndex < 0) return;
    const [moved] = next.splice(fromIndex, 1);
    next.splice(targetIndex > fromIndex ? targetIndex - 1 : targetIndex, 0, moved);
    onChangeSegments(next);
  };

  let cursor = 0;
  return <div className="timeline-scrollport">
    <div className="timeline-canvas" ref={timelineRef} style={{ width: `${timelineWidth}px` }}>
      <div className="timeline-ruler" onPointerDown={beginTimelineSeek} onPointerMove={moveTimelineSeek} onPointerUp={finishTimelineSeek} onPointerCancel={cancelTimelineSeek} onLostPointerCapture={lostTimelineCapture}>
        {rulerMarks.map((mark) => <span key={mark} className="timeline-ruler-mark" style={{ left: `${mark * PIXELS_PER_SECOND}px` }}>{formatTime(mark)}</span>)}
      </div>
      <div className="timeline-lane-label"><span>Video</span><span>Drag clips to reorder · split at playhead, then delete</span></div>
      <div className="timeline-video-lane" onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const clipId = event.dataTransfer.getData('application/easyed-clip'); const importedId = event.dataTransfer.getData('application/easyed-imported-video'); if (clipId) onDropClip(clipId); if (importedId) onDropImportedVideo(importedId); }}>
        {segments.map((segment, index) => {
          const left = cursor * PIXELS_PER_SECOND;
          const width = Math.max(42, (segment.end - segment.start) * PIXELS_PER_SECOND);
          cursor += segment.end - segment.start;
          return <React.Fragment key={segment.id}><div draggable onDragStart={(event) => event.dataTransfer.setData('application/easyed-segment', segment.id)} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); const id = event.dataTransfer.getData('application/easyed-segment'); if (id) reorderBefore(id, segment.id); }} onClick={() => onSelect(segment.id)} className={`timeline-segment ${activeSegmentId === segment.id ? 'is-active' : ''}`} style={{ left, width }}>
            <div className="timeline-segment-copy"><strong>{index + 1}. {segment.title}</strong><small>{formatTime(segment.end - segment.start)}</small></div>
          </div>{index < segments.length - 1 && <button title="Select this transition junction" onClick={() => onSelectBoundary(segment.id)} className={`timeline-boundary ${selectedBoundarySegmentId === segment.id ? 'is-selected' : ''} ${transitionsBySegmentId[segment.id] === 'fade' ? 'is-fade' : ''}`} style={{ left: left + width }}>{transitionsBySegmentId[segment.id] === 'fade' ? 'Fade' : 'Cut'}</button>}</React.Fragment>;
        })}
      </div>
      <div className="timeline-lane-label is-audio"><span>Audio</span><span>{music ? 'Music is mixed underneath all video clips.' : 'Drop uploaded music here'}</span></div>
      <div className={`timeline-audio-lane ${music ? 'has-music' : ''}`} onDragOver={(event) => event.preventDefault()} onDrop={(event) => { event.preventDefault(); if (event.dataTransfer.getData('application/easyed-music')) onDropMusic(); }}>
        {music ? <div className="timeline-audio-content"><div><strong>♫ {music.name}</strong><small>Loops to match the sequence</small></div><button onClick={onRemoveMusic}>Remove</button></div> : <p>Drop a music track onto this lane</p>}
      </div>
      <div className="timeline-playhead" style={{ left: `${Math.min(contentDuration, playhead) * PIXELS_PER_SECOND}px` }}><div onPointerDown={beginTimelineSeek} onPointerMove={moveTimelineSeek} onPointerUp={finishTimelineSeek} onPointerCancel={cancelTimelineSeek} onLostPointerCapture={lostTimelineCapture} /></div>
    </div>
  </div>;
};
