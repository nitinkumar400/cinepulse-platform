const { z } = require('zod');

const email = z.string().trim().email('Please enter a valid email address.');
const password = z.string().min(6, 'Password must be at least 6 characters.');
const optionalString = z.string().trim().optional();

const loginSchema = z.object({
  body: z.object({
    email,
    password: z.string().min(1, 'Password is required.'),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

const updateProfileSchema = z.object({
  body: z.object({
    username: optionalString,
    avatar: optionalString,
    bio: z.string().trim().max(200).optional(),
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

const changePasswordSchema = z.object({
  body: z.object({
    currentPassword: z.string().min(1),
    newPassword: password,
  }),
  query: z.object({}).passthrough(),
  params: z.object({}).passthrough(),
});

module.exports = {
  loginSchema,
  updateProfileSchema,
  changePasswordSchema,
};
