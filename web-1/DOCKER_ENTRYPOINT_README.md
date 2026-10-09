# Docker Entrypoint - Database Initialization

> 📍 **Nawigacja:** [web-1/README.md](README.md) → Ten dokument

## Problem Solved: Chicken-and-Egg

**Issue:** Container crashes on startup if database tables don't exist (permissions init requires tables).

**Solution:** `docker-entrypoint.sh` automatically initializes database before starting the application.

## How It Works

1. **Wait for Database** - TCP check on DB host:port (max 30 retries, 2s interval)
2. **Check Schema** - Query `information_schema` to see if tables exist
3. **Initialize if Needed:**
   - **DEVELOPMENT/STAGING:** `prisma db push` (no migrations)
   - **PREVIEW/PRODUCTION:** `prisma migrate deploy` (if migrations exist)
4. **Generate Prisma Client** - Always regenerate to ensure up-to-date types
5. **Start Application** - Execute CMD from Dockerfile

## Environment Detection

- **Migrations exist** (`src/prisma/migrations/` not empty) → Use `migrate deploy`
- **No migrations** → Use `db:push`

## Usage

### Development (Docker)

```bash
# Fresh start (removes volumes)
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d

# Entrypoint automatically:
# - Waits for DB
# - Applies schema (db:push)
# - Generates Prisma Client
# - Starts app
```

### Staging (staging host)

```bash
# Same as development
docker-compose -f docker-compose.prod.yml down -v
docker-compose -f docker-compose.prod.yml up -d
```

### Preview/Production (Neon)

Skrypty migracji są zdefiniowane w [web-1/package.json](package.json).

## Files Modified

- `web-1/docker-entrypoint.sh` - Initialization script
- `web-1/docker.dev.Dockerfile` - Added entrypoint + netcat
- `web-1/docker.prod.Dockerfile` - Added entrypoint + netcat

## Dependencies

- `netcat-openbsd` - For TCP check (installed in Dockerfile)
- `prisma` - For schema operations

## Logs

Entrypoint logs are prefixed with emojis:

- 🚀 Starting
- ⏳ Waiting for database
- ✅ Success
- ⚠️ Warning
- ❌ Error
- 🔍 Checking
- 🔨 Running db:push
- 📦 Running migrations
- 🔧 Generating client
- 🎯 Starting app

## Troubleshooting

**Container exits immediately:**

- Check `docker logs web-1-dev` for entrypoint errors
- Verify `DATABASE_URL` is set correctly
- Ensure DB container is healthy (`docker ps`)

**Schema not applied:**

- Check if `Role` table exists: `docker exec db psql -U <user> -d db -c "\dt"`
- Manually run: `docker exec web-1-dev npx prisma db push --url=$DATABASE_URL`

**Migrations fail:**

- Ensure migrations directory exists and is not empty
- Check migration files are valid SQL
- Verify `DATABASE_URL` points to correct environment

## Testing

```bash
# Test full reset (simulates fresh deployment)
cd /path/to/repo
docker-compose -f docker-compose.dev.yml down -v
docker-compose -f docker-compose.dev.yml up -d
docker logs -f web-1-dev

# Expected output:
# 🚀 Starting web-1 container...
# ⏳ Waiting for database...
# ✅ Database is ready
# 🔍 Checking if schema is applied...
# ⚠️  Schema not applied, initializing database...
# 🔨 Running db:push (DEVELOPMENT/STAGING mode)...
# ✅ Schema applied
# 🔧 Generating Prisma Client...
# 🎯 Starting application...
# 🌱 Seeding database...
# [Permissions] Initialization complete
# 👑 Master Admin: Master admin created
# 🧪 Test Users: Test stylist created...
# ✅ Seeding complete
```

## Future Improvements

- [ ] Add health check endpoint for orchestrators
- [ ] Add retry logic for schema operations
- [ ] Add rollback on failure
- [ ] Add metrics/monitoring hooks
