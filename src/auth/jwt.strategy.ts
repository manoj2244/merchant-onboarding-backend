import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { EnvironmentVariables } from '../config/env.validation';
import { UsersService } from '../users/users.service';
import { AuthenticatedUser, JwtPayload } from './authenticated-user';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    config: ConfigService<EnvironmentVariables, true>,
    private readonly users: UsersService,
  ) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      secretOrKey: config.get('JWT_SECRET'),
      // Pin the algorithm so a token cannot choose its own (e.g. "none").
      algorithms: ['HS256'],
      ignoreExpiration: false,
    });
  }

  /**
   * Re-load the user on every request: a deactivated user or a changed role takes effect
   * immediately instead of when the token expires. The role is taken from the DB, not the token.
   */
  async validate(payload: JwtPayload): Promise<AuthenticatedUser> {
    const user = await this.users.findActiveById(payload.sub);
    if (!user) throw new UnauthorizedException();
    return { id: user.id, email: user.email, role: user.role };
  }
}
