describe("env validation", () => {
  it("parses valid environment variables without throwing", () => {
    // Re-import after setup.ts has populated process.env
    expect(() => {
      const { env } = require("@/lib/env");
      expect(env.DATABASE_URL).toContain("postgresql://");
      expect(env.AUTH_SECRET.length).toBeGreaterThanOrEqual(16);
    }).not.toThrow();
  });

  it("throws when DATABASE_URL is missing", () => {
    const saved = process.env.DATABASE_URL;
    delete process.env.DATABASE_URL;
    jest.resetModules();
    expect(() => require("@/lib/env")).toThrow("Invalid environment variables");
    process.env.DATABASE_URL = saved;
    jest.resetModules();
  });
});
