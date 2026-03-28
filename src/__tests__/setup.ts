// Load env for tests
process.env.DATABASE_URL =
  process.env.DATABASE_URL ??
  "postgresql://gamzo:gamzo_dev_password@localhost:5432/gamzo?schema=public";
process.env.AUTH_SECRET = process.env.AUTH_SECRET ?? "test-secret-min-16-chars-long";
// NODE_ENV is read-only in strict TypeScript — set via jest testEnvironment or jest.config instead
// process.env.NODE_ENV = "test";
