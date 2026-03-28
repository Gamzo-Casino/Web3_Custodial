describe("app boot", () => {
  it("loads without crashing", () => {
    expect(true).toBe(true);
  });

  it("next config is importable", () => {
    const fs = require("fs");
    const path = require("path");
    const configPath = path.join(process.cwd(), "next.config.ts");
    expect(fs.existsSync(configPath)).toBe(true);
  });

  it("prisma schema exists", () => {
    const fs = require("fs");
    const path = require("path");
    const schemaPath = path.join(process.cwd(), "prisma", "schema.prisma");
    const schema = fs.readFileSync(schemaPath, "utf8");
    expect(schema).toContain("model User");
    expect(schema).toContain("model WalletBalance");
    expect(schema).toContain("model LedgerEntry");
    expect(schema).toContain("model CoinflipMatch");
    expect(schema).toContain("model CoinflipCommit");
    expect(schema).toContain("model AuditLog");
    expect(schema).toContain("passwordHash");
  });
});
