// ══════════════════════════════════════════
// CINE PULSE — Server Health Dashboard
// ──────────────────────────────────────────
// Vanilla JS module that powers the Server Health section of the
// admin panel. Renders one Server_Card per Embed_Server returned by
// `GET /api/admin/servers`, polls `GET /api/admin/servers/health`
// every 60 seconds, and supports enable/disable + up/down-arrow
// reordering through `PUT /api/admin/servers/:key` and
// `PUT /api/admin/servers/reorder`.
//
// Dependencies (loaded globally before this script):
//   • app.js        → apiFetch, readJsonResponse, showToast, escapeHtml
//   • config.js     → window.__APP_CONFIG (not strictly required here)
//
// Public API (exposed on window.ServerHealthDashboard):
//   • init(containerId)  — bootstrap the dashboard into the given element
//   • refresh()          — re-fetch the full server list and re-render
//   • destroy()          — stop polling (call when navigating away)
//
// Requirements traceability: 2.1–2.8, 3.1–3.6, 4.1–4.6
// ══════════════════════════════════════════

(function () {
  'use strict';

  // ──────────────────────────────────────────
  // CONSTANTS
  // ──────────────────────────────────────────

  const POLL_INTERVAL_MS = 60_000;            // Requirement 2.3
  const API_BASE_PATH    = '/admin/servers';  // mounted under /api by apiFetch

  const STYLE_TAG_ID     = 'server-health-styles';
  const SUMMARY_LAST_ID  = 'shdLastUpdatedTs';

  // Add Server modal — DOM ids and key validation pattern. The
  // pattern mirrors the server-side rule in
  // backend/routes/adminServers.js (`KEY_PATTERN = /^[a-z0-9_]+$/`).
  const ADD_BTN_ID       = 'shdAddServerBtn';
  const MODAL_ROOT_ID    = 'shdAddServerModal';
  const KEY_PATTERN      = /^[a-z0-9_]+$/;

  // ──────────────────────────────────────────
  // MODULE STATE
  // ──────────────────────────────────────────
  //
  // All state lives on the closure — there is exactly one dashboard
  // per page so we deliberately avoid an instance class.

  let _serversCache = []; // last-known list of Server_Config docs (sorted by priority)
  let _pollTimer    = null;
  let _container    = null;
  let _wired        = false;

  // Drag-and-drop state. We track the in-flight key on the closure so
  // `dragover`/`drop` handlers can locate it without parsing the
  // event's `dataTransfer` (which is not always readable across
  // browsers during dragover for security reasons).
  let _dragKey      = null;

  // ──────────────────────────────────────────
  // SAFE GLOBAL HELPERS
  // ──────────────────────────────────────────
  //
  // `app.js` exposes these globally; we re-bind them locally so a
  // missing dependency yields a console warning instead of a hard
  // ReferenceError later inside a render path.

  const _apiFetch         = typeof window.apiFetch         === 'function' ? window.apiFetch         : null;
  const _readJsonResponse = typeof window.readJsonResponse === 'function' ? window.readJsonResponse : null;
  const _showToast        = typeof window.showToast        === 'function' ? window.showToast        : (msg) => console.log('[toast]', msg);
  const _escapeHtml       = typeof window.escapeHtml       === 'function'
    ? window.escapeHtml
    : (str) => String(str == null ? '' : str)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');

  // ──────────────────────────────────────────
  // STYLE INJECTION
  // ──────────────────────────────────────────
  //
  // The admin panel's stylesheet does not yet ship dedicated rules
  // for the dashboard, so we inject a single `<style>` tag the first
  // time we render. The tag carries a stable id so subsequent inits
  // are idempotent.

  function _injectStyles() {
    if (document.getElementById(STYLE_TAG_ID)) return;

    const style = document.createElement('style');
    style.id = STYLE_TAG_ID;
    style.textContent = `
      .shd-root { color: #e5e7eb; }

      .server-health-summary {
        display: flex;
        flex-wrap: wrap;
        align-items: center;
        gap: 16px;
        padding: 16px 20px;
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 12px;
        margin-bottom: 20px;
      }
      .server-health-summary .health-stat {
        display: flex;
        align-items: baseline;
        gap: 6px;
        padding: 6px 12px;
        border-radius: 999px;
        background: #0f172a;
        font-size: 13px;
      }
      .server-health-summary .health-stat .num {
        font-size: 18px;
        font-weight: 700;
        color: #f9fafb;
      }
      .server-health-summary .health-stat .label {
        color: #9ca3af;
        text-transform: uppercase;
        letter-spacing: 0.04em;
        font-size: 11px;
      }
      .server-health-summary .health-stat.working .num   { color: #22c55e; }
      .server-health-summary .health-stat.degraded .num  { color: #f59e0b; }
      .server-health-summary .health-stat.down .num      { color: #ef4444; }

      .server-health-summary .last-updated {
        margin-left: auto;
        font-size: 12px;
        color: #9ca3af;
      }

      .server-cards {
        display: grid;
        grid-template-columns: repeat(auto-fill, minmax(320px, 1fr));
        gap: 16px;
      }

      .server-card {
        background: #111827;
        border: 1px solid #1f2937;
        border-radius: 12px;
        padding: 16px;
        transition: border-color 200ms ease, transform 150ms ease;
      }
      .server-card:hover { border-color: #374151; }
      .server-card.is-down { border-color: #7f1d1d; box-shadow: 0 0 0 1px #ef4444 inset; }

      .server-card-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 12px;
        margin-bottom: 12px;
      }
      .server-name-block {
        display: flex;
        align-items: center;
        gap: 8px;
        min-width: 0;
        flex: 1;
      }
      .server-name-block h3 {
        font-size: 15px;
        font-weight: 600;
        margin: 0;
        color: #f9fafb;
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .server-type-tag {
        font-size: 10px;
        text-transform: uppercase;
        letter-spacing: 0.08em;
        padding: 2px 6px;
        border-radius: 4px;
        background: #1f2937;
        color: #9ca3af;
      }

      .status-badge {
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 14px; height: 14px;
        border-radius: 50%;
        font-size: 0;
        line-height: 0;
        background: #374151;
      }
      .status-badge.working  { background: #22c55e; box-shadow: 0 0 8px rgba(34,197,94,0.6); }
      .status-badge.degraded { background: #f59e0b; box-shadow: 0 0 8px rgba(245,158,11,0.5); }
      .status-badge.down     { background: #ef4444; box-shadow: 0 0 8px rgba(239,68,68,0.6); }

      .server-controls {
        display: flex;
        align-items: center;
        gap: 6px;
        flex-shrink: 0;
      }

      .reorder-btn {
        background: #1f2937;
        border: 1px solid #374151;
        color: #d1d5db;
        width: 26px; height: 26px;
        border-radius: 6px;
        font-size: 11px;
        cursor: pointer;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        transition: background 150ms ease, color 150ms ease;
      }
      .reorder-btn:hover:not(:disabled) {
        background: #374151;
        color: #ffffff;
      }
      .reorder-btn:disabled {
        opacity: 0.4;
        cursor: not-allowed;
      }

      .toggle-switch {
        position: relative;
        display: inline-block;
        width: 40px;
        height: 22px;
      }
      .toggle-switch input {
        opacity: 0;
        width: 0;
        height: 0;
      }
      .toggle-switch .slider {
        position: absolute;
        cursor: pointer;
        inset: 0;
        background: #374151;
        border-radius: 22px;
        transition: background 200ms ease;
      }
      .toggle-switch .slider::before {
        content: '';
        position: absolute;
        height: 16px; width: 16px;
        left: 3px; top: 3px;
        background: #f9fafb;
        border-radius: 50%;
        transition: transform 200ms ease;
      }
      .toggle-switch input:checked + .slider { background: #22c55e; }
      .toggle-switch input:checked + .slider::before { transform: translateX(18px); }
      .toggle-switch input:disabled + .slider { cursor: not-allowed; opacity: 0.6; }

      .server-card-body {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 8px 16px;
      }
      .server-card-body .metric {
        display: flex;
        flex-direction: column;
        font-size: 12px;
      }
      .server-card-body .metric label {
        color: #9ca3af;
        font-size: 11px;
        text-transform: uppercase;
        letter-spacing: 0.05em;
        margin-bottom: 2px;
      }
      .server-card-body .metric .value {
        color: #f3f4f6;
        font-weight: 500;
      }
      .server-card-body .metric .value.working  { color: #22c55e; }
      .server-card-body .metric .value.degraded { color: #f59e0b; }
      .server-card-body .metric .value.down     { color: #ef4444; }

      .shd-loading,
      .shd-error,
      .shd-empty {
        padding: 32px;
        text-align: center;
        color: #9ca3af;
        background: #111827;
        border: 1px dashed #1f2937;
        border-radius: 12px;
      }
      .shd-error { color: #fca5a5; border-color: #7f1d1d; }

      /* ── Add Server button (summary-row right side) ── */
      .shd-add-btn {
        background: linear-gradient(135deg, #2563eb, #1d4ed8);
        color: #ffffff;
        border: 1px solid #1d4ed8;
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        transition: transform 120ms ease, box-shadow 120ms ease, opacity 120ms ease;
      }
      .shd-add-btn:hover {
        transform: translateY(-1px);
        box-shadow: 0 4px 12px rgba(37, 99, 235, 0.35);
      }
      .shd-add-btn:active { transform: translateY(0); opacity: 0.9; }

      /* ── Drag-and-drop visual states ── */
      .server-card { cursor: grab; }
      .server-card.dragging {
        opacity: 0.4;
        cursor: grabbing;
      }
      .server-card.drag-over {
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.35) inset;
      }
      /* Inner controls should not steal drag focus from the card */
      .server-card .server-controls,
      .server-card .toggle-switch,
      .server-card .reorder-btn {
        cursor: pointer;
      }

      /* ── Add Server modal ── */
      .shd-modal-backdrop {
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        display: flex;
        align-items: flex-start;
        justify-content: center;
        padding: 64px 16px;
        z-index: 1000;
        overflow-y: auto;
      }
      .shd-modal {
        background: #0f172a;
        border: 1px solid #1f2937;
        border-radius: 14px;
        width: 100%;
        max-width: 560px;
        padding: 22px 24px 18px;
        color: #e5e7eb;
        box-shadow: 0 24px 48px rgba(0, 0, 0, 0.55);
      }
      .shd-modal h2 {
        font-size: 18px;
        margin: 0 0 4px;
        color: #f9fafb;
      }
      .shd-modal .shd-modal-sub {
        font-size: 12px;
        color: #9ca3af;
        margin: 0 0 16px;
      }
      .shd-modal form { display: flex; flex-direction: column; gap: 12px; }
      .shd-form-field { display: flex; flex-direction: column; gap: 4px; }
      .shd-form-field label {
        font-size: 12px;
        color: #d1d5db;
        text-transform: uppercase;
        letter-spacing: 0.04em;
      }
      .shd-form-field input,
      .shd-form-field select {
        background: #111827;
        border: 1px solid #1f2937;
        color: #f3f4f6;
        padding: 8px 10px;
        border-radius: 8px;
        font-size: 13px;
        outline: none;
      }
      .shd-form-field input:focus,
      .shd-form-field select:focus {
        border-color: #3b82f6;
        box-shadow: 0 0 0 2px rgba(59, 130, 246, 0.25);
      }
      .shd-form-field input[aria-invalid="true"] {
        border-color: #ef4444;
        box-shadow: 0 0 0 2px rgba(239, 68, 68, 0.25);
      }
      .shd-form-field .shd-hint {
        font-size: 11px;
        color: #6b7280;
      }
      .shd-error-text {
        color: #fca5a5;
        font-size: 12px;
        min-height: 14px;
      }
      .shd-form-row {
        display: grid;
        grid-template-columns: repeat(2, minmax(0, 1fr));
        gap: 12px;
      }
      .shd-modal-actions {
        display: flex;
        justify-content: flex-end;
        align-items: center;
        gap: 10px;
        margin-top: 6px;
      }
      .shd-modal-actions .shd-form-error {
        margin-right: auto;
        font-size: 12px;
        color: #fca5a5;
        max-width: 60%;
      }
      .shd-btn {
        padding: 8px 14px;
        border-radius: 8px;
        font-size: 13px;
        font-weight: 600;
        cursor: pointer;
        border: 1px solid transparent;
        transition: opacity 120ms ease, background 120ms ease;
      }
      .shd-btn[disabled] { opacity: 0.6; cursor: not-allowed; }
      .shd-btn-cancel {
        background: transparent;
        color: #d1d5db;
        border-color: #374151;
      }
      .shd-btn-cancel:hover { background: #1f2937; }
      .shd-btn-submit {
        background: #2563eb;
        color: #ffffff;
        border-color: #1d4ed8;
      }
      .shd-btn-submit:hover { background: #1d4ed8; }
      .shd-conditional[hidden] { display: none !important; }
    `;
    document.head.appendChild(style);
  }

  // ──────────────────────────────────────────
  // FORMATTING HELPERS
  // ──────────────────────────────────────────

  /**
   * Convert an ISO timestamp (or null) into a "X minutes ago" string.
   * Falls back to "Never" when no timestamp is present.
   *
   * @param {string|Date|null} timestamp
   * @returns {string}
   */
  function formatTimeAgo(timestamp) {
    if (!timestamp) return 'Never';

    const t = timestamp instanceof Date ? timestamp.getTime() : Date.parse(timestamp);
    if (!Number.isFinite(t)) return 'Never';

    const diffMs   = Math.max(0, Date.now() - t);
    const seconds  = Math.floor(diffMs / 1000);
    if (seconds < 10)        return 'just now';
    if (seconds < 60)        return `${seconds} seconds ago`;
    const minutes  = Math.floor(seconds / 60);
    if (minutes < 60)        return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
    const hours    = Math.floor(minutes / 60);
    if (hours < 24)          return `${hours} hour${hours === 1 ? '' : 's'} ago`;
    const days     = Math.floor(hours / 24);
    if (days < 30)           return `${days} day${days === 1 ? '' : 's'} ago`;

    try {
      return new Date(t).toLocaleDateString();
    } catch {
      return 'Never';
    }
  }

  function _statusClass(status) {
    const s = String(status || '').trim().toLowerCase();
    if (s === 'working')  return 'working';
    if (s === 'degraded') return 'degraded';
    if (s === 'down')     return 'down';
    return '';
  }

  function _displayStatus(status) {
    const s = String(status || '').trim();
    if (!s) return 'Unknown';
    return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
  }

  function _formatNumber(n, decimals = 1) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return '0';
    return n.toFixed(decimals);
  }

  // ──────────────────────────────────────────
  // RENDERING
  // ──────────────────────────────────────────

  function _renderLoading() {
    if (!_container) return;
    _container.innerHTML = '<div class="shd-root"><div class="shd-loading">Loading server health…</div></div>';
  }

  function _renderError(message) {
    if (!_container) return;
    _container.innerHTML = `
      <div class="shd-root">
        <div class="shd-error">${_escapeHtml(message || 'Failed to load server data. Retrying in 60s.')}</div>
      </div>
    `;
  }

  function _computeSummary(servers) {
    let working = 0;
    let degraded = 0;
    let down = 0;

    for (const s of servers) {
      const status = _statusClass(s.lastStatus || s.status);
      if (status === 'working')        working++;
      else if (status === 'degraded')  degraded++;
      else if (status === 'down')      down++;
    }

    return { total: servers.length, working, degraded, down };
  }

  function _renderSummary(servers) {
    const { total, working, degraded, down } = _computeSummary(servers);
    return `
      <div class="server-health-summary">
        <div class="health-stat"><span class="num">${total}</span><span class="label">Total</span></div>
        <div class="health-stat working"><span class="num">${working}</span><span class="label">Working</span></div>
        <div class="health-stat degraded"><span class="num">${degraded}</span><span class="label">Degraded</span></div>
        <div class="health-stat down"><span class="num">${down}</span><span class="label">Down</span></div>
        <button type="button" id="${ADD_BTN_ID}" class="shd-add-btn" aria-label="Add Server">+ Add Server</button>
        <div class="last-updated">Last updated: <span id="${SUMMARY_LAST_ID}">${_escapeHtml(_lastUpdatedLabel())}</span></div>
      </div>
    `;
  }

  let _lastUpdatedAt = null;
  function _lastUpdatedLabel() {
    if (!_lastUpdatedAt) return '—';
    try {
      return new Date(_lastUpdatedAt).toLocaleTimeString();
    } catch {
      return '—';
    }
  }

  function _renderCard(server, index, total) {
    const statusValue = server.lastStatus || server.status || null;
    const statusCls   = _statusClass(statusValue);
    const cardClasses = ['server-card', statusCls === 'down' ? 'is-down' : ''].filter(Boolean).join(' ');

    const successRate = typeof server.successRate === 'number' ? server.successRate : 0;
    const avgLoad     = typeof server.avgLoadTime === 'number' ? server.avgLoadTime : 0;
    const lastChecked = formatTimeAgo(server.lastCheckedAt || server.checkedAt);

    const isFirst = index === 0;
    const isLast  = index === total - 1;
    const enabled = server.enabled !== false;

    return `
      <div class="${cardClasses}"
           draggable="true"
           data-key="${_escapeHtml(server.key)}"
           data-priority="${_escapeHtml(server.priority)}">
        <div class="server-card-header">
          <div class="server-name-block">
            <span class="status-badge ${statusCls}" aria-hidden="true">●</span>
            <h3 title="${_escapeHtml(server.name)}">${_escapeHtml(server.name)}</h3>
            <span class="server-type-tag">${_escapeHtml(server.type || '')}</span>
          </div>
          <div class="server-controls">
            <button type="button"
                    class="reorder-btn up"
                    title="Move up"
                    aria-label="Move ${_escapeHtml(server.name)} up"
                    ${isFirst ? 'disabled' : ''}>▲</button>
            <button type="button"
                    class="reorder-btn down"
                    title="Move down"
                    aria-label="Move ${_escapeHtml(server.name)} down"
                    ${isLast ? 'disabled' : ''}>▼</button>
            <label class="toggle-switch"
                   title="${enabled ? 'Disable' : 'Enable'} ${_escapeHtml(server.name)}">
              <input type="checkbox" ${enabled ? 'checked' : ''} aria-label="Enable or disable ${_escapeHtml(server.name)}">
              <span class="slider"></span>
            </label>
            <button type="button"
                    class="reorder-btn delete-server-btn"
                    title="Delete Server"
                    aria-label="Delete ${_escapeHtml(server.name)}"
                    style="margin-left: 8px; border-color: #ef4444; background: #7f1d1d; color: #fca5a5; display: inline-flex; align-items: center; justify-content: center; width: 28px; height: 28px; padding: 0;">
              <i class="ri-delete-bin-line" style="font-size: 14px; pointer-events: none;"></i>
            </button>
          </div>
        </div>
        <div class="server-card-body">
          <div class="metric">
            <label>Status</label>
            <span class="value ${statusCls}">${_escapeHtml(_displayStatus(statusValue))}</span>
          </div>
          <div class="metric">
            <label>Last Checked</label>
            <span class="value">${_escapeHtml(lastChecked)}</span>
          </div>
          <div class="metric">
            <label>Success Rate</label>
            <span class="value">${_escapeHtml(_formatNumber(successRate, 1))}%</span>
          </div>
          <div class="metric">
            <label>Avg Load Time</label>
            <span class="value">${_escapeHtml(String(Math.round(avgLoad || 0)))}ms</span>
          </div>
        </div>
      </div>
    `;
  }

  function _render() {
    if (!_container) return;

    if (!Array.isArray(_serversCache) || _serversCache.length === 0) {
      _container.innerHTML = `
        <div class="shd-root">
          ${_renderSummary([])}
          <div class="shd-empty">No servers configured. Use the “Add Server” form to register one.</div>
        </div>
      `;
      return;
    }

    const total = _serversCache.length;
    const cards = _serversCache.map((s, i) => _renderCard(s, i, total)).join('');

    _container.innerHTML = `
      <div class="shd-root">
        ${_renderSummary(_serversCache)}
        <div class="server-cards">${cards}</div>
      </div>
    `;
  }

  // ──────────────────────────────────────────
  // DATA FETCHING
  // ──────────────────────────────────────────

  /**
   * Fetch the canonical server list (`GET /api/admin/servers`).
   *
   * @returns {Promise<Array<object>>} sorted-by-priority server list
   */
  async function _fetchServers() {
    if (!_apiFetch || !_readJsonResponse) {
      throw new Error('apiFetch helper is not available');
    }

    const res     = await _apiFetch(API_BASE_PATH);
    const payload = await _readJsonResponse(res);

    if (!res.ok || !payload || payload.success === false) {
      const message = (payload && payload.message) || `Request failed (${res.status})`;
      throw new Error(message);
    }

    const servers = Array.isArray(payload.servers) ? payload.servers : [];
    // Defensive sort: the API already returns ascending priority, but
    // we re-sort here so the dashboard never depends on server order.
    servers.sort((a, b) => (a.priority || 0) - (b.priority || 0));
    return servers;
  }

  /**
   * Fetch the latest health snapshot (`GET /api/admin/servers/health`).
   * Used by the 60-second polling loop. The response contains one
   * entry per Embed_Server with both probe-level fields (status,
   * checkedAt, etc.) and rolling stats (successRate, avgLoadTime).
   *
   * @returns {Promise<Array<object>>}
   */
  async function _fetchHealth() {
    if (!_apiFetch || !_readJsonResponse) {
      throw new Error('apiFetch helper is not available');
    }

    const res     = await _apiFetch(`${API_BASE_PATH}/health`);
    const payload = await _readJsonResponse(res);

    if (!res.ok || !payload || payload.success === false) {
      const message = (payload && payload.message) || `Request failed (${res.status})`;
      throw new Error(message);
    }

    return Array.isArray(payload.health) ? payload.health : [];
  }

  /**
   * Merge a health snapshot into the cached server list. Mutates and
   * returns the cache so callers can re-render without re-fetching
   * the full server list.
   */
  function _mergeHealth(healthEntries) {
    if (!Array.isArray(healthEntries) || healthEntries.length === 0) return;
    const byKey = new Map(healthEntries.map((h) => [h.serverKey, h]));

    for (const server of _serversCache) {
      const h = byKey.get(server.key);
      if (!h) continue;

      // The /health endpoint surfaces both the latest probe sample
      // and the rolling stats; copy them onto the cached config doc
      // so the next render picks them up.
      if (h.lastStatus    !== undefined) server.lastStatus    = h.lastStatus    || h.status || server.lastStatus;
      if (h.lastCheckedAt !== undefined) server.lastCheckedAt = h.lastCheckedAt || h.checkedAt || server.lastCheckedAt;
      if (h.successRate   !== undefined && h.successRate !== null) server.successRate = h.successRate;
      if (h.avgLoadTime   !== undefined && h.avgLoadTime !== null) server.avgLoadTime = h.avgLoadTime;
      if (h.enabled       !== undefined) server.enabled       = h.enabled;
    }
  }

  // ──────────────────────────────────────────
  // POLLING
  // ──────────────────────────────────────────

  function _startPolling() {
    _stopPolling();
    _pollTimer = setInterval(_pollHealth, POLL_INTERVAL_MS);
  }

  function _stopPolling() {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  }

  async function _pollHealth() {
    if (!_container || !document.body.contains(_container)) {
      // The container has been detached (user navigated away). Stop
      // polling so the timer does not leak across SPA route changes.
      _stopPolling();
      return;
    }

    try {
      const health = await _fetchHealth();
      _mergeHealth(health);
      _lastUpdatedAt = Date.now();
      _render();
    } catch (err) {
      // Polling failures should not be intrusive — surface a small
      // notice in the "Last updated" label and keep the existing
      // cards visible until the next tick.
      console.warn('[ServerHealthDashboard] poll failed:', err && err.message);
      const tsEl = document.getElementById(SUMMARY_LAST_ID);
      if (tsEl) tsEl.textContent = `${_lastUpdatedLabel()} (refresh failed)`;
    }
  }

  // ──────────────────────────────────────────
  // EVENT WIRING (delegated)
  // ──────────────────────────────────────────

  function _wireEvents() {
    if (_wired || !_container) return;
    _wired = true;

    _container.addEventListener('change', (ev) => {
      const input = ev.target;
      if (!input || !input.matches('.toggle-switch input')) return;
      const card = input.closest('.server-card');
      if (!card) return;
      _handleToggle(input, card);
    });

    _container.addEventListener('click', (ev) => {
      // Open the Add Server modal when the summary-row button is
      // clicked. This is delegated so the button can be re-rendered
      // by `_render()` without needing to re-bind handlers.
      const addBtn = ev.target.closest && ev.target.closest(`#${ADD_BTN_ID}`);
      if (addBtn) {
        ev.preventDefault();
        _openAddServerModal();
        return;
      }

      const btn = ev.target.closest('.reorder-btn');
      if (!btn) return;

      const card = btn.closest('.server-card');
      if (!card) return;

      if (btn.classList.contains('up')) {
        _handleReorder(card, -1);
      } else if (btn.classList.contains('down')) {
        _handleReorder(card, 1);
      } else if (btn.classList.contains('delete-server-btn')) {
        _handleDelete(card);
      }
    });

    // ────────────────────────────────────────
    // HTML5 Drag-and-Drop reordering (Requirement 4.5)
    // ────────────────────────────────────────
    // We bind on the container and walk up to the nearest
    // `.server-card`. The drag source is identified by `_dragKey`
    // which is set on `dragstart` and cleared on `dragend`.

    _container.addEventListener('dragstart', (ev) => {
      const card = ev.target && ev.target.closest && ev.target.closest('.server-card');
      if (!card) return;

      const key = card.getAttribute('data-key');
      if (!key) return;

      // Skip drags that originated on an interactive control (toggle
      // switch / arrow button). The browser fires `dragstart` for the
      // ancestor card, so we need to inspect the original target.
      if (ev.target.closest('.toggle-switch') || ev.target.closest('.reorder-btn')) {
        ev.preventDefault();
        return;
      }

      _dragKey = key;
      card.classList.add('dragging');

      if (ev.dataTransfer) {
        try {
          ev.dataTransfer.effectAllowed = 'move';
          ev.dataTransfer.setData('text/plain', key);
        } catch (_e) {
          // Some sandboxed contexts forbid `setData`; the closure
          // variable `_dragKey` is the source of truth, so this is
          // recoverable.
        }
      }
    });

    _container.addEventListener('dragover', (ev) => {
      const card = ev.target && ev.target.closest && ev.target.closest('.server-card');
      if (!card) return;
      if (!_dragKey) return;

      // `preventDefault` on `dragover` is what tells the browser
      // this element is a valid drop target.
      ev.preventDefault();
      if (ev.dataTransfer) ev.dataTransfer.dropEffect = 'move';

      // Highlight the hovered target — but never highlight the
      // dragged card itself.
      const targetKey = card.getAttribute('data-key');
      if (targetKey === _dragKey) return;

      // Clear previous highlights so only one target shows the
      // accent border at a time.
      const prev = _container.querySelectorAll('.server-card.drag-over');
      prev.forEach((el) => { if (el !== card) el.classList.remove('drag-over'); });

      card.classList.add('drag-over');
    });

    _container.addEventListener('dragleave', (ev) => {
      const card = ev.target && ev.target.closest && ev.target.closest('.server-card');
      if (!card) return;
      // Only clear when the cursor truly leaves the card; ignore
      // bubbling events from inner children.
      if (ev.relatedTarget && card.contains(ev.relatedTarget)) return;
      card.classList.remove('drag-over');
    });

    _container.addEventListener('drop', (ev) => {
      const card = ev.target && ev.target.closest && ev.target.closest('.server-card');
      if (!card) return;

      ev.preventDefault();

      const targetKey = card.getAttribute('data-key');
      const draggedKey = _dragKey
        || (ev.dataTransfer ? ev.dataTransfer.getData('text/plain') : '');

      // Always clear the visual state — the dragend fallback below
      // will handle anything we miss here.
      card.classList.remove('drag-over');

      if (!draggedKey || !targetKey || draggedKey === targetKey) return;

      _handleDragReorder(draggedKey, targetKey);
    });

    _container.addEventListener('dragend', () => {
      _dragKey = null;
      // Remove all transient drag classes — they may still be set
      // on the source or target if the drop landed outside the
      // dashboard (e.g. on the page background).
      const cards = _container.querySelectorAll('.server-card');
      cards.forEach((c) => {
        c.classList.remove('dragging');
        c.classList.remove('drag-over');
      });
    });
  }

  /**
   * Handle a toggle-switch change. The toggle is OPTIMISTIC — the
   * native checkbox state has already flipped before this runs. On
   * API failure we revert it and surface an error toast.
   */
  async function _handleToggle(input, card) {
    const key = card.getAttribute('data-key');
    if (!key) return;

    const newEnabled = !!input.checked;
    const previousEnabled = !newEnabled;

    // Disable the input while in-flight so the user cannot rapid-toggle
    // and race the PATCH responses.
    input.disabled = true;

    try {
      const res = await _apiFetch(`${API_BASE_PATH}/${encodeURIComponent(key)}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ enabled: newEnabled }),
      });
      const payload = await _readJsonResponse(res);

      if (!res.ok || !payload || payload.success === false) {
        const message = (payload && payload.message) || `Request failed (${res.status})`;
        throw new Error(message);
      }

      // Update the cache so a subsequent render keeps the new state.
      const cached = _serversCache.find((s) => s.key === key);
      if (cached) cached.enabled = newEnabled;

      const server = (payload && payload.server) || cached || { name: key };
      const verb = newEnabled ? 'enabled' : 'disabled';
      _showToast(`${server.name || key} ${verb}`, 'success');
    } catch (err) {
      // Revert the visible toggle so the UI matches the persisted state.
      input.checked = previousEnabled;
      const cached = _serversCache.find((s) => s.key === key);
      if (cached) cached.enabled = previousEnabled;
      _showToast(`Failed to update server: ${err && err.message ? err.message : 'unknown error'}`, 'error');
    } finally {
      input.disabled = false;
    }
  }

  /**
   * Handle a server deletion. Invokes DELETE /api/admin/servers/:key.
   * On success, removes the card from the UI, shifts priorities,
   * and triggers a toast message.
   */
  async function _handleDelete(card) {
    const key = card.getAttribute('data-key');
    if (!key) return;

    const cached = _serversCache.find((s) => s.key === key);
    const serverName = cached ? cached.name : key;

    if (!confirm(`Are you sure you want to delete the server "${serverName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      const res = await _apiFetch(`${API_BASE_PATH}/${encodeURIComponent(key)}`, {
        method: 'DELETE',
      });
      const payload = await _readJsonResponse(res);

      if (!res.ok || !payload || payload.success === false) {
        const message = (payload && payload.message) || `Request failed (${res.status})`;
        throw new Error(message);
      }

      // Remove from cache and re-render
      _serversCache = _serversCache.filter((s) => s.key !== key);
      
      // Re-fetch the canonical list so any server-side priority shifts
      // (Property 1) are reflected exactly as MongoDB stored them.
      try {
        _serversCache = await _fetchServers();
      } catch (refetchErr) {
        // Keep the optimistic cache; surface a soft warning only.
        console.warn('[ServerHealthDashboard] delete refetch failed:', refetchErr && refetchErr.message);
      }
      
      _render();
      _showToast(`Server "${serverName}" deleted`, 'success');
    } catch (err) {
      _showToast(`Failed to delete server: ${err && err.message ? err.message : 'unknown error'}`, 'error');
    }
  }

  /**
   * Handle an up/down reorder click. We compute the new key sequence
   * locally, swap the affected card's neighbour, and PUT the full
   * `orderedKeys` array (the API contract requires the complete set).
   */
  async function _handleReorder(card, direction) {
    const key = card.getAttribute('data-key');
    if (!key) return;

    const idx = _serversCache.findIndex((s) => s.key === key);
    if (idx === -1) return;

    const targetIdx = idx + direction;
    if (targetIdx < 0 || targetIdx >= _serversCache.length) return;

    // Build the new ordered key list by swapping idx and targetIdx.
    const newOrder = _serversCache.map((s) => s.key);
    [newOrder[idx], newOrder[targetIdx]] = [newOrder[targetIdx], newOrder[idx]];

    // Optimistic cache update so the re-render snaps immediately.
    const previousCache = _serversCache.slice();
    const reordered = newOrder.map((k, i) => {
      const s = _serversCache.find((c) => c.key === k);
      // priority is 1-based per Property 1 / Requirement 1.6
      return { ...s, priority: i + 1 };
    });
    _serversCache = reordered;
    _render();

    try {
      const res = await _apiFetch(`${API_BASE_PATH}/reorder`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderedKeys: newOrder }),
      });
      const payload = await _readJsonResponse(res);

      if (!res.ok || !payload || payload.success === false) {
        const message = (payload && payload.message) || `Request failed (${res.status})`;
        throw new Error(message);
      }

      // Re-fetch the canonical list so any server-side priority shifts
      // (Property 1) are reflected exactly as MongoDB stored them.
      try {
        _serversCache = await _fetchServers();
      } catch (refetchErr) {
        // Keep the optimistic cache; surface a soft warning only.
        console.warn('[ServerHealthDashboard] reorder refetch failed:', refetchErr && refetchErr.message);
      }
      _render();
      _showToast('Server order updated', 'success');
    } catch (err) {
      // Roll back to the pre-swap cache and re-render.
      _serversCache = previousCache;
      _render();
      _showToast(`Failed to reorder: ${err && err.message ? err.message : 'unknown error'}`, 'error');
    }
  }

  /**
   * Handle a drag-and-drop reorder. The drag source's key is
   * `draggedKey`; the drop target is `targetKey`. The dragged card
   * is moved to the position currently occupied by `targetKey`,
   * with all other cards shifting accordingly. The PUT contract is
   * the same as the arrow-button flow — submit the full ordered
   * key array.
   *
   * Validates: Requirement 4.5
   */
  async function _handleDragReorder(draggedKey, targetKey) {
    if (!draggedKey || !targetKey || draggedKey === targetKey) return;

    const fromIdx = _serversCache.findIndex((s) => s.key === draggedKey);
    const toIdx   = _serversCache.findIndex((s) => s.key === targetKey);
    if (fromIdx === -1 || toIdx === -1) return;

    // Move the dragged item out, then splice it back in at the
    // target's position. This produces the natural "drop replaces
    // target" reorder users expect from drag-and-drop UIs.
    const reordered = _serversCache.slice();
    const [moved] = reordered.splice(fromIdx, 1);
    reordered.splice(toIdx, 0, moved);

    const newOrder = reordered.map((s) => s.key);

    // Optimistic update so the cards snap into place immediately.
    const previousCache = _serversCache.slice();
    _serversCache = reordered.map((s, i) => ({ ...s, priority: i + 1 }));
    _render();

    try {
      const res = await _apiFetch(`${API_BASE_PATH}/reorder`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ orderedKeys: newOrder }),
      });
      const payload = await _readJsonResponse(res);

      if (!res.ok || !payload || payload.success === false) {
        const message = (payload && payload.message) || `Request failed (${res.status})`;
        throw new Error(message);
      }

      // Re-fetch the canonical list so any server-side priority
      // shifts are reflected exactly as MongoDB stored them.
      try {
        _serversCache = await _fetchServers();
      } catch (refetchErr) {
        console.warn('[ServerHealthDashboard] drag-reorder refetch failed:', refetchErr && refetchErr.message);
      }
      _render();
      _showToast('Server order updated', 'success');
    } catch (err) {
      _serversCache = previousCache;
      _render();
      _showToast(`Failed to reorder: ${err && err.message ? err.message : 'unknown error'}`, 'error');
    }
  }

  // ──────────────────────────────────────────
  // ADD SERVER MODAL  (Requirement 5.1–5.6)
  // ──────────────────────────────────────────
  //
  // The modal is rendered lazily — we inject it into the body the
  // first time the user clicks the "+ Add Server" button. Subsequent
  // opens reuse the same DOM and reset all field state.

  /**
   * Compute the default priority for a new server: one greater than
   * the current highest priority, or 1 if the list is empty.
   *
   * @returns {number}
   */
  function _defaultNewPriority() {
    if (!Array.isArray(_serversCache) || _serversCache.length === 0) return 1;
    const max = _serversCache.reduce((acc, s) => {
      const p = typeof s.priority === 'number' ? s.priority : 0;
      return p > acc ? p : acc;
    }, 0);
    return max + 1;
  }

  /**
   * Open the Add Server modal, building it on first use. The modal
   * lives on `document.body` so it always overlays the entire admin
   * panel regardless of the dashboard container's stacking context.
   */
  function _openAddServerModal() {
    let backdrop = document.getElementById(MODAL_ROOT_ID);
    if (!backdrop) {
      backdrop = _buildAddServerModal();
      document.body.appendChild(backdrop);
    }

    // Reset form state on every open so a previous failed submit
    // doesn't leak its inline errors into the new session.
    const form = backdrop.querySelector('form');
    if (form) form.reset();
    backdrop.querySelectorAll('.shd-error-text').forEach((el) => { el.textContent = ''; });
    backdrop.querySelectorAll('input[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
    const formError = backdrop.querySelector('.shd-form-error');
    if (formError) formError.textContent = '';

    // Pre-fill priority with the next-available value.
    const priorityInput = backdrop.querySelector('input[name="priority"]');
    if (priorityInput) priorityInput.value = String(_defaultNewPriority());

    // Default Type → standard, then sync conditional URL-pattern
    // visibility so the right fields are shown.
    const typeSelect = backdrop.querySelector('select[name="type"]');
    if (typeSelect) typeSelect.value = 'standard';
    _syncTypeFields(backdrop);

    backdrop.style.display = 'flex';
    // Focus the first field so keyboard users can start typing
    // immediately.
    const firstInput = backdrop.querySelector('input[name="name"]');
    if (firstInput) {
      try { firstInput.focus(); } catch (_e) { /* noop */ }
    }
  }

  /**
   * Tear down the modal — we hide rather than destroy so subsequent
   * opens are instant and re-use the same DOM.
   */
  function _closeAddServerModal() {
    const backdrop = document.getElementById(MODAL_ROOT_ID);
    if (backdrop) backdrop.style.display = 'none';
  }

  /**
   * Show or hide the type-specific URL pattern fields based on the
   * currently selected `type` value (`standard` vs `anime`).
   */
  function _syncTypeFields(root) {
    const select = root.querySelector('select[name="type"]');
    if (!select) return;
    const isAnime    = select.value === 'anime';
    const standardEl = root.querySelector('[data-conditional="standard"]');
    const animeEl    = root.querySelector('[data-conditional="anime"]');
    if (standardEl) standardEl.hidden = isAnime;
    if (animeEl)    animeEl.hidden    = !isAnime;
  }

  /**
   * Build the Add Server modal DOM. The form fields exactly match
   * the contract enforced by `backend/routes/adminServers.js`
   * `_validateCreatePayload`, so client-side validation can mirror
   * the server-side rules and avoid a round-trip on obvious typos.
   */
  function _buildAddServerModal() {
    const backdrop = document.createElement('div');
    backdrop.id = MODAL_ROOT_ID;
    backdrop.className = 'shd-modal-backdrop';
    backdrop.style.display = 'none';
    backdrop.setAttribute('role', 'dialog');
    backdrop.setAttribute('aria-modal', 'true');
    backdrop.setAttribute('aria-label', 'Add Server');

    backdrop.innerHTML = `
      <div class="shd-modal" role="document">
        <h2>Add Server</h2>
        <p class="shd-modal-sub">Register a new Embed_Server. URL patterns must include the required placeholders.</p>
        <form novalidate>
          <div class="shd-form-row">
            <div class="shd-form-field">
              <label for="shd-field-name">Name</label>
              <input id="shd-field-name" name="name" type="text" required autocomplete="off">
              <div class="shd-error-text" data-error-for="name"></div>
            </div>
            <div class="shd-form-field">
              <label for="shd-field-key">Key</label>
              <input id="shd-field-key" name="key" type="text" required autocomplete="off"
                     pattern="^[a-z0-9_]+$">
              <div class="shd-hint">lowercase letters, digits, underscores</div>
              <div class="shd-error-text" data-error-for="key"></div>
            </div>
          </div>

          <div class="shd-form-field">
            <label for="shd-field-type">Type</label>
            <select id="shd-field-type" name="type" required>
              <option value="standard">standard</option>
              <option value="anime">anime</option>
            </select>
            <div class="shd-error-text" data-error-for="type"></div>
          </div>

          <div class="shd-conditional" data-conditional="standard">
            <div class="shd-form-field">
              <label for="shd-field-movie">Movie URL Pattern</label>
              <input id="shd-field-movie" name="movieUrlPattern" type="text"
                     placeholder="https://example.com/movie/{tmdbId}" autocomplete="off">
              <div class="shd-hint">must contain {tmdbId}</div>
              <div class="shd-error-text" data-error-for="movieUrlPattern"></div>
            </div>
            <div class="shd-form-field">
              <label for="shd-field-tv">TV URL Pattern</label>
              <input id="shd-field-tv" name="tvUrlPattern" type="text"
                     placeholder="https://example.com/tv/{tmdbId}/{season}/{episode}" autocomplete="off">
              <div class="shd-hint">must contain {tmdbId}, {season}, {episode}</div>
              <div class="shd-error-text" data-error-for="tvUrlPattern"></div>
            </div>
          </div>

          <div class="shd-conditional" data-conditional="anime" hidden>
            <div class="shd-form-field">
              <label for="shd-field-anime">Anime URL Pattern</label>
              <input id="shd-field-anime" name="animeUrlPattern" type="text"
                     placeholder="https://example.com/anime/{anilistId}/{episode}" autocomplete="off">
              <div class="shd-hint">must contain {anilistId}, {episode}</div>
              <div class="shd-error-text" data-error-for="animeUrlPattern"></div>
            </div>
          </div>

          <div class="shd-form-row">
            <div class="shd-form-field">
              <label for="shd-field-sandbox">Sandbox Policy</label>
              <input id="shd-field-sandbox" name="sandboxPolicy" type="text" value="none" autocomplete="off">
              <div class="shd-error-text" data-error-for="sandboxPolicy"></div>
            </div>
            <div class="shd-form-field">
              <label for="shd-field-timeout">Timeout (ms)</label>
              <input id="shd-field-timeout" name="timeout" type="number" min="1000" step="500" value="9000">
              <div class="shd-error-text" data-error-for="timeout"></div>
            </div>
          </div>

          <div class="shd-form-field" style="max-width:160px;">
            <label for="shd-field-priority">Priority</label>
            <input id="shd-field-priority" name="priority" type="number" min="1" step="1" value="1">
            <div class="shd-error-text" data-error-for="priority"></div>
          </div>

          <div class="shd-modal-actions">
            <div class="shd-form-error" role="alert"></div>
            <button type="button" class="shd-btn shd-btn-cancel" data-action="cancel">Cancel</button>
            <button type="submit" class="shd-btn shd-btn-submit" data-action="submit">Add Server</button>
          </div>
        </form>
      </div>
    `;

    // ── Event wiring (scoped to this modal element) ──
    const form       = backdrop.querySelector('form');
    const typeSelect = backdrop.querySelector('select[name="type"]');
    const cancelBtn  = backdrop.querySelector('[data-action="cancel"]');

    typeSelect.addEventListener('change', () => _syncTypeFields(backdrop));

    cancelBtn.addEventListener('click', (ev) => {
      ev.preventDefault();
      _closeAddServerModal();
    });

    // Close when the user clicks the dimmed backdrop, but not when
    // clicks bubble up from the modal panel itself.
    backdrop.addEventListener('click', (ev) => {
      if (ev.target === backdrop) _closeAddServerModal();
    });

    // ESC key closes the modal — only attach when the modal is open
    // so the global listener doesn't fire during normal admin use.
    document.addEventListener('keydown', (ev) => {
      if (ev.key !== 'Escape') return;
      if (backdrop.style.display === 'none') return;
      _closeAddServerModal();
    });

    form.addEventListener('submit', (ev) => {
      ev.preventDefault();
      _onAddServerSubmit(backdrop);
    });

    return backdrop;
  }

  /**
   * Read the form into a plain object suitable for POST. Empty
   * strings become `undefined` so the server receives only the
   * fields the user actually filled in.
   */
  function _readAddServerForm(root) {
    const get = (name) => {
      const el = root.querySelector(`[name="${name}"]`);
      if (!el) return undefined;
      const v = (el.value == null) ? '' : String(el.value).trim();
      return v === '' ? undefined : v;
    };

    const data = {
      name:            get('name'),
      key:             get('key'),
      type:            get('type'),
      movieUrlPattern: get('movieUrlPattern'),
      tvUrlPattern:    get('tvUrlPattern'),
      animeUrlPattern: get('animeUrlPattern'),
      sandboxPolicy:   get('sandboxPolicy'),
    };

    const timeoutRaw = get('timeout');
    if (timeoutRaw !== undefined) {
      const n = Number(timeoutRaw);
      if (Number.isFinite(n)) data.timeout = n;
    }
    const priorityRaw = get('priority');
    if (priorityRaw !== undefined) {
      const n = Number(priorityRaw);
      if (Number.isFinite(n)) data.priority = n;
    }

    // For type=standard, drop the anime-only field; for type=anime,
    // drop the standard-only fields. Sending unrelated fields is
    // harmless but it confuses operators reading network logs.
    if (data.type === 'standard') {
      delete data.animeUrlPattern;
    } else if (data.type === 'anime') {
      delete data.movieUrlPattern;
      delete data.tvUrlPattern;
    }

    return data;
  }

  /**
   * Validate the form payload mirroring the server's contract. Returns
   * either `null` (ok) or a `{ field, message }` describing the first
   * invalid field.
   *
   * @param {object} formData
   * @returns {{field: string, message: string}|null}
   */
  function _validateAddServerForm(formData) {
    if (!formData || typeof formData !== 'object') {
      return { field: 'name', message: 'Form data missing' };
    }

    if (!formData.name) {
      return { field: 'name', message: 'Name is required' };
    }
    if (!formData.key) {
      return { field: 'key', message: 'Key is required' };
    }
    if (!KEY_PATTERN.test(formData.key)) {
      return { field: 'key', message: 'Key must match ^[a-z0-9_]+$' };
    }
    if (formData.type !== 'standard' && formData.type !== 'anime') {
      return { field: 'type', message: "Type must be 'standard' or 'anime'" };
    }

    if (formData.type === 'standard') {
      const hasMovie = !!formData.movieUrlPattern;
      const hasTv    = !!formData.tvUrlPattern;
      if (!hasMovie && !hasTv) {
        return { field: 'movieUrlPattern', message: 'Provide at least one of Movie or TV URL Pattern' };
      }
      if (hasMovie && !formData.movieUrlPattern.includes('{tmdbId}')) {
        return { field: 'movieUrlPattern', message: 'Movie URL Pattern must contain {tmdbId}' };
      }
      if (hasTv) {
        const missing = ['{tmdbId}', '{season}', '{episode}']
          .filter((p) => !formData.tvUrlPattern.includes(p));
        if (missing.length > 0) {
          return { field: 'tvUrlPattern', message: `TV URL Pattern must contain ${missing.join(', ')}` };
        }
      }
    } else {
      // type === 'anime'
      if (!formData.animeUrlPattern) {
        return { field: 'animeUrlPattern', message: 'Anime URL Pattern is required' };
      }
      const missing = ['{anilistId}', '{episode}']
        .filter((p) => !formData.animeUrlPattern.includes(p));
      if (missing.length > 0) {
        return { field: 'animeUrlPattern', message: `Anime URL Pattern must contain ${missing.join(', ')}` };
      }
    }

    if (formData.timeout !== undefined && (!Number.isFinite(formData.timeout) || formData.timeout < 1000)) {
      return { field: 'timeout', message: 'Timeout must be at least 1000 ms' };
    }
    if (formData.priority !== undefined && (!Number.isInteger(formData.priority) || formData.priority < 1)) {
      return { field: 'priority', message: 'Priority must be an integer ≥ 1' };
    }

    return null;
  }

  /**
   * Render an inline error for a specific field, marking the input
   * `aria-invalid` so screen readers pick it up.
   */
  function _setFieldError(root, field, message) {
    if (!root || !field) return;
    const errEl = root.querySelector(`[data-error-for="${field}"]`);
    if (errEl) errEl.textContent = message || '';
    const input = root.querySelector(`[name="${field}"]`);
    if (input) {
      if (message) input.setAttribute('aria-invalid', 'true');
      else         input.removeAttribute('aria-invalid');
    }
  }

  function _clearAllFieldErrors(root) {
    if (!root) return;
    root.querySelectorAll('.shd-error-text').forEach((el) => { el.textContent = ''; });
    root.querySelectorAll('[aria-invalid="true"]').forEach((el) => el.removeAttribute('aria-invalid'));
    const formError = root.querySelector('.shd-form-error');
    if (formError) formError.textContent = '';
  }

  /**
   * Submit the Add Server form. Returns nothing — all UI updates are
   * applied as side effects.
   *
   * Status code mapping:
   *   201 → close modal, append card, success toast (Req 5.3, 5.6)
   *   409 → inline "Server key already exists" on the `key` field   (Req 5.4)
   *   400 → inline error on the offending field (best-effort guess) (Req 5.5)
   *   ≥500 → form-level error toast
   */
  async function _onAddServerSubmit(root) {
    const submitBtn = root.querySelector('[data-action="submit"]');
    const cancelBtn = root.querySelector('[data-action="cancel"]');

    _clearAllFieldErrors(root);

    const formData  = _readAddServerForm(root);
    const validation = _validateAddServerForm(formData);
    if (validation) {
      _setFieldError(root, validation.field, validation.message);
      return;
    }

    // Disable both action buttons while in-flight so a double-click
    // can't post the same payload twice.
    if (submitBtn) submitBtn.disabled = true;
    if (cancelBtn) cancelBtn.disabled = true;

    try {
      const result = await _submitAddServer(formData);

      if (result.ok) {
        // Append the canonical doc to the cache (the API returns
        // priority post-shift, so we trust it) and re-render.
        if (result.server && result.server.key) {
          _serversCache = Array.isArray(_serversCache) ? _serversCache.slice() : [];
          // Replace any existing entry with the same key (defensive)
          // before pushing, then re-sort by priority.
          _serversCache = _serversCache.filter((s) => s.key !== result.server.key);
          _serversCache.push(result.server);
          _serversCache.sort((a, b) => (a.priority || 0) - (b.priority || 0));
        }

        // Refresh from the canonical server list so any priority
        // shifts triggered by the insert (Property 1 / Req 1.6) are
        // reflected exactly as MongoDB stored them.
        try {
          _serversCache = await _fetchServers();
        } catch (_refetchErr) {
          // Optimistic cache is good enough; surface no extra error.
        }
        _render();

        _closeAddServerModal();
        _showToast(`Server "${formData.name}" added`, 'success');
        return;
      }

      // ── error branches ─────────────────────────────────────────
      if (result.status === 409) {
        _setFieldError(root, 'key', 'Server key already exists');
        return;
      }

      if (result.status === 400) {
        // Best-effort field-level inline error. The server returns a
        // human-readable string in `result.message`; if we can pull
        // a field name out of it we attach it to that input,
        // otherwise we fall back to a form-level error.
        const message = result.message || 'Validation failed';
        const guessed = _guessFieldFromMessage(message);
        if (guessed) {
          _setFieldError(root, guessed, message);
        } else {
          const formError = root.querySelector('.shd-form-error');
          if (formError) formError.textContent = message;
        }
        return;
      }

      // 401/403/5xx → toast and form-level error.
      const formError = root.querySelector('.shd-form-error');
      const message = result.message || `Request failed (${result.status})`;
      if (formError) formError.textContent = message;
      _showToast(message, 'error');
    } catch (err) {
      const formError = root.querySelector('.shd-form-error');
      const message = (err && err.message) || 'Network error';
      if (formError) formError.textContent = message;
      _showToast(`Failed to add server: ${message}`, 'error');
    } finally {
      if (submitBtn) submitBtn.disabled = false;
      if (cancelBtn) cancelBtn.disabled = false;
    }
  }

  /**
   * POST the form payload to the API. Resolves with a structured
   * result object — never throws — so the caller can handle the
   * status-code branches without unwrapping a try/catch.
   *
   * @param {object} formData
   * @returns {Promise<{ok:boolean, status:number, server?:object, message?:string}>}
   */
  async function _submitAddServer(formData) {
    if (!_apiFetch || !_readJsonResponse) {
      return { ok: false, status: 0, message: 'apiFetch helper is not available' };
    }

    let res;
    try {
      res = await _apiFetch(API_BASE_PATH, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify(formData),
      });
    } catch (err) {
      return { ok: false, status: 0, message: (err && err.message) || 'Network error' };
    }

    let payload = null;
    try {
      payload = await _readJsonResponse(res);
    } catch (_e) {
      payload = null;
    }

    if (res.ok && payload && payload.success !== false) {
      return {
        ok: true,
        status: res.status,
        server: payload.server || null,
      };
    }

    return {
      ok: false,
      status: res.status,
      message: (payload && payload.message) || `Request failed (${res.status})`,
    };
  }

  /**
   * Map a server-side validation message back to the form field it
   * concerns. Best-effort only — when no field can be inferred we
   * return null and the caller falls back to a form-level error.
   */
  function _guessFieldFromMessage(message) {
    const m = String(message || '').toLowerCase();
    if (m.includes('movieurlpattern')) return 'movieUrlPattern';
    if (m.includes('tvurlpattern'))    return 'tvUrlPattern';
    if (m.includes('animeurlpattern')) return 'animeUrlPattern';
    if (m.includes('sandbox'))         return 'sandboxPolicy';
    if (m.includes('timeout'))         return 'timeout';
    if (m.includes('priority'))        return 'priority';
    if (m.startsWith('type'))          return 'type';
    if (m.startsWith('name'))          return 'name';
    if (m.startsWith('key'))           return 'key';
    return null;
  }

  /**
   * Bootstrap the dashboard into the supplied container element.
   *
   * @param {string} containerId — id attribute of the host element
   */
  async function init(containerId) {
    const id = String(containerId || 'serverHealthDashboard');
    const el = document.getElementById(id);

    if (!el) {
      console.warn(`[ServerHealthDashboard] container #${id} not found`);
      return;
    }

    _container = el;
    _injectStyles();
    _wireEvents();
    _renderLoading();

    try {
      _serversCache = await _fetchServers();
      _lastUpdatedAt = Date.now();
      _render();
    } catch (err) {
      console.error('[ServerHealthDashboard] initial load failed:', err);
      _renderError((err && err.message) || 'Failed to load server data.');
    }

    _startPolling();
  }

  /**
   * Re-fetch the full server list and re-render. Useful after the
   * "Add Server" modal completes (task 9.2) or whenever an external
   * caller wants to force a refresh without waiting for the next
   * poll tick.
   *
   * @returns {Promise<void>}
   */
  async function refresh() {
    if (!_container) return;

    try {
      _serversCache = await _fetchServers();
      _lastUpdatedAt = Date.now();
      _render();
    } catch (err) {
      console.error('[ServerHealthDashboard] refresh failed:', err);
      _renderError((err && err.message) || 'Failed to load server data.');
    }
  }

  /**
   * Stop the polling timer. Call when the admin panel navigates away
   * from the Server Health section so the interval does not keep
   * issuing fetches in the background.
   */
  function destroy() {
    _stopPolling();
    _container = null;
    _wired = false;
    _serversCache = [];
    _lastUpdatedAt = null;
    _dragKey = null;
    // Tear down the modal — it lives on document.body and would
    // otherwise leak across SPA route changes. Subsequent dashboards
    // rebuild it lazily on first open.
    const modal = document.getElementById(MODAL_ROOT_ID);
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
  }

  // Expose the module on the global namespace. The admin panel HTML
  // (created in task 9.3) calls `ServerHealthDashboard.init(...)`
  // when the Server Health tab activates.
  window.ServerHealthDashboard = {
    init,
    refresh,
    destroy,
    // Exposed for task 9.2 (Add Server modal) so it can poke the
    // cache without re-fetching when the API already returned the
    // canonical doc.
    _internal: {
      get serversCache() { return _serversCache.slice(); },
      formatTimeAgo,
    },
  };
})();
