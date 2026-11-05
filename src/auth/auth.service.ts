import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { EnvironmentVariables } from '../config/env.validation';
import { User } from '../users/entities/user.entity';
import { hashPassword, verifyPassword } from '../users/password';
import { UsersService } from '../users/users.service';
import { JwtPayload } from './authenticated-user';
import { LoginResponseDto, UserProfileDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  // Compared against when the email is unknown, so response time does not reveal which emails exist.
  private readonly dummyHash = hashPassword('timing-equaliser-not-a-real-password');

  constructor(
    private readonly users: UsersService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvironmentVariables, true>,
  ) {}

  async login(email: string, password: string): Promise<LoginResponseDto> {
    const user = await this.users.findForLogin(email);
    const passwordOk = await verifyPassword(password, user?.passwordHash ?? (await this.dummyHash));

    if (!user || !passwordOk || !user.isActive) {
      // Log the outcome only; never the submitted email/password.
      this.logger.warn({ event: 'login_failed', userId: user?.id });
      throw new UnauthorizedException('Invalid email or password');
    }

    const payload: JwtPayload = { sub: user.id, role: user.role };
    const accessToken = await this.jwt.signAsync(payload);
    this.logger.log({ event: 'login_succeeded', userId: user.id });

    return {
      accessToken,
      tokenType: 'Bearer',
      expiresIn: this.config.get('JWT_EXPIRES_IN'),
      user: AuthService.toProfile(user),
    };
  }

  async profile(userId: string): Promise<UserProfileDto> {
    const user = await this.users.findActiveById(userId);
    if (!user) throw new UnauthorizedException();
    return AuthService.toProfile(user);
  }

  private static toProfile(user: User): UserProfileDto {
    return { id: user.id, email: user.email, fullName: user.fullName, role: user.role };
  }
}
