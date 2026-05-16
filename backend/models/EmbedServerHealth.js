// ══════════════════════════════════════════
// CINE STREAM — EmbedServerHealth Model
//
// Stores individual probe results for each Embed_Server. Each document
// represents a single Health_Check captured by ServerHealthService.
//
// Documents auto-expire after 30 days via the TTL index on `checkedAt`,
// so the collection retains exactly the rolling 30-day window required
// by Requirements 6.6 and 6.10.
// ══════════════════════════════════════════
const mongoose = require('mongoose');

const EmbedServerHealthSchema = new mongoose.Schema({

  // References EmbedServerConfig.key (not _id) so probe records stay
  // readable even if a server doc is deleted and re-created.
  serverKey: {
    type:     String,
    required: true,
    trim:     true,
    index:    true,
  },

  // Three-way classification produced by ServerHealthService.classifyProbeResult
  status: {
    type:     String,
    enum:     ['Working', 'Degraded', 'Down'],
    required: true,
  },

  // Probe response time in milliseconds. On timeout this equals the
  // server's configured `timeout` value (per Requirement 6.5).
  responseTime: {
    type:     Number,
    required: true,
    min:      0,
  },

  // HTTP status code returned by the probe. Null when the request
  // timed out or failed before receiving a response.
  httpStatusCode: {
    type:    Number,
    default: null,
  },

  // Timestamp of the probe. Drives the TTL index below.
  checkedAt: {
    type:    Date,
    default: Date.now,
  },

});

// ══════════════════════════════════════════
// INDEXES
//
// 1. { serverKey: 1, checkedAt: -1 }
//    Powers the "latest N probes for server X" query used by the
//    success-rate / avg-load-time aggregations and the admin health
//    dashboard.
//
// 2. { checkedAt: 1 } with expireAfterSeconds: 2592000 (30 days)
//    MongoDB TTL index that automatically removes probe records older
//    than 30 days, satisfying the retention requirement (Req 6.10).
// ══════════════════════════════════════════
EmbedServerHealthSchema.index({ serverKey: 1, checkedAt: -1 });
EmbedServerHealthSchema.index(
  { checkedAt: 1 },
  { expireAfterSeconds: 2592000 }
);

module.exports = mongoose.model('EmbedServerHealth', EmbedServerHealthSchema);
