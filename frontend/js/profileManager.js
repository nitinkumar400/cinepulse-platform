(function () {
  const AVATAR_COLORS = [
    '#e50914', '#f97316', '#f59e0b', '#10b981',
    '#3b82f6', '#8b5cf6', '#ec4899', '#06b6d4',
    '#84cc16', '#6366f1', '#f43f5e', '#14b8a6',
  ];

  const POSTER_PLACEHOLDER = 'data:image/svg+xml;base64,PHN2ZyB3aWR0aD0iODAiIGhlaWdodD0iMTEwIiB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciPjxyZWN0IHdpZHRoPSIxMDAlIiBoZWlnaHQ9IjEwMCUiIGZpbGw9IiMxYTFhMjQiLz48dGV4dCB4PSI1MCUiIHk9IjUwJSIgZm9udC1zaXplPSIyNCIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZHk9Ii4zZW0iIGZpbGw9IiM0NDQiPvCfjpg8L3RleHQ+PC9zdmc+';

  let currentUser = null;

  window.addEventListener('DOMContentLoaded', async () => {
    if (!getToken() || !getUser()) {
      window.location.href = '/login';
      return;
    }

    setupEventListeners();
    await hydrateProfile();
  });

  async function hydrateProfile() {
    try {
      const res = await apiFetch('/users/me');
      const payload = await readJsonResponse(res);
      currentUser = payload.user || null;

      if (!currentUser) {
        throw new Error('User data missing');
      }

      localStorage.setItem('user', JSON.stringify(currentUser));
      renderNavbar();
      renderProfileHeader(currentUser);
      renderStats(currentUser);
      renderWatchHistory(currentUser.watched || []);
      renderWatchlist(currentUser.watchlist || []);
      buildAvatarStudio();
      populateSettings(currentUser);
    } catch (error) {
      showToast('Failed to load profile', 'error');
    }
  }

  function setupEventListeners() {
    document.querySelectorAll('.ptab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.tab, btn));
    });

    document.getElementById('avatarEditBtn')?.addEventListener('click', () => {
      const studio = document.getElementById('avatarColorPicker');
      if (!studio) return;
      studio.style.display = studio.style.display === 'block' ? 'none' : 'block';
    });

    document.getElementById('closeColorPicker')?.addEventListener('click', () => {
      document.getElementById('avatarColorPicker').style.display = 'none';
    });

    document.getElementById('saveProfileBtn')?.addEventListener('click', saveProfile);
    document.getElementById('changePasswordBtn')?.addEventListener('click', changePassword);
    document.getElementById('securityLogoutBtn')?.addEventListener('click', handleLogout);
    document.getElementById('installAppBtn')?.addEventListener('click', () => {
      if (typeof PWAManager !== 'undefined') PWAManager.showInstallBanner();
    });

    setupPasswordToggle('currentPassword', 'toggleCurrent');
    setupPasswordToggle('newPassword', 'toggleNew');
  }

  function renderNavbar() {
    const sec = document.getElementById('userSection');
    if (!sec || !currentUser) return;

    const avatarImage = typeof resolveAvatarImage === 'function' ? resolveAvatarImage(currentUser.avatar || '') : '';
    const avatarMarkup = avatarImage
      ? `<span style="width:38px;height:38px;border-radius:50%;overflow:hidden;display:inline-flex;align-items:center;justify-content:center;border:2px solid rgba(229,9,20,0.24);box-shadow:0 0 0 1px rgba(255,255,255,0.04);"><img src="${avatarImage}" alt="Avatar" style="width:100%;height:100%;object-fit:cover;" referrerpolicy="no-referrer"></span>`
      : `<span style="width:38px;height:38px;border-radius:50%;display:inline-flex;align-items:center;justify-content:center;background:${(currentUser.avatar || '').startsWith('#') ? `linear-gradient(135deg, ${currentUser.avatar} 0%, #111827 100%)` : 'linear-gradient(135deg,#ef4444 0%,#7c3aed 100%)'};font-weight:700;color:#fff;">${escapeHtml((currentUser.username || 'U').slice(0, 1).toUpperCase())}</span>`;

    sec.innerHTML = `
      ${avatarMarkup}
      <span style="font-size:13px;color:var(--text-secondary);">Hi, ${escapeHtml(currentUser.username || 'User')}</span>
      ${currentUser.role === 'admin'
        ? `<a href="admin.html"><button class="btn-nav" style="margin-left:10px;"><i class="ri-upload-cloud-line"></i> Upload</button></a>`
        : ''}
      <button id="navLogoutBtn" class="btn-nav" style="background:var(--bg-card);color:var(--text-secondary);margin-left:10px;">Logout</button>`;

    document.getElementById('navLogoutBtn')?.addEventListener('click', handleLogout);
  }

  function renderProfileHeader(user) {
    document.getElementById('profileUsername').textContent = user.username || 'User';
    document.getElementById('profileEmail').textContent = user.email || '-';

    const roleBadge = document.getElementById('roleBadge');
    roleBadge.textContent = user.role === 'admin' ? 'Admin' : 'Member';
    roleBadge.className = `profile-badge ${user.role === 'admin' ? 'badge-admin' : 'badge-user'}`;

    document.getElementById('verifiedBadge').style.display = user.isVerified ? 'inline-flex' : 'none';

    if (user.createdAt) {
      const joined = new Date(user.createdAt).toLocaleDateString('en-US', {
        month: 'long',
        day: 'numeric',
        year: 'numeric',
      });
      document.getElementById('profileJoined').textContent = `Member since ${joined}`;
    }

    applyProfileBackdrop(user);
    setAvatarDisplay(user.avatar || user.avatarColor || '', user.username || 'U');
  }

  function renderStats(user) {
    const watchedCount = Array.isArray(user.watched) ? user.watched.length : (user.counts?.watched || 0);
    const completedCount = Array.isArray(user.completed) ? user.completed.length : (user.counts?.completed || 0);
    const watchlistCount = Array.isArray(user.watchlist) ? user.watchlist.length : (user.counts?.watchlist || 0);
    const reviewCount = user.counts?.reviews || 0;

    document.getElementById('pstatWatched').textContent = watchedCount;
    document.getElementById('pstatCompleted').textContent = completedCount;
    document.getElementById('pstatWatchlist').textContent = watchlistCount;
    document.getElementById('pstatReviews').textContent = reviewCount;
  }

  function populateSettings(user) {
    document.getElementById('settingsUsername').value = user.username || '';
    document.getElementById('settingsEmail').value = user.email || '';
  }

  function setAvatarDisplay(avatarValue, username) {
    const el = document.getElementById('profileAvatarDisplay');
    if (!el) return;

    const resolvedAvatar = String(avatarValue || '').trim();
    const imageUrl = typeof resolveAvatarImage === 'function' ? resolveAvatarImage(resolvedAvatar) : '';

    el.innerHTML = '';
    el.removeAttribute('style');

    if (imageUrl) {
      el.innerHTML = `<img src="${imageUrl}" alt="Avatar" referrerpolicy="no-referrer">`;
      return;
    }

    const gradient = resolvedAvatar || 'linear-gradient(135deg, #ef4444 0%, #7c3aed 100%)';
    el.style.background = gradient.startsWith('#')
      ? `linear-gradient(135deg, ${gradient} 0%, #18181b 100%)`
      : gradient;
    el.textContent = (username || 'U').slice(0, 1).toUpperCase();
  }

  function buildAvatarStudio() {
    buildEliteAvatarGrid();
    buildAvatarColorPicker();
  }

  function buildEliteAvatarGrid() {
    const grid = document.getElementById('eliteAvatarGrid');
    if (!grid || !Array.isArray(window.CINESTREAM_ELITE_AVATARS)) return;

    grid.innerHTML = window.CINESTREAM_ELITE_AVATARS.map((avatar) => {
      const value = `elite:${avatar.id}`;
      const preview = typeof getEliteAvatarDataUrl === 'function' ? getEliteAvatarDataUrl(value) : '';
      const isSelected = currentUser?.avatar === value;

      return `
        <button type="button" class="avatar-preset-card ${isSelected ? 'selected' : ''}" data-avatar="${value}">
          <div class="avatar-preset-thumb" style="background-image:url('${preview}')"></div>
          <div class="avatar-preset-name">${escapeHtml(avatar.name)}</div>
          <div class="avatar-preset-series">${escapeHtml(avatar.series)}</div>
        </button>
      `;
    }).join('');

    grid.querySelectorAll('.avatar-preset-card').forEach((btn) => {
      btn.addEventListener('click', () => selectAvatarChoice(btn.dataset.avatar));
    });
  }

  function buildAvatarColorPicker() {
    const grid = document.getElementById('avatarColorsGrid');
    if (!grid) return;

    grid.innerHTML = AVATAR_COLORS.map((color) => `
      <button type="button" class="avatar-color-btn ${currentUser?.avatar === color ? 'selected' : ''}" style="background:${color};" data-color="${color}"></button>
    `).join('');

    grid.querySelectorAll('.avatar-color-btn').forEach((btn) => {
      btn.addEventListener('click', () => selectAvatarChoice(btn.dataset.color));
    });
  }

  function renderWatchHistory(history) {
    const container = document.getElementById('historyList');
    if (!container) return;

    const validHistory = history.filter((entry) => entry.movie);
    if (!validHistory.length) {
      applyProfileBackdrop(currentUser);
      container.innerHTML = `
        <div class="empty-state" style="background:
          linear-gradient(135deg, rgba(8,8,12,0.86), rgba(8,8,12,0.72)),
          url('https://images.unsplash.com/photo-1578632767115-351597cf2477?auto=format&fit=crop&w=1200&q=80') center/cover no-repeat;
          border-radius:22px;border:1px solid rgba(255,255,255,0.08);">
          <div class="empty-state-icon">👑</div>
          <h3>Start your journey</h3>
          <p>Build your royal watch history with your first anime or movie tonight.</p>
          <a href="index.html?category=anime" class="btn btn-primary" style="margin-top:20px;display:inline-flex;"><i class="ri-play-fill"></i> Enter Elite Anime</a>
        </div>`;
      return;
    }

    container.innerHTML = validHistory.map((entry) => {
      const movie = entry.movie;
      const progress = entry.totalDuration > 0 ? Math.min(100, Math.round((entry.progress / entry.totalDuration) * 100)) : 0;
      const watchedAt = new Date(entry.watchedAt || entry.updatedAt || Date.now()).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

      return `
        <div class="history-item" data-movie-id="${movie._id}" data-progress="${entry.progress || 0}">
          <img class="history-thumb" src="${getImageUrl(movie.thumbnailUrl) || POSTER_PLACEHOLDER}" alt="${escapeHtml(movie.title)}" referrerpolicy="no-referrer">
          <div class="history-info">
            <div class="history-title">${escapeHtml(movie.title)}</div>
            <div class="history-meta">${escapeHtml(movie.category || 'Content')} · ${watchedAt}</div>
            <div class="history-progress-bar"><div class="history-progress-fill" style="width:${progress}%;"></div></div>
            <div class="history-pct">${entry.completed ? 'Completed' : `${progress}% watched`}</div>
          </div>
          <div class="history-actions">
            <div class="history-play-btn"><i class="ri-play-fill"></i></div>
            <button class="history-remove-btn" type="button" data-movie-id="${movie._id}"><i class="ri-delete-bin-line"></i> Remove</button>
          </div>
        </div>`;
    }).join('');

    applyProfileBackdrop({
      ...currentUser,
      watched: validHistory,
    });

    if (!container.dataset.bound) {
      container.dataset.bound = 'true';
      container.addEventListener('click', async (event) => {
        const removeBtn = event.target.closest('.history-remove-btn');
        const item = event.target.closest('.history-item');

        if (removeBtn) {
          event.stopPropagation();
          await removeHistory(removeBtn.dataset.movieId);
          return;
        }

        if (item) {
          window.location.href = `movie-details.html?id=${item.dataset.movieId}&t=${item.dataset.progress || 0}`;
        }
      });
    }
  }

  function renderWatchlist(watchlist) {
    const grid = document.getElementById('watchlistGrid');
    if (!grid) return;

    if (!watchlist.length) {
      grid.innerHTML = `
        <div class="empty-state" style="grid-column:1/-1;background:
          linear-gradient(135deg, rgba(8,8,12,0.86), rgba(8,8,12,0.72)),
          url('https://images.unsplash.com/photo-1511512578047-dfb367046420?auto=format&fit=crop&w=1200&q=80') center/cover no-repeat;
          border-radius:22px;border:1px solid rgba(255,255,255,0.08);">
          <div class="empty-state-icon">🔖</div>
          <h3>Curate your royal queue</h3>
          <p>Save the titles that deserve a front-row spot in your watchlist.</p>
          <a href="index.html" class="btn btn-primary" style="margin-top:20px;display:inline-flex;"><i class="ri-add-line"></i> Start your journey</a>
        </div>`;
      return;
    }

    grid.innerHTML = watchlist.map((movie) => `
      <div class="wl-card" data-id="${movie._id}">
        <img class="wl-card-thumb" src="${getImageUrl(movie.thumbnailUrl) || POSTER_PLACEHOLDER}" alt="${escapeHtml(movie.title)}" referrerpolicy="no-referrer">
        <button type="button" class="wl-remove" data-id="${movie._id}"><i class="ri-close-line"></i></button>
        <div class="wl-card-info">
          <div class="wl-card-title">${escapeHtml(movie.title)}</div>
          <div class="wl-card-cat">${escapeHtml(movie.category || 'content')}</div>
        </div>
      </div>
    `).join('');

    if (!grid.dataset.bound) {
      grid.dataset.bound = 'true';
      grid.addEventListener('click', async (event) => {
        const removeBtn = event.target.closest('.wl-remove');
        const card = event.target.closest('.wl-card');

        if (removeBtn) {
          event.stopPropagation();
          await removeWatchlist(removeBtn.dataset.id);
          return;
        }

        if (card) {
          window.location.href = `movie-details.html?id=${card.dataset.id}`;
        }
      });
    }
  }

  async function selectAvatarChoice(avatarValue) {
    try {
      const res = await apiFetch('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ avatar: avatarValue }),
      });
      const payload = await readJsonResponse(res);
      currentUser = {
        ...currentUser,
        ...(payload.user || {}),
        avatar: avatarValue,
        avatarColor: payload.user?.avatarColor || currentUser?.avatarColor || '#e50914',
      };
      localStorage.setItem('user', JSON.stringify(currentUser));
      renderProfileHeader(currentUser);
      buildAvatarStudio();
      document.getElementById('avatarColorPicker').style.display = 'none';
      showToast('Avatar updated', 'success');
    } catch (error) {
      showToast('Failed to update avatar', 'error');
    }
  }

  async function saveProfile() {
    const username = document.getElementById('settingsUsername').value.trim();
    if (!username || username.length < 3) {
      showInlineAlert('settingsAlert', 'Username must be at least 3 characters', 'error');
      return;
    }

    try {
      const res = await apiFetch('/auth/profile', {
        method: 'PUT',
        body: JSON.stringify({ username }),
      });
      const payload = await readJsonResponse(res);
      currentUser = { ...currentUser, ...(payload.user || {}) };
      localStorage.setItem('user', JSON.stringify(currentUser));
      renderNavbar();
      renderProfileHeader(currentUser);
      showInlineAlert('settingsAlert', 'Profile updated successfully', 'success');
      showToast('Profile saved', 'success');
    } catch (error) {
      showInlineAlert('settingsAlert', 'Could not save profile', 'error');
    }
  }

  async function changePassword() {
    const currentPassword = document.getElementById('currentPassword').value;
    const newPassword = document.getElementById('newPassword').value;
    const confirmNewPassword = document.getElementById('confirmNewPassword').value;

    if (!currentPassword || !newPassword || !confirmNewPassword) {
      showInlineAlert('securityAlert', 'Please fill in all password fields', 'error');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      showInlineAlert('securityAlert', 'New passwords do not match', 'error');
      return;
    }

    try {
      const res = await apiFetch('/auth/change-password', {
        method: 'PUT',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const payload = await readJsonResponse(res);
      showInlineAlert('securityAlert', payload.message || 'Password changed', 'success');
      showToast('Password updated', 'success');
      document.getElementById('currentPassword').value = '';
      document.getElementById('newPassword').value = '';
      document.getElementById('confirmNewPassword').value = '';
    } catch (error) {
      showInlineAlert('securityAlert', 'Could not change password', 'error');
    }
  }

  async function removeHistory(movieId) {
    try {
      await apiFetch(`/watch/history/${movieId}`, { method: 'DELETE' });
      await hydrateProfile();
      showToast('Removed from history', 'success');
    } catch (error) {
      showToast('Could not remove history item', 'error');
    }
  }

  function applyProfileBackdrop(user) {
    const hero = document.querySelector('.profile-hero');
    if (!hero) return;

    const recentAnime = (user?.watched || []).find((entry) => entry.movie?.category === 'anime' && entry.movie?.thumbnailUrl)
      || (user?.watched || []).find((entry) => entry.movie?.thumbnailUrl);

    const backdropUrl = recentAnime?.movie?.thumbnailUrl
      ? `url("${getImageUrl(recentAnime.movie.thumbnailUrl)}")`
      : 'none';

    hero.style.setProperty('--profile-backdrop', backdropUrl);
  }

  async function removeWatchlist(movieId) {
    try {
      await apiFetch(`/auth/watchlist/${movieId}`, { method: 'PUT' });
      await hydrateProfile();
      showToast('Removed from watchlist', 'success');
    } catch (error) {
      showToast('Could not remove watchlist item', 'error');
    }
  }

  function switchTab(tabName, button) {
    document.querySelectorAll('.ptab').forEach((tab) => tab.classList.remove('active'));
    document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.remove('active'));
    button.classList.add('active');
    document.getElementById(`tab-${tabName}`)?.classList.add('active');
  }

  function setupPasswordToggle(inputId, toggleId) {
    document.getElementById(toggleId)?.addEventListener('click', () => {
      const input = document.getElementById(inputId);
      if (!input) return;
      input.type = input.type === 'password' ? 'text' : 'password';
    });
  }

  function showInlineAlert(targetId, message, type) {
    const target = document.getElementById(targetId);
    if (!target) return;
    target.style.display = 'block';
    target.innerHTML = `<div class="alert alert-${type}"><i class="${type === 'error' ? 'ri-error-warning-line' : 'ri-checkbox-circle-line'}"></i> ${escapeHtml(message)}</div>`;
  }

  function handleLogout() {
    localStorage.removeItem('token');
    localStorage.removeItem('user');
    window.location.href = '/login';
  }
})();
