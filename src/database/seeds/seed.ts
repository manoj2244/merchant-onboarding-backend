import 'dotenv/config';
import dataSource from '../data-source';
import { User } from '../../users/entities/user.entity';
import { hashPassword } from '../../users/password';
import { Role } from '../../users/role.enum';

/**
 * Development-only seed: one user per role plus a second SALES and REVIEWER so the
 * object-level rules (own vs. someone else's / assigned vs. unassigned) can be tried by hand.
 * The password comes from SEED_USER_PASSWORD; nothing secret is committed.
 */
const DEMO_USERS: ReadonlyArray<Pick<User, 'email' | 'fullName' | 'role'>> = [
  { email: 'admin@example.com', fullName: 'Demo Admin', role: Role.ADMIN },
  { email: 'sales.one@example.com', fullName: 'Demo Sales One', role: Role.SALES },
  { email: 'sales.two@example.com', fullName: 'Demo Sales Two', role: Role.SALES },
  { email: 'reviewer.one@example.com', fullName: 'Demo Reviewer One', role: Role.REVIEWER },
  { email: 'reviewer.two@example.com', fullName: 'Demo Reviewer Two', role: Role.REVIEWER },
];

async function seed(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to seed demo users in production');
  }
  const password = process.env.SEED_USER_PASSWORD;
  if (!password || password.length < 8 || password.startsWith('<')) {
    throw new Error('Set SEED_USER_PASSWORD (min 8 chars) in .env before seeding');
  }

  await dataSource.initialize();
  try {
    const passwordHash = await hashPassword(password);
    await dataSource
      .getRepository(User)
      .upsert(
        DEMO_USERS.map((u) => ({ ...u, passwordHash, isActive: true })),
        { conflictPaths: ['email'] },
      );
    console.log(`Seeded ${DEMO_USERS.length} demo users: ${DEMO_USERS.map((u) => `${u.email} (${u.role})`).join(', ')}`);
  } finally {
    await dataSource.destroy();
  }
}

seed().catch((err: Error) => {
  console.error(`Seed failed: ${err.message}`);
  process.exit(1);
});
