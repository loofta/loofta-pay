// Global test setup
jest.setTimeout(30000);

// Mock environment variables for tests
process.env.SUPABASE_URL = 'https://test.supabase.co';
process.env.SUPABASE_SECRET = 'test-secret-key';
process.env.REDIS_URL = '';
process.env.ONECLICK_API_BASE = 'https://1click.chaindefuser.com';
process.env.NODE_ENV = 'test';
