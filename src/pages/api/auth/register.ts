import { hash } from 'bcryptjs';
import { type NextApiRequest, type NextApiResponse } from 'next';
import { z } from 'zod';

import { env } from '~/env';
import { db } from '~/server/db';

const registerSchema = z.object({
  name: z.string().min(1).max(100),
  email: z.string().email(),
  password: z.string().min(8).max(128),
});

const BCRYPT_ROUNDS = 12;

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if ('POST' !== req.method) {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (env.INVITE_ONLY) {
    return res.status(403).json({ error: 'Registration is disabled on this instance' });
  }

  if (env.DISABLE_EMAIL_SIGNUP) {
    return res.status(403).json({ error: 'Registration of new accounts is disabled' });
  }

  const parsed = registerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: parsed.error.issues[0]?.message ?? 'Invalid input' });
  }

  const { name, email, password } = parsed.data;
  const normalizedEmail = email.toLowerCase();

  const existingUser = await db.user.findUnique({
    where: { email: normalizedEmail },
  });

  if (existingUser) {
    return res.status(409).json({ error: 'An account with this email already exists' });
  }

  const passwordHash = await hash(password, BCRYPT_ROUNDS);

  await db.user.create({
    data: {
      name,
      email: normalizedEmail,
      passwordHash,
      emailVerified: new Date(),
      preferredLanguage: 'en',
    },
  });

  return res.status(201).json({ ok: true });
}
