<p align="center"><img src="public/glbforge.svg" width="96" alt="GLBForge" /></p>

# GLBForge

离线 glTF / GLB 模型工作台，使用 Tauri 2、Vue 3 和 Three.js 构建。当前提供 Windows x64 压缩引擎。

## 功能

- **模型压缩**：Meshopt / Draco 引擎、参数预设、批量任务及操作日志。
- **模型预览**：拖入 GLB 后加载预览；压缩后选择原始或压缩模型，支持滑动对比和铺满窗口。
- **模型诊断**：在 Worker 中按阶段检查结构、几何与资源，执行清理验证；支持取消以及 JSON / 文本报告导出。
- **节点标记**：独立导入模型，节点树与三维选择联动，按节点索引编辑 extras，导入/导出标记 JSON，保存标记 GLB。
- **格式转换**：通过独立页面处理模型，各模块保留自己的输入状态。

模型处理在本机执行，不需要云服务账号。诊断是应用内检查，不等同于完整的 glTF 规范验证；压缩收益取决于模型和参数。

## 开发

准备 Node.js 24、pnpm 和 Rust stable。Windows 还需要 Visual Studio C++ Build Tools、Windows SDK 和 WebView2。

```sh
git clone https://github.com/SilveryFlow/GLBForge.git
cd GLBForge
pnpm install --frozen-lockfile
pnpm tauri dev
```

`pnpm dev` 只启动前端，文件读写和压缩需要 Tauri 桌面环境。

```sh
pnpm test         # 模型数据回归
pnpm build        # 类型检查及前端构建
pnpm tauri build  # 桌面程序和安装包
```

Windows 安装包输出到 `src-tauri/target/release/bundle/`。仓库包含 Windows x64 的 gltfpack 和 draco_transcoder；其他平台需自行编译对应引擎，按 `工具名-目标三元组` 放入 `src-tauri/binaries/`。其他平台尚未完成验证。

## 项目结构

| 目录 | 内容 |
| --- | --- |
| `src/views` | 压缩、转换、批量、诊断、节点标记页面 |
| `src/components` | 模型预览、滑动对比、参数设置 |
| `src/lib` | 诊断、GLB 标记读写与桌面调用 |
| `src-tauri` | Rust 后端、压缩引擎和图标 |
| `tests` | 数据回归测试 |

界面遵循 [DESIGN.md](DESIGN.md)，主题 token 位于 `src/styles/theme.scss`。图标源文件是 `public/glbforge.svg`，通过 `pnpm tauri icon public/glbforge.svg` 生成桌面图标。

## 版本发布

版本与 [CHANGELOG.md](CHANGELOG.md) 由 release-it 管理。提交使用 Conventional Commits：`feat:` 表示新功能，`fix:` 表示修复；发布时自动汇总记录。

先将改动提交并推送到 `main`，保持工作区干净，再执行：

```sh
pnpm release --dry-run       # 预演，不修改版本、不创建 tag、不推送
pnpm release --no-increment  # 首次发布当前版本 0.1.0
pnpm release patch          # 后续修复版本；新功能可用 minor
```

实际发布会先运行测试和前端构建，再同步 `package.json`、`src-tauri/tauri.conf.json`、`Cargo.toml`、`Cargo.lock` 的版本，生成 changelog、发布提交和 `v版本号` tag，并推送到 GitHub。不会发布 npm 包。

推送 tag 会触发 **Windows Release** 工作流，构建 Windows x64 的 NSIS `.exe` 和 `.msi` 安装包，并将文件和该版本的 changelog 上传到 **Release 草稿**。下载草稿附件验证安装、启动和主要功能后，在 GitHub Releases 点击 **Publish release**。

构建失败可重跑对应工作流，也可在 Actions 手动选择已存在的 tag。已正式发布的附件不会被自动覆盖。当前没有配置 Windows 代码签名；安装包不是已签名版本。

## 贡献与许可

欢迎提交 Issue 和 Pull Request。请描述复现步骤、系统版本及预期行为；模型样本请使用可公开分享的文件。提交前运行 `pnpm test` 和 `pnpm build`。

自有代码与图标采用 [MIT License](LICENSE)。第三方组件保留原许可，见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
