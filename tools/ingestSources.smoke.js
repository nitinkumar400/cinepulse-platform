#!/usr/bin/env node

const http = require('http');
const assert = require('node:assert/strict');

const { attachSourceToMovie } = require('./ingestSources');

async function run() {
  let captured = null;

  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (chunk) => { body += chunk; });
    req.on('end', () => {
      captured = {
        method: req.method,
        url: req.url,
        auth: req.headers.authorization,
        body: JSON.parse(body || '{}'),
      };
      res.writeHead(201, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ message: 'ok' }));
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const apiBase = `http://127.0.0.1:${address.port}`;

  try {
    await attachSourceToMovie('movie123', {
      server: 'youtube',
      normalized_url: 'https://www.youtube-nocookie.com/embed/abc123',
      quality: 'HD',
      meta: {
        title: 'Smoke Title',
        duration_seconds: 120,
        thumbnail: 'https://img.youtube.com/vi/abc123/hqdefault.jpg',
        canonical_id: 'abc123',
      },
    }, 'fake-admin-token', apiBase);

    assert.equal(captured.method, 'POST');
    assert.equal(captured.url, '/movies/movie123/source');
    assert.equal(captured.auth, 'Bearer fake-admin-token');
    assert.equal(captured.body.server, 'youtube');
    assert.equal(captured.body.meta.canonical_id, 'abc123');

    console.log(JSON.stringify({
      success: true,
      smoke: 'attachSourceToMovie',
      captured,
    }, null, 2));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
