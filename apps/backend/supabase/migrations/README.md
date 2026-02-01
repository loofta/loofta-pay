# Database Migrations

This directory contains SQL migration files for the Supabase database.

**Using a remote dev DB (no Docker)?** See [REMOTE_DEV.md](../REMOTE_DEV.md) for setup and how to revert to local.

## Migration File Naming

Migrations should be named with the format: `YYYYMMDDHHMMSS_description.sql`

Example: `20250126173154_add_is_private_to_claims.sql`

## How to Apply Migrations

### Local Development

1. **Using Supabase CLI** (recommended):
   ```bash
   cd apps/backend
   npm run db:migrate:local
   ```
   This will reset the local database and apply all migrations.

2. **Manual application**:
   ```bash
   cd apps/backend
   supabase db reset
   ```

### Production

Migrations are automatically deployed via GitHub Actions when pushed to `main` branch.

To manually deploy:
```bash
cd apps/backend
npm run db:migrate:prod
```

Or using Supabase CLI directly:
```bash
cd apps/backend
supabase db push
```

### Creating a New Migration

```bash
cd apps/backend
npm run db:migrate:create
# Or: supabase migration new migration_name
```

## Migration Best Practices

1. **Always use `IF NOT EXISTS`** for idempotency:
   ```sql
   ALTER TABLE table_name 
   ADD COLUMN IF NOT EXISTS column_name TYPE;
   ```

2. **Add indexes** for frequently queried columns:
   ```sql
   CREATE INDEX IF NOT EXISTS index_name ON table_name (column_name);
   ```

3. **Test locally** before pushing to production

4. **Include comments** explaining the migration purpose

## Current Migrations

- `20250126173154_add_is_private_to_claims.sql` - Adds `is_private` column to claims table for private payment tracking
