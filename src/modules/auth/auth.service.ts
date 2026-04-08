import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcrypt';
import { PrismaService } from '../../database/prisma.service';
import { LoginDto } from './dto/login.dto';
import { JwtPayload } from './strategies/jwt.strategy';
import { UpdateProfileDto } from './dto/update-profile.dto';
import { ChangePasswordDto } from './dto/change-password.dto';

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: any[];
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private prisma: PrismaService,
    private jwtService: JwtService,
    private configService: ConfigService,
  ) {}

  async validateUser(email: string, password: string): Promise<AuthUser | null> {
    const user = await this.prisma.user.findUnique({
      where: { email, deletedAt: null },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user || !user.isActive) {
      return null;
    }

    const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

    if (!isPasswordValid) {
      return null;
    }

    const roles = user.roles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      permissions: ur.role.permissions.map((rp) => ({
        id: rp.permission.id,
        name: rp.permission.name,
        resource: rp.permission.resource,
        action: rp.permission.action,
      })),
    }));

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
    };
  }

  async login(loginDto: LoginDto): Promise<AuthTokens & { user: AuthUser }> {
    const user = await this.validateUser(loginDto.email, loginDto.password);

    if (!user) {
      throw new UnauthorizedException('Invalid email or password');
    }

    const tokens = await this.generateTokens(user.id, user.email);

    // Hash and store the refresh token
    const hashedRefreshToken = await bcrypt.hash(tokens.refreshToken, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefreshToken },
    });

    this.logger.log(`User logged in: ${user.email}`);

    return {
      ...tokens,
      user,
    };
  }

  async refreshTokens(userId: string, refreshToken: string): Promise<AuthTokens> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
    });

    if (!user || !user.refreshToken || !user.isActive) {
      throw new ForbiddenException('Access denied: invalid refresh token');
    }

    const isRefreshTokenValid = await bcrypt.compare(refreshToken, user.refreshToken);

    if (!isRefreshTokenValid) {
      throw new ForbiddenException('Access denied: refresh token mismatch');
    }

    const tokens = await this.generateTokens(user.id, user.email);

    // Rotate the refresh token
    const hashedRefreshToken = await bcrypt.hash(tokens.refreshToken, 10);
    await this.prisma.user.update({
      where: { id: user.id },
      data: { refreshToken: hashedRefreshToken },
    });

    this.logger.log(`Tokens refreshed for user: ${user.email}`);

    return tokens;
  }

  async logout(userId: string): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { refreshToken: null },
    });

    this.logger.log(`User logged out: ${userId}`);
  }

  async getMe(userId: string): Promise<AuthUser> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId, deletedAt: null },
      include: {
        roles: {
          include: {
            role: {
              include: {
                permissions: {
                  include: { permission: true },
                },
              },
            },
          },
        },
      },
    });

    if (!user) {
      throw new UnauthorizedException('User not found');
    }

    const roles = user.roles.map((ur) => ({
      id: ur.role.id,
      name: ur.role.name,
      permissions: ur.role.permissions.map((rp) => ({
        id: rp.permission.id,
        name: rp.permission.name,
        resource: rp.permission.resource,
        action: rp.permission.action,
      })),
    }));

    return {
      id: user.id,
      email: user.email,
      name: user.name,
      roles,
    };
  }

  async updateProfile(userId: string, dto: UpdateProfileDto): Promise<AuthUser> {
    await this.prisma.user.update({
      where: { id: userId },
      data: { name: dto.name },
    });
    return this.getMe(userId);
  }

  async changePassword(userId: string, dto: ChangePasswordDto): Promise<{ message: string }> {
    const user = await this.prisma.user.findUnique({ where: { id: userId, deletedAt: null } });

    if (!user) {
      throw new UnauthorizedException('Utilizador não encontrado');
    }

    const isCurrentValid = await bcrypt.compare(dto.currentPassword, user.passwordHash);
    if (!isCurrentValid) {
      throw new BadRequestException('A senha atual está incorreta');
    }

    if (dto.currentPassword === dto.newPassword) {
      throw new BadRequestException('A nova senha deve ser diferente da atual');
    }

    const bcryptRounds = parseInt(process.env.BCRYPT_ROUNDS, 10) || 12;
    const passwordHash = await bcrypt.hash(dto.newPassword, bcryptRounds);

    // Update password and rotate refresh token (invalidate other sessions)
    await this.prisma.user.update({
      where: { id: userId },
      data: { passwordHash, refreshToken: null },
    });

    this.logger.log(`Password changed for user: ${userId}`);
    return { message: 'Senha alterada com sucesso. Por favor faça login novamente.' };
  }

  private async generateTokens(userId: string, email: string): Promise<AuthTokens> {
    const payload: JwtPayload = { sub: userId, email };

    const [accessToken, refreshToken] = await Promise.all([
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.secret'),
        expiresIn: this.configService.get<string>('jwt.expiresIn'),
      }),
      this.jwtService.signAsync(payload, {
        secret: this.configService.get<string>('jwt.refreshSecret'),
        expiresIn: this.configService.get<string>('jwt.refreshExpiresIn'),
      }),
    ]);

    return { accessToken, refreshToken };
  }
}
