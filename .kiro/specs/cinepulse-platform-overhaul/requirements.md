# Requirements Document

## Introduction

This document specifies requirements for the **CinePulse Platform Overhaul** — a set of three deeply interconnected features that transform CinePulse from a functional streaming catalog into a world-class, Netflix-calibre streaming experience.

**Feature 1 — Server Health Monitor & No-Code Server Management**: A live admin dashboard that gives operators full visibility and control over every embed server (VidLink, Videasy, VidSrc IO, VidSrc ICU, 2Embed, VidSrc.to, VidNest, and all anime-specialist servers) without touching code. Server configuration is migrated from the static `public/js/embedServers.js` file into MongoDB so changes survive deployments.

**Feature 2 — Netflix-Style Home Page Redesign**: A complete overhaul of `/pages/index.html` into a full Netflix-style layout: a large auto-rotating hero billboard, horizontal scroll rails per category, 2:3 poster cards with hover-expand, and a category filter bar that filters all rails simultaneously without a page reload.

**Feature 3 — Netflix-Style Category/Browse Pages**: Dedicated browse pages (`/browse/movies`, `/browse/anime`, `/browse/series`, `/browse/kdrama`, `/browse/chinese`, `/browse/hindi`) with a category hero banner, infinite-scroll card grid, advanced filter sidebar, removable filter pills, sub-category toggles, in-page search, and breadcrumb navigation.

The platform runs on **Node.js + Express.js** (backend), **MongoDB + Mongoose** (database), **Vanilla JS + HTML/CSS** (frontend, no framework), deployed on **Vercel** (serverless). The existing embed server configuration lives in `public/js/embedServers.js` and the admin panel is at `/admin.html`.

---

## Glossary

- **Admin**: An authenticated user with `role: "admin"` in the User collection.
- **Embed_Server**: A third-party streaming provider (e.g., VidLink, Videasy) whose content is loaded inside an `<iframe>` on the player page. Defined by a name, URL patterns, sandbox policy, priority, and enabled/disabled state.
- **Standard_Server**: An Embed_Server that uses a TMDB ID to construct movie and TV episode URLs (e.g., VidLink, Videasy, VidSrc IO).
- **Anime_Server**: An Embed_Server that uses an AniList ID to construct anime episode URLs (e.g., VidNest Anime, VidNest Pahe).
- **Server_Config**: The MongoDB document that stores all properties of a single Embed_Server, replacing the equivalent entry in `public/js/embedServers.js`.
- **Health_Check**: An automated probe that loads a known-good test title on an Embed_Server and records whether the response indicates a working player.
- **Health_Status**: One of three states for an Embed_Server: `Working`, `Degraded`, or `Down`.
- **Success_Rate**: The percentage of Health_Checks for an Embed_Server that returned a `Working` result over the last 30 days, expressed as a number between 0 and 100.
- **Avg_Load_Time**: The arithmetic mean of response times (in milliseconds) recorded across all Health_Checks for an Embed_Server over the last 30 days.
- **Priority**: An integer assigned to each Embed_Server that determines the order in which the player attempts servers. Lower integer = higher priority.
- **Billboard**: The large full-viewport hero section at the top of the home page that auto-rotates through up to 5 featured titles.
- **Billboard_Item**: A single title displayed in the Billboard, including its backdrop image, title logo (if available), match score, genre pills, and action buttons.
- **Rail**: A horizontally scrollable row of media cards on the home page, grouped under a category label.
- **Rail_Card**: A single media card within a Rail, displayed at a 2:3 poster aspect ratio.
- **Category_Filter**: A pill button in the filter bar that, when activated, filters all Rails and the Billboard simultaneously to show only content matching that category.
- **Browse_Page**: A dedicated full-page view for a single content category (e.g., `/browse/anime`) containing a hero banner, infinite-scroll card grid, and filter sidebar.
- **Infinite_Scroll**: A pagination pattern where additional content is loaded automatically when the user scrolls within 200px of the bottom of the card grid.
- **Filter_Sidebar**: A collapsible panel on Browse Pages containing filter controls for Genre, Year, Rating, Language, Status, and Sort By.
- **Active_Filter_Pill**: A removable tag displayed above the card grid that represents one currently applied filter value.
- **Subbed_Dubbed_Toggle**: A two-state toggle on the anime Browse Page that filters results to show only Subbed or only Dubbed anime.
- **Breadcrumb**: A navigation trail (e.g., Home › Anime › Action) displayed at the top of Browse Pages.
- **Toast_Notification**: A transient in-app message displayed in the bottom-right corner of the screen for up to 5 seconds.
- **In_App_Notification**: A persistent notification stored in the Notification collection and surfaced in the admin panel's notification feed.
- **TMDB_ID**: The numeric identifier assigned to a title by The Movie Database API.
- **AniList_ID**: The numeric identifier assigned to an anime title by the AniList GraphQL API.
- **Scheduler**: The server-side mechanism (Vercel Cron or equivalent) that triggers Health_Checks on a configurable interval.
- **Probe_Title**: A known-good title (with a valid TMDB_ID or AniList_ID) used by the Scheduler to test each Embed_Server.
- **Hover_Expand**: A CSS/JS interaction on Rail_Cards where hovering causes the card to scale up and reveal additional metadata (title, rating, genre tags, Play button).
- **Progress_Dot**: A small circular indicator below the Billboard that shows which Billboard_Item is currently displayed and how many items remain.
- **See_All_Link**: A link at the right end of a Rail header that navigates to the corresponding Browse_Page.
- **Sandbox_Policy**: The value of the `sandbox` attribute applied to the `<iframe>` for an Embed_Server. Can be `"none"` (no sandbox attribute) or a space-separated list of sandbox tokens.
- **EmbedServers_JS**: The legacy static file `public/js/embedServers.js` that currently defines all Embed_Server configurations in code.
- **Server_Health_Collection**: The MongoDB collection `embed_server_health` that stores Health_Check results.
- **Server_Config_Collection**: The MongoDB collection `embed_server_configs` that stores Server_Config documents.

