#!/usr/bin/env node

/*
  Legal / Terms Notice:
  - This tool only accepts links that the operator confirms are public, lawful,
    and authorized for embedding or administrative cataloging.
  - It does not download video content and must not be used to bypass provider
    restrictions, paywalls, privacy controls, or geographic blocks.
  - Set CONFIRM_PUBLIC_LINKS=yes before running to confirm compliance.
*/

const fs = require('fs');
const path = require('path');
const axios = require('axios');

const DEFAULT_API_BASE = process.env.BACKEND_API_BASE || 'http://localhost:5000/api';
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || '';
const YOUTUBE_API_KEY = process.env.YOUTUBE_API_KEY || '';
const CONFIRM_PUBLIC_LINKS = String(process.env.CONFIRM_PUBLIC_LINKS || '').toLowerCase() === 'yes';
const ALLOWED_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
  'dailymotion.com',
  'www.dailymotion.com',
  'dai.ly',
  'vimeo.com',
  'www.vimeo.com',
  'player.vimeo.com',
]);

function parseArgs(argv) {
  const args = { movieId: '', file: '', dryRun: false };
  for (let index = 2; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--movieId') {
      args.movieId = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--file') {
      args.file = argv[index + 1] || '';
      index += 1;
    } else if (arg === '--dryRun') {
      args.dryRun = true;
    }
  }
  return args;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(task, label) {
  let attempt = 0;
  let delay = 400;

  while (attempt < 3) {
    try {
      return await task();
    } catch (error) {
      attempt += 1;
      const status = error.response?.status || 0;
      const retryable = attempt < 3 && (!status || status >= 500 || status === 429);
      if (!retryable) {
        throw error;
      }
      console.error(`[retry] ${label} attempt ${attempt} failed: ${error.message}`);
      await sleep(delay);
      delay *= 2;
    }
  }

  throw new Error(`${label} failed after retries`);
}

function safeUrl(value) {
  try {
    return new URL(String(value || '').trim());
  } catch {
    return null;
  }
}

function isDirectMp4Candidate(parsedUrl) {
  return parsedUrl && /\.mp4($|\?)/i.test(parsedUrl.href);
}

function detectProvider(rawUrl) {
  const parsed = safeUrl(rawUrl);
  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    throw new Error('Invalid URL');
  }

  const host = parsed.hostname.toLowerCase();

  if (host.includes('youtu.be') || host.includes('youtube.com') || host.includes('youtube-nocookie.com')) {
    return { provider: 'youtube', parsed };
  }
  if (host.includes('dailymotion.com') || host === 'dai.ly') {
    return { provider: 'dailymotion', parsed };
  }
  if (host.includes('vimeo.com')) {
    return { provider: 'vimeo', parsed };
  }
  if (isDirectMp4Candidate(parsed)) {
    return { provider: 'upload', parsed };
  }

  if (!ALLOWED_HOSTS.has(host)) {
    throw new Error(`Domain not allowed: ${host}`);
  }

  return { provider: 'upload', parsed };
}

