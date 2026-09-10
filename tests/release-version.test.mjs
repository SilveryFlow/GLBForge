import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

test("发布版本同步只修改应用包，并拒绝 tag 或版本不一致", () => {
  const dir = mkdtempSync(join(tmpdir(), "glbforge-version-test-"));
  const script = resolve("scripts/release-version.mjs");
  const run = (arg, tag = "") =>
    spawnSync(process.execPath, [script, arg], {
      cwd: dir,
      encoding: "utf8",
      env: { ...process.env, RELEASE_TAG: tag },
    });
  try {
    mkdirSync(join(dir, "src-tauri"));
    writeFileSync(join(dir, "package.json"), '{"version":"0.2.0"}');
    writeFileSync(join(dir, "src-tauri/tauri.conf.json"), '{"version":"0.1.0"}');
    writeFileSync(
      join(dir, "src-tauri/Cargo.toml"),
      '[package]\nname = "glbforge"\nversion = "0.1.0"\n',
    );
    writeFileSync(
      join(dir, "src-tauri/Cargo.lock"),
      '[[package]]\nname = "dependency"\nversion = "0.1.0"\n\n[[package]]\nname = "glbforge"\nversion = "0.1.0"\n',
    );
    assert.notEqual(run("--check").status, 0);
    assert.notEqual(run("0.3.0").status, 0);
    assert.equal(run("0.2.0").status, 0);
    assert.equal(run("--check", "v0.2.0").status, 0);
    assert.notEqual(run("--check", "v0.3.0").status, 0);
    assert.match(
      readFileSync(join(dir, "src-tauri/Cargo.lock"), "utf8"),
      /name = "dependency"\nversion = "0.1.0"/,
    );
  } finally {
    assert.ok(dir.startsWith(join(tmpdir(), "glbforge-version-test-")));
    rmSync(dir, { recursive: true, force: true });
  }
});
