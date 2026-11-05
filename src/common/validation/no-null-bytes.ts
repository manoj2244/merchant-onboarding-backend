import { Matches } from 'class-validator';

/** PostgreSQL rejects U+0000 in text columns; refuse it at the edge (400) instead of failing in the DB (500). */
export const NoNullBytes = () =>
  // eslint-disable-next-line no-control-regex
  Matches(/^[^\u0000]*$/, { message: '$property must not contain NUL characters' });
