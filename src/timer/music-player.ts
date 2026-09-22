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

    /** Render the full music player UI into the given container element. */
    render(container: HTMLElement): void {
        const lang = this.plugin.settings.language;
        container.createEl('label', { text: t(lang, 'music_player_label'), cls: 'tui-label' });
        const musicCont = container.createDiv({ cls: 'music-player-container' });

        const sourceCont = musicCont.createDiv({ attr: { style: 'display: flex; gap: 5px; margin-bottom: 10px; align-items: center;' } });
        const sourceDropdown = sourceCont.createEl('select', { cls: 'dropdown', attr: { style: 'flex: 1;' } });
        const streamInput = sourceCont.createEl('input', { type: 'text', placeholder: 'YouTube / Audio URL...', attr: { style: 'flex: 1; display: none;' } });
        const applyBtn = sourceCont.createEl('button', { text: 'Load', cls: 'music-btn', attr: { style: 'padding: 4px 8px; font-size: 0.8em;' } });

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
            streamInput.setCssStyles({ display: 'block' });
        } else if (currentSrc.startsWith('folder:')) {
            sourceDropdown.value = currentSrc;
        }

        sourceDropdown.onchange = () => {
            if (sourceDropdown.value === 'stream') {
                streamInput.setCssStyles({ display: 'block' });
            } else {
                streamInput.setCssStyles({ display: 'none' });
            }
        };

        applyBtn.onclick = async () => {
            if (sourceDropdown.value === 'none') {
                this.plugin.settings.activeMusicSource = 'none';
                this.plugin.settings.globalMusicStreamUrl = '';
                this.clearFolder();
            } else if (sourceDropdown.value === 'stream') {
                const url = streamInput.value.trim();
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
            attr: { style: 'display: none; width: 100%; height: 100px; border: none; border-radius: 8px; margin-bottom: 10px;', allow: 'autoplay' }
        });

        this.audioPlayer.onplay = () => { if (this.playPauseBtn && !this.plugin.settings.globalMusicStreamUrl?.includes('youtu')) this.playPauseBtn.textContent = '⏸ Pause'; };
        this.audioPlayer.onpause = () => { if (this.playPauseBtn && !this.plugin.settings.globalMusicStreamUrl?.includes('youtu')) this.playPauseBtn.textContent = '▶ Play'; };

        const infoCont = musicCont.createDiv({ cls: 'music-info-container' });
        this.musicStatusEl = infoCont.createDiv({ cls: 'music-status', text: 'No music folder selected' });
        this.musicTimeEl = infoCont.createDiv({ cls: 'music-time', text: '00:00 / 00:00' });

        const musicCtrls = musicCont.createDiv({ cls: 'music-controls' });

        this.volumeSlider = musicCtrls.createEl('input', { type: 'range' });
        this.volumeSlider.min = '0'; this.volumeSlider.max = '1'; this.volumeSlider.step = '0.05';
        this.volumeSlider.value = String(this.audioPlayer.volume);
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
            const streamUrl = this.plugin.settings.globalMusicStreamUrl;
            if (streamUrl && (streamUrl.includes('youtu.be') || streamUrl.includes('youtube.com'))) {
                if (this.iframeEl.src.includes('autoplay=0')) {
                    this.iframeEl.src = this.iframeEl.src.replace('autoplay=0', 'autoplay=1');
                    this.playPauseBtn.textContent = '⏸ Pause';
                } else {
                    this.iframeEl.src = this.iframeEl.src.replace('autoplay=1', 'autoplay=0');
                    this.playPauseBtn.textContent = '▶ Play';
                }
                return;
            }

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

        const nextBtn = musicCtrls.createEl('button', { text: '⏭ Next', cls: 'music-btn' });
        nextBtn.onclick = () => this.next(true);

        this.playlistToggleBtn = musicCtrls.createEl('button', {
            text: '☰', cls: 'music-btn',
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

    /** Load a music folder path; skips reload if already loaded. */
    loadFolder(folderPath: string): void {
        const streamUrl = this.plugin.settings.globalMusicStreamUrl;
        if (streamUrl) {
            this.currentMusicFolder = 'stream';
            this.playlistFiles = [];
            
            if (streamUrl.includes('youtube.com') || streamUrl.includes('youtu.be')) {
                this.iframeEl.setCssStyles({ display: 'block' });
                let videoId = '';
                if (streamUrl.includes('v=')) {
                    const parts = streamUrl.split('v=');
                    if (parts[1]) videoId = parts[1].split('&')[0] || '';
                } else if (streamUrl.includes('youtu.be/')) {
                    const parts = streamUrl.split('youtu.be/');
                    if (parts[1]) videoId = parts[1].split('?')[0] || '';
                }
                
                if (videoId && !this.iframeEl.src.includes(videoId)) {
                    this.iframeEl.src = `https://www.youtube.com/embed/${videoId}?autoplay=0`;
                }
                if (this.musicStatusEl) this.musicStatusEl.textContent = '📺 YouTube Stream';
            } else {
                this.iframeEl.setCssStyles({ display: 'none' });
                this.audioPlayer.src = streamUrl;
                if (this.musicStatusEl) this.musicStatusEl.textContent = '📻 Audio Stream';
            }
            return;
        }

        this.iframeEl.setCssStyles({ display: 'none' });

        if (this.currentMusicFolder === folderPath) {
            if (this.musicStatusEl) this.musicStatusEl.textContent = t(this.plugin.settings.language, 'loaded_tracks', this.playlistFiles.length);
            return;
        }
        this.currentMusicFolder = folderPath;
        const allFiles = this.app.vault.getFiles();
        const audioFiles = allFiles.filter(f =>
            f.path.startsWith(folderPath) && ['mp3', 'wav', 'ogg', 'm4a', 'flac'].includes(f.extension)
        );

        if (audioFiles.length > 0) {
            this.playlistFiles = audioFiles.map(f => ({ path: this.app.vault.getResourcePath(f), name: f.basename }));
            this.generateShuffle();
            this.currentTrackIndex = 0;
            if (this.musicStatusEl) this.musicStatusEl.textContent = t(this.plugin.settings.language, 'loaded_tracks', this.playlistFiles.length);
            if (this.audioPlayer.paused) {
                this.audioPlayer.src = '';
                if (this.musicTimeEl) this.musicTimeEl.textContent = '00:00 / 00:00';
            }
        } else {
            this.playlistFiles = [];
            if (this.musicStatusEl) this.musicStatusEl.textContent = t(this.plugin.settings.language, 'no_audio_files', folderPath);
        }
    }

    /** Clear the loaded folder / playlist. */
    clearFolder(): void {
        this.currentMusicFolder = '';
        this.playlistFiles = [];
        if (this.musicStatusEl) this.musicStatusEl.textContent = t(this.plugin.settings.language, 'no_music');
    }

    /** Play audio if a playlist is loaded. Does nothing if already playing. */
    playIfReady(): void {
        const streamUrl = this.plugin.settings.globalMusicStreamUrl;
        if (streamUrl && (streamUrl.includes('youtu.be') || streamUrl.includes('youtube.com'))) {
            if (this.iframeEl.src.includes('autoplay=0')) {
                this.iframeEl.src = this.iframeEl.src.replace('autoplay=0', 'autoplay=1');
                if (this.playPauseBtn) this.playPauseBtn.textContent = '⏸ Pause';
            }
            return;
        }
        if (streamUrl) {
            if (this.audioPlayer.src !== streamUrl) this.audioPlayer.src = streamUrl;
            this.audioPlayer.play().catch(e => console.error('Audio play failed:', e));
            return;
        }

        if (this.playlistFiles.length > 0) {
            if (!this.audioPlayer.src || this.audioPlayer.src === '') {
                if (this.playbackMode === 'rand') this.currentTrackIndex = this.shuffledIndices[this.shuffleCursor] || 0;
                this.loadTrack();
            } else {
                this.audioPlayer.play().catch(e => console.error('Audio play failed:', e));
            }
        }
    }

    pause(): void {
        const streamUrl = this.plugin.settings.globalMusicStreamUrl;
        if (streamUrl && (streamUrl.includes('youtu.be') || streamUrl.includes('youtube.com'))) {
            this.iframeEl.src = this.iframeEl.src.replace('autoplay=1', 'autoplay=0');
            if (this.playPauseBtn) this.playPauseBtn.textContent = '▶ Play';
            return;
        }
        this.audioPlayer.pause();
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