---

## Requirements

---

### Requirement 1: Server Configuration Persistence in MongoDB

**User Story:** As an Admin, I want all embed server configurations stored in MongoDB, so that changes I make in the admin panel persist across deployments without requiring code changes.

#### Acceptance Criteria

1. THE Server_Config_Collection SHALL store one document per Embed_Server containing at minimum: `key` (unique string), `name` (string), `type` (enum: `standard` | `anime`), `priority` (integer ≥ 1), `enabled` (boolean), `sandboxPolicy` (string), `movieUrlPattern` (string, nullable), `tvUrlPattern` (string, nullable), `animeUrlPattern` (string, nullable), `timeout` (integer, milliseconds), `createdAt` (Date), `updatedAt` (Date).
2. WHEN the CinePulse backend starts and the Server_Config_Collection is empty, THE Server_Config_Service SHALL seed the collection with all Embed_Servers currently defined in EmbedServers_JS, preserving their existing priority order and sandbox policies.
3. WHEN the Server_Config_Collection contains at least one document, THE Server_Config_Service SHALL NOT overwrite existing documents during startup seeding.
4. WHEN the player requests the list of active Embed_Servers, THE Server_Config_Service SHALL return only documents where `enabled` is `true`, ordered ascending by `priority`.
5. THE Server_Config_Collection SHALL enforce a unique index on the `key` field.
6. IF a Server_Config document is saved with a `priority` value already held by another document, THEN THE Server_Config_Service SHALL shift all documents with `priority ≥ new priority` up by one to maintain a contiguous, conflict-free priority sequence.

---

### Requirement 2: Admin Server Health Dashboard

**User Story:** As an Admin, I want a live dashboard in the admin panel that shows the current status of every embed server, so that I can immediately see which servers are working and which need attention.

#### Acceptance Criteria

1. WHEN an Admin navigates to the Server Health section of the admin panel, THE Dashboard SHALL display one Server_Card per Embed_Server stored in the Server_Config_Collection.
2. THE Dashboard SHALL render each Server_Card with the following fields visible without scrolling: server name, Health_Status badge (`Working` / `Degraded` / `Down`), last checked timestamp (human-readable, e.g., "3 minutes ago"), Success_Rate percentage, and Avg_Load_Time in milliseconds.
3. WHILE the Dashboard is open, THE Dashboard SHALL refresh all Server_Card data every 60 seconds without requiring a full page reload.
4. THE Dashboard SHALL display a "Last Updated" timestamp that updates each time the data is refreshed.
5. WHEN a Server_Card's Health_Status is `Down`, THE Dashboard SHALL render that card's status badge with a red background and the card border with a red highlight.
6. WHEN a Server_Card's Health_Status is `Degraded`, THE Dashboard SHALL render that card's status badge with an amber background.
7. WHEN a Server_Card's Health_Status is `Working`, THE Dashboard SHALL render that card's status badge with a green background.
8. THE Dashboard SHALL display a summary row at the top showing: total server count, count of `Working` servers, count of `Degraded` servers, and count of `Down` servers.

---

### Requirement 3: Admin Server Enable/Disable Toggle

**User Story:** As an Admin, I want to toggle any embed server on or off from the dashboard without touching code, so that I can instantly disable a broken server and re-enable it when it recovers.

#### Acceptance Criteria

1. THE Dashboard SHALL render a toggle switch on each Server_Card that reflects the current `enabled` state of that Embed_Server.
2. WHEN an Admin clicks the toggle switch on a Server_Card, THE Dashboard SHALL send a PATCH request to `PUT /api/admin/servers/:key` with `{ enabled: <new_boolean> }` and update the Server_Config document in MongoDB.
3. WHEN the PATCH request succeeds, THE Dashboard SHALL update the toggle switch state and display a Toast_Notification confirming the change (e.g., "VidLink disabled").
4. WHEN the PATCH request fails, THE Dashboard SHALL revert the toggle switch to its previous state and display a Toast_Notification with the error message.
5. WHEN an Embed_Server's `enabled` field is `false`, THE Player SHALL exclude that server from the list of sources returned by `GET /api/watch/:id/sources`.
6. IF an Admin disables all Embed_Servers simultaneously, THEN THE Player SHALL return an empty sources array and display a "No servers available" message to the viewer.

---

### Requirement 4: Admin Server Priority Reordering

**User Story:** As an Admin, I want to reorder embed servers by dragging and dropping (or using up/down arrows) in the dashboard, so that I can promote a reliable server to the top without editing code.

#### Acceptance Criteria

