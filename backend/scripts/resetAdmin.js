/**
 * Reset admin password to default credentials
 * Run: node backend/scripts/resetAdmin.js
 */
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const path = require('path');

// Load env
require('dotenv').config({ path: path.join(__dirname, '../../.env.development') });

const MONGO_URI = process.env.MONGODB_URI || 'mongodb://127.0.0.1:27017/cinestream';

// Target credentials
const TARGET_EMAIL = 'admin@cinestream.local';
const TARGET_PASSWORD = 'Admin@12345';

async function resetAdmin() {
  await mongoose.connect(MONGO_URI);
  console.info('Connected to MongoDB');

  const userCollection = mongoose.connection.collection('users');

  // Find existing admin
  const existingAdmin = await userCollection.findOne({ role: 'admin' });

  if (!existingAdmin) {
    console.info('No admin found. Creating new admin...');
    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(TARGET_PASSWORD, salt);

    await userCollection.insertOne({
      username: 'admin',
      email: TARGET_EMAIL,
      password: hashedPassword,
      role: 'admin',
      isVerified: true,
      isActive: true,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    console.info(`Admin created: ${TARGET_EMAIL} / ${TARGET_PASSWORD}`);
  } else {
    console.info('Existing admin found:', existingAdmin.email);
    console.info('Resetting password...');

    const salt = await bcrypt.genSalt(12);
    const hashedPassword = await bcrypt.hash(TARGET_PASSWORD, salt);

    await userCollection.updateOne(
      { _id: existingAdmin._id },
      {
        $set: {
          email: TARGET_EMAIL,
          username: 'admin',
          password: hashedPassword,
          isVerified: true,
          isActive: true,
          updatedAt: new Date(),
        },
      }
    );
    console.info(`Admin updated: ${TARGET_EMAIL} / ${TARGET_PASSWORD}`);
  }

  await mongoose.disconnect();
  console.info('Done. You can now log in with:');
  console.info(`  Email:    ${TARGET_EMAIL}`);
  console.info(`  Password: ${TARGET_PASSWORD}`);
}

resetAdmin().catch(err => {
  console.error('Error:', err.message);
  process.exit(1);
});
