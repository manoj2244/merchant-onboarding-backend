import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { User } from './entities/user.entity';
import { Role } from './role.enum';

@Injectable()
export class UsersService {
  constructor(@InjectRepository(User) private readonly users: Repository<User>) {}

  /** The only query that loads the password hash; used exclusively by login. */
  findForLogin(email: string): Promise<User | null> {
    return this.users
      .createQueryBuilder('user')
      .addSelect('user.passwordHash')
      .where('user.email = :email', { email: email.trim().toLowerCase() })
      .getOne();
  }

  findActiveById(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id, isActive: true } });
  }

  findActiveReviewer(id: string): Promise<User | null> {
    return this.users.findOne({ where: { id, isActive: true, role: Role.REVIEWER } });
  }
}
