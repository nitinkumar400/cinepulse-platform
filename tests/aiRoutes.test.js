const assert = require('node:assert/strict');
const express = require('express');
const http = require('http');

const { AICacheService } = require('../backend/services/aiCacheService');
const { createAiRouters } = require('../backend/routes/aiRoutes');

async function startServer(app) {
  const server = http.createServer(app);

  await new Promise((resolve) => {
    server.listen(0, '127.0.0.1', resolve);
  });

  const address = server.address();
  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
  };
}

async function run() {
  const cache = new AICacheService({ ttlMs: 60 * 60 * 1000 });
  let providerCalls = 0;

  const { aiRouter } = createAiRouters({
    cache,
    logger: {
      info() {},
      error() {},
    },
    async generateText(prompt) {
      providerCalls += 1;
      return `generated:${prompt}`;
    },
  });

  const app = express();
  app.use(express.json());
  app.use('/api/ai', aiRouter);

  const { server, baseUrl } = await startServer(app);

  try {
    const firstResponse = await fetch(`${baseUrl}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'recommend a sci-fi movie' }),
    });
    const firstBody = await firstResponse.json();

    const secondResponse = await fetch(`${baseUrl}/api/ai`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: 'recommend a sci-fi movie' }),
    });
    const secondBody = await secondResponse.json();

    assert.equal(firstResponse.status, 200);
    assert.equal(secondResponse.status, 200);
    assert.deepEqual(firstBody, {
      success: true,
      result: 'generated:recommend a sci-fi movie',
    });
    assert.deepEqual(secondBody, firstBody);
    assert.equal(providerCalls, 1);

    const events = cache.getLogs().map((entry) => entry.event);
    assert.deepEqual(events, ['miss', 'hit']);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
  }

  console.log('aiRoutes cache integration test passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
