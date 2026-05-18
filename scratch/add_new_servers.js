const mongoose = require('mongoose');
require('dotenv').config({ path: './.env' });
const serverConfigService = require('../backend/services/serverConfigService');
const EmbedServerConfig = require('../backend/models/EmbedServerConfig');

async function run() {
  try {
    console.log('Connecting to MongoDB...');
    await mongoose.connect(process.env.MONGODB_URI);
    console.log('Connected!');

    const serversToUpsert = [
      {
        key: 'vidlink',
        name: 'VidLink',
        type: 'standard',
        priority: 1,
        enabled: true,
        sandboxPolicy: 'none',
        movieUrlPattern: 'https://vidlink.pro/movie/{tmdbId}',
        tvUrlPattern: 'https://vidlink.pro/tv/{tmdbId}/{season}/{episode}',
        animeUrlPattern: null,
        timeout: 9000,
      },
      {
        key: 'vidsrcnet',
        name: 'VidSrc Net',
        type: 'standard',
        priority: 2,
        enabled: true,
        sandboxPolicy: 'none',
        movieUrlPattern: 'https://vidsrc.net/embed/movie?tmdb={tmdbId}',
        tvUrlPattern: 'https://vidsrc.net/embed/tv?tmdb={tmdbId}&season={season}&episode={episode}',
        animeUrlPattern: null,
        timeout: 9000,
      },
      {
        key: 'autoembed',
        name: 'AutoEmbed',
        type: 'standard',
        priority: 3,
        enabled: true,
        sandboxPolicy: 'none',
        movieUrlPattern: 'https://player.autoembed.cc/embed/movie/{tmdbId}',
        tvUrlPattern: 'https://player.autoembed.cc/embed/tv/{tmdbId}/{season}/{episode}',
        animeUrlPattern: null,
        timeout: 9000,
      }
    ];

    for (const server of serversToUpsert) {
      const existing = await EmbedServerConfig.findOne({ key: server.key });
      if (existing) {
        console.log(`Server with key "${server.key}" already exists. Updating it...`);
        const updated = await serverConfigService.update(server.key, {
          name: server.name,
          type: server.type,
          enabled: server.enabled,
          sandboxPolicy: server.sandboxPolicy,
          movieUrlPattern: server.movieUrlPattern,
          tvUrlPattern: server.tvUrlPattern,
          animeUrlPattern: server.animeUrlPattern,
          timeout: server.timeout,
          priority: server.priority,
        });
        console.log(`Updated "${server.key}" successfully!`);
      } else {
        console.log(`Server with key "${server.key}" does not exist. Creating it...`);
        const created = await serverConfigService.create(server);
        console.log(`Created "${server.key}" successfully!`);
      }
    }

    console.log('All servers upserted successfully.');
    
    // List final order
    const all = await serverConfigService.getAll();
    console.log('--- Final Server List from DB ---');
    all.forEach(s => {
      console.log(`Priority ${s.priority}: [${s.key}] ${s.name} (${s.type}) - ${s.enabled ? 'ENABLED' : 'DISABLED'}`);
    });

    process.exit(0);
  } catch (err) {
    console.error('Failed to run migration:', err);
    process.exit(1);
  }
}

run();
