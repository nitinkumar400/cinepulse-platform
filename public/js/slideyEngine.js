/**
 * Slidey Engine - CinePulse Elite
 * Manages the 70/30 asymmetric hero showcase with auto-rotation and queue.
 */

class SlideyEngine {
  constructor() {
    this.movies = [];
    this.activeIndex = 0;
    this.timer = null;
    this.intervalMs = 7000;
    
    // DOM Elements
    this.els = {
      left: document.getElementById('slideyLeft'),
      title: document.getElementById('slideyTitle'),
      desc: document.getElementById('slideyDesc'),
      rating: document.getElementById('slideyRating'),
      year: document.getElementById('slideyYear'),
      category: document.getElementById('slideyCategory'),
      watchBtn: document.getElementById('slideyWatchBtn'),
      infoBtn: document.getElementById('slideyInfoBtn'),
      queueList: document.getElementById('slideyQueueList')
    };
  }

  async init() {
    if (!this.els.left) return;
    
    try {
      const res = await apiFetch('/movies?limit=6&sort=highest_rated');
      const data = await readJsonResponse(res);
      this.movies = (data.movies || []).filter(m => m.backdropUrl || m.bannerUrl || m.posterUrl).slice(0, 5);
      
      if (this.movies.length === 0) {
        this.els.left.style.display = 'none';
        return;
      }
      
      this.renderQueue();
      this.setActive(0);
      this.startTimer();
      
    } catch (err) {
      console.error('SlideyEngine error:', err);
    }
  }

  setActive(index) {
    this.activeIndex = index;
    const movie = this.movies[index];
    if (!movie) return;
    
    // Update Left Viewport
    const bgUrl = mediaUrl(movie.backdropUrl || movie.bannerUrl || movie.posterUrl, 'original');
    
    // Smooth transition trick: create a temporary image to preload
    const img = new Image();
    img.src = bgUrl;
    img.onload = () => {
      this.els.left.style.backgroundImage = `url('${bgUrl}')`;
    };
    
    this.els.title.textContent = movie.title || 'Untitled';
    this.els.desc.textContent = movie.synopsis || movie.description || 'No description available.';
    this.els.rating.textContent = (movie.averageRating > 0) ? movie.averageRating.toFixed(1) : 'NEW';
    this.els.year.textContent = movie.releaseYear || new Date().getFullYear();
    this.els.category.textContent = String(movie.category || 'Movie').toUpperCase();
    
    this.els.watchBtn.onclick = () => { window.location.href = `/pages/movie-details.html?id=${movie._id}`; };
    this.els.infoBtn.onclick = () => { window.location.href = `/pages/movie-details.html?id=${movie._id}`; };
    
    // Update Queue UI
    Array.from(this.els.queueList.children).forEach((child, i) => {
      if (i === index) child.classList.add('active');
      else child.classList.remove('active');
    });
  }

  renderQueue() {
    this.els.queueList.innerHTML = '';
    
    this.movies.forEach((movie, idx) => {
      const item = document.createElement('div');
      item.className = 'slidey-queue-item';
      
      const thumbUrl = mediaUrl(movie.posterUrl || movie.thumbnailUrl, 'w200');
      
      item.innerHTML = `
        <img src="${thumbUrl}" class="slidey-item-thumb" alt="Thumbnail">
        <div class="slidey-item-info">
          <h4>${escapeHtml(movie.title)}</h4>
          <span>${movie.releaseYear || ''} • ${movie.category || 'Movie'}</span>
        </div>
      `;
      
      item.onclick = () => {
        this.setActive(idx);
        this.resetTimer();
      };
      
      this.els.queueList.appendChild(item);
    });
  }

  next() {
    let nextIdx = this.activeIndex + 1;
    if (nextIdx >= this.movies.length) nextIdx = 0;
    this.setActive(nextIdx);
  }

  startTimer() {
    this.timer = setInterval(() => this.next(), this.intervalMs);
  }

  resetTimer() {
    clearInterval(this.timer);
    this.startTimer();
  }
}

// Auto-init when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  const slidey = new SlideyEngine();
  slidey.init();
});
