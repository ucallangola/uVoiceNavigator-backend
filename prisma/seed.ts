import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import * as bcrypt from 'bcrypt';

// Prisma 7: pass PoolConfig directly to avoid @types/pg version conflicts
const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma  = new PrismaClient({ adapter } as any);

async function main() {
  console.log('Seeding database...');

  // ============================================================
  // Seed Permissions
  // ============================================================
  const resources = ['interactions', 'audios', 'alerts', 'dashboard', 'users', 'roles', 'permissions'];
  const actions = ['read', 'write', 'delete', 'manage'];

  const permissions: { name: string; resource: string; action: string }[] = [];

  for (const resource of resources) {
    for (const action of actions) {
      permissions.push({ name: `${resource}:${action}`, resource, action });
    }
  }

  console.log('Creating permissions...');
  for (const perm of permissions) {
    await prisma.permission.upsert({
      where: { resource_action: { resource: perm.resource, action: perm.action } },
      update: {},
      create: perm,
    });
  }

  // ============================================================
  // Seed Roles
  // ============================================================
  console.log('Creating roles...');

  const adminRole = await prisma.role.upsert({
    where: { name: 'admin' },
    update: {},
    create: {
      name: 'admin',
      description: 'Full system access — can manage all resources',
    },
  });

  const supervisorRole = await prisma.role.upsert({
    where: { name: 'supervisor' },
    update: {},
    create: {
      name: 'supervisor',
      description: 'Can view all data and manage interactions/audios',
    },
  });

  const agentRole = await prisma.role.upsert({
    where: { name: 'agent' },
    update: {},
    create: {
      name: 'agent',
      description: 'Read-only access to interactions and audios',
    },
  });

  // ============================================================
  // Assign Permissions to Roles
  // ============================================================
  console.log('Assigning permissions to roles...');

  // Admin gets all permissions
  const allPermissions = await prisma.permission.findMany();
  for (const perm of allPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: adminRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: adminRole.id, permissionId: perm.id },
    });
  }

  // Supervisor gets read/write permissions (not delete/manage for users/roles/permissions)
  const supervisorPermissions = await prisma.permission.findMany({
    where: {
      OR: [
        { resource: 'interactions' },
        { resource: 'audios' },
        { resource: 'alerts', action: { in: ['read', 'manage'] } },
        { resource: 'dashboard', action: 'read' },
        { resource: 'users', action: 'read' },
      ],
    },
  });

  for (const perm of supervisorPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: supervisorRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: supervisorRole.id, permissionId: perm.id },
    });
  }

  // Agent gets read-only permissions
  const agentPermissions = await prisma.permission.findMany({
    where: {
      action: 'read',
      resource: { in: ['interactions', 'audios', 'dashboard'] },
    },
  });

  for (const perm of agentPermissions) {
    await prisma.rolePermission.upsert({
      where: {
        roleId_permissionId: { roleId: agentRole.id, permissionId: perm.id },
      },
      update: {},
      create: { roleId: agentRole.id, permissionId: perm.id },
    });
  }

  // ============================================================
  // Seed Admin User
  // ============================================================
  console.log('Creating admin user...');

  const adminPasswordHash = await bcrypt.hash('Admin@123456', 12);

  const adminUser = await prisma.user.upsert({
    where: { email: 'admin@uvoice.com' },
    update: {},
    create: {
      name: 'Administrator',
      email: 'admin@uvoice.com',
      passwordHash: adminPasswordHash,
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: adminUser.id, roleId: adminRole.id },
    },
    update: {},
    create: { userId: adminUser.id, roleId: adminRole.id },
  });

  // ============================================================
  // Seed Supervisor User
  // ============================================================
  console.log('Creating supervisor user...');

  const supervisorPasswordHash = await bcrypt.hash('Super@123456', 12);

  const supervisorUser = await prisma.user.upsert({
    where: { email: 'supervisor@uvoice.com' },
    update: {},
    create: {
      name: 'Maria Supervisora',
      email: 'supervisor@uvoice.com',
      passwordHash: supervisorPasswordHash,
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      userId_roleId: { userId: supervisorUser.id, roleId: supervisorRole.id },
    },
    update: {},
    create: { userId: supervisorUser.id, roleId: supervisorRole.id },
  });

  // ============================================================
  // Seed Sample Email Alert
  // ============================================================
  console.log('Creating sample email alert...');

  await prisma.emailAlert.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      recipientEmail: 'admin@uvoice.com',
      alertType: 'scheduled',
      sendHour: 8,
      enabled: true,
    },
  });

  console.log('');
  console.log('========================================');
  console.log('Database seeding completed!');
  console.log('');
  console.log('Default users created:');
  console.log('  Admin:      admin@uvoice.com      / Admin@123456');
  console.log('  Supervisor: supervisor@uvoice.com / Super@123456');
  console.log('========================================');
}

main()
  .then(async () => {
    await prisma.$disconnect();
  })
  .catch(async (e) => {
    console.error(e);
    await prisma.$disconnect();
    process.exit(1);
  });
