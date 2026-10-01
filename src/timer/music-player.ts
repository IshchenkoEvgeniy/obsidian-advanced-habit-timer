import { App, TFolder } from 'obsidian';
import { t } from '../i18n';
import type HabitTimerPlugin from '../main';

export type PlaybackMode = 'seq' | 'loop' | 'rand';

/**
 * Self-contained music player component for the TimerView.
 * Manages playlist loading, track navigation, shuffle, and audio playback.
 */
export class MusicPlayer {
    audioPlayer: HTMLAudioElement;
    playlistFiles: { path: string; name: string }[] = [];
    currentTrackIndex: number = 0;
    playbackMode: PlaybackMode = 'seq';

    private shuffledIndices: number[] = [];
    private shuffleCursor: number = 0;
    private currentMusicFolder: string = '';
    private currentStreamUrl = '';
    private sourceKind: 'none' | 'youtube' | 'stream' | 'folder' = 'none';
    private youtubeShouldPlay = false;
    private hostEl: HTMLElement | null = null;
    private anchorEl: HTMLElement | null = null;
    private anchorObserver: ResizeObserver | null = null;
    private detailsObserver: MutationObserver | null = null;
    private attachedWindow: Window | null = null;
    private positionFrame = 0;
    private readonly schedulePosition = () => {
        if (this.positionFrame) return;
        this.positionFrame = (this.attachedWindow || window).requestAnimationFrame(() => {
            this.positionFrame = 0;
            this.positionAtAnchor();
        });
    };

    iframeEl!: HTMLIFrameElement;

    // DOM refs — assigned in render()
    musicStatusEl!: HTMLElement;
    musicTimeEl!: HTMLElement;
    volumeSlider!: HTMLInputElement;
    playPauseBtn!: HTMLButtonElement;
    modeBtn!: HTMLButtonElement;
    playlistContainer!: HTMLElement;
    playlistToggleBtn!: HTMLButtonElement;
    trackListEl!: HTMLElement;
    private musicCont!: HTMLElement;
    private nextBtn!: HTMLButtonElement;

    constructor(private app: App, private plugin: HabitTimerPlugin) {
        if (!this.audioPlayer) {
            this.audioPlayer = new Audio();
            this.audioPlayer.onended = () => this.next(false);
            this.audioPlayer.ontimeupdate = () => {
                if (this.musicTimeEl && !isNaN(this.audioPlayer.duration)) {
                    this.musicTimeEl.textContent = `${this.plugin.formatTime(this.audioPlayer.currentTime)} / ${this.plugin.formatTime(this.audioPlayer.duration)}`;
                }
            };
        }
    }

    /** Keep the iframe in one DOM node for the whole plugin lifetime. Recreating it stops YouTube playback. */
    ensureRendered(doc: Document = document): void {
        if (this.hostEl) return;
        this.hostEl = doc.body.createDiv({ cls: 'fl-persistent-music-player' });
        this.hostEl.setAttribute('aria-hidden', 'true');
        this.render(this.hostEl);
    }

    attach(anchor: HTMLElement): void {
        this.ensureRendered(anchor.ownerDocument);
        this.detach();
        if (this.hostEl!.ownerDocument !== anchor.ownerDocument) anchor.ownerDocument.body.appendChild(this.hostEl!);
        this.anchorEl = anchor;
        this.attachedWindow = anchor.ownerDocument.defaultView;
        this.anchorObserver = new ResizeObserver(this.schedulePosition);
        this.anchorObserver.observe(anchor);
        this.anchorObserver.observe(this.hostEl!);
        const details = anchor.closest('details');
        if (details) {
            this.detailsObserver = new MutationObserver(this.schedulePosition);
            this.detailsObserver.observe(details, { attributes: true, attributeFilter: ['open'] });
        }
        this.attachedWindow?.addEventListener('scroll', this.schedulePosition, true);
        this.attachedWindow?.addEventListener('resize', this.schedulePosition);
        this.schedulePosition();
    }

    detach(anchor?: HTMLElement): void {
        if (anchor && this.anchorEl !== anchor) return;
        this.anchorEl = null;
        this.anchorObserver?.disconnect();
        this.anchorObserver = null;
        this.detailsObserver?.disconnect();
        this.detailsObserver = null;
        this.attachedWindow?.removeEventListener('scroll', this.schedulePosition, true);
        this.attachedWindow?.removeEventListener('resize', this.schedulePosition);
        if (this.positionFrame) (this.attachedWindow || window).cancelAnimationFrame(this.positionFrame);
        this.positionFrame = 0;
        this.attachedWindow = null;
        this.hideHost();
    }

