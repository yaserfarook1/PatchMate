#!/bin/bash
# PatchMate Azure Deployment Script
# Run this from Azure Cloud Shell or local Azure CLI

# ── Subscription ──────────────────────────────────────────────────────────────
SUBSCRIPTION="0a2d21ac-e2ce-45e5-92b2-c1c4fb023b27"
echo "Setting subscription to PCSASSURE Microsoft Azure Sponsorship..."
az account set --subscription "$SUBSCRIPTION"

# ── Variables ─────────────────────────────────────────────────────────────────
RESOURCE_GROUP="patchmate-rg"
LOCATION="westus2"
APP_NAME="patchmate-app"
DB_SERVER="patchmate-db"
DB_NAME="patchmate"
DB_USER="patchmateadmin"
DB_PASSWORD="$(openssl rand -base64 24)"
REDIS_NAME="patchmate-redis"

echo "=== PatchMate Azure Deployment ==="
echo "Resource Group: $RESOURCE_GROUP"
echo "Location: $LOCATION"
echo ""

# ── 1. Create Resource Group ─────────────────────────────────────────────────
echo "Creating resource group..."
az group create --name $RESOURCE_GROUP --location $LOCATION

# ── 2. Create PostgreSQL Flexible Server ──────────────────────────────────────
echo "Creating PostgreSQL server..."
az postgres flexible-server create \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER \
  --location $LOCATION \
  --admin-user $DB_USER \
  --admin-password "$DB_PASSWORD" \
  --sku-name Standard_B1ms \
  --tier Burstable \
  --storage-size 32 \
  --version 16 \
  --yes

# Create database
az postgres flexible-server db create \
  --resource-group $RESOURCE_GROUP \
  --server-name $DB_SERVER \
  --database-name $DB_NAME

# Allow Azure services
az postgres flexible-server firewall-rule create \
  --resource-group $RESOURCE_GROUP \
  --name $DB_SERVER \
  --rule-name AllowAzure \
  --start-ip-address 0.0.0.0 \
  --end-ip-address 0.0.0.0

# ── 3. Create Redis Cache ────────────────────────────────────────────────────
echo "Creating Redis cache..."
az redis create \
  --resource-group $RESOURCE_GROUP \
  --name $REDIS_NAME \
  --location $LOCATION \
  --sku Basic \
  --vm-size c0

# ── 4. Create App Service Plan (Windows) ──────────────────────────────────────
echo "Creating App Service plan..."
az appservice plan create \
  --resource-group $RESOURCE_GROUP \
  --name "${APP_NAME}-plan" \
  --sku B2 \
  --is-linux false

# ── 5. Create Web App ────────────────────────────────────────────────────────
echo "Creating web app..."
az webapp create \
  --resource-group $RESOURCE_GROUP \
  --plan "${APP_NAME}-plan" \
  --name $APP_NAME \
  --runtime "NODE:20-lts"

# ── 6. Get connection strings ─────────────────────────────────────────────────
DB_HOST=$(az postgres flexible-server show --resource-group $RESOURCE_GROUP --name $DB_SERVER --query "fullyQualifiedDomainName" -o tsv)
REDIS_HOST=$(az redis show --resource-group $RESOURCE_GROUP --name $REDIS_NAME --query "hostName" -o tsv)
REDIS_KEY=$(az redis list-keys --resource-group $RESOURCE_GROUP --name $REDIS_NAME --query "primaryKey" -o tsv)

DATABASE_URL="postgresql://${DB_USER}:${DB_PASSWORD}@${DB_HOST}:5432/${DB_NAME}?sslmode=require"
REDIS_URL="rediss://:${REDIS_KEY}@${REDIS_HOST}:6380"

# ── 7. Set environment variables ──────────────────────────────────────────────
echo "Configuring app settings..."
az webapp config appsettings set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --settings \
    DATABASE_URL="$DATABASE_URL" \
    REDIS_URL="$REDIS_URL" \
    JWT_SECRET="$(openssl rand -base64 48)" \
    NODE_ENV="production" \
    PORT="3001" \
    FRONTEND_URL="https://${APP_NAME}.azurewebsites.net" \
    UPLOADS_DIR="./uploads" \
    AZURE_OAUTH_REDIRECT_URI="https://${APP_NAME}.azurewebsites.net/api/tenants/oauth-callback" \
    GRAPH_SCOPES="https://graph.microsoft.com/DeviceManagementApps.ReadWrite.All https://graph.microsoft.com/DeviceManagementManagedDevices.Read.All https://graph.microsoft.com/Group.Read.All https://graph.microsoft.com/User.Read offline_access" \
    WEBSITE_NODE_DEFAULT_VERSION="~20"

# ── 8. Enable 64-bit + WebSocket ─────────────────────────────────────────────
az webapp config set \
  --resource-group $RESOURCE_GROUP \
  --name $APP_NAME \
  --use-32bit-worker-process false \
  --web-sockets-enabled true

# ── Output ────────────────────────────────────────────────────────────────────
echo ""
echo "=== Deployment Complete ==="
echo ""
echo "App URL:      https://${APP_NAME}.azurewebsites.net"
echo "Database:     $DB_HOST"
echo "Redis:        $REDIS_HOST"
echo "DB Password:  $DB_PASSWORD"
echo ""
echo "Next steps:"
echo "  1. Deploy code: az webapp deployment source config-zip --resource-group $RESOURCE_GROUP --name $APP_NAME --src deploy.zip"
echo "  2. Run migrations: az webapp ssh --resource-group $RESOURCE_GROUP --name $APP_NAME"
echo "  3. Update Azure App Registration redirect URIs to: https://${APP_NAME}.azurewebsites.net/api/tenants/oauth-callback"
echo "  4. Add custom domain later: az webapp config hostname add --webapp-name $APP_NAME --resource-group $RESOURCE_GROUP --hostname patchmate.ai"
