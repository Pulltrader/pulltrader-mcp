// =============================================================================
// PUBLISHED METADATA CONTRACT
// =============================================================================
// The registry record (`server.json`), the npm-style manifest (`package.json`),
// and the server's own identity (`src/version.ts`) are what every directory —
// the official MCP Registry, Smithery, Glama, PulseMCP — reads to decide what
// this server is and whether it is maintained. They drifted once already: the
// published record advertised a single tool for three releases while the worker
// served seven. These tests make that drift a build failure.
// =============================================================================

import { describe, it, expect } from "vitest";
import { REGISTRY_NAME, SERVER_VERSION } from "../src/version";
import { TOOLS } from "../src/tools/registry";

import serverJsonRaw from "../server.json";
import packageJsonRaw from "../package.json";

const serverJson = serverJsonRaw as Record<string, unknown>;
const packageJson = packageJsonRaw as Record<string, unknown>;
const publisherMeta = (serverJson._meta as Record<string, Record<string, unknown>>)[
  "io.modelcontextprotocol.registry/publisher-provided"
]!;

describe("published metadata", () => {
  it("advertises exactly the tools the server serves", () => {
    expect([...(publisherMeta.tools as string[])].sort()).toEqual(TOOLS.map((t) => t.name).sort());
  });

  it("keeps server.json, package.json and version.ts on the same version", () => {
    expect(serverJson.version).toBe(SERVER_VERSION);
    expect(packageJson.version).toBe(SERVER_VERSION);
  });

  it("uses the DNS-verified registry namespace", () => {
    expect(serverJson.name).toBe(REGISTRY_NAME);
    expect(REGISTRY_NAME.startsWith("app.pulltrader/")).toBe(true);
  });

  it("points remotes at the verified production endpoint", () => {
    const remotes = serverJson.remotes as Array<{ type: string; url: string }>;
    expect(remotes).toHaveLength(1);
    expect(remotes[0]!.type).toBe("streamable-http");
    expect(remotes[0]!.url).toBe("https://mcp.pulltrader.app/mcp");
  });

  it("points the repository at the public mirror", () => {
    const repo = serverJson.repository as { url: string };
    expect(repo.url).toBe("https://github.com/pulltrader/pulltrader-mcp");
    expect((packageJson.repository as { url: string }).url).toContain("pulltrader/pulltrader-mcp");
  });
});