    destroy(): void {
        this.detach();
        this.pause();
        this.audioPlayer.src = '';
        if (this.iframeEl) this.iframeEl.src = 'about:blank';
        this.hostEl?.remove();
        this.hostEl = null;
    }

    private positionAtAnchor(): void {
        if (!this.hostEl || !this.anchorEl) return;
        const details = this.anchorEl.closest('details');
        if (details && !details.open) {
            this.hideHost();
            return;
        }
        const rect = this.anchorEl.getBoundingClientRect();
        if (!rect.width || !this.anchorEl.isConnected) {
            this.hideHost();
            return;
        }
        const styles = this.anchorEl.ownerDocument.defaultView?.getComputedStyle(this.anchorEl);
        const leftPadding = parseFloat(styles?.paddingLeft || '0') || 0;
        const rightPadding = parseFloat(styles?.paddingRight || '0') || 0;
        const topPadding = parseFloat(styles?.paddingTop || '0') || 0;
        const bottomPadding = parseFloat(styles?.paddingBottom || '0') || 0;
        this.hostEl.style.width = `${Math.max(200, rect.width - leftPadding - rightPadding)}px`;
        const height = Math.ceil(this.hostEl.getBoundingClientRect().height);
        const reservedHeight = height + topPadding + bottomPadding;
        if (height && this.anchorEl.style.minHeight !== `${reservedHeight}px`) this.anchorEl.style.minHeight = `${reservedHeight}px`;
        const top = rect.top + topPadding;
        const viewport = this.anchorEl.closest('.view-content')?.getBoundingClientRect();
        if (viewport && (top + height <= viewport.top || top >= viewport.bottom)) {
            this.hideHost();
            return;
        }
        this.hostEl.style.clipPath = viewport
            ? `inset(${Math.max(0, viewport.top - top)}px 0 ${Math.max(0, top + height - viewport.bottom)}px 0)`
            : '';
        this.hostEl.style.left = `${rect.left + leftPadding}px`;
        this.hostEl.style.top = `${top}px`;
        this.hostEl.addClass('is-visible');
        this.hostEl.setAttribute('aria-hidden', 'false');
    }

    private hideHost(): void {
        if (!this.hostEl) return;
        this.hostEl.removeClass('is-visible');
        this.hostEl.style.left = '-10000px';
        this.hostEl.style.top = '0px';
        this.hostEl.setAttribute('aria-hidden', 'true');
    }