1. THE Dashboard SHALL render each Server_Card with up-arrow and down-arrow buttons that move the server one position higher or lower in priority.
2. WHEN an Admin clicks the up-arrow on a Server_Card that is not already at priority 1, THE Dashboard SHALL swap that server's priority with the server immediately above it and persist both changes to MongoDB via `PUT /api/admin/servers/reorder`.
3. WHEN an Admin clicks the down-arrow on a Server_Card that is not already at the lowest priority, THE Dashboard SHALL swap that server's priority with the server immediately below it and persist both changes to MongoDB.
4. WHEN the reorder request succeeds, THE Dashboard SHALL re-render the Server_Card list in the new priority order without a full page reload.
5. WHERE the user's browser supports the HTML Drag and Drop API, THE Dashboard SHALL also support drag-and-drop reordering of Server_Cards, committing the new order to MongoDB on drop.
6. WHEN a reorder operation is committed, THE Player SHALL use the updated priority order for all subsequent source-list requests within 5 seconds.

---

### Requirement 5: Admin Add New Embed Server

**User Story:** As an Admin, I want to add a new embed server by filling out a form in the admin panel, so that I can expand the server pool without deploying code changes.

#### Acceptance Criteria

1. THE Dashboard SHALL provide an "Add Server" button that opens a modal form with the following fields: Name (text, required), Key (text, required, must match `^[a-z0-9_]+$`), Type (select: `standard` | `anime`, required), Movie URL Pattern (text, required if Type is `standard`, must contain `{tmdbId}`), TV URL Pattern (text, required if Type is `standard`, must contain `{tmdbId}`, `{season}`, `{episode}`), Anime URL Pattern (text, required if Type is `anime`, must contain `{anilistId}`, `{episode}`), Sandbox Policy (text, default `"none"`), Timeout (number, milliseconds, default 9000), Priority (number, default = current highest priority + 1).
2. WHEN an Admin submits the Add Server form with all required fields valid, THE Dashboard SHALL POST to `POST /api/admin/servers` and insert a new Server_Config document with `enabled: true`.
3. WHEN the POST request succeeds, THE Dashboard SHALL close the modal, display a Toast_Notification ("Server added successfully"), and append the new Server_Card to the list.
4. IF the submitted Key already exists in the Server_Config_Collection, THEN THE Server_Config_Service SHALL return HTTP 409 and THE Dashboard SHALL display an inline validation error "Server key already exists" without closing the modal.
5. IF any required field is missing or fails pattern validation, THEN THE Dashboard SHALL display inline field-level error messages and SHALL NOT submit the form.
6. WHEN a new Embed_Server is added with `enabled: true`, THE Player SHALL include it in source lists for subsequent requests within 5 seconds.

---

### Requirement 6: Automated Server Health Checks

**User Story:** As an Admin, I want the platform to automatically probe each embed server on a schedule, so that I always have up-to-date health data without manually testing servers.

#### Acceptance Criteria

1. THE Scheduler SHALL trigger a Health_Check cycle for all enabled Embed_Servers every 30 minutes.
2. WHEN a Health_Check cycle runs, THE Health_Check_Service SHALL probe each enabled Embed_Server by constructing a URL using the server's URL pattern and a designated Probe_Title (a title with a known-valid TMDB_ID or AniList_ID stored in environment configuration).
3. WHEN a probe response is received within the server's configured `timeout` milliseconds and the HTTP status code is 200, THE Health_Check_Service SHALL record the result as `Working` with the measured response time.
4. WHEN a probe response is received within the timeout but the HTTP status code is not 200, THE Health_Check_Service SHALL record the result as `Degraded` with the measured response time.
5. WHEN a probe does not receive a response within the server's configured `timeout` milliseconds, THE Health_Check_Service SHALL record the result as `Down` with a response time equal to the timeout value.
6. THE Health_Check_Service SHALL write each probe result as a document to the Server_Health_Collection containing: `serverKey`, `status`, `responseTime`, `httpStatusCode`, `checkedAt`.
7. AFTER writing a probe result, THE Health_Check_Service SHALL update the corresponding Server_Config document with: `lastCheckedAt`, `lastStatus`, `successRate` (computed over the last 30 days of results), and `avgLoadTime` (computed over the last 30 days of results).
8. THE Health_Check_Service SHALL run all server probes in parallel (not sequentially) to complete a full cycle within 2× the maximum configured server timeout.
9. IF the Scheduler fails to complete a Health_Check cycle due to an unhandled exception, THEN THE Health_Check_Service SHALL log the error and schedule the next cycle at the normal interval without crashing the server process.
10. THE Server_Health_Collection SHALL retain Health_Check documents for 30 days and THE Health_Check_Service SHALL delete documents older than 30 days during each cycle.

---

### Requirement 7: Server Down Notifications

**User Story:** As an Admin, I want to be notified immediately when an embed server goes down, so that I can take action before viewers are affected.

#### Acceptance Criteria

