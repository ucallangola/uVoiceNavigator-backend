import path from 'node:path';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: path.join('prisma', 'schema.prisma'),

  // Used by prisma migrate dev/deploy/studio
  // The DATABASE_URL is injected by dotenv-cli before prisma runs
  datasource: {
    url: process.env.DATABASE_URL ?? '',
  },
});
