// ══════════════════════════════════════════
// CINE STREAM — Subtitle Service
// backend/services/subtitleService.js
// ══════════════════════════════════════════
const axios  = require('axios');
const fs     = require('fs');
const path   = require('path');
const https  = require('https');
const { getEnv } = require('../config/env');

const OPENSUB_BASE    = 'https://api.opensubtitles.com/api/v1';
const OPENSUB_API_KEY = getEnv('OPENSUB_API_KEY', '');

// ── In-memory cache (TTL: 30 minutes) ──

// ── Axios instance with OpenSubtitles headers ──
const openSubClient = axios.create({
  baseURL: OPENSUB_BASE,
  timeout: 15000,
  headers: {
    'Api-Key':      OPENSUB_API_KEY,
    'Content-Type': 'application/json',
    'User-Agent':   'CineStream v1.0',
    'Accept':       'application/json',
  },
});

// ══════════════════════════════════════════
// SEARCH SUBTITLES
// Searches OpenSubtitles by title + language
// Returns clean structured array
// ══════════════════════════════════════════
async function searchSubtitles(title, language = 'en') {
  if (!OPENSUB_API_KEY) throw new Error('OPENSUB_API_KEY not set in .env');

  const res = await openSubClient.get('/subtitles', {
    params: {
      query:     title,
      languages: language,
      type:      'movie',
    },
  });

  const raw     = res.data?.data || [];
  const results = raw.slice(0, 20).map(item => ({
    file_id:      item.attributes?.files?.[0]?.file_id  || null,
    file_name:    item.attributes?.files?.[0]?.file_name || '',
    title:        item.attributes?.feature_details?.movie_name
                  || item.attributes?.release           || title,
    language:     item.attributes?.language             || language,
    language_name:item.attributes?.language             || language,
    download_count:item.attributes?.download_count      || 0,
    rating:       item.attributes?.ratings              || 0,
    uploader:     item.attributes?.uploader?.name       || 'unknown',
    url:          item.attributes?.url                  || '',
  })).filter(s => s.file_id);

  return results;
}

// ══════════════════════════════════════════
// GET DOWNLOAD URL
// Calls /download endpoint to get a direct link
// ══════════════════════════════════════════
async function getDownloadUrl(fileId) {
  if (!OPENSUB_API_KEY) throw new Error('OPENSUB_API_KEY not set in .env');

  const res = await openSubClient.post('/download', {
    file_id:    fileId,
    sub_format: 'srt',
  });

  const link     = res.data?.link;
  const fileName = res.data?.file_name || `subtitle_${fileId}.srt`;
  const remaining= res.data?.remaining || 0;

  if (!link) throw new Error('No download link returned from OpenSubtitles');

  return { link, fileName, remaining };
}

// ══════════════════════════════════════════
// DOWNLOAD FILE TO DISK
// Downloads the .srt from OpenSubtitles CDN
// ══════════════════════════════════════════
function downloadFileToDisk(url, destPath) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(destPath);
    https.get(url, (response) => {
      response.pipe(file);
      file.on('finish', () => { file.close(); resolve(); });
      file.on('error',  (err) => { fs.unlink(destPath, ()=>{}); reject(err); });
    }).on('error', (err) => {
      fs.unlink(destPath, () => {});
      reject(err);
    });
  });
}

// ══════════════════════════════════════════
// CONVERT SRT → VTT
// Pure JS conversion — no external package needed
// Handles edge cases: BOM, Windows line endings, encoding
// ══════════════════════════════════════════
function convertSrtToVtt(srtContent) {
  // Remove BOM if present
  let content = srtContent.replace(/^\uFEFF/, '');

  // Normalise line endings
  content = content.replace(/\r\n/g, '\n').replace(/\r/g, '\n');

  // SRT timestamp: 00:01:23,456 → VTT: 00:01:23.456
  const vttBody = content
    .replace(/(\d{2}:\d{2}:\d{2}),(\d{3})/g, '$1.$2')
    .trim();

  return 'WEBVTT\n\n' + vttBody;
}

// ══════════════════════════════════════════
// ENSURE SUBTITLE DIR EXISTS
// ══════════════════════════════════════════
function ensureSubtitleDir() {
  const dir = path.join(__dirname, '../uploads/subtitles');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// ══════════════════════════════════════════
// FULL PIPELINE: fileId → .vtt file on disk
// Returns the relative URL served to the client
// ══════════════════════════════════════════
async function downloadAndConvert(fileId) {
  const dir     = ensureSubtitleDir();
  const vttPath = path.join(dir, `${fileId}.vtt`);
  const vttUrl  = `/uploads/subtitles/${fileId}.vtt`;

  // Already converted — serve from disk cache
  if (fs.existsSync(vttPath)) {
    return { url: vttUrl, fileId, alreadyExists: true };
  }

  // 1. Get download link
  const { link, fileName } = await getDownloadUrl(fileId);

  // 2. Download .srt to temp file
  const srtPath = path.join(dir, `${fileId}.srt`);
  await downloadFileToDisk(link, srtPath);

  // 3. Read .srt, convert to .vtt
  const srtContent = fs.readFileSync(srtPath, 'utf-8');
  const vttContent = convertSrtToVtt(srtContent);

  // 4. Write .vtt file
  fs.writeFileSync(vttPath, vttContent, 'utf-8');

  // 5. Delete temp .srt
  fs.unlink(srtPath, () => {});

  return { url: vttUrl, fileId, alreadyExists: false, originalName: fileName };
}

module.exports = { searchSubtitles, downloadAndConvert, getDownloadUrl };