1. WHEN a Health_Check records a `Down` status for an Embed_Server that had a `Working` or `Degraded` status in its previous check, THE Notification_Service SHALL create an In_App_Notification in the Notification collection with severity `critical` and message "Server {name} is Down".
2. WHEN a Health_Check records a `Degraded` status for an Embed_Server that had a `Working` status in its previous check, THE Notification_Service SHALL create an In_App_Notification with severity `warning` and message "Server {name} is Degraded".
3. WHEN a Health_Check records a `Working` status for an Embed_Server that had a `Down` or `Degraded` status in its previous check, THE Notification_Service SHALL create an In_App_Notification with severity `info` and message "Server {name} has recovered".
4. WHEN an Admin is viewing the admin panel and a new In_App_Notification is created, THE Admin_Panel SHALL display a Toast_Notification within 60 seconds of the notification being created.
5. WHERE an `ADMIN_EMAIL` environment variable is configured, THE Notification_Service SHALL send an email to that address when a server transitions to `Down` status, containing the server name, timestamp, and a link to the Server Health Dashboard.
6. THE Notification_Service SHALL NOT send duplicate notifications for the same server remaining in the same status across consecutive checks (i.e., only notify on status transitions).

---

### Requirement 8: Billboard Hero — Auto-Rotating Carousel

**User Story:** As a viewer, I want to see a large, visually stunning hero section at the top of the home page that automatically cycles through featured titles, so that I can discover new content at a glance.

#### Acceptance Criteria

