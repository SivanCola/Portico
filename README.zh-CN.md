# Portico

[English](README.md) | [简体中文](README.zh-CN.md)

**跨平台桌面 SSH 终端**，核心能力是把**本机图片粘贴进远程 AI 编程 CLI**（Claude Code、Codex）。

本机截图 → Portico 经 SSH/SFTP 上传到远端 → 按当前 provider 注入路径提示。**默认不走第三方云**：数据只走你自己的 SSH 连接。

![Portico — 会话、终端、图片架与端口转发](docs/assets/screenshot.png)

| | |
| --- | --- |
| **版本** | `0.1.1`（MVP） |
| **技术栈** | Electron · React · xterm.js · ssh2 · node-pty |
| **许可证** | MIT |
| **仓库** | [SivanCola/Portico](https://github.com/SivanCola/Portico) |

## 为什么需要 Portico？

AI CLI 跑在服务器上，截图却在本机。Portico 在不依赖第三方图床的前提下打通这条链路：

1. **暂存（Stage）** 剪贴板图片（`⌘/Ctrl+Shift+V`）或拖入多张文件。
2. **提交（Commit）** 在 Image Shelf 上传到内容寻址路径。
3. **注入** Claude / Codex / Shell 对应文案（自动检测，可手动切换）。

除图片桥外，Portico 还是完整的多标签终端：本地 Shell 或 SSH、端口转发、会话恢复、远端剪贴板同步。

## 功能一览

| 领域 | 能力 |
| ---- | ---- |
| **图片 → 远程 AI** | 多图暂存/提交、超大图压缩、Claude / Codex / Shell 适配器 |
| **会话** | 本地 PTY 或 SSH；多标签侧栏；可选启动时恢复会话 |
| **SSH** | 密码 / 密钥 / Agent；兼容 `~/.ssh/config`；对照 `known_hosts` 校验主机密钥 |
| **tmux** | 存在则附着 / 始终附着或创建；恢复后自动 re-attach |
| **端口转发** | 本地（`-L`）、远程（`-R`）、SOCKS5（`-D`）；流量计数；嗅探 `localhost` URL 一键转发 |
| **剪贴板** | OSC 52 远端 → 本机；可选协助开启 tmux `set-clipboard` |
| **界面** | 命令面板、图片架、设置中心、英文 / 简体中文 |
| **模式** | **仅终端（Terminal only）** — 关闭图片桥、端口转发与 provider 检测 |
| **更新** | stable / beta 双渠道；通过 GitHub Releases + `electron-updater` |

### 图片交接模型（MVP）

可靠基线是**基于文件路径**：远端 AI 读取

```text
~/.portico/blobs/<sha256>.<ext>
```

（beta 渠道为 `~/.portico-beta/blobs/...`）。本机剪贴板图片模拟与远端 `portico-agent` **不在本版本范围**。

Provider 适配器（`src/shared/adapters.ts`）：

| Provider | 交互会话 | 命令模式 |
| -------- | -------- | -------- |
| Claude | `Analyze this image: <path>` | 同左 |
| Codex | `<prompt>: <path>`（路径回退） | `codex -i <path> "<prompt>"` |
| Shell | `# image uploaded to <path>` | 同左 |

检测依赖横幅 / 进程名启发式，也可在顶栏 provider 药丸上手动覆盖。

## 安装

从已发布的 Release 下载安装包：

```text
https://github.com/SivanCola/Portico/releases
```

| 平台 | 产物 |
| ---- | ---- |
| macOS Apple Silicon | `Portico-*-arm64.dmg` / `-arm64-mac.zip` |
| macOS Intel | `Portico-*.dmg` / `-mac.zip` |
| Windows | `Portico.Setup.*.exe` |
| Linux | `Portico-*.AppImage`、`portico_*_amd64.deb` |

也可按下文从源码构建。

### macOS 提示无法打开或已损坏？

当前 Release **未**使用 Apple Developer ID 签名 / 公证，从网上下载后 macOS 可能拦截（「Apple 无法验证 Portico…」/「已损坏」等）。

若来自 [GitHub Releases](https://github.com/SivanCola/Portico/releases) 并已放入 `/Applications`，请先退出 Portico，再运行：

```bash
sudo xattr -rd com.apple.quarantine /Applications/Portico.app
```

若安装的是 **Portico Beta**：

```bash
sudo xattr -rd com.apple.quarantine "/Applications/Portico Beta.app"
```

然后再次打开应用。也可：**右键 App → 打开**，或 **系统设置 → 隐私与安全性 → 仍要打开**。

## 开发

需要：**Node.js 20+**、npm。

```bash
npm install
npm run dev          # electron-vite — stable 渠道
npm run dev:beta     # beta 渠道身份
npm run build        # main + preload + renderer → out/（stable）
npm run build:beta
npm run typecheck    # node + web 的 tsc
npm test             # vitest
```

### 本地打包

```bash
npm run dist:stable   # → dist/stable
npm run dist:beta     # → dist/beta
# 仅目录产物（不打安装包）：
npm run pack:stable
npm run pack:beta
```

## 快捷键

| 快捷键 | 作用 |
| ------ | ---- |
| `⌘/Ctrl + Shift + P` | 命令面板 |
| `⌘/Ctrl + Shift + V` | **暂存**剪贴板图片（尚未上传；可重复暂存多张） |
| Image Shelf 提交栏 `Enter` | 上传已暂存图片、注入路径并提交给 Claude/Codex |
| `⌘/Ctrl + \` | 切换工具侧栏（图片架 + 端口转发） |

更多操作在命令面板（检查更新、清理远端缓存、tmux、在浏览器打开转发等）。

## 端口转发

在 **设置 → 端口转发** 中启用，规则在右侧工具侧栏管理。

| 模式 | 含义 | 典型用途 |
| ---- | ---- | -------- |
| 本地（−L） | 本机监听 → 隧道到**服务器上**的 host:port | 远端 Claude Code / Vite / Next 预览 |
| 远程（−R） | 服务器监听 → 隧道回**本机**服务 | Webhook、本机 Agent |
| SOCKS（−D） | 本机 SOCKS5 代理，经 SSH 转发 | 浏览器 / curl 以远端出口访问 |

**SOCKS 示例** — 本机动态转发 `1080`：

```bash
curl --socks5-hostname 127.0.0.1:1080 https://ifconfig.me
# 或系统 / 浏览器代理：socks5://127.0.0.1:1080
```

每条规则显示实时**流量计数**（↑ 本机→远端，↓ 远端→本机）。点击行计数可清零该规则，或对整个会话 **Reset traffic**。

**远端开发服务器流程**

1. SSH 连接并启动服务（例如 Claude Code 在主机打开 `localhost:5173`）。
2. Portico 嗅探终端输出中的 `http://localhost:5173` 等 URL，提供**一键 Forward**。
3. 或手动添加：本机端口 → `127.0.0.1` : 远端端口（默认同端口）。
4. 点击本地转发的浏览器图标，或用命令面板 **Open port forward in browser**。

规则**按会话标签持久化**（随主机/tmux 恢复），主动断开后显示为 *stopped*，重连后重新绑定。还可：

- **两端同端口** / 本机端口占用时 **自动选端口**
- **暂停 / 恢复** 单条规则（不必删除）
- **高级**：标签、绑定地址（默认 `127.0.0.1`；`0.0.0.0` 暴露到局域网，请谨慎）
- 跨标签本机监听端口冲突检测

可在设置中关闭端口转发，或使用 **仅终端** 一并关闭图片桥、端口转发与 provider 检测。

## 会话恢复

左侧标签布局保存在 `userData/sessions.json`（**不含密码**）。启动时可：

- 重新打开标签并自动重连 SSH（密钥或 agent）
- 对各标签执行 `tmux attach`
- 恢复该标签的**端口转发规则**

开关：**设置 → 启动时恢复会话**。

## 存储约定

远端 blob 内容寻址：

```text
~/.portico/blobs/<sha256>.<ext>        # stable
~/.portico-beta/blobs/<sha256>.<ext>   # beta
```

同一图片重复粘贴不会重复上传。命令面板 **Clear Remote Portico Cache** 可清理。单图软上限 **8 MiB**（超限会压缩/缩小）；单次暂存最多 **20** 张。

## 架构

```text
src/
  shared/       类型、IPC、常量、适配器、哈希（环境无关，单测覆盖）
  main/         Electron 主进程：SSH/SFTP、本地 PTY、剪贴板、上传、端口转发、更新
  preload/      contextBridge：typed window.portico
  renderer/src/ React + xterm.js：会话、终端、图片架、设置、i18n
```

## 发布渠道

构建时由 `PORTICO_RELEASE_CHANNEL` 选择（默认 `stable`）：

| 渠道 | 应用名 | appId | 远端 blob 目录 | 更新 feed | 输出目录 |
| ---- | ------ | ----- | -------------- | --------- | -------- |
| stable | Portico | `com.portico.app` | `~/.portico/blobs` | `latest` | `dist/stable` |
| beta | Portico Beta | `com.portico.app.beta` | `~/.portico-beta/blobs` | `beta` | `dist/beta` |

Stable 与 Beta 完全隔离（应用身份、`userData` / `localStorage`、远端缓存），可并排安装。

### 自动更新

打包版从 [SivanCola/Portico](https://github.com/SivanCola/Portico) 的 GitHub Releases 检查更新。Beta 会自动下载新的 **prerelease** 并提示重启；stable 只接收 **latest**。开发模式下提示 “updates disabled in dev”。命令面板：**Check for Updates** / **Restart to Install Update**。

### 发版

由 tag 驱动 CI（`.github/workflows/release.yml`）：

| Tag | 渠道 | GitHub Release |
| --- | ---- | -------------- |
| `vX.Y.Z`（如 `v0.1.1`） | stable | 正式版 → `latest` feed |
| `vX.Y.Z-beta.N`（如 `v0.1.1-beta.1`） | beta | **prerelease** → `beta` feed |

流水线要求 `package.json` 的 `version` 与 tag（去掉 `v`）一致，避免更新元数据版本错误。

```bash
# 示例：package.json 升到 0.1.1 后打 stable 版
git tag v0.1.1
git push origin v0.1.1
```

## 测试对照

| 关注点 | 位置 |
| ------ | ---- |
| 剪贴板暂存（位图 + 文件）→ 提交 | `src/main/clipboard.ts`、`portico-controller.ts`（`stage` / `commitStaged`） |
| 空格 / 非 ASCII 路径 | `src/shared/hash.test.ts`（`shellQuote`、`blobPath`） |
| 重连安全 teardown | `src/main/ssh-session.ts`（`disconnect`） |
| Claude / Codex 适配器 | `src/shared/adapters.test.ts` |
| 超大图压缩 / 拒绝 | `src/main/clipboard.ts`（`normalizeNative`）+ `blob-uploader.ts` |
| 普通文本粘贴 | terminal `onData` → `sendInput` |
| 端口转发 / SOCKS | `src/main/port-forwarder.ts`、`socks5.ts` |
| 会话恢复 | `src/main/session-store.ts` |
| 主机密钥 | `src/main/host-key.ts` |
| OSC 52 剪贴板 | `src/main/osc52.ts` |

## 许可证

MIT。
