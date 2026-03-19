const Notification = require('./models/Notification');
const User = require('./models/User');
const logger = require('./config/logger');

const sendNotification = async ({ userId, type, title, message, link, image }) => {
  try {
    await Notification.create({
      user: userId,
      type,
      title,
      message,
      link: link || null,
      image: image || null,
    });
  } catch (error) {
    logger.error('Notification error', {
      error: error.message,
      userId,
      type,
      title,
    });
  }
};

const notifyAllUsers = async ({ type, title, message, link, image }) => {
  try {
    const users = await User.find({}, '_id').lean();
    const docs = users.map((user) => ({
      user: user._id,
      type,
      title,
      message,
      link: link || null,
      image: image || null,
    }));

    if (docs.length > 0) {
      await Notification.insertMany(docs);
    }

    logger.info('Broadcast notification sent', {
      count: docs.length,
      title,
      type,
    });
  } catch (error) {
    logger.error('Bulk notification error', {
      error: error.message,
      title,
      type,
    });
  }
};

module.exports = { sendNotification, notifyAllUsers };