1. THE Billboard SHALL display exactly 5 Billboard_Items selected from the platform's featured or trending content.
2. WHEN the home page loads, THE Billboard SHALL display the first Billboard_Item immediately, with its backdrop image filling the full viewport width and at least 70% of the viewport height.
3. THE Billboard SHALL automatically advance to the next Billboard_Item every 6 seconds.
4. WHEN the Billboard advances to a new Billboard_Item, THE Billboard SHALL transition the backdrop image and copy with a smooth cross-fade animation lasting no more than 600 milliseconds.
5. THE Billboard SHALL display Progress_Dots below the hero copy — one dot per Billboard_Item — with the dot corresponding to the currently displayed item rendered as active (filled/highlighted).
6. WHEN a viewer clicks a Progress_Dot, THE Billboard SHALL immediately display the corresponding Billboard_Item and reset the 6-second auto-advance timer.
7. WHEN a viewer hovers over the Billboard on a non-touch device, THE Billboard SHALL pause the auto-advance timer for the duration of the hover.
8. WHEN a viewer stops hovering over the Billboard, THE Billboard SHALL resume the auto-advance timer from the beginning of the current item's 6-second interval.
9. THE Billboard SHALL display for each Billboard_Item: backdrop image, title logo image (if `logoUrl` is available in the Movie document) or the title text as a fallback, a match score (integer between 92 and 99, deterministically derived from the title's `_id`), up to 3 genre pills, a "Play Now" button linking to the movie details page, and a "More Info" button linking to the movie details page.
10. IF a Billboard_Item's backdrop image fails to load, THEN THE Billboard SHALL display a dark gradient background and continue rendering all text and button elements.

---

### Requirement 9: Billboard Hero — Mobile Responsiveness

**User Story:** As a viewer on a mobile device, I want the hero billboard to be fully usable and visually correct, so that I have the same quality experience as on desktop.

#### Acceptance Criteria

1. WHILE the viewport width is less than 768px, THE Billboard SHALL reduce its minimum height to 70% of the viewport height and align the hero copy to the bottom of the section.
2. WHILE the viewport width is less than 768px, THE Billboard SHALL apply a vertical gradient overlay (dark at bottom, semi-transparent at top) so that text remains legible over any backdrop image.
3. WHILE the viewport width is less than 768px, THE Billboard SHALL center-align the title, meta row, genre pills, and action buttons.
4. WHILE the viewport width is less than 768px, THE Billboard SHALL render the "Play Now" and "More Info" buttons at a minimum touch target size of 44×44px.
5. WHILE the viewport width is less than 768px, THE Billboard SHALL support swipe-left and swipe-right gestures to navigate between Billboard_Items.

---

### Requirement 10: Home Page Horizontal Scroll Rails

**User Story:** As a viewer, I want to see multiple categorised horizontal scroll rails below the hero, so that I can quickly browse different types of content without leaving the home page.

#### Acceptance Criteria

1. THE Home_Page SHALL render the following Rails in this order (when content is available): Continue Watching (only if the viewer has watch history), Trending This Week, New Releases, Top Rated, Premium Series, Elite Anime, Hollywood, K-Drama, Chinese (Donghua), Hindi Dubbed, Recommended For You.
2. THE Continue_Watching_Rail SHALL only be visible when the viewer has at least one item in their local watch history (`cs_continue_watching` localStorage key).
3. WHEN the Continue_Watching_Rail is visible, THE Continue_Watching_Rail SHALL display items in reverse chronological order of last-watched timestamp.
4. EACH Rail SHALL display a header containing: a category label (e.g., "TRENDING THIS WEEK"), a subtitle line, and a "See All" link that navigates to the corresponding Browse_Page.
5. EACH Rail SHALL be horizontally scrollable and SHALL display a minimum of 6 Rail_Cards before requiring scroll.
6. WHEN a Rail contains no content, THE Home_Page SHALL hide that Rail's section entirely rather than showing an empty container.
7. WHILE the viewport width is less than 768px, EACH Rail SHALL use `scrollbar-width: none` to hide the scrollbar and SHALL support native touch scroll.
8. WHILE the viewport width is less than 768px, EACH Rail_Card SHALL have a minimum width of 160px and a maximum width of 74vw.

---

### Requirement 11: Rail Cards — 2:3 Poster Ratio with Hover Expand

**User Story:** As a viewer, I want media cards to display at a 2:3 poster ratio with a hover effect that reveals more details, so that I can quickly assess a title's appeal before clicking.

#### Acceptance Criteria

1. EACH Rail_Card SHALL maintain a 2:3 aspect ratio (width:height) at all viewport sizes.
2. EACH Rail_Card SHALL display the poster image as the primary visual, with a title text overlay at the bottom as a fallback when no poster is available.
3. WHEN a viewer hovers over a Rail_Card on a non-touch device, THE Rail_Card SHALL scale to 1.08× its original size with a smooth CSS transition of no more than 250 milliseconds.
4. WHEN a Rail_Card is in the hover-expanded state, THE Rail_Card SHALL display an overlay containing: the title, the rating (formatted as a star + number), up to 2 genre tags, and a "Play" button.
5. WHEN a viewer clicks the "Play" button on a Rail_Card overlay, THE Browser SHALL navigate to `movie-details.html?id={_id}`.
6. WHEN a viewer clicks anywhere on a Rail_Card (outside the "Play" button), THE Browser SHALL navigate to `movie-details.html?id={_id}`.
7. IF a Rail_Card's poster image fails to load, THEN THE Rail_Card SHALL display a dark placeholder with the title text centred.
8. THE Rail_Card SHALL only be rendered for items where `canPlay()` returns `true` (i.e., the item has a valid `tmdbId`, `anilistId`, or `videoUrl`).

---

### Requirement 12: Category Filter Bar

**User Story:** As a viewer, I want a row of category filter pills at the top of the home page that instantly filter all rails to show only the selected category, so that I can focus on the type of content I want without reloading the page.

#### Acceptance Criteria

1. THE Category_Filter_Bar SHALL display the following pill buttons: All, Hollywood, Anime, Chinese (Donghua), K-Drama, Hindi Dubbed.
2. WHEN the home page loads, THE Category_Filter_Bar SHALL activate the "All" pill by default.
3. WHEN a viewer clicks a Category_Filter pill, THE Home_Page SHALL update the URL query parameter `sidebarCategory` to the selected category value without triggering a full page reload.
4. WHEN a Category_Filter is active (not "All"), THE Home_Page SHALL re-fetch and re-render all Rails to show only content matching that category.
5. WHEN a Category_Filter is active, THE Billboard SHALL also update to show only Billboard_Items from that category.
6. WHEN a viewer navigates back using the browser's back button, THE Category_Filter_Bar SHALL restore the previously active filter from the URL query parameter.
7. WHEN a Category_Filter is active, THE Category_Filter_Bar SHALL render the active pill with the accent colour background and white text.
8. WHILE the viewport width is less than 768px, THE Category_Filter_Bar SHALL allow horizontal scrolling so all pills remain accessible without wrapping to multiple lines.

---

### Requirement 13: Browse Page Structure

**User Story:** As a viewer, I want dedicated browse pages for each content category, so that I can explore the full catalog for a specific type of content with advanced filtering.

#### Acceptance Criteria

1. THE Platform SHALL serve Browse_Pages at the following routes: `/browse/movies`, `/browse/anime`, `/browse/series`, `/browse/kdrama`, `/browse/chinese`, `/browse/hindi`.
2. EACH Browse_Page SHALL display a Breadcrumb at the top of the content area in the format "Home › {Category Name}".
3. EACH Browse_Page SHALL display a category hero banner below the Breadcrumb, containing a background image representative of the category, the category name as a large heading, and a short descriptive subtitle.
4. EACH Browse_Page SHALL display a card grid below the hero banner that initially loads 24 items.
5. THE card grid on Browse_Pages SHALL use a responsive CSS grid with a minimum card width of 160px, expanding to fill available columns.
6. WHEN a viewer scrolls to within 200px of the bottom of the card grid, THE Browse_Page SHALL automatically fetch and append the next page of 24 items (Infinite_Scroll).
7. WHEN all available items have been loaded, THE Browse_Page SHALL display a "You've reached the end" message and SHALL NOT make further fetch requests.
8. WHEN a Browse_Page is loading additional items via Infinite_Scroll, THE Browse_Page SHALL display a loading spinner at the bottom of the grid.

---

### Requirement 14: Browse Page Advanced Filter Sidebar

**User Story:** As a viewer, I want an advanced filter sidebar on browse pages, so that I can narrow down the catalog by genre, year, rating, language, status, and sort order.

#### Acceptance Criteria

1. EACH Browse_Page SHALL display a Filter_Sidebar containing the following filter controls: Genre (multi-select checkboxes), Year (range slider or dual input: min year to max year), Rating (range slider: 0.0 to 10.0, step 0.5), Language (multi-select checkboxes), Status (checkboxes: Ongoing, Completed, Upcoming, Cancelled), Sort By (select: Newest, Oldest, Highest Rated, Most Popular, A–Z, Z–A).
2. WHEN a viewer selects or changes any filter value, THE Browse_Page SHALL re-fetch the card grid from the first page using the updated filter parameters and replace the existing grid content.
3. WHEN one or more filters are active, THE Browse_Page SHALL display Active_Filter_Pills above the card grid, one pill per active filter value, each showing the filter name and value.
4. WHEN a viewer clicks the × on an Active_Filter_Pill, THE Browse_Page SHALL remove that filter value, re-fetch the grid, and remove the pill.
5. THE Browse_Page SHALL display a "Clear All Filters" button above the card grid when at least one filter is active; clicking it SHALL reset all filters to their default state and re-fetch the grid.
6. WHILE the viewport width is less than 1024px, THE Filter_Sidebar SHALL be hidden by default and accessible via a "Filters" button that opens it as a slide-in drawer.
7. WHILE the viewport width is greater than or equal to 1024px, THE Filter_Sidebar SHALL be permanently visible as a left-side panel.
8. THE Filter_Sidebar SHALL persist its open/closed state in `sessionStorage` so that navigating back to a Browse_Page restores the sidebar state.

---

### Requirement 15: Browse Page Card Hover Details

**User Story:** As a viewer, I want hovering over a card on a browse page to reveal key details, so that I can evaluate a title without navigating away.

#### Acceptance Criteria

1. EACH card on a Browse_Page SHALL maintain a 2:3 aspect ratio and display the poster image as the primary visual.
2. WHEN a viewer hovers over a card on a non-touch device, THE card SHALL display an overlay containing: title, release year, rating, episode count (for series and anime), and a "Play" button.
3. WHEN a viewer clicks the "Play" button on a card overlay, THE Browser SHALL navigate to `movie-details.html?id={_id}`.
4. WHEN a viewer clicks anywhere on a card (outside the "Play" button), THE Browser SHALL navigate to `movie-details.html?id={_id}`.
5. IF a card's poster image fails to load, THEN THE card SHALL display a dark placeholder with the title text centred.

---

### Requirement 16: Anime Browse Page — Subbed/Dubbed Toggle

**User Story:** As an anime viewer, I want a Subbed/Dubbed toggle on the anime browse page, so that I can filter the catalog to show only my preferred audio format.

#### Acceptance Criteria

1. THE `/browse/anime` Browse_Page SHALL display a Subbed_Dubbed_Toggle above the card grid with two states: "Subbed" and "Dubbed".
2. WHEN the Subbed_Dubbed_Toggle is set to "Subbed", THE Browse_Page SHALL filter the card grid to show only items where `subDubTag` is `"Subbed"` or `subDubTag` is null/undefined.
3. WHEN the Subbed_Dubbed_Toggle is set to "Dubbed", THE Browse_Page SHALL filter the card grid to show only items where `subDubTag` is `"Dubbed"`.
4. WHEN the Subbed_Dubbed_Toggle state changes, THE Browse_Page SHALL re-fetch the card grid from page 1 with the updated filter.
5. THE Subbed_Dubbed_Toggle SHALL be reflected as an Active_Filter_Pill when either "Subbed" or "Dubbed" is explicitly selected.

---

### Requirement 17: Browse Page In-Category Search

**User Story:** As a viewer, I want a search input on each browse page that searches within that category only, so that I can find specific titles without leaving the browse context.

#### Acceptance Criteria

1. EACH Browse_Page SHALL display a search input field labelled "Search within {Category Name}…".
2. WHEN a viewer types at least 2 characters into the search input, THE Browse_Page SHALL debounce for 300 milliseconds and then re-fetch the card grid filtered to titles matching the query within the current category.
3. WHEN the search input is cleared, THE Browse_Page SHALL re-fetch the card grid with the previously active filters (excluding the search query).
4. WHEN a search is active, THE Browse_Page SHALL display a "Searching for: {query}" Active_Filter_Pill above the grid.
5. WHEN a search returns zero results, THE Browse_Page SHALL display a "No results found for '{query}'" message in place of the card grid.

---

### Requirement 18: Browse Page Breadcrumb Navigation

**User Story:** As a viewer, I want breadcrumb navigation on browse pages, so that I always know where I am and can navigate back to the home page in one click.

#### Acceptance Criteria

1. EACH Browse_Page SHALL display a Breadcrumb at the top of the main content area.
2. THE Breadcrumb SHALL contain at minimum two segments: "Home" (linking to `/pages/index.html`) and the current category name (non-linking, current page indicator).
3. WHEN a viewer clicks the "Home" segment of the Breadcrumb, THE Browser SHALL navigate to `/pages/index.html`.
4. THE Breadcrumb SHALL use `aria-label="breadcrumb"` and `aria-current="page"` on the final segment for accessibility.

---

### Requirement 19: API Endpoints for Server Management

**User Story:** As a developer, I want well-defined REST API endpoints for server management, so that the admin dashboard can perform all CRUD and reorder operations reliably.

#### Acceptance Criteria

1. THE Backend SHALL expose `GET /api/admin/servers` (Admin auth required) that returns all Server_Config documents ordered by `priority` ascending.
2. THE Backend SHALL expose `POST /api/admin/servers` (Admin auth required) that creates a new Server_Config document; returns HTTP 201 on success, HTTP 409 if the key already exists, HTTP 400 if required fields are missing or invalid.
3. THE Backend SHALL expose `PUT /api/admin/servers/:key` (Admin auth required) that updates any mutable field of a Server_Config document; returns HTTP 200 on success, HTTP 404 if the key does not exist.
4. THE Backend SHALL expose `DELETE /api/admin/servers/:key` (Admin auth required) that removes a Server_Config document; returns HTTP 200 on success, HTTP 404 if the key does not exist.
5. THE Backend SHALL expose `PUT /api/admin/servers/reorder` (Admin auth required) that accepts a body of `{ orderedKeys: [string] }` and reassigns `priority` values (1, 2, 3, …) to match the submitted order; returns HTTP 200 on success.
6. THE Backend SHALL expose `GET /api/admin/servers/health` (Admin auth required) that returns the latest Health_Check result for each Embed_Server.
7. THE Backend SHALL expose `POST /api/admin/servers/health/run` (Admin auth required) that triggers an immediate Health_Check cycle outside the scheduled interval; returns HTTP 202 Accepted immediately and runs the cycle asynchronously.
8. ALL admin server management endpoints SHALL return HTTP 401 when called without a valid admin JWT.

---

### Requirement 20: API Endpoints for Browse Pages

**User Story:** As a developer, I want browse page API endpoints that support filtering, sorting, and pagination, so that the frontend can power the infinite-scroll grid and filter sidebar without custom per-page logic.

#### Acceptance Criteria

1. THE Backend SHALL expose `GET /api/browse/:category` that accepts query parameters: `page` (integer, default 1), `limit` (integer, default 24, max 48), `genre` (comma-separated string), `yearMin` (integer), `yearMax` (integer), `ratingMin` (float), `ratingMax` (float), `language` (comma-separated string), `status` (comma-separated string), `sortBy` (enum: `newest` | `oldest` | `rating` | `popular` | `az` | `za`, default `newest`), `q` (string, search query), `subDub` (enum: `subbed` | `dubbed`).
2. WHEN `GET /api/browse/:category` is called, THE Backend SHALL return a JSON response containing: `items` (array of Movie documents), `total` (integer, total matching count), `page` (integer), `totalPages` (integer), `hasMore` (boolean).
3. WHEN the `:category` parameter is `anime`, THE Backend SHALL filter results to documents where `category` is `"anime"`.
4. WHEN the `:category` parameter is `movies`, THE Backend SHALL filter results to documents where `category` is `"movie"`.
5. WHEN the `:category` parameter is `series`, THE Backend SHALL filter results to documents where `category` is `"series"`.
6. WHEN the `:category` parameter is `kdrama`, THE Backend SHALL filter results to documents where `original_language` is `"ko"`.
7. WHEN the `:category` parameter is `chinese`, THE Backend SHALL filter results to documents where `original_language` is `"zh"`.
8. WHEN the `:category` parameter is `hindi`, THE Backend SHALL filter results to documents where `original_language` is `"hi"`.
9. WHEN the `subDub` parameter is provided and `:category` is `anime`, THE Backend SHALL apply the `subDubTag` filter.
10. IF an unrecognised `:category` value is provided, THEN THE Backend SHALL return HTTP 400 with a descriptive error message.

---

### Requirement 21: Player Integration with MongoDB-Driven Server Config

**User Story:** As a viewer, I want the video player to use the server priority and enabled state from MongoDB, so that admin changes take effect immediately without a deployment.

#### Acceptance Criteria

1. WHEN `GET /api/watch/:id/sources` is called, THE Watch_Service SHALL fetch the current list of enabled Embed_Servers from the Server_Config_Collection, ordered by `priority` ascending.
2. THE Watch_Service SHALL construct embed URLs using the URL patterns stored in the Server_Config documents, substituting `{tmdbId}`, `{season}`, `{episode}`, `{anilistId}` placeholders with the actual values from the Movie document.
3. WHEN a Server_Config document's `enabled` field is `false`, THE Watch_Service SHALL exclude that server from the returned sources array.
4. THE Watch_Service SHALL cache the Server_Config list in memory for a maximum of 5 minutes to reduce MongoDB reads on high-traffic deployments.
5. WHEN an Admin updates a Server_Config document (enable/disable, reorder, add, delete), THE Watch_Service SHALL invalidate its in-memory cache so the next request reflects the change within 5 seconds.

---

## Correctness Properties

The following properties define invariants and round-trip behaviours that MUST hold across all implementations and SHOULD be verified with property-based tests.

### Property 1: Server Priority Sequence Invariant

**Scope**: Server_Config_Collection after any create, update, reorder, or delete operation.

**Property**: After any mutation to the Server_Config_Collection, the set of `priority` values across all documents SHALL form a contiguous sequence of integers starting at 1 with no gaps and no duplicates.

**Testable as**: Property-based test — generate random sequences of add/remove/reorder operations and assert the priority sequence invariant holds after each operation.

```
FOR ALL sequences of [add, remove, reorder] operations on Server_Config_Collection:
  LET priorities = sorted list of priority values across all documents
  ASSERT priorities == [1, 2, 3, ..., len(priorities)]
```

---

### Property 2: Embed URL Round-Trip Substitution

**Scope**: URL pattern substitution in Watch_Service.

**Property**: For any Server_Config document with a valid URL pattern and any valid set of IDs, constructing the embed URL and then extracting the substituted values back from the URL SHALL recover the original IDs.

**Testable as**: Property-based test — generate random valid TMDB IDs, season numbers, and episode numbers; substitute into patterns; parse back; assert equality.

```
FOR ALL (tmdbId: positive integer, season: 1..20, episode: 1..200):
  LET url = substitute(movieUrlPattern, {tmdbId})
  ASSERT extractTmdbId(url) == tmdbId

FOR ALL (tmdbId: positive integer, season: 1..20, episode: 1..200):
  LET url = substitute(tvUrlPattern, {tmdbId, season, episode})
  ASSERT extractTmdbId(url) == tmdbId
  ASSERT extractSeason(url) == season
  ASSERT extractEpisode(url) == episode
```

---

### Property 3: Health Check Success Rate Bounds

**Scope**: `successRate` field on Server_Config documents.

**Property**: The `successRate` value computed by the Health_Check_Service SHALL always be a number in the closed interval [0, 100].

**Testable as**: Property-based test — generate random sequences of `Working` / `Degraded` / `Down` results and assert the computed success rate is always within bounds.

```
FOR ALL sequences of Health_Check results (length 1..1000):
  LET rate = computeSuccessRate(results)
  ASSERT 0 <= rate <= 100
```

---

### Property 4: Filter Idempotence

**Scope**: Browse page API — `GET /api/browse/:category`.

**Property**: Applying the same set of filter parameters twice to the same dataset SHALL return identical results (idempotence).

**Testable as**: Property-based test — generate random valid filter parameter sets; call the endpoint twice with the same parameters; assert the response bodies are identical.

```
FOR ALL valid filter parameter sets P:
  LET response1 = GET /api/browse/:category?P
  LET response2 = GET /api/browse/:category?P
  ASSERT response1.items == response2.items
  ASSERT response1.total == response2.total
```

---

### Property 5: Pagination Completeness

**Scope**: Browse page API pagination.

**Property**: Fetching all pages of results for a given filter set and concatenating the `items` arrays SHALL yield exactly `total` unique items with no duplicates.

**Testable as**: Property-based test — for random filter sets, paginate through all pages and assert the union of all items equals `total` with no duplicate `_id` values.

```
FOR ALL valid filter parameter sets P where total > 0:
  LET allItems = []
  FOR page = 1 TO totalPages:
    allItems += GET /api/browse/:category?P&page={page}&limit=24 .items
  ASSERT len(allItems) == total
  ASSERT len(unique(_id values in allItems)) == total
```

---

### Property 6: Enabled Server Subset Invariant

**Scope**: `GET /api/watch/:id/sources` response.

**Property**: The set of server keys in the sources response SHALL always be a subset of the server keys where `enabled` is `true` in the Server_Config_Collection.

**Testable as**: Property-based test — generate random enabled/disabled configurations; call the sources endpoint; assert the returned server keys are a subset of enabled keys.

```
FOR ALL Server_Config states S:
  LET enabledKeys = {doc.key | doc in S where doc.enabled == true}
  LET sourceKeys = {source.server | source in GET /api/watch/:id/sources}
  ASSERT sourceKeys ⊆ enabledKeys
```

---

### Property 7: Billboard Item Count Invariant

**Scope**: Billboard rendering on the home page.

**Property**: The Billboard SHALL always display exactly 5 Progress_Dots regardless of how many items are returned by the API (clamped to 5).

**Testable as**: Example-based test — mock the featured content API to return 1, 3, 5, 7, and 10 items; assert the Progress_Dot count is always min(returned count, 5).

```
FOR count IN [1, 3, 5, 7, 10]:
  LET dots = renderBillboard(mockItems(count)).progressDotCount
  ASSERT dots == min(count, 5)
```

---

### Property 8: Category Filter Monotonicity

**Scope**: Browse page API — filtered result count.

**Property**: Adding more restrictive filter constraints SHALL never increase the total result count.

**Testable as**: Property-based test — generate a base filter set and a more restrictive superset; assert the superset total is ≤ the base total.

```
FOR ALL filter sets F1, F2 where F2 is strictly more restrictive than F1:
  LET total1 = GET /api/browse/:category?F1 .total
  LET total2 = GET /api/browse/:category?F2 .total
  ASSERT total2 <= total1
```

---

### Property 9: Server Config Serialisation Round-Trip

**Scope**: Server_Config document serialisation to/from MongoDB.

**Property**: Saving a Server_Config document to MongoDB and reading it back SHALL produce a document with identical field values (excluding auto-generated `_id`, `createdAt`, `updatedAt`).

**Testable as**: Property-based test — generate random valid Server_Config objects; write to MongoDB; read back; assert field equality.

```
FOR ALL valid Server_Config objects C:
  LET saved = insert(C) into Server_Config_Collection
  LET retrieved = findOne({key: C.key})
  ASSERT retrieved.key == C.key
  ASSERT retrieved.name == C.name
  ASSERT retrieved.priority == C.priority
  ASSERT retrieved.enabled == C.enabled
  ASSERT retrieved.sandboxPolicy == C.sandboxPolicy
  ASSERT retrieved.timeout == C.timeout
```

---

### Property 10: Notification Transition-Only Invariant

**Scope**: Notification_Service — server status change notifications.

**Property**: For any sequence of consecutive Health_Check results for a single server, the number of In_App_Notifications created SHALL equal the number of status transitions (changes from one status to a different status), not the total number of checks.

**Testable as**: Property-based test — generate random sequences of Health_Status values; simulate the notification logic; assert notification count equals transition count.

```
FOR ALL sequences of Health_Status values S (length 1..100):
  LET transitions = count of index i where S[i] != S[i-1] (for i > 0)
  LET notifications = simulateNotifications(S)
  ASSERT len(notifications) == transitions
```
