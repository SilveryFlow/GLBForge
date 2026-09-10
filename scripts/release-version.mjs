import { readFileSync, writeFileSync } from "node:fs";

const packageVersion = JSON.parse(readFileSync("package.json", "utf8")).version;
const configPath = "src-tauri/tauri.conf.json";
const config = JSON.parse(readFileSync(configPath, "utf8"));
const cargoPath = "src-tauri/Cargo.toml";
const lockPath = "src-tauri/Cargo.lock";
const cargo = readFileSync(cargoPath, "utf8");
const lock = readFileSync(lockPath, "utf8");
const cargoPattern = /(\[package\][\s\S]*?\nversion = ")([^"]+)(")/;
const lockPattern = /(\[\[package\]\]\r?\nname = "glbforge"\r?\nversion = ")([^"]+)(")/;
const cargoVersion = cargo.match(cargoPattern)?.[2];
const lockVersion = lock.match(lockPattern)?.[2];
if (!cargoVersion || !lockVersion) throw new Error("未找到 Rust 应用版本");

const argument = process.argv[2];
if (argument === "--check") {
  if (![config.version, cargoVersion, lockVersion].every((v) => v === packageVersion)) {
    throw new Error("package.json、Tauri、Cargo.toml、Cargo.lock 的版本不一致");
  }
  if (process.env.RELEASE_TAG && process.env.RELEASE_TAG !== `v${packageVersion}`) {
    throw new Error("发布 tag 与应用版本不一致");
  }
  console.log(`版本一致：${packageVersion}`);
} else {
  if (!/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(argument ?? "") || argument !== packageVersion) {
    throw new Error("请通过 release-it 升级 package.json 后再同步版本");
  }
  config.version = argument;
  writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`);
  writeFileSync(
    cargoPath,
    cargo.replace(cargoPattern, (_m, before, _v, after) => before + argument + after),
  );
  writeFileSync(
    lockPath,
    lock.replace(lockPattern, (_m, before, _v, after) => before + argument + after),
  );
  console.log(`已同步桌面版本：${argument}`);
}
