const assert = require('node:assert/strict');

const { AICacheService } = require('../backend/services/aiCacheService');

async function run() {
  const cache = new AICacheService({ ttlMs: 50 });

  cache.set('prompt:batman', 'Batman Begins');
  assert.equal(cache.get('prompt:batman'), 'Batman Begins');
  assert.equal(cache.size(), 1);

  await new Promise((resolve) => setTimeout(resolve, 70));

  assert.equal(cache.get('prompt:batman'), null);
  assert.equal(cache.size(), 0);

  const events = cache.getLogs().map((entry) => entry.event);
  assert.deepEqual(events, ['hit', 'miss']);
  console.log('aiCacheService test passed');
}

run().catch((error) => {
  console.error(error);
  process.exit(1);
});
