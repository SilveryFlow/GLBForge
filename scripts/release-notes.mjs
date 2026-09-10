import { readFileSync, writeFileSync } from "node:fs";

const version = JSON.parse(readFileSync("package.json", "utf8")).version;
const changelog = readFileSync("CHANGELOG.md", "utf8");
const sections = changelog.split(/(?=^#{1,3} \[?\d+\.\d+\.\d+)/m);
const section = sections.find(
  (part) =>
    part.startsWith(`## [${version}]`) ||
    part.startsWith(`## ${version} `) ||
    part.startsWith(`### [${version}]`) ||
    part.startsWith(`# [${version}]`),
);
if (!section) throw new Error(`CHANGELOG.md 缺少 ${version} 的发布记录`);
writeFileSync(
  "release-notes.md",
  `${section.trim()}\n\nWindows x64：下载 .exe 安装程序或 .msi 安装包。\n`,
);
