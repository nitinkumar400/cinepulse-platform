// ══════════════════════════════════════════
// CINE STREAM — Notification System
// ══════════════════════════════════════════

const NotificationSystem = (() => {

  let pollInterval = null;
  let unreadCount  = 0;

  // ── INJECT BELL INTO NAVBAR ──
  const injectBell = () => {
    const userSection = document.getElementById('userSection');
    if (!userSection) return;

    const existing = document.getElementById('notifBellWrap');
    if (existing) return;

    const wrap = document.createElement('div');
    wrap.id    = 'notifBellWrap';
    wrap.style.cssText = 'position:relative;display:inline-flex;align-items:center;';
    wrap.innerHTML = `
      <button id="notifBell"
              onclick="NotificationSystem.toggle()"
              style="
                background:none;border:none;cursor:pointer;
                color:var(--text-secondary);font-size:22px;
                position:relative;padding:4px 8px;
                transition:color 0.2s;
              "
              title="Notifications">
        <i class="ri-notification-3-line" id="notifBellIcon"></i>
        <span id="notifBadge" style="
          display:none;
          position:absolute;top:0;right:4px;
          min-width:18px;height:18px;
          background:var(--accent);border-radius:9px;
          font-size:10px;font-weight:700;color:#fff;
          font-family:var(--font-body);
          align-items:center;justify-content:center;
          padding:0 4px;line-height:1;
        "></span>
      </button>
    `;

    // Insert BEFORE user section content
    userSection.insertBefore(wrap, userSection.firstChild);
  };

  // ── TOGGLE DROPDOWN ──
  const toggle = () => {
    let panel = document.getElementById('notifPanel');
    if (!panel) {
      createPanel();
      panel = document.getElementById('notifPanel');
    }
    const isVisible = panel.style.display === 'block';
    panel.style.display = isVisible ? 'none' : 'block';
    if (!isVisible) {
      fetchNotifications();
    }
  };

  // ── CREATE PANEL ──
  const createPanel = () => {
    const panel = document.createElement('div');
    panel.id    = 'notifPanel';
    panel.style.cssText = `
      position:fixed;
      top:calc(var(--nav-height, 64px) + 8px);
      right:16px;
      width:360px;
      max-height:520px;
      background:var(--bg-secondary);
      border:1px solid var(--border);
      border-radius:var(--radius-lg);
      box-shadow:0 20px 60px rgba(0,0,0,0.6);
      z-index:9999;
      display:none;
      overflow:hidden;
      flex-direction:column;
    `;
    panel.innerHTML = `
      <div style="
        padding:16px 20px;
        border-bottom:1px solid var(--border);
        display:flex;align-items:center;justify-content:space-between;
        flex-shrink:0;
      ">
        <h3 style="font-size:15px;font-weight:700;margin:0;display:flex;align-items:center;gap:8px;">
          <i class="ri-notification-3-line" style="color:var(--accent);"></i>
          Notifications
          <span id="notifPanelCount" style="font-size:12px;color:var(--text-muted);font-weight:400;"></span>
        </h3>
        <div style="display:flex;gap:8px;align-items:center;">
          <button onclick="NotificationSystem.markAllRead()"
                  style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--accent);font-family:var(--font-body);padding:4px 8px;border-radius:4px;transition:background 0.2s;"
                  onmouseover="this.style.background='rgba(229,9,20,0.1)'"
                  onmouseout="this.style.background='none'">
            Mark all read
          </button>
          <button onclick="NotificationSystem.clearAll()"
                  style="background:none;border:none;cursor:pointer;font-size:12px;color:var(--text-muted);font-family:var(--font-body);padding:4px 8px;border-radius:4px;transition:background 0.2s;"
                  onmouseover="this.style.background='rgba(255,255,255,0.05)'"
                  onmouseout="this.style.background='none'">
            Clear all
          </button>
          <button onclick="NotificationSystem.toggle()"
                  style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:18px;line-height:1;">
            <i class="ri-close-line"></i>
          </button>
        </div>
      </div>
      <div id="notifList" style="overflow-y:auto;max-height:420px;flex:1;">
        <div style="text-align:center;padding:40px 20px;color:var(--text-muted);">
          <div class="spinner" style="margin:0 auto 12px;"></div>
          Loading...
        </div>
      </div>
    `;

    document.body.appendChild(panel);

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!e.target.closest('#notifPanel') && !e.target.closest('#notifBellWrap')) {
        const p = document.getElementById('notifPanel');
        if (p) p.style.display = 'none';
      }
    });
  };

  // ── FETCH NOTIFICATIONS FROM API ──
  const fetchNotifications = async () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    try {
      const res  = await fetch(`${API_BASE}/notifications`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (!res.ok) return;

      const data = await res.json();
      unreadCount = data.unreadCount || 0;

      updateBadge(unreadCount);
      renderNotifications(data.notifications || []);

    } catch(e) {}
  };

  // ── RENDER NOTIFICATIONS IN PANEL ──
  const renderNotifications = (notifications) => {
    const list = document.getElementById('notifList');
    if (!list) return;

    const panelCount = document.getElementById('notifPanelCount');
    if (panelCount) {
      panelCount.textContent = notifications.length > 0
        ? `(${notifications.length})`
        : '';
    }

    if (notifications.length === 0) {
      list.innerHTML = `
        <div style="text-align:center;padding:48px 20px;color:var(--text-muted);">
          <div style="font-size:48px;margin-bottom:12px;">🔔</div>
          <p style="font-size:14px;">No notifications yet</p>
          <p style="font-size:12px;margin-top:4px;">We'll notify you when something happens!</p>
        </div>`;
      return;
    }

    const typeIcons = {
      new_content:  { icon:'ri-film-line',      color:'#3b82f6' },
      review_liked: { icon:'ri-heart-fill',      color:'#ec4899' },
      new_episode:  { icon:'ri-tv-2-line',       color:'#8b5cf6' },
      system:       { icon:'ri-information-line', color:'#f59e0b' },
    };

    list.innerHTML = notifications.map(n => {
      const meta  = typeIcons[n.type] || typeIcons.system;
      const time  = timeAgo(new Date(n.createdAt));
      const unread = !n.isRead;

      return `
        <div id="notif-${n._id}"
             onclick="NotificationSystem.handleClick('${n._id}', '${n.link||''}')"
             style="
               display:flex;align-items:flex-start;gap:12px;
               padding:14px 20px;
               cursor:pointer;
               border-bottom:1px solid rgba(255,255,255,0.04);
               transition:background 0.15s;
               background:${unread ? 'rgba(229,9,20,0.04)' : 'transparent'};
               position:relative;
             "
             onmouseover="this.style.background='var(--bg-hover)'"
             onmouseout="this.style.background='${unread ? 'rgba(229,9,20,0.04)' : 'transparent'}'">

          <!-- Icon or thumbnail -->
          ${n.image ? `
            <div style="position:relative;flex-shrink:0;">
              <img src="${typeof MEDIA_BASE !== 'undefined' ? MEDIA_BASE : ''}${n.image}"
                   style="width:44px;height:60px;object-fit:cover;border-radius:6px;background:var(--bg-card);"
                   onerror="this.style.background='var(--bg-card)'">
              <div style="
                position:absolute;bottom:-4px;right:-4px;
                width:18px;height:18px;border-radius:50%;
                background:${meta.color};
                display:flex;align-items:center;justify-content:center;
                border:2px solid var(--bg-secondary);
              ">
                <i class="${meta.icon}" style="font-size:9px;color:#fff;"></i>
              </div>
            </div>
          ` : `
            <div style="
              width:44px;height:44px;border-radius:50%;flex-shrink:0;
              background:${meta.color}22;border:1px solid ${meta.color}44;
              display:flex;align-items:center;justify-content:center;
              font-size:20px;color:${meta.color};
            ">
              <i class="${meta.icon}"></i>
            </div>
          `}

          <!-- Content -->
          <div style="flex:1;min-width:0;">
            <div style="
              font-size:13px;font-weight:${unread ? '700' : '500'};
              margin-bottom:3px;
              white-space:nowrap;overflow:hidden;text-overflow:ellipsis;
            ">${n.title}</div>
            <div style="
              font-size:12px;color:var(--text-secondary);
              line-height:1.4;margin-bottom:5px;
              display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;overflow:hidden;
            ">${n.message}</div>
            <div style="font-size:11px;color:var(--text-muted);">${time}</div>
          </div>

          <!-- Unread dot + delete -->
          <div style="display:flex;flex-direction:column;align-items:center;gap:8px;flex-shrink:0;">
            ${unread ? `<div style="width:8px;height:8px;border-radius:50%;background:var(--accent);flex-shrink:0;"></div>` : '<div style="width:8px;"></div>'}
            <button onclick="event.stopPropagation();NotificationSystem.deleteOne('${n._id}')"
                    style="background:none;border:none;cursor:pointer;color:var(--text-muted);font-size:14px;padding:2px;transition:color 0.15s;"
                    onmouseover="this.style.color='var(--accent)'"
                    onmouseout="this.style.color='var(--text-muted)'"
                    title="Remove">
              <i class="ri-close-line"></i>
            </button>
          </div>

        </div>`;
    }).join('');
  };

  // ── UPDATE BELL BADGE ──
  const updateBadge = (count) => {
    const badge    = document.getElementById('notifBadge');
    const bellIcon = document.getElementById('notifBellIcon');
    if (!badge) return;

    if (count > 0) {
      badge.style.display  = 'flex';
      badge.textContent    = count > 99 ? '99+' : count;
      if (bellIcon) {
        bellIcon.className = 'ri-notification-3-fill';
        bellIcon.style.color = 'var(--accent)';
      }
    } else {
      badge.style.display  = 'none';
      if (bellIcon) {
        bellIcon.className = 'ri-notification-3-line';
        bellIcon.style.color = '';
      }
    }
  };

  // ── HANDLE CLICK (mark read + navigate) ──
  const handleClick = async (id, link) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_BASE}/notifications/${id}/read`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      // Update UI
      const el = document.getElementById(`notif-${id}`);
      if (el) {
        el.style.background = 'transparent';
        const dot = el.querySelector('[style*="border-radius:50%;background:var(--accent)"]');
        if (dot) dot.style.display = 'none';
      }
      unreadCount = Math.max(0, unreadCount - 1);
      updateBadge(unreadCount);
    } catch(e) {}

    if (link && link !== 'null' && link !== '') {
      window.location.href = link;
    }
  };

  // ── MARK ALL READ ──
  const markAllRead = async () => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_BASE}/notifications/read-all`, {
        method: 'PUT',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      unreadCount = 0;
      updateBadge(0);
      fetchNotifications();
      showToast('All notifications marked as read', 'success');
    } catch(e) {}
  };

  // ── CLEAR ALL ──
  const clearAll = async () => {
    if (!confirm('Clear all notifications?')) return;
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_BASE}/notifications`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      unreadCount = 0;
      updateBadge(0);
      fetchNotifications();
      showToast('All notifications cleared', 'success');
    } catch(e) {}
  };

  // ── DELETE ONE ──
  const deleteOne = async (id) => {
    const token = localStorage.getItem('token');
    try {
      await fetch(`${API_BASE}/notifications/${id}`, {
        method: 'DELETE',
        headers: { 'Authorization': `Bearer ${token}` }
      });
      document.getElementById(`notif-${id}`)?.remove();
      await fetchNotifications();
    } catch(e) {}
  };

  // ── TIME AGO HELPER ──
  const timeAgo = (date) => {
    const seconds = Math.floor((new Date() - date) / 1000);
    if (seconds < 60)   return 'Just now';
    if (seconds < 3600) return `${Math.floor(seconds/60)}m ago`;
    if (seconds < 86400) return `${Math.floor(seconds/3600)}h ago`;
    if (seconds < 604800) return `${Math.floor(seconds/86400)}d ago`;
    return date.toLocaleDateString('en-US', { month:'short', day:'numeric' });
  };

  // ── START POLLING (check every 30s) ──
  const startPolling = () => {
    fetchNotifications(); // immediate first fetch
    pollInterval = setInterval(fetchNotifications, 30000);
  };

  // ── STOP POLLING ──
  const stopPolling = () => {
    if (pollInterval) clearInterval(pollInterval);
  };

  // ── INIT ──
  const init = () => {
    const token = localStorage.getItem('token');
    if (!token) return;

    // Wait for DOM + navbar to be ready
    const tryInject = () => {
      const userSection = document.getElementById('userSection');
      if (userSection && userSection.innerHTML.trim() !== '') {
        injectBell();
        startPolling();
      } else {
        setTimeout(tryInject, 100);
      }
    };
    tryInject();
  };

  // Public API
  return { init, toggle, markAllRead, clearAll, deleteOne, handleClick, fetchNotifications };

})();