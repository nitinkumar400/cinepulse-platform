const mongoose = require('mongoose');
const User = require('../models/User');
const { getEnv } = require('../config/env');

(async () => {
  try {
    const uri = getEnv('MONGO_URI', 'mongodb://127.0.0.1:27017/cine-stream');
    await mongoose.connect(uri, { useNewUrlParser: true, useUnifiedTopology: true });

    const email = 'nitinmishra0105@gmail.com';
    const password = 'Nitin@9621';
    const username = 'admin';

    let user = await User.findOne({
      $or: [
        { email },
        { username },
      ],
    });

    if (user) {
      user.email = email;
      user.username = username;
      user.password = password;
      user.role = 'admin';
      user.isVerified = true;
      user.isActive = true;
      await user.save();
      console.info('Admin user updated:', email);
    } else {
      await User.create({
        email,
        username,
        password,
        role: 'admin',
        isVerified: true,
        isActive: true,
      });
      console.info('Admin user created:', email);
    }

    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('Error creating admin user:', error);
    process.exit(1);
  }
})();
