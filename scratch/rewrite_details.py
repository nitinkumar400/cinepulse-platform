import re

filepath = "c:\\Users\\NITIN MISHRA\\Workspace\\01_Development\\Active\\cine-stream-platform-main.zip\\public\\pages\\movie-details.html"

with open(filepath, "r", encoding="utf-8") as f:
    content = f.read()

# We want to replace the entire <div id="movieContent" ...> up to <div class="recommendations-section" ...>

new_structure = """<div id="movieContent" style="display:none; padding-top: var(--nav-height);">
  <div class="details-bg" id="detailsBg"></div>

  <div class="cinema-layout" style="position:relative; z-index:2; display:flex; max-width:1400px; margin:0 auto; padding: 40px 4% 60px; gap: 30px; align-items: flex-start; flex-wrap: wrap;">
    <!-- LEFT 70% -->
    <div class="cinema-left" style="flex: 1 1 65%; min-width: 320px;">
      
      <!-- PLAYER -->
      <div class="video-section" id="playerSection" style="padding: 0; background: none;">
        <div id="loginGate" style="display:none;"></div>
        <div id="videoContainer" class="player-shell">
          <div class="player-topbar">
            <div class="player-status" id="playerStatus">Preparing stream…</div>
            <button id="adminDeleteMovieBtn" class="btn btn-danger" style="display:none;padding:6px 12px;font-size:12px;">
              <i class="ri-delete-bin-line"></i> Delete Movie
            </button>
          </div>
          <div class="player-viewport">
            <div id="playerLoader" class="player-loader">
              <div class="player-loader-spinner"></div>
              <div class="player-loader-text">Loading stream…</div>
            </div>
            <div id="playerMessage" class="player-overlay-message"></div>
            <div id="nativePlayerShell" class="player-stage is-active">
              <video id="videoPlayer" preload="metadata" playsinline style="width:100%;display:block;height:100%;background:#000;">
                Your browser does not support video.
              </video>
            </div>
            <div id="popupPlayerShell" class="player-stage" style="display:none;opacity:1;pointer-events:auto;">
              <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100%;gap:20px;background:linear-gradient(135deg,#0f172a,#1e293b);border-radius:12px;">
                <div style="text-align:center;color:#94a3b8;">
                  <i class="ri-video-line" style="font-size:64px;color:#dc2626;margin-bottom:16px;display:block;"></i>
                  <p style="margin:0;font-size:18px;color:#f8fafc;font-weight:600;">Ready to play</p>
                  <p style="margin:8px 0 0;font-size:14px;opacity:0.7;">Opens in secure popup window</p>
                </div>
                <button id="btnWatchPopupMain" style="padding:16px 40px;background:linear-gradient(135deg,#dc2626,#b91c1c);color:white;border:none;border-radius:10px;font-size:18px;font-weight:600;cursor:pointer;display:flex;align-items:center;gap:10px;box-shadow:0 6px 20px rgba(220,38,38,0.3);transition:transform 0.2s,box-shadow 0.2s;" onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
                  <i class="ri-play-fill" style="font-size:24px;"></i> Watch Now
                </button>
              </div>
            </div>
            <div id="embedShell" class="player-embed-shell" style="display:none;">
              <div id="embedPlayerHost" class="player-embed">
                <iframe id="embedFrame" title="CINE STREAM Player" referrerpolicy="no-referrer" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share; fullscreen" allowfullscreen></iframe>
              </div>
            </div>
          </div>
        </div>

        <div style="max-width:980px;margin:12px auto 0;display:flex;align-items:center;justify-content:space-between;flex-wrap:wrap;gap:12px;">
          <span id="playerTitle" style="font-size:15px;font-weight:600;color:var(--text-primary);"></span>
          <div style="display:flex;align-items:center;gap:16px;flex-wrap:wrap;">
            <div id="shareUnlockWrap" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;">
              <button id="shareWhatsappBtn" class="btn-nav" style="padding:6px 10px;font-size:12px;"><i class="ri-whatsapp-line"></i> Share WhatsApp</button>
              <button id="shareTelegramBtn" class="btn-nav" style="padding:6px 10px;font-size:12px;"><i class="ri-telegram-line"></i> Share Telegram</button>
              <span id="unlockHint" style="font-size:11px;color:var(--text-muted);">Share to unlock High-Speed Server 1</span>
            </div>
            <div class="rating-wrapper" id="ratingWrapper" style="display:none;">
              <span class="rating-label">Rate:</span>
              <div id="ratingStars"></div>
            </div>
            <button id="shortcutsBtn" style="background:none;border:1px solid var(--border);border-radius:var(--radius);color:var(--text-muted);font-size:12px;padding:5px 12px;cursor:pointer;transition:var(--transition);"><i class="ri-keyboard-line"></i> Shortcuts</button>
          </div>
        </div>
      </div>

      <!-- TITLE & META -->
      <div class="details-info" style="margin-top: 24px;">
        <span class="category-tag" id="movieCategory"></span>
        <h1 class="details-title" id="movieTitle" style="font-size: clamp(32px, 5vw, 48px); margin-bottom: 12px;"></h1>
        <div class="details-meta" style="margin-bottom: 16px;">
          <span class="star-rating" id="movieRating">⭐ —</span><span class="separator">•</span>
          <span id="movieYear"></span><span class="separator">•</span>
          <span id="movieDuration"></span><span class="separator">•</span>
          <span id="movieAgeRating" style="background:rgba(255,255,255,0.1);padding:2px 10px;border-radius:4px;font-size:12px;"></span>
          <span id="movieStatusBadge" style="display:none;padding:2px 10px;border-radius:4px;font-size:12px;font-weight:600;"></span>
        </div>
        <div class="details-genres" id="movieGenres"></div>
        <p id="movieDesc" style="font-size:15px;line-height:1.8;color:var(--text-secondary);margin-bottom:28px;max-width:800px;"></p>
        <div class="details-actions">
          <button class="btn btn-primary" id="watchNowBtn" style="display:none;"><i class="ri-play-fill"></i> Watch Now</button>
          <button class="btn btn-secondary" id="watchlistBtn"><i class="ri-add-line"></i> My List</button>
          <button class="btn trailer-btn" id="trailerBtn" style="display:none;"><i class="ri-film-line"></i> Trailer</button>
          <button class="btn btn-outline" id="shareBtn"><i class="ri-share-line"></i> Share</button>
        </div>
      </div>

      <!-- DETAILS TABLE -->
      <div class="details-section" style="padding: 40px 0 0;">
        <div class="details-table" style="margin-top:0;">
          <div><div class="detail-item-label">Director</div><div class="detail-item-value" id="detailDirector">—</div></div>
          <div><div class="detail-item-label">Studio</div><div class="detail-item-value" id="detailStudio">—</div></div>
          <div><div class="detail-item-label">Language</div><div class="detail-item-value" id="detailLanguage">—</div></div>
          <div><div class="detail-item-label">Views</div><div class="detail-item-value" id="detailViews">—</div></div>
          <div><div class="detail-item-label">Release Year</div><div class="detail-item-value" id="detailYear">—</div></div>
          <div><div class="detail-item-label">Age Rating</div><div class="detail-item-value" id="detailRating">—</div></div>
          <div id="detailStatusWrap" style="display:none;"><div class="detail-item-label">Status</div><div class="detail-item-value" id="detailStatus">—</div></div>
          <div id="detailEpisodesWrap" style="display:none;"><div class="detail-item-label">Episodes</div><div class="detail-item-value" id="detailEpisodes">—</div></div>
        </div>
        <div id="castSection" style="display:none;margin-top:28px;">
          <h3 style="font-size:16px;font-weight:600;color:var(--text-secondary);margin-bottom:14px;text-transform:uppercase;letter-spacing:1px;">Cast</h3>
          <div id="castList" style="display:flex;flex-wrap:wrap;gap:10px;"></div>
        </div>
      </div>
      
    </div>

    <!-- RIGHT 30% -->
    <div class="cinema-right" style="flex: 0 0 30%; min-width: 300px; position: sticky; top: calc(var(--nav-height) + 20px);">
      <!-- POSTER (Hidden on mobile) -->
      <div class="details-poster" style="display:none; margin-bottom: 24px;">
        <img id="moviePoster" src="" alt="Poster" loading="eager" style="border-radius: var(--radius-lg); width: 100%; box-shadow: 0 20px 40px rgba(0,0,0,0.6);">
      </div>

      <!-- SERVER SWITCHER -->
      <div class="server-switcher" id="serverSwitcher" style="display:none; margin-bottom: 24px; background: var(--bg-secondary); padding: 16px; border-radius: var(--radius-lg); border: 1px solid var(--border); flex-direction: column; align-items: stretch;">
        <label style="display:block; margin-bottom: 12px; font-weight: 700; color: #fff; font-size: 13px; letter-spacing: 1px;">SERVERS</label>
        <div id="serverButtons" style="display:flex;flex-direction:column;gap:8px;"></div>
      </div>

      <!-- EPISODES -->
      <div class="episodes-section" id="episodesSection" style="display:none; padding: 0;">
        <div class="episodes-header" style="margin-bottom: 16px; flex-direction: column; align-items: stretch;">
          <h2 class="episodes-title" style="font-size: 18px; margin-bottom: 12px;">Episodes</h2>
          <div id="episodeSeasonTabs" style="display:flex;gap:8px;flex-wrap:wrap;"></div>
        </div>
        <div class="episodes-grid" id="episodesGrid" style="grid-template-columns: 1fr; max-height: 500px; overflow-y: auto; padding-right: 8px;">
          <div class="spinner-container" style="grid-column:1/-1;"><div class="spinner"></div></div>
        </div>
      </div>
    </div>
  </div>
</div>
"""

start_marker = '<div id="movieContent"'
end_marker = '<div class="recommendations-section"'

start_idx = content.find(start_marker)
end_idx = content.find(end_marker)

if start_idx != -1 and end_idx != -1:
    new_content = content[:start_idx] + new_structure + "\n  " + content[end_idx:]
    with open(filepath, "w", encoding="utf-8") as f:
        f.write(new_content)
    print("Successfully replaced movieContent structure.")
else:
    print("Could not find markers.")
