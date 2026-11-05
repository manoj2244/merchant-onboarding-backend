import { Role } from '../users/role.enum';

/** The identity attached to `request.user` after JWT validation. Loaded from the DB, not the token. */
export interface AuthenticatedUser {
  id: string;
  email: string;
  role: Role;
}

export interface JwtPayload {
  sub: string;
  role: Role;
}
