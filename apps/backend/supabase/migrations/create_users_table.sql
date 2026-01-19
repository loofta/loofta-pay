-- Create users table for admin role management
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  privy_user_id TEXT UNIQUE NOT NULL,
  role TEXT NOT NULL DEFAULT 'user', -- 'user' or 'admin'
  email TEXT,
  name TEXT
);

-- Add indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_users_privy_user_id ON users (privy_user_id);
CREATE INDEX IF NOT EXISTS idx_users_role ON users (role);

-- Enable RLS (Row Level Security)
ALTER TABLE users ENABLE ROW LEVEL SECURITY;

-- Policy: Users can read their own data
-- Drop policy if it exists to make migration idempotent
DROP POLICY IF EXISTS "Users can read own data" ON users;

CREATE POLICY "Users can read own data" ON users
  FOR SELECT
  USING (true); -- For now, allow reading (we'll restrict in API)

-- Insert the admin user
-- Replace with your actual Privy user ID
INSERT INTO users (privy_user_id, role, email)
VALUES ('did:privy:cmi521k5500p4k00cd2uxmhxf', 'admin', NULL)
ON CONFLICT (privy_user_id) 
DO UPDATE SET role = 'admin';