    /** Render the full music player UI into the given container element. */
    render(container: HTMLElement): void {
        const lang = this.plugin.settings.language;
        container.createEl('label', { text: t(lang, 'music_player_label'), cls: 'tui-label' });
        const musicCont = container.createDiv({ cls: 'music-player-container' });
        this.musicCont = musicCont;

        const sourceCont = musicCont.createDiv({ cls: 'music-source-row' });
        const sourceDropdown = sourceCont.createEl('select', { cls: 'dropdown' });
        const streamInput = sourceCont.createEl('input', { type: 'text', cls: 'music-url-input', placeholder: 'YouTube / Audio URL...' });
        const applyBtn = sourceCont.createEl('button', { text: 'Load', cls: 'music-btn music-load-btn' });

        sourceDropdown.createEl('option', { text: '-- No Music --', value: 'none' });
        sourceDropdown.createEl('option', { text: '🌐 URL (Stream)', value: 'stream' });
        
        if (this.plugin.settings.globalMusicFolder) {
            const root = this.app.vault.getAbstractFileByPath(this.plugin.settings.globalMusicFolder);
            if (root instanceof TFolder) {
                root.children.forEach((c) => {
                    if (c instanceof TFolder) {
                        sourceDropdown.createEl('option', { text: `📁 ${c.name}`, value: `folder:${c.name}` });
                    }
                });
            }
        }

        const currentSrc = this.plugin.settings.activeMusicSource || 'none';
        if (currentSrc.startsWith('url:')) {
            sourceDropdown.value = 'stream';
            streamInput.value = currentSrc.substring(4);
        } else if (currentSrc.startsWith('folder:')) {
            sourceDropdown.value = currentSrc;
        }

        const updateSourceRow = () => sourceCont.toggleClass('has-url', sourceDropdown.value === 'stream');
        sourceDropdown.onchange = updateSourceRow;
        updateSourceRow();

        applyBtn.onclick = async () => {
            const url = streamInput.value.trim();
            if (sourceDropdown.value === 'stream' && !url) return;
            if (sourceDropdown.value === 'none') {
                this.plugin.settings.activeMusicSource = 'none';
                this.plugin.settings.globalMusicStreamUrl = '';
                this.clearFolder();
            } else if (sourceDropdown.value === 'stream') {
                this.plugin.settings.activeMusicSource = `url:${url}`;
                this.plugin.settings.globalMusicStreamUrl = url;
                this.loadFolder('stream');
            } else if (sourceDropdown.value.startsWith('folder:')) {
                const folderName = sourceDropdown.value.substring(7);
                this.plugin.settings.activeMusicSource = `folder:${folderName}`;
                this.plugin.settings.globalMusicStreamUrl = '';
                this.loadFolder(`${this.plugin.settings.globalMusicFolder}/${folderName}`);
            }
            await this.plugin.saveSettings();
        };

        this.iframeEl = musicCont.createEl('iframe', {
            cls: 'music-youtube-frame',
            attr: { title: 'YouTube music player', allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen', allowfullscreen: 'true' }
        });
        this.iframeEl.style.display = 'none';
        this.iframeEl.onload = () => {
            if (this.sourceKind === 'youtube' && this.youtubeShouldPlay) this.youtubeCommand('playVideo');
        };
        musicCont.createDiv({ cls: 'music-youtube-hint', text: lang === 'ru'
            ? 'Управление воспроизведением и громкостью — в видео YouTube.'
            : 'Use the controls inside the YouTube video.' });

        this.audioPlayer.onplay = () => { if (this.playPauseBtn) this.playPauseBtn.textContent = '⏸ Pause'; };
        this.audioPlayer.onpause = () => { if (this.playPauseBtn) this.playPauseBtn.textContent = '▶ Play'; };

        const infoCont = musicCont.createDiv({ cls: 'music-info-container' });
        this.musicStatusEl = infoCont.createDiv({ cls: 'music-status', text: 'No music folder selected' });
        this.musicTimeEl = infoCont.createDiv({ cls: 'music-time', text: '00:00 / 00:00' });

        const musicCtrls = musicCont.createDiv({ cls: 'music-controls' });

        this.volumeSlider = musicCtrls.createEl('input', { type: 'range' });
        this.volumeSlider.min = '0'; this.volumeSlider.max = '1'; this.volumeSlider.step = '0.05';
        this.volumeSlider.value = String(this.audioPlayer.volume);
        this.volumeSlider.setAttribute('aria-label', lang === 'ru' ? 'Громкость' : 'Volume');
        this.volumeSlider.oninput = () => { this.audioPlayer.volume = parseFloat(this.volumeSlider.value); };

        this.modeBtn = musicCtrls.createEl('button', {
            text: this.playbackMode === 'seq' ? '🔁 Seq' : (this.playbackMode === 'loop' ? '🔂 Loop' : '🔀 Rand'),
            cls: 'music-btn'
        });
        this.modeBtn.onclick = () => {
            if (this.playbackMode === 'seq') { this.playbackMode = 'loop'; this.modeBtn.textContent = '🔂 Loop'; }
            else if (this.playbackMode === 'loop') { this.playbackMode = 'rand'; this.modeBtn.textContent = '🔀 Rand'; this.generateShuffle(); }
            else { this.playbackMode = 'seq'; this.modeBtn.textContent = '🔁 Seq'; }
        };

        this.playPauseBtn = musicCtrls.createEl('button', {
            text: this.audioPlayer.paused ? `▶ ${t(lang, 'start')}` : '⏸ Pause',
            cls: 'music-btn'
        });
        this.playPauseBtn.onclick = () => {
            if (this.sourceKind === 'youtube' || this.sourceKind === 'none') return;
            if (this.audioPlayer.paused) {
                const currentSrc = this.audioPlayer.src;
                if ((!currentSrc || currentSrc.endsWith('/') || this.audioPlayer.readyState === 0) && this.playlistFiles.length > 0) {
                    if (this.playbackMode === 'rand') this.currentTrackIndex = this.shuffledIndices[this.shuffleCursor] || 0;
                    this.loadTrack(true);
                } else {
                    this.audioPlayer.play().catch(e => {
                        console.error('Playback failed, trying to reload track:', e);
                        this.loadTrack(true);
                    });
                }
            } else {
                this.audioPlayer.pause();
            }
        };

        this.nextBtn = musicCtrls.createEl('button', { text: '⏭ Next', cls: 'music-btn music-folder-only' });
        this.nextBtn.onclick = () => this.next(true);
        this.modeBtn.addClass('music-folder-only');

        this.playlistToggleBtn = musicCtrls.createEl('button', {
            text: '☰', cls: 'music-btn music-folder-only',
            attr: { title: t(lang, 'track_list_toggle') }
        });
        this.playlistToggleBtn.onclick = () => {
            this.playlistContainer.setCssStyles({ display: this.playlistContainer.style.display === 'none' ? 'block' : 'none' });
            this.renderPlaylistItems();
        };

        this.playlistContainer = musicCont.createDiv({ cls: 'music-playlist-container', attr: { style: 'display: none;' } });
        this.trackListEl = this.playlistContainer.createDiv({ cls: 'music-track-list' });

        // Initialize state
        const initSrc = this.plugin.settings.activeMusicSource || 'none';
        if (initSrc.startsWith('url:')) {
            this.loadFolder('stream');
        } else if (initSrc.startsWith('folder:')) {
            const folderName = initSrc.substring(7);
            this.loadFolder(`${this.plugin.settings.globalMusicFolder}/${folderName}`);
        } else {
            this.clearFolder();
        }
    }

    private youtubeId(raw: string): string | null {
        try {
            const url = new URL(raw);
            const host = url.hostname.toLowerCase();
            const id = host === 'youtu.be' ? url.pathname.slice(1).split('/')[0]
                : host === 'youtube.com' || host.endsWith('.youtube.com')
                    ? url.searchParams.get('v') || url.pathname.match(/^\/(?:live|shorts|embed)\/([^/]+)/)?.[1]
                    : null;
            return id && /^[A-Za-z0-9_-]{11}$/.test(id) ? id : null;
        } catch { return null; }
    }

    private updateSourceAppearance(): void {
        if (!this.musicCont) return;
        this.musicCont.classList.toggle('is-youtube', this.sourceKind === 'youtube');
        this.musicCont.classList.toggle('is-stream', this.sourceKind === 'stream');
        this.musicCont.classList.toggle('is-folder', this.sourceKind === 'folder');
        this.musicCont.classList.toggle('is-none', this.sourceKind === 'none');
        if (this.playPauseBtn) this.playPauseBtn.disabled = this.sourceKind === 'none' || (this.sourceKind === 'folder' && !this.playlistFiles.length);
        if (this.nextBtn) this.nextBtn.disabled = this.sourceKind !== 'folder' || !this.playlistFiles.length;
        if (this.modeBtn) this.modeBtn.disabled = this.sourceKind !== 'folder' || !this.playlistFiles.length;
        if (this.playlistToggleBtn) this.playlistToggleBtn.disabled = this.sourceKind !== 'folder' || !this.playlistFiles.length;
        if (this.playlistContainer && this.sourceKind !== 'folder') this.playlistContainer.style.display = 'none';
    }

    private stopCurrentPlayback(): void {
        this.audioPlayer.pause();
        this.audioPlayer.removeAttribute('src');
        this.audioPlayer.load();
        if (this.iframeEl) {
            this.iframeEl.style.display = 'none';
            if (this.iframeEl.src && this.iframeEl.src !== 'about:blank') this.iframeEl.src = 'about:blank';
        }
        this.currentMusicFolder = '';
        this.currentStreamUrl = '';
        this.youtubeShouldPlay = false;
        this.playlistFiles = [];
        this.sourceKind = 'none';
        if (this.musicTimeEl) this.musicTimeEl.textContent = '00:00 / 00:00';
        if (this.playPauseBtn) this.playPauseBtn.textContent = '▶ Play';
        this.updateSourceAppearance();
    }

    /** Load a source without reloading it when the timer view is opened again. */
    loadFolder(folderPath: string): void {
        const streamUrl = this.plugin.settings.globalMusicStreamUrl;
        if (streamUrl) {
            const videoId = this.youtubeId(streamUrl);
            const kind = videoId ? 'youtube' : 'stream';
            if (this.sourceKind !== kind || this.currentStreamUrl !== streamUrl) {
                this.stopCurrentPlayback();
                this.sourceKind = kind;
                this.currentStreamUrl = streamUrl;
                if (videoId) {
                    const origin = this.iframeEl.ownerDocument.defaultView?.location.origin;
                    const params = new URLSearchParams({ enablejsapi: '1', autoplay: '0', controls: '1' });
                    if (origin?.startsWith('http://') || origin?.startsWith('https://')) params.set('origin', origin);
                    this.iframeEl.src = `https://www.youtube.com/embed/${videoId}?${params}`;
                    this.iframeEl.style.display = 'block';
                } else {
                    this.audioPlayer.src = streamUrl;
                }
            }
            this.musicStatusEl.textContent = videoId ? '📺 YouTube Stream' : '📻 Audio Stream';
            this.updateSourceAppearance();
            return;
        }

        if (this.sourceKind === 'folder' && this.currentMusicFolder === folderPath) return;
        this.stopCurrentPlayback();
        this.sourceKind = 'folder';
        this.currentMusicFolder = folderPath;
        const audioFiles = this.app.vault.getFiles().filter(file =>
            file.path.startsWith(`${folderPath}/`) && ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(file.extension)
        );
        this.playlistFiles = audioFiles.map(file => ({ path: this.app.vault.getResourcePath(file), name: file.basename }));
        this.generateShuffle();
        this.currentTrackIndex = 0;
        this.musicStatusEl.textContent = audioFiles.length
            ? t(this.plugin.settings.language, 'loaded_tracks', audioFiles.length)
            : t(this.plugin.settings.language, 'no_audio_files', folderPath);
        this.updateSourceAppearance();
    }

    clearFolder(): void {
        this.stopCurrentPlayback();
        if (this.musicStatusEl) this.musicStatusEl.textContent = t(this.plugin.settings.language, 'no_music');
    }

    private youtubeCommand(command: 'playVideo' | 'pauseVideo'): void {
        if (this.sourceKind !== 'youtube') return;
        this.iframeEl.contentWindow?.postMessage(JSON.stringify({ event: 'command', func: command, args: [] }), 'https://www.youtube.com');
    }

    playIfReady(): void {
        if (this.sourceKind === 'youtube') {
            this.youtubeShouldPlay = true;
            this.youtubeCommand('playVideo');
            return;
        }
        if (this.sourceKind === 'stream') {
            this.audioPlayer.play().catch(error => console.error('Audio stream playback failed:', error));
            return;
        }
        if (this.sourceKind === 'folder' && this.playlistFiles.length) {
            if (!this.audioPlayer.src) {
                if (this.playbackMode === 'rand') this.currentTrackIndex = this.shuffledIndices[this.shuffleCursor] || 0;
                this.loadTrack();
            } else {
                this.audioPlayer.play().catch(error => console.error('Audio playback failed:', error));
            }
        }
    }

    pause(): void {
        if (this.sourceKind === 'youtube') {
            this.youtubeShouldPlay = false;
            this.youtubeCommand('pauseVideo');
        }
        else this.audioPlayer.pause();
    }

    /** Advance to the next track (or loop/shuffle depending on mode). */
    next(force: boolean = false): void {
        if (this.playlistFiles.length === 0) return;
        if (!force && this.playbackMode === 'loop') {
            this.audioPlayer.currentTime = 0;
            this.audioPlayer.play().catch(e => console.error(e));
            return;
        }
        if (this.playbackMode === 'rand') {
            this.shuffleCursor++;
            if (this.shuffleCursor >= this.shuffledIndices.length) this.generateShuffle();
            this.currentTrackIndex = this.shuffledIndices[this.shuffleCursor] || 0;
        } else {
            this.currentTrackIndex++;
            if (this.currentTrackIndex >= this.playlistFiles.length) this.currentTrackIndex = 0;
        }
        this.loadTrack();
    }

    /** Load and optionally auto-play the current track. */
    loadTrack(autoPlay: boolean = true): void {
        if (this.playlistFiles.length === 0) return;
        const track = this.playlistFiles[this.currentTrackIndex];
        if (track) {
            this.audioPlayer.src = track.path;
            this.musicStatusEl.textContent = `🎵 ${track.name}`;
            if (autoPlay) this.audioPlayer.play().catch(e => console.error(e));
        }
    }

    renderPlaylistItems(): void {
        this.trackListEl.empty();
        this.playlistFiles.forEach((file, index) => {
            const item = this.trackListEl.createDiv({
                cls: `music-track-item ${this.currentTrackIndex === index ? 'active' : ''}`,
                text: file.name
            });
            item.onclick = () => {
                this.currentTrackIndex = index;
                if (this.playbackMode === 'rand') {
                    const sIdx = this.shuffledIndices.indexOf(index);
                    if (sIdx !== -1) this.shuffleCursor = sIdx;
                }
                this.loadTrack();
                this.renderPlaylistItems();
            };
        });
    }

    private generateShuffle(): void {
        this.shuffledIndices = Array.from({ length: this.playlistFiles.length }, (_, i) => i);
        for (let i = this.shuffledIndices.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            const tmp = this.shuffledIndices[i]!;
            this.shuffledIndices[i] = this.shuffledIndices[j]!;
            this.shuffledIndices[j] = tmp;
        }
        this.shuffleCursor = 0;
    }
}
