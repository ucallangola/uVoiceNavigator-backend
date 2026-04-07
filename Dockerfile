# --- Stage 1: Build the application ---
FROM node:20-alpine AS builder

# Create app directory
WORKDIR /app

# Copy package.json and package-lock.json
COPY package*.json ./

# Install all dependencies (including devDependencies to build the project)
RUN npm ci

# Copy the entire project source code
COPY . .

# Generate Prisma Client
RUN npx prisma generate

# Build the NestJS application
RUN npm run build

# --- Stage 2: Production image ---
FROM node:20-alpine AS production

# Set Node environment to production
ENV NODE_ENV=production

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install only production dependencies
# Note: In NPM v9+, --omit=dev is preferred over --only=production
RUN npm ci --omit=dev

# Copy the Prisma schema from the builder stage
COPY --from=builder /app/prisma ./prisma

# Generate Prisma client for the production environment
RUN npx prisma generate

# Copy the compiled application from the builder stage
COPY --from=builder /app/dist ./dist

# Create a non-root user for better security (optional but recommended)
RUN adduser -D nestuser
USER nestuser

# Expose the default application port
EXPOSE 3000

# Start the application
CMD [ "node", "dist/main.js" ]
