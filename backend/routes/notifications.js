const express      = require('express');
const router       = express.Router();
const Notification = require('../models/Notification');
const { protect }  = require('../middleware/authMiddleware');

// ── GET ALL NOTIFICATIONS FOR LOGGED IN USER ──
// GET /api/notifications
router.get('/', protect, async (req, res) => {
  try {
    const notifications = await Notification
      .find({ user: req.user._id })
      .sort({ createdAt: -1 })
      .limit(30);

    const unreadCount = await Notification.countDocuments({
      user:   req.user._id,
      isRead: false,
    });

    res.json({ notifications, unreadCount });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

// ── MARK ONE NOTIFICATION AS READ ──
// PUT /api/notifications/:id/read
router.put('/:id/read', protect, async (req, res) => {
  try {
    const notif = await Notification.findOne({
      _id:  req.params.id,
      user: req.user._id,
    });

    if (!notif) return res.status(404).json({ message: 'Not found' });

    notif.isRead = true;
    await notif.save();

    res.json({ message: 'Marked as read' });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

// ── MARK ALL NOTIFICATIONS AS READ ──
// PUT /api/notifications/read-all
router.put('/read-all', protect, async (req, res) => {
  try {
    await Notification.updateMany(
      { user: req.user._id, isRead: false },
      { isRead: true }
    );
    res.json({ message: 'All marked as read' });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

// ── DELETE ONE NOTIFICATION ──
// DELETE /api/notifications/:id
router.delete('/:id', protect, async (req, res) => {
  try {
    await Notification.findOneAndDelete({
      _id:  req.params.id,
      user: req.user._id,
    });
    res.json({ message: 'Deleted' });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

// ── DELETE ALL NOTIFICATIONS ──
// DELETE /api/notifications
router.delete('/', protect, async (req, res) => {
  try {
    await Notification.deleteMany({ user: req.user._id });
    res.json({ message: 'All cleared' });
  } catch(e) {
    res.status(500).json({ message: e.message });
  }
});

module.exports = router;