#!/bin/bash
echo "=== PatchMate Deploy Script ==="

DEPLOYMENT_SOURCE="${DEPLOYMENT_SOURCE:-/home/site/repository}"
DEPLOYMENT_TARGET="${DEPLOYMENT_TARGET:-/home/site/wwwroot}"

# Copy files to deployment target
echo "Copying files..."
cp -r "$DEPLOYMENT_SOURCE/." "$DEPLOYMENT_TARGET/"

cd "$DEPLOYMENT_TARGET"

# Install dependencies with npm (not pnpm — avoids symlink issues)
echo "Installing API dependencies..."
cd apps/api && npm install --production=false && cd ../..

echo "Installing database dependencies..."
cd packages/database && npm install && cd ../..

# Generate Prisma client
echo "Generating Prisma client..."
cd packages/database && npx prisma generate && cd ../..

# Run database migrations
echo "Running database migrations..."
cd packages/database && npx prisma migrate deploy && cd ../..

echo "=== Deploy Complete ==="