function parseYouTubeId(parsed) {
  if (parsed.hostname === 'youtu.be') {
    return parsed.pathname.replace('/', '').trim();
  }
  if (parsed.searchParams.get('v')) {
    return parsed.searchParams.get('v');
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const embedIndex = parts.findIndex((part) => part === 'embed');
  if (embedIndex !== -1 && parts[embedIndex + 1]) {
    return parts[embedIndex + 1];
  }
  const shortsIndex = parts.findIndex((part) => part === 'shorts');
  if (shortsIndex !== -1 && parts[shortsIndex + 1]) {
    return parts[shortsIndex + 1];
  }
  return '';
}

function parseDailymotionId(parsed) {
  if (parsed.hostname === 'dai.ly') {
    return parsed.pathname.replace('/', '').trim();
  }
  const parts = parsed.pathname.split('/').filter(Boolean);
  const videoIndex = parts.findIndex((part) => part === 'video');
  if (videoIndex !== -1 && parts[videoIndex + 1]) {
    return parts[videoIndex + 1];
  }
  return '';
}

function parseVimeoId(parsed) {
  const parts = parsed.pathname.split('/').filter(Boolean);
  const numeric = parts.reverse().find((part) => /^\d+$/.test(part));
  return numeric || '';
}

function toIsoDurationSeconds(iso = '') {
  const match = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return 0;
  const hours = parseInt(match[1] || '0', 10);
  const minutes = parseInt(match[2] || '0', 10);
  const seconds = parseInt(match[3] || '0', 10);
  return (hours * 3600) + (minutes * 60) + seconds;
}

function guessQuality(input = '') {
  const value = String(input || '').toLowerCase();
  if (value.includes('2160') || value.includes('4k')) return '4K';
  if (value.includes('1440') || value.includes('1080') || value.includes('full hd')) return 'Full HD';
  if (value.includes('720') || value.includes('hd')) return 'HD';
  return 'SD';
}

function canonicalize(source) {
  if (source.provider === 'youtube') {
    const canonicalId = parseYouTubeId(source.parsed);
    if (!canonicalId) throw new Error('Could not extract YouTube video id');
    return {
      server: 'youtube',
      canonicalId,
      normalizedUrl: `https://www.youtube-nocookie.com/embed/${canonicalId}`,
      watchUrl: `https://www.youtube.com/watch?v=${canonicalId}`,
    };
  }

  if (source.provider === 'dailymotion') {
    const canonicalId = parseDailymotionId(source.parsed);
    if (!canonicalId) throw new Error('Could not extract Dailymotion video id');
    return {
      server: 'dailymotion',
      canonicalId,
      normalizedUrl: `https://www.dailymotion.com/embed/video/${canonicalId}`,
      watchUrl: `https://www.dailymotion.com/video/${canonicalId}`,
    };
  }

  if (source.provider === 'vimeo') {
    const canonicalId = parseVimeoId(source.parsed);
    if (!canonicalId) throw new Error('Could not extract Vimeo video id');
    return {
      server: 'vimeo',
      canonicalId,
      normalizedUrl: `https://player.vimeo.com/video/${canonicalId}`,
      watchUrl: `https://vimeo.com/${canonicalId}`,
    };
  }

  return {
    server: 'upload',
    canonicalId: source.parsed.href,
    normalizedUrl: source.parsed.href,
    watchUrl: source.parsed.href,
  };
}

async function requestUrl(config) {
  return withRetry(
    () => axios({
      timeout: 8000,
      maxRedirects: 5,
      validateStatus: () => true,
      ...config,
    }),
    `${config.method || 'GET'} ${config.url}`
  );
}

function ensurePublicResponse(response, label) {
  if (response.status === 401 || response.status === 403) {
    throw new Error(`${label} is private, blocked, or paywalled (${response.status})`);
  }
  if (response.status >= 400) {
    throw new Error(`${label} failed (${response.status})`);
  }
}

async function fetchYoutubeMetadata(canonicalId) {
  if (YOUTUBE_API_KEY) {
    const response = await requestUrl({
      method: 'GET',
      url: 'https://www.googleapis.com/youtube/v3/videos',
      params: {
        part: 'snippet,contentDetails',
        id: canonicalId,
        key: YOUTUBE_API_KEY,
      },
    });
    ensurePublicResponse(response, 'YouTube metadata');
    const item = response.data?.items?.[0];
    if (!item) throw new Error('YouTube video not found');
    return {
      title: item.snippet?.title || '',
      duration_seconds: toIsoDurationSeconds(item.contentDetails?.duration || ''),
      thumbnail: item.snippet?.thumbnails?.high?.url || item.snippet?.thumbnails?.default?.url || '',
    };
  }

  const response = await requestUrl({
    method: 'GET',
    url: 'https://www.youtube.com/oembed',
    params: {
      url: `https://www.youtube.com/watch?v=${canonicalId}`,
      format: 'json',
    },
  });
  ensurePublicResponse(response, 'YouTube oEmbed');
  return {
    title: response.data?.title || '',
    duration_seconds: 0,
    thumbnail: response.data?.thumbnail_url || '',
  };
}

async function fetchDailymotionMetadata(canonicalId) {
  const response = await requestUrl({
    method: 'GET',
    url: 'https://www.dailymotion.com/services/oembed',
    params: {
      url: `https://www.dailymotion.com/video/${canonicalId}`,
    },
  });
  ensurePublicResponse(response, 'Dailymotion oEmbed');
  return {
    title: response.data?.title || '',
    duration_seconds: Number(response.data?.duration) || 0,
    thumbnail: response.data?.thumbnail_url || '',
  };
}

async function fetchVimeoMetadata(canonicalId) {
  const response = await requestUrl({
    method: 'GET',
    url: 'https://vimeo.com/api/oembed.json',
    params: {
      url: `https://vimeo.com/${canonicalId}`,
    },
  });
  ensurePublicResponse(response, 'Vimeo oEmbed');
  return {
    title: response.data?.title || '',
    duration_seconds: Number(response.data?.duration) || 0,
    thumbnail: response.data?.thumbnail_url || '',
  };
}

async function validateDirectVideo(url) {
  const response = await requestUrl({
    method: 'HEAD',
    url,
  });

  ensurePublicResponse(response, 'Direct video URL');
  const contentType = String(response.headers['content-type'] || '');
  const contentLength = Number(response.headers['content-length'] || '0');
  if (!/video\//i.test(contentType) && !/\.mp4($|\?)/i.test(url)) {
    throw new Error(`Direct URL is not playable video content (${contentType || 'unknown content-type'})`);
  }

  return {
    title: path.basename(new URL(url).pathname) || 'Direct video',
    duration_seconds: 0,
    thumbnail: '',
    content_type: contentType,
    content_length: contentLength,
  };
}

async function validateEmbed(normalizedUrl, server) {
  if (server === 'upload') return;

  let response = await requestUrl({
    method: 'HEAD',
    url: normalizedUrl,
  });

  if (response.status === 405) {
    response = await requestUrl({
      method: 'GET',
      url: normalizedUrl,
    });
  }

  ensurePublicResponse(response, `${server} embed`);
}

async function inspectUrl(rawUrl) {
  const detected = detectProvider(rawUrl);
  const canonical = canonicalize(detected);

  let metadata;
  if (canonical.server === 'youtube') {
    metadata = await fetchYoutubeMetadata(canonical.canonicalId);
  } else if (canonical.server === 'dailymotion') {
    metadata = await fetchDailymotionMetadata(canonical.canonicalId);
  } else if (canonical.server === 'vimeo') {
    metadata = await fetchVimeoMetadata(canonical.canonicalId);
  } else {
    metadata = await validateDirectVideo(canonical.normalizedUrl);
  }

  await validateEmbed(canonical.normalizedUrl, canonical.server);

  return {
    input_url: rawUrl,
    server: canonical.server,
    canonical_id: canonical.canonicalId,
    normalized_url: canonical.normalizedUrl,
    quality: guessQuality(`${rawUrl} ${metadata.title || ''}`),
    meta: {
      title: metadata.title || '',
      duration_seconds: metadata.duration_seconds || 0,
      thumbnail: metadata.thumbnail || '',
      canonical_id: canonical.canonicalId,
    },
  };
}

async function attachSourceToMovie(movieId, item, adminToken, apiBase) {
  const response = await withRetry(
    () => axios.post(
      `${apiBase.replace(/\/$/, '')}/movies/${movieId}/source`,
      {
        server: item.server,
        url: item.normalized_url,
        quality: item.quality,
        meta: item.meta,
      },
      {
        timeout: 8000,
        headers: {
          Authorization: `Bearer ${adminToken}`,
          'Content-Type': 'application/json',
        },
        validateStatus: () => true,
      }
    ),
    `POST /movies/${movieId}/source`
  );

  ensurePublicResponse(response, 'Attach source API');
  return response.data;
}

function buildCurlCommand(movieId, item) {
  const body = JSON.stringify({
    server: item.server,
    url: item.normalized_url,
    quality: item.quality,
    meta: item.meta,
  });

  return `curl -X POST "${DEFAULT_API_BASE}/movies/${movieId}/source" -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" -d '${body}'`;
}

async function runIngest(options) {
  if (!CONFIRM_PUBLIC_LINKS) {
    throw new Error('Set CONFIRM_PUBLIC_LINKS=yes to confirm all links are public, lawful, and authorized for embedding.');
  }
  if (!options.movieId) {
    throw new Error('Missing required --movieId');
  }
  if (!options.file) {
    throw new Error('Missing required --file');
  }

  const filePath = path.resolve(process.cwd(), options.file);
  const fileContents = fs.readFileSync(filePath, 'utf8');
  const urls = fileContents
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'));

  const report = {
    movieId: options.movieId,
    dryRun: !!options.dryRun,
    imported: [],
    skipped: [],
    manual_curl_commands: [],
    summary: {
      total_input: urls.length,
      valid: 0,
      imported: 0,
      skipped: 0,
    },
  };

  const seen = new Set();

  for (const rawUrl of urls) {
    try {
      const item = await inspectUrl(rawUrl);
      const dedupeKey = `${item.server}:${item.canonical_id || item.normalized_url}`;
      if (seen.has(dedupeKey)) {
        report.skipped.push({
          input_url: rawUrl,
          reason: 'Duplicate canonical source in input batch',
        });
        continue;
      }

      seen.add(dedupeKey);
      report.summary.valid += 1;
      report.manual_curl_commands.push(buildCurlCommand(options.movieId, item));

      if (options.dryRun) {
        report.imported.push({
          ...item,
          preview: true,
        });
        continue;
      }

      if (!ADMIN_TOKEN) {
        throw new Error('Missing ADMIN_TOKEN environment variable');
      }

      const apiResult = await attachSourceToMovie(
        options.movieId,
        item,
        ADMIN_TOKEN,
        DEFAULT_API_BASE
      );

      report.imported.push({
        ...item,
        api_result: apiResult,
      });
    } catch (error) {
      report.skipped.push({
        input_url: rawUrl,
        reason: error.message,
      });
      console.error(`[skip] ${rawUrl} -> ${error.message}`);
    }
  }

  report.summary.imported = report.imported.length;
  report.summary.skipped = report.skipped.length;
  return report;
}

async function runCli() {
  try {
    const args = parseArgs(process.argv);
    const report = await runIngest(args);
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({
      success: false,
      error: error.message,
    }, null, 2)}\n`);
    process.exitCode = 1;
  }
}

if (require.main === module) {
  runCli();
}

module.exports = {
  parseArgs,
  detectProvider,
  canonicalize,
  inspectUrl,
  attachSourceToMovie,
  runIngest,
  buildCurlCommand,
};

