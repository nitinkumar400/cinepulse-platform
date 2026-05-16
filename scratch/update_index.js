const fs = require('fs');

let html = fs.readFileSync('public/pages/index.html', 'utf8');

// Replace renderRail inner HTML
html = html.replace(
  /container\.innerHTML = list\.map\(\(item, index\) => buildCardMarkup\(item, \{\s*rank: options\.withRank && index < 5 \? item\.trendingRank \|\| index \+ 1 : '',\s*\}\)\)\.join\(''\);\s*bindIndexImageFallback\(container\);/g,
  `container.innerHTML = list.map((item, index) => buildCardMarkup(item, {\n    rank: options.withRank && index < 10 ? item.trendingRank || index + 1 : '',\n    wide: options.withRank ? false : true\n  })).join('');\n  bindIndexImageFallback(container);`
);

// Replace loadTopRatedMoviesRail options
html = html.replace(
  /renderRail\('topRatedMoviesRail',\s*_sanitizeCatalog\(payload\.movies \|\| \[\],\s*\{\s*allowOngoing:\s*false\s*\}\),\s*\{\s*emptyText:\s*'Top rated movies will appear here\.'\s*\}\);/g,
  `renderRail('topRatedMoviesRail', _sanitizeCatalog(payload.movies || [], { allowOngoing: false }), { withRank: true, emptyText: 'Top rated movies will appear here.' });`
);

// Add Telegram banner
html = html.replace(
  /<!-- ══════════════════════════════════════════════════════\s*Ghost Profile: Continue Watching Rail\s*══════════════════════════════════════════════════════ -->/g,
  `<!-- ══════════════════════════════════════════════════════
       TELEGRAM BANNER (Netflix Layout Overhaul)
       ══════════════════════════════════════════════════════ -->
  <section class="telegram-hero-banner" style="margin-top: -60px; position: relative; z-index: 10;">
    <div class="telegram-hero-banner-content">
      <h4>Important Note</h4>
      <p>This site link is temporary and will change every month. To stay updated, download the NetMirror app on your mobile device for the latest PC link or visit our main site.<br/>Join our main site for the latest updates about the new mobile app and PC site.</p>
    </div>
    <a href="https://t.me/cinepulse_platform" target="_blank" class="telegram-hero-banner-btn">
      <i class="ri-telegram-fill" style="font-size: 20px;"></i>
      Join Our Telegram Channel Now
    </a>
  </section>

  <!-- ══════════════════════════════════════════════════════
       Ghost Profile: Continue Watching Rail
       ══════════════════════════════════════════════════════ -->`
);

fs.writeFileSync('public/pages/index.html', html);
console.log('index.html updated successfully.');
