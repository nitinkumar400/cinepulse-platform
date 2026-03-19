const mongoose = require('mongoose');

const NotificationSchema = new mongoose.Schema({

  // Who receives this notification
  user: {
    type: mongoose.Schema.Types.ObjectId,
    ref: 'User',
    required: true,
  },

  // Notification type
  type: {
    type: String,
    enum: [
      'new_content',   // New movie/anime uploaded
      'review_liked',  // Someone liked your review
      'new_episode',   // New episode added to a series you watched
      'system',        // System announcement
    ],
    required: true,
  },

  // Display text
  title:   { type: String, required: true },
  message: { type: String, required: true },

  // Optional link to navigate to
  link: { type: String, default: null },

  // Optional image (movie thumbnail etc)
  image: { type: String, default: null },

  // Read status
  isRead: { type: Boolean, default: false },

  createdAt: { type: Date, default: Date.now },
});

// Index for fast queries
NotificationSchema.index({ user: 1, createdAt: -1 });
NotificationSchema.index({ user: 1, isRead: 1 });

module.exports = mongoose.model('Notification', NotificationSchema);