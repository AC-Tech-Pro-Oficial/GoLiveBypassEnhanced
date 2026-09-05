import { readFileSync } from "fs";
import { resolve } from "path";
import { describe, expect, it } from "vitest";

const source = readFileSync(resolve(process.cwd(), "electron/updater.ts"), "utf8");

describe("updater trust boundary", () => {
  it("allows downloads only from GitHub-controlled release hosts", () => {
    expect(source).toContain("RELEASE_DOWNLOAD_HOSTS");
    for (const host of [
      "github.com",
      "release-assets.githubusercontent.com",
      "objects.githubusercontent.com",
      "github-releases.githubusercontent.com",
    ]) {
      expect(source).toContain(`"${host}"`);
    }
    expect(source).toContain("isTrustedReleaseUrl(next)");
    expect(source).toContain("redirecionamento de update saiu dos hosts confiaveis do GitHub");
  });

  it("requires a strict sha256 digest rather than accepting an arbitrary hash algorithm", () => {
    expect(source).toContain("/^sha256:[0-9a-fA-F]{64}$/");
    expect(source).toContain('createHash("sha256")');
    expect(source).not.toContain("createHash(algo)");
  });

  it("bounds update downloads by size and network inactivity", () => {
    expect(source).toContain("MAX_UPDATE_BYTES = 250 * 1024 * 1024");
    expect(source).toContain('headers["content-length"]');
    expect(source).toContain("received > MAX_UPDATE_BYTES");
    expect(source).toContain("req.setTimeout(30_000");
    expect(source).toContain("rm(dest, { force: true })");
  });
});
