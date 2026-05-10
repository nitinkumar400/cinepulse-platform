// ══════════════════════════════════════════
// CINE STREAM — Enhanced Video Player v2
// Quality selector + subtitles + resume
// ══════════════════════════════════════════

const VideoPlayer = (() => {

  let video        = null;
  let container    = null;
  let hideTimer    = null;
  let isTheater    = false;
  let isMobile     = window.innerWidth <= 768;

  let currentContentId  = null;
  let progressSaveTimer = null;
  let subtitleTracks    = [];

  // Quality state
  let qualityMap     = {};
  let currentQuality = 'auto';

  // ══════════════════════════════════════════
  // INIT
  // ══════════════════════════════════════════
  const init = (videoId, containerId, contentId = null) => {
    video     = document.getElementById(videoId);
    container = document.getElementById(containerId);
    if (!video || !container) return;

    currentContentId = contentId;
    container.classList.add('vp-wrap');

    buildControls();
    bindKeyboard();
    bindMobileGestures();
    restoreVolume();

    container.addEventListener('mousemove',  showControls);
    container.addEventListener('mouseleave', () => scheduleHide(2000));
    container.addEventListener('touchstart', showControls, { passive: true });

    video.addEventListener('timeupdate',     onTimeUpdate);
    video.addEventListener('loadedmetadata', updateDuration);
    video.addEventListener('volumechange',   updateVolumeUI);
    video.addEventListener('play',           () => { updatePlayPauseBtn(true);  scheduleHide(3000); });
    video.addEventListener('pause',          () => { updatePlayPauseBtn(false); showControls(); });
    video.addEventListener('ended',          onVideoEnded);
    video.addEventListener('waiting',        () => showBuffering(true));
    video.addEventListener('canplay',        () => showBuffering(false));

    video.addEventListener('click', () => {
      if (isMobile) return;
      const wp = video.paused;
      togglePlay();
      showClickFeedback(wp ? '▶' : '⏸');
    });

    video.addEventListener('loadedmetadata', () => restoreProgress());
    window.addEventListener('resize', () => { isMobile = window.innerWidth <= 768; });

    // Production mode: keep player init silent
  };

  // ══════════════════════════════════════════
  // BUILD CONTROLS
  // ══════════════════════════════════════════
  const buildControls = () => {
    video.removeAttribute('controls');
    container.style.cssText += ';position:relative;background:#000;overflow:hidden;user-select:none;';
    container.style.borderRadius = 'var(--radius-lg,12px)';

    container.insertAdjacentHTML('beforeend', `
      <div id="vpBuffering" style="display:none;position:absolute;inset:0;align-items:center;justify-content:center;background:rgba(0,0,0,0.3);z-index:5;pointer-events:none;">
        <div style="width:52px;height:52px;border-radius:50%;border:4px solid rgba(255,255,255,0.15);border-top-color:#fff;animation:vp-spin 0.8s linear infinite;"></div>
      </div>

      <div id="vpClickFeedback" style="position:absolute;top:50%;left:50%;transform:translate(-50%,-50%) scale(0);background:rgba(0,0,0,0.6);border-radius:50%;width:72px;height:72px;display:flex;align-items:center;justify-content:center;font-size:28px;z-index:6;pointer-events:none;transition:transform 0.15s,opacity 0.3s;opacity:0;"></div>

      <div id="vpSeekLeft" style="position:absolute;left:0;top:0;bottom:0;width:40%;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity 0.3s;">
        <div style="background:rgba(0,0,0,0.6);border-radius:50px;padding:8px 16px;font-size:13px;color:#fff;">◀◀ 10s</div>
      </div>
      <div id="vpSeekRight" style="position:absolute;right:0;top:0;bottom:0;width:40%;display:flex;align-items:center;justify-content:center;pointer-events:none;opacity:0;transition:opacity 0.3s;">
        <div style="background:rgba(0,0,0,0.6);border-radius:50px;padding:8px 16px;font-size:13px;color:#fff;">10s ▶▶</div>
      </div>

      <div id="vpSkipIntro" style="display:none;position:absolute;bottom:80px;right:24px;z-index:10;">
        <button id="vpSkipIntroBtn" style="background:rgba(0,0,0,0.8);border:2px solid #fff;color:#fff;padding:8px 20px;border-radius:4px;font-size:14px;font-weight:600;cursor:pointer;">Skip Intro →</button>
      </div>
      <div id="vpNextEp" style="display:none;position:absolute;bottom:80px;right:24px;z-index:10;">
        <button id="vpNextEpBtn" style="background:var(--accent,#e50914);border:none;color:#fff;padding:10px 22px;border-radius:4px;font-size:14px;font-weight:600;cursor:pointer;">▶ Next Episode</button>
      </div>

      <div id="vpControls" style="position:absolute;bottom:0;left:0;right:0;background:linear-gradient(to top,rgba(0,0,0,0.92),transparent);padding:40px 16px 16px;transition:opacity 0.3s;z-index:8;">

        <div id="vpProgressWrap" style="position:relative;height:4px;background:rgba(255,255,255,0.2);border-radius:2px;cursor:pointer;margin-bottom:12px;transition:height 0.15s;">
          <div id="vpBufferedBar" style="position:absolute;top:0;left:0;height:100%;background:rgba(255,255,255,0.25);border-radius:2px;width:0%;transition:width 0.5s;"></div>
          <div id="vpProgressBar" style="position:absolute;top:0;left:0;height:100%;background:var(--accent,#e50914);border-radius:2px;width:0%;">
            <div style="position:absolute;right:-6px;top:50%;transform:translateY(-50%);width:12px;height:12px;border-radius:50%;background:#fff;box-shadow:0 0 4px rgba(0,0,0,0.5);"></div>
          </div>
          <div id="vpTimeTooltip" style="position:absolute;bottom:12px;background:rgba(0,0,0,0.85);color:#fff;font-size:11px;padding:3px 8px;border-radius:4px;pointer-events:none;display:none;transform:translateX(-50%);white-space:nowrap;"></div>
        </div>

        <div style="display:flex;align-items:center;gap:8px;flex-wrap:nowrap;">
          <button id="vpPlayBtn" title="Play/Pause (Space)" style="background:none;border:none;cursor:pointer;color:#fff;font-size:22px;padding:4px 6px;line-height:1;transition:transform 0.1s;flex-shrink:0;"><i class="ri-play-fill"></i></button>
          <button id="vpSkipBackBtn" title="Back 10s (←)" style="background:none;border:none;cursor:pointer;color:#fff;font-size:18px;padding:4px 6px;line-height:1;transition:transform 0.1s;flex-shrink:0;"><i class="ri-replay-10-line"></i></button>
          <button id="vpSkipFwdBtn" title="Forward 10s (→)" style="background:none;border:none;cursor:pointer;color:#fff;font-size:18px;padding:4px 6px;line-height:1;transition:transform 0.1s;flex-shrink:0;"><i class="ri-forward-10-line"></i></button>

          <div style="display:flex;align-items:center;gap:6px;flex-shrink:0;">
            <button id="vpMuteBtn" title="Mute (M)" style="background:none;border:none;cursor:pointer;color:#fff;font-size:20px;padding:4px 6px;line-height:1;transition:transform 0.1s;"><i class="ri-volume-up-line"></i></button>
            <input id="vpVolumeSlider" type="range" min="0" max="1" step="0.05" value="1" style="width:70px;height:4px;cursor:pointer;accent-color:var(--accent,#e50914);">
          </div>

          <div id="vpTimeDisplay" style="font-size:12px;color:rgba(255,255,255,0.85);white-space:nowrap;flex-shrink:0;">0:00 / 0:00</div>
          <div style="flex:1;"></div>

          <!-- QUALITY BUTTON -->
          <div style="position:relative;flex-shrink:0;">
            <button id="vpQualityBtn" title="Quality (Alt+1/2/3)" style="display:none;background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;transition:background 0.2s;letter-spacing:0.5px;">Auto</button>
            <div id="vpQualityMenu" style="display:none;position:absolute;bottom:36px;right:0;background:#1a1a24;border:1px solid rgba(255,255,255,0.15);border-radius:8px;overflow:hidden;min-width:110px;box-shadow:0 8px 24px rgba(0,0,0,0.7);z-index:20;"></div>
          </div>

          <!-- CC BUTTON -->
          <div style="position:relative;flex-shrink:0;">
            <button id="vpCcBtn" title="Subtitles (C)" style="display:none;background:none;border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:rgba(255,255,255,0.5);font-size:14px;font-weight:700;padding:4px 8px;border-radius:4px;transition:color 0.2s,border-color 0.2s;letter-spacing:0.5px;">CC</button>
            <div id="vpSubMenu" style="display:none;position:absolute;bottom:36px;right:0;background:#1a1a24;border:1px solid rgba(255,255,255,0.15);border-radius:8px;overflow:hidden;min-width:130px;box-shadow:0 8px 24px rgba(0,0,0,0.7);z-index:20;">
              <div id="vpSubOff" style="padding:9px 16px;font-size:13px;cursor:pointer;color:var(--accent,#e50914);font-weight:700;text-align:center;">Off</div>
            </div>
          </div>

          <!-- SPEED -->
          <div style="position:relative;flex-shrink:0;">
            <button id="vpSpeedBtn" title="Speed" style="background:rgba(255,255,255,0.1);border:1px solid rgba(255,255,255,0.2);cursor:pointer;color:#fff;font-size:11px;font-weight:700;padding:4px 10px;border-radius:4px;transition:background 0.2s;">1x</button>
            <div id="vpSpeedMenu" style="display:none;position:absolute;bottom:36px;right:0;background:#1a1a24;border:1px solid rgba(255,255,255,0.15);border-radius:8px;overflow:hidden;min-width:80px;box-shadow:0 8px 24px rgba(0,0,0,0.7);z-index:20;">
              ${[0.5,0.75,1,1.25,1.5,1.75,2].map(s=>`<div id="vpSpeed_${s.toString().replace('.','_')}" data-speed="${s}" style="padding:9px 16px;font-size:13px;cursor:pointer;color:${s===1?'var(--accent,#e50914)':'#fff'};text-align:center;font-weight:${s===1?'700':'400'};">${s}x</div>`).join('')}
            </div>
          </div>

          <button id="vpPipBtn" title="PiP (P)" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.7);font-size:18px;padding:4px 6px;line-height:1;transition:color 0.2s,transform 0.1s;flex-shrink:0;"><i class="ri-picture-in-picture-line"></i></button>
          <button id="vpTheaterBtn" title="Theater (T)" style="background:none;border:none;cursor:pointer;color:rgba(255,255,255,0.7);font-size:18px;padding:4px 6px;line-height:1;transition:color 0.2s,transform 0.1s;flex-shrink:0;"><i class="ri-layout-bottom-line"></i></button>
          <button id="vpFullscreenBtn" title="Fullscreen (F)" style="background:none;border:none;cursor:pointer;color:#fff;font-size:20px;padding:4px 6px;line-height:1;transition:transform 0.1s;flex-shrink:0;"><i class="ri-fullscreen-line"></i></button>
        </div>
      </div>

      <style>
        @keyframes vp-spin{to{transform:rotate(360deg)}}
        .vp-wrap video{width:100%;display:block;max-height:580px;background:#000;cursor:pointer}
        .vp-wrap:fullscreen video,.vp-wrap:-webkit-full-screen video{max-height:100vh;height:100vh}
        .vp-theater video{max-height:75vh!important}
        #vpProgressWrap:hover{height:6px!important}
        #vpPlayBtn:hover,#vpSkipBackBtn:hover,#vpSkipFwdBtn:hover,#vpMuteBtn:hover,
        #vpFullscreenBtn:hover,#vpPipBtn:hover,#vpTheaterBtn:hover{transform:scale(1.15)}
        #vpPipBtn:hover,#vpTheaterBtn:hover{color:#fff!important}
        #vpSpeedBtn:hover,#vpQualityBtn:hover{background:rgba(255,255,255,0.2)!important}
        #vpCcBtn:hover{color:#fff!important;border-color:#fff!important}
        #vpSubMenu div:hover,#vpSpeedMenu div:hover,
        #vpQualityMenu .vp-q-item:hover{background:rgba(255,255,255,0.1)}
        #vpSkipIntroBtn:hover{background:rgba(229,9,20,0.9)!important;
          border-color:var(--accent,#e50914)!important}
      </style>
    `);

    bindControlEvents();
    if (!document.pictureInPictureEnabled) {
      const b = document.getElementById('vpPipBtn');
      if (b) b.style.display = 'none';
    }
    setInterval(updateBuffered, 1000);
  };

  // ══════════════════════════════════════════
  // BIND EVENTS
  // ══════════════════════════════════════════
  const bindControlEvents = () => {
    const on = (id, fn) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('click', fn);
    };

    on('vpPlayBtn',       () => { const wp = video.paused; togglePlay(); showClickFeedback(wp ? '▶' : '⏸'); });
    on('vpSkipBackBtn',   () => skip(-10));
    on('vpSkipFwdBtn',    () => skip(10));
    on('vpMuteBtn',       toggleMute);
    on('vpPipBtn',        togglePiP);
    on('vpTheaterBtn',    toggleTheater);
    on('vpFullscreenBtn', toggleFullscreen);
    on('vpSpeedBtn',      toggleSpeedMenu);
    on('vpCcBtn',         toggleSubMenu);
    on('vpSkipIntroBtn',  skipIntro);
    on('vpSubOff',        () => selectSubtitle(null));
    on('vpQualityBtn',    toggleQualityMenu);
    on('vpNextEpBtn',     () => { if (typeof onNextEpisode === 'function') onNextEpisode(); });

    const slider = document.getElementById('vpVolumeSlider');
    if (slider) slider.addEventListener('input', e => setVolume(e.target.value));

    const wrap = document.getElementById('vpProgressWrap');
    if (wrap) {
      wrap.addEventListener('click', seekTo);
      wrap.addEventListener('mousemove', previewSeek);
      wrap.addEventListener('mouseleave', () => {
        const t = document.getElementById('vpTimeTooltip');
        if (t) t.style.display = 'none';
      });
    }

    const sm = document.getElementById('vpSpeedMenu');
    if (sm) sm.addEventListener('click', e => {
      const item = e.target.closest('[data-speed]');
      if (item) setSpeed(parseFloat(item.dataset.speed));
    });

    document.addEventListener('fullscreenchange',       updateFullscreenIcon);
    document.addEventListener('webkitfullscreenchange', updateFullscreenIcon);
  };

  // ══════════════════════════════════════════
  // QUALITY SELECTOR
  //
  // BUG 1 FIXED: `saved` variable was used BEFORE being declared
  //   Old code referenced `saved` inside a block, then declared it
  //   again below with `localStorage.getItem(...)` — pure syntax error
  //   causing the entire loadQualities() to crash on call.
  //
  // BUG 2 FIXED: Duplicate + conflicting quality selection logic
  //   Old code had TWO separate `if (saved && qualityMap[saved])`
  //   blocks — the second one undid the network-speed auto-selection
  //   from the first block, making it dead code.
  // ══════════════════════════════════════════
  const loadQualities = (qualities = {}) => {
    qualityMap = {};
    ['360p', '720p', '1080p'].forEach(q => {
      if (qualities[q] && String(qualities[q]).trim()) {
        qualityMap[q] = String(qualities[q]).trim();
      }
    });

    const btn  = document.getElementById('vpQualityBtn');
    const menu = document.getElementById('vpQualityMenu');
    if (!btn || !menu) return;

    const available = Object.keys(qualityMap);
    if (available.length === 0) {
      btn.style.display = 'none';
      return;
    }

    btn.style.display = '';

    // FIX: Declare `saved` FIRST before using it
    const saved = localStorage.getItem('vpQuality');

    if (saved && qualityMap[saved]) {
      // Honour saved user preference
      currentQuality = saved;
    } else {
      // Auto-pick based on network speed if available,
      // otherwise default to highest quality available
      const conn  = navigator.connection || navigator.mozConnection || {};
      const speed = conn.effectiveType || '';

      const order = ['1080p', '720p', '360p'];
      if (speed === '2g' || speed === 'slow-2g') {
        currentQuality = available.includes('360p') ? '360p'
                       : order.find(q => qualityMap[q]) || available[0];
      } else if (speed === '3g') {
        currentQuality = available.includes('720p') ? '720p'
                       : order.find(q => qualityMap[q]) || available[0];
      } else {
        // 4g / wifi / unknown — pick highest available
        currentQuality = order.find(q => qualityMap[q]) || available[0];
      }
    }

    btn.textContent = currentQuality;
    buildQualityMenu(available);
    applyQuality(currentQuality, false);
  };

  const buildQualityMenu = (available) => {
    const menu = document.getElementById('vpQualityMenu');
    if (!menu) return;

    const order  = ['1080p', '720p', '360p'];
    const sorted = order.filter(q => available.includes(q));

    const badges = {
      '1080p': '<span style="font-size:10px;background:rgba(229,9,20,0.2);color:#e50914;padding:1px 6px;border-radius:3px;margin-left:6px;">FHD</span>',
      '720p':  '<span style="font-size:10px;background:rgba(59,130,246,0.2);color:#60a5fa;padding:1px 6px;border-radius:3px;margin-left:6px;">HD</span>',
      '360p':  '<span style="font-size:10px;background:rgba(255,255,255,0.1);color:#888;padding:1px 6px;border-radius:3px;margin-left:6px;">SD</span>',
    };

    menu.innerHTML = sorted.map(q => `
      <div class="vp-q-item" data-quality="${q}" style="
        padding:10px 16px;font-size:13px;cursor:pointer;
        color:${q === currentQuality ? 'var(--accent,#e50914)' : '#fff'};
        font-weight:${q === currentQuality ? '700' : '400'};
        display:flex;align-items:center;
        border-bottom:0.5px solid rgba(255,255,255,0.06);">
        <span>${q}</span>
        ${badges[q] || ''}
        ${q === currentQuality
          ? '<i class="ri-check-line" style="margin-left:auto;font-size:14px;"></i>'
          : ''}
      </div>`).join('');

    menu.querySelectorAll('.vp-q-item').forEach(item => {
      item.addEventListener('click', () => selectQuality(item.dataset.quality));
    });
  };

  const toggleQualityMenu = () => {
    const menu = document.getElementById('vpQualityMenu');
    if (!menu) return;
    menu.style.display = menu.style.display === 'none' ? 'block' : 'none';
    if (menu.style.display === 'block') {
      setTimeout(() => {
        document.addEventListener('click', function close(e) {
          if (!e.target.closest('#vpQualityBtn') && !e.target.closest('#vpQualityMenu')) {
            menu.style.display = 'none';
            document.removeEventListener('click', close);
          }
        });
      }, 50);
    }
  };

  const selectQuality = (quality) => {
    if (quality === currentQuality) {
      const m = document.getElementById('vpQualityMenu');
      if (m) m.style.display = 'none';
      return;
    }
    applyQuality(quality, true);
  };

  // ══════════════════════════════════════════
  // APPLY QUALITY
  //
  // BUG 3 FIXED: Duplicate `loadedmetadata` listeners
  //   Old code added the restore-time listener TWICE —
  //   once inside `if (video.src !== newSrc)` and AGAIN
  //   unconditionally right after. This caused the video to
  //   jump to savedTime twice, sometimes to wrong position.
  //   Also caused memory leak — listeners never removed cleanly.
  //
  //   Fixed: Single listener, only added when src actually changes.
  // ══════════════════════════════════════════
  const applyQuality = (quality, announce = true) => {
    // Fallback if selected quality not in map
    if (!qualityMap[quality]) {
      const fallback = ['1080p', '720p', '360p'].find(q => qualityMap[q]);
      if (!fallback) return;
      quality = fallback;
    }

    const savedTime = video ? video.currentTime : 0;
    const wasPaused = video ? video.paused       : true;
    currentQuality  = quality;

    const btn = document.getElementById('vpQualityBtn');
    if (btn) btn.textContent = quality;

    buildQualityMenu(Object.keys(qualityMap));

    const menu = document.getElementById('vpQualityMenu');
    if (menu) menu.style.display = 'none';

    if (!video) return;

    const newSrc = qualityMap[quality];

    // FIX: Only swap source if it actually changed
    // Old code always replaced src and added two listeners
    if (video.src !== newSrc) {
      video.pause();
      video.src = newSrc;

      // FIX: Single listener — restores position after src swap
      video.addEventListener('loadedmetadata', function restoreTime() {
        video.currentTime = savedTime;
        if (!wasPaused) video.play().catch(() => {});
        video.removeEventListener('loadedmetadata', restoreTime);
      });
    }

    localStorage.setItem('vpQuality', quality);
    if (announce) showClickFeedback(quality);
  };

  const getCurrentQuality = () => currentQuality;
  const getQualityMap     = () => ({ ...qualityMap });

  // ══════════════════════════════════════════
  // PLAY / PAUSE
  // ══════════════════════════════════════════
  const togglePlay = () => {
    if (!video) return;
    video.paused ? video.play() : video.pause();
  };

  const updatePlayPauseBtn = (isPlaying) => {
    const btn = document.getElementById('vpPlayBtn');
    if (!btn) return;
    btn.innerHTML = isPlaying
      ? '<i class="ri-pause-fill"></i>'
      : '<i class="ri-play-fill"></i>';
  };

  // ══════════════════════════════════════════
  // SKIP / SEEK
  // ══════════════════════════════════════════
  const skip = (s) => {
    if (!video || !isFinite(video.duration)) return;
    video.currentTime = Math.max(0, Math.min(video.duration, video.currentTime + s));
    showClickFeedback(s > 0 ? `+${s}s` : `${s}s`);
  };

  const seekTo = (e) => {
    if (!video || !isFinite(video.duration)) return;
    const wrap = document.getElementById('vpProgressWrap');
    const rect = wrap.getBoundingClientRect();
    video.currentTime = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * video.duration;
  };

  const previewSeek = (e) => {
    if (!video || !isFinite(video.duration)) return;
    const wrap = document.getElementById('vpProgressWrap');
    const tt   = document.getElementById('vpTimeTooltip');
    if (!wrap || !tt) return;
    const rect = wrap.getBoundingClientRect();
    const pct  = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    tt.textContent   = formatTime(pct * video.duration);
    tt.style.left    = `${pct * 100}%`;
    tt.style.display = 'block';
  };

  const onTimeUpdate = () => {
    if (!video || !isFinite(video.duration)) return;
    const bar = document.getElementById('vpProgressBar');
    if (bar) bar.style.width = `${(video.currentTime / video.duration) * 100}%`;
    updateTimeDisplay();
    const si = document.getElementById('vpSkipIntro');
    if (si) si.style.display = (video.currentTime >= 5 && video.currentTime <= 90) ? 'block' : 'none';
    if (currentContentId) {
      clearTimeout(progressSaveTimer);
      progressSaveTimer = setTimeout(saveProgress, 5000);
    }
  };

  const updateBuffered = () => {
    if (!video || !video.buffered.length || !isFinite(video.duration)) return;
    const buf = document.getElementById('vpBufferedBar');
    if (!buf) return;
    buf.style.width = `${(video.buffered.end(video.buffered.length - 1) / video.duration) * 100}%`;
  };

  const updateDuration    = () => updateTimeDisplay();
  const updateTimeDisplay = () => {
    const el = document.getElementById('vpTimeDisplay');
    if (!el || !video) return;
    el.textContent = `${formatTime(video.currentTime)} / ${formatTime(video.duration || 0)}`;
  };

  // ══════════════════════════════════════════
  // RESUME PLAYBACK
  // ══════════════════════════════════════════
  const saveProgress = () => {
    if (!currentContentId || !video || !isFinite(video.duration)) return;
    if (video.currentTime < 5) return;
    if (video.currentTime > video.duration - 10) {
      localStorage.removeItem(`vp_progress_${currentContentId}`);
      return;
    }
    localStorage.setItem(`vp_progress_${currentContentId}`, video.currentTime.toFixed(1));
  };

  const restoreProgress = () => {
    if (!currentContentId || !video) return;
    const saved = localStorage.getItem(`vp_progress_${currentContentId}`);
    if (!saved) return;
    const t = parseFloat(saved);
    if (t > 10 && isFinite(video.duration) && t < video.duration - 10) {
      video.currentTime = t;
      if (typeof showToast === 'function') showToast(`▶ Resumed from ${formatTime(t)}`, 'info');
    }
  };

  // ══════════════════════════════════════════
  // SUBTITLES
  // ══════════════════════════════════════════
  const loadSubtitles = (subs = []) => {
    subtitleTracks = subs;
    Array.from(video.querySelectorAll('track')).forEach(t => t.remove());
    const ccBtn = document.getElementById('vpCcBtn');
    if (!subs || subs.length === 0) { if (ccBtn) ccBtn.style.display = 'none'; return; }
    if (ccBtn) ccBtn.style.display = '';
    subs.forEach(sub => {
      const t   = document.createElement('track');
      t.kind    = 'subtitles';
      t.label   = sub.label || sub.language;
      t.srclang = getLangCode(sub.language);
      t.src     = sub.url;
      if (sub.default) t.default = true;
      video.appendChild(t);
    });
    Array.from(video.textTracks).forEach(t => { t.mode = 'hidden'; });
    const def = subs.find(s => s.default);
    if (def) {
      const mt = Array.from(video.textTracks).find(t => t.language === getLangCode(def.language));
      if (mt) { mt.mode = 'showing'; activateCcBtn(true); }
    }
    buildSubMenu(subs);
  };

  const buildSubMenu = (subs) => {
    const menu = document.getElementById('vpSubMenu');
    if (!menu) return;
    const off = document.getElementById('vpSubOff');
    menu.innerHTML = '';
    if (off) menu.appendChild(off);
    subs.forEach(sub => {
      const div       = document.createElement('div');
      div.dataset.lang  = getLangCode(sub.language);
      div.textContent   = sub.label || sub.language;
      div.style.cssText = 'padding:9px 16px;font-size:13px;cursor:pointer;color:#fff;text-align:center;';
      div.addEventListener('click', () => selectSubtitle(div.dataset.lang));
      menu.appendChild(div);
    });
  };

  const toggleSubMenu = () => {
    const m = document.getElementById('vpSubMenu');
    if (!m) return;
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
    if (m.style.display === 'block') {
      setTimeout(() => {
        document.addEventListener('click', function c(e) {
          if (!e.target.closest('#vpCcBtn') && !e.target.closest('#vpSubMenu')) {
            m.style.display = 'none';
            document.removeEventListener('click', c);
          }
        });
      }, 50);
    }
  };

  const selectSubtitle = (lang) => {
    Array.from(video.textTracks).forEach(t => {
      t.mode = (lang && t.language === lang) ? 'showing' : 'hidden';
    });
    activateCcBtn(!!lang);
    const m   = document.getElementById('vpSubMenu'); if (m) m.style.display = 'none';
    const off = document.getElementById('vpSubOff');
    if (off) { off.style.color = !lang ? 'var(--accent,#e50914)' : '#fff'; off.style.fontWeight = !lang ? '700' : '400'; }
    showClickFeedback(lang ? 'CC' : 'CC ✕');
  };

  const activateCcBtn = (active) => {
    const btn = document.getElementById('vpCcBtn'); if (!btn) return;
    btn.style.color       = active ? '#fff'                   : 'rgba(255,255,255,0.5)';
    btn.style.borderColor = active ? 'rgba(255,255,255,0.8)' : 'rgba(255,255,255,0.2)';
    btn.style.background  = active ? 'rgba(229,9,20,0.4)'    : 'none';
  };

  const getLangCode = (l) => (
    { English:'en', Hindi:'hi', Japanese:'ja', Korean:'ko',
      Spanish:'es', French:'fr', Arabic:'ar', German:'de', Portuguese:'pt' }[l] || 'en'
  );

  // ══════════════════════════════════════════
  // VOLUME
  // ══════════════════════════════════════════
  const setVolume = (val) => {
    if (!video) return;
    const v   = parseFloat(val);
    video.volume = v;
    video.muted  = v === 0;
    const s = document.getElementById('vpVolumeSlider');
    if (s) s.value = v;
    localStorage.setItem('vpVolume', v);
  };

  const toggleMute = () => {
    if (!video) return;
    video.muted = !video.muted;
    const s = document.getElementById('vpVolumeSlider');
    if (s) s.value = video.muted ? 0 : video.volume;
  };

  const updateVolumeUI = () => {
    const btn = document.getElementById('vpMuteBtn');
    const s   = document.getElementById('vpVolumeSlider');
    if (!btn || !video) return;
    const v = video.muted ? 0 : video.volume;
    if (s) s.value = v;
    btn.innerHTML = v === 0 || video.muted
      ? '<i class="ri-volume-mute-line"></i>'
      : v < 0.5
        ? '<i class="ri-volume-down-line"></i>'
        : '<i class="ri-volume-up-line"></i>';
  };

  const restoreVolume = () => {
    const saved = localStorage.getItem('vpVolume');
    if (saved !== null && video) {
      video.volume = parseFloat(saved);
      const s = document.getElementById('vpVolumeSlider');
      if (s) s.value = saved;
    }
  };

  // ══════════════════════════════════════════
  // SPEED
  // ══════════════════════════════════════════
  const toggleSpeedMenu = () => {
    const m = document.getElementById('vpSpeedMenu');
    if (!m) return;
    m.style.display = m.style.display === 'none' ? 'block' : 'none';
    if (m.style.display === 'block') {
      setTimeout(() => {
        document.addEventListener('click', function c(e) {
          if (!e.target.closest('#vpSpeedBtn') && !e.target.closest('#vpSpeedMenu')) {
            m.style.display = 'none';
            document.removeEventListener('click', c);
          }
        });
      }, 50);
    }
  };

  const setSpeed = (speed) => {
    if (!video) return;
    video.playbackRate = speed;
    const btn = document.getElementById('vpSpeedBtn');
    if (btn) btn.textContent = `${speed}x`;
    const m = document.getElementById('vpSpeedMenu');
    if (m) m.style.display = 'none';
    [0.5,0.75,1,1.25,1.5,1.75,2].forEach(s => {
      const el = document.getElementById(`vpSpeed_${s.toString().replace('.','_')}`);
      if (el) {
        el.style.color      = s === speed ? 'var(--accent,#e50914)' : '#fff';
        el.style.fontWeight = s === speed ? '700' : '400';
      }
    });
    showClickFeedback(`${speed}x`);
  };

  // ══════════════════════════════════════════
  // PiP / THEATER / FULLSCREEN
  // ══════════════════════════════════════════
  const togglePiP = async () => {
    if (!video) return;
    try {
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else await video.requestPictureInPicture();
    } catch (e) {}
  };

  const toggleTheater = () => {
    if (!container) return;
    isTheater = !isTheater;
    const btn = document.getElementById('vpTheaterBtn');
    const sec = document.getElementById('playerSection');
    if (isTheater) {
      container.classList.add('vp-theater');
      if (sec) { sec.style.maxWidth = '100%'; sec.style.padding = '0'; }
      if (btn) btn.innerHTML = '<i class="ri-layout-bottom-2-line"></i>';
      if (typeof showToast === 'function') showToast('Theater mode · T to exit', 'info');
    } else {
      container.classList.remove('vp-theater');
      if (sec) { sec.style.maxWidth = ''; sec.style.padding = ''; }
      if (btn) btn.innerHTML = '<i class="ri-layout-bottom-line"></i>';
    }
  };

  const toggleFullscreen = () => {
    if (!container) return;
    if (!document.fullscreenElement)
      (container.requestFullscreen || container.webkitRequestFullscreen).call(container).catch(() => {});
    else
      document.exitFullscreen();
  };

  const updateFullscreenIcon = () => {
    const btn = document.getElementById('vpFullscreenBtn'); if (!btn) return;
    btn.innerHTML = document.fullscreenElement
      ? '<i class="ri-fullscreen-exit-line"></i>'
      : '<i class="ri-fullscreen-line"></i>';
  };

  // ══════════════════════════════════════════
  // SKIP INTRO / NEXT EP / ENDED
  // ══════════════════════════════════════════
  const skipIntro = () => {
    if (!video) return;
    video.currentTime = 90;
    const el = document.getElementById('vpSkipIntro');
    if (el) el.style.display = 'none';
    showClickFeedback('Skipped');
  };

  const showNextEpisodeBtn = (show = true) => {
    const el = document.getElementById('vpNextEp');
    if (el) el.style.display = show ? 'block' : 'none';
  };

  const onVideoEnded = () => {
    updatePlayPauseBtn(false);
    showClickFeedback('↩');
    if (currentContentId) localStorage.removeItem(`vp_progress_${currentContentId}`);
    if (typeof onNextEpisode === 'function') showNextEpisodeBtn(true);
  };

  // ══════════════════════════════════════════
  // KEYBOARD — Alt+1/2/3 for quality
  // ══════════════════════════════════════════
  const bindKeyboard = () => {
    document.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT'    ||
          e.target.tagName === 'TEXTAREA' ||
          e.target.tagName === 'SELECT'   ||
          e.target.isContentEditable) return;
      if (!video) return;

      switch (e.code) {
        case 'Space': case 'KeyK': {
          e.preventDefault();
          const wp = video.paused; togglePlay(); showClickFeedback(wp ? '▶' : '⏸');
          break;
        }
        case 'ArrowLeft':  e.preventDefault(); skip(-10); break;
        case 'ArrowRight': e.preventDefault(); skip(10);  break;
        case 'ArrowUp': {
          e.preventDefault();
          const nv = Math.min(1, video.volume + 0.1);
          setVolume(nv.toFixed(2)); showClickFeedback(`🔊 ${Math.round(nv * 100)}%`);
          break;
        }
        case 'ArrowDown': {
          e.preventDefault();
          const nv = Math.max(0, video.volume - 0.1);
          setVolume(nv.toFixed(2)); showClickFeedback(`🔊 ${Math.round(nv * 100)}%`);
          break;
        }
        case 'KeyM': e.preventDefault(); toggleMute(); showClickFeedback(video.muted ? '🔇' : '🔊'); break;
        case 'KeyF': e.preventDefault(); toggleFullscreen(); break;
        case 'KeyT': e.preventDefault(); toggleTheater();    break;
        case 'KeyP': e.preventDefault(); togglePiP();        break;
        case 'KeyC': e.preventDefault(); toggleSubMenu();    break;
        case 'Digit1':
          if (e.altKey) { e.preventDefault(); if (qualityMap['360p'])  selectQuality('360p');  }
          else if (isFinite(video.duration)) video.currentTime = 0;
          break;
        case 'Digit2':
          if (e.altKey) { e.preventDefault(); if (qualityMap['720p'])  selectQuality('720p');  }
          else if (isFinite(video.duration)) video.currentTime = video.duration * 0.2;
          break;
        case 'Digit3':
          if (e.altKey) { e.preventDefault(); if (qualityMap['1080p']) selectQuality('1080p'); }
          else if (isFinite(video.duration)) video.currentTime = video.duration * 0.3;
          break;
        case 'Digit4': if (isFinite(video.duration)) video.currentTime = video.duration * 0.4; break;
        case 'Digit5': if (isFinite(video.duration)) video.currentTime = video.duration * 0.5; break;
        case 'Digit6': if (isFinite(video.duration)) video.currentTime = video.duration * 0.6; break;
        case 'Digit7': if (isFinite(video.duration)) video.currentTime = video.duration * 0.7; break;
        case 'Digit8': if (isFinite(video.duration)) video.currentTime = video.duration * 0.8; break;
        case 'Digit9': if (isFinite(video.duration)) video.currentTime = video.duration * 0.9; break;
        case 'Digit0': if (isFinite(video.duration)) video.currentTime = 0; break;
      }
    });
  };

  // ══════════════════════════════════════════
  // MOBILE GESTURES
  // ══════════════════════════════════════════
  const bindMobileGestures = () => {
    if (!isMobile) return;
    let tapTimer = null;
    let tapCount = 0;
    container.addEventListener('touchend', (e) => {
      if (e.target.closest('#vpControls')) return;
      const touch = e.changedTouches[0];
      const side  = touch.clientX < container.offsetWidth / 2 ? 'left' : 'right';
      tapCount++;
      if (tapCount === 1) {
        tapTimer = setTimeout(() => {
          tapCount = 0;
          const wp = video.paused; togglePlay(); showClickFeedback(wp ? '▶' : '⏸');
        }, 250);
      } else if (tapCount >= 2) {
        clearTimeout(tapTimer);
        tapCount = 0;
        if (side === 'left') { skip(-10); flashSeekIndicator('vpSeekLeft');  }
        else                 { skip(10);  flashSeekIndicator('vpSeekRight'); }
      }
    });
  };

  // ══════════════════════════════════════════
  // SHOW / HIDE CONTROLS
  // ══════════════════════════════════════════
  const showControls = () => {
    const c = document.getElementById('vpControls');
    if (c) c.style.opacity = '1';
    container.style.cursor = 'default';
    clearTimeout(hideTimer);
    scheduleHide(3000);
  };

  const scheduleHide = (ms) => {
    clearTimeout(hideTimer);
    if (!video || video.paused) return;
    hideTimer = setTimeout(() => {
      const c = document.getElementById('vpControls');
      if (c) c.style.opacity = '0';
      container.style.cursor = 'none';
    }, ms);
  };

  // ══════════════════════════════════════════
  // HELPERS
  // ══════════════════════════════════════════
  const showBuffering = (show) => {
    const el = document.getElementById('vpBuffering');
    if (el) el.style.display = show ? 'flex' : 'none';
  };

  const showClickFeedback = (icon) => {
    const el = document.getElementById('vpClickFeedback');
    if (!el) return;
    el.textContent     = icon;
    el.style.opacity   = '1';
    el.style.transform = 'translate(-50%,-50%) scale(1)';
    setTimeout(() => { el.style.opacity = '0'; el.style.transform = 'translate(-50%,-50%) scale(1.4)'; }, 400);
    setTimeout(() => { el.style.transform = 'translate(-50%,-50%) scale(0)'; }, 700);
  };

  const flashSeekIndicator = (id) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.style.opacity = '1';
    setTimeout(() => { el.style.opacity = '0'; }, 600);
  };

  const formatTime = (s) => {
    if (!isFinite(s) || isNaN(s)) return '0:00';
    const h   = Math.floor(s / 3600);
    const m   = Math.floor((s % 3600) / 60);
    const sec = Math.floor(s % 60);
    return h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(sec).padStart(2,'0')}`
      : `${m}:${String(sec).padStart(2,'0')}`;
  };

  const showShortcuts = () => {
    if (typeof showToast === 'function') {
      showToast('Space=Play · ←→=Seek · ↑↓=Vol · M=Mute · C=CC · F=Full · T=Theater · Alt+1/2/3=Quality', 'info');
    }
  };

  // ══════════════════════════════════════════
  // PUBLIC API
  // ══════════════════════════════════════════
  return {
    init, togglePlay, skip, seekTo, previewSeek,
    setVolume, toggleMute, setSpeed, toggleSpeedMenu,
    togglePiP, toggleTheater, toggleFullscreen,
    skipIntro, showShortcuts,
    loadSubtitles,
    loadQualities,
    getCurrentQuality,
    getQualityMap,
    showNextEpisodeBtn,
    saveProgress, restoreProgress, formatTime,
  };

})();
