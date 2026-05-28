# opencode-mascot

一个把 AI / opencode 工作状态可视化到桌面的轻量 Electron 看板娘工具。它可以作为本地桌面角色独立运行，也可以通过 opencode 插件、CLI 或本地 HTTP API 驱动，让“正在思考、调用工具、等待权限、完成、报错”等状态变成可见的桌面反馈。

适合希望把 AI 工作流变得更直观、更有存在感的人：你可以把它当作一个能动起来的桌面状态面板，也可以把它接入自己的自动化流程、编辑器插件或本地工具链。

## 内置形象预览

仓库当前内置了可以直接使用的主题素材。为了方便在 GitHub 上快速感受风格，下面展示两个内置主题的静态预览。

<table>
  <tr>
    <td align="center">
      <strong>default</strong><br />
      <img src="assets/mascot/default/idle/ComfyUI_01084_.png" alt="default mascot preview" width="220" />
    </td>
    <td align="center">
      <strong>succubus</strong><br />
      <img src="assets/mascot/succubus/idle/ComfyUI_01392_.png" alt="succubus mascot preview" width="220" />
    </td>
  </tr>
</table>

## 项目亮点

- **桌面可视化 AI 状态**：把 `idle`、`working`、`thinking`、`typing`、`tool`、`permission`、`done`、`error` 等状态映射成角色动作。
- **多角色同时显示**：支持多个角色并存，可拖拽、缩放、隐藏/显示，适合区分不同项目或不同来源的状态流。
- **opencode 自动联动**：插件可为每个 opencode 项目自动创建角色，并跟随事件切换动作。
- **本地优先、可脚本化控制**：可通过浏览器控制台、CLI 和本地 HTTP API 控制角色，不依赖云服务。
- **偏好持久化**：名称、位置、大小、主题和部分显示偏好会自动保存。

## 快速入口

### 我想接入 opencode（推荐）

推荐直接安装 opencode 插件，然后启动或重启 opencode。正常情况下，不需要手动先启动看板娘；插件会在需要时自动拉起本地 mascot 服务。

Windows：

```powershell
.\install-opencode-plugin.bat
```

macOS/Linux：

```sh
chmod +x ./install-opencode-plugin.sh
./install-opencode-plugin.sh
```

通用命令：

```sh
node scripts/install-opencode-plugin.js
```

安装完成后，启动或重启 opencode，并检查连接状态：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/opencode/state"
```

### 我想单独手动跑起来

```powershell
npm install
npm start
```

启动后可打开：

```text
http://127.0.0.1:17890
```

Windows 也可以直接双击：

```text
start-mascot.bat
```

卸载插件：

Windows：

```powershell
.\uninstall-opencode-plugin.bat
```

macOS/Linux：

```sh
chmod +x ./uninstall-opencode-plugin.sh
./uninstall-opencode-plugin.sh
```

通用命令：

```sh
node scripts/uninstall-opencode-plugin.js
```

安装后启动或重启 opencode，并检查连接状态：

- 安装脚本会自动补齐本项目依赖（缺失时执行 `npm install`）。
- 安装脚本会自动把 mascot 插件写入全局 `opencode.json` 的 `plugin` 列表。
- 安装脚本会显示分阶段进度，例如检查 Electron、安装依赖、校验二进制、复制插件文件和写入配置。
- 安装脚本在未显式配置镜像时，会默认使用国内可访问的 Electron 镜像下载二进制。
- 正常情况下，只要安装脚本顺利完成，启动或重启 opencode 后看板娘就应自动加载，不需要手动先启动 mascot，也不需要再手动改插件配置。

默认情况下，安装脚本会自动使用：

```powershell
$env:ELECTRON_MIRROR='https://npmmirror.com/mirrors/electron/'
$env:ELECTRON_CUSTOM_DIR='{{ version }}'
```

如果你想改成自己的腾讯云、阿里云、公司内网镜像，也可以在运行安装脚本前手动覆盖。例如 PowerShell：

```powershell
$env:ELECTRON_MIRROR='https://your-mirror.example.com/electron/'
$env:ELECTRON_CUSTOM_DIR='{{ version }}'
```

如果你的网络环境需要代理，也可以在同一个终端里一起设置：

```powershell
$env:ELECTRON_GET_USE_PROXY='1'
$env:HTTPS_PROXY='http://127.0.0.1:7890'
$env:HTTP_PROXY='http://127.0.0.1:7890'
```

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/opencode/state"
```

## 适合谁

- 想把 AI 助手当前状态直接映射到桌面上的个人开发者。
- 想为 opencode 项目窗口自动生成角色反馈的人。
- 想通过本地 HTTP API / CLI 把桌面角色接入自己脚本或工具链的人。
- 想做一个更有存在感、更容易一眼感知状态的本地 AI 工作环境的人。

## 功能

- 多角色同时显示、拖拽、缩放、隐藏/显示。
- 多帧动作播放，支持 `idle`、`working`、`thinking`、`typing`、`tool`、`permission`、`done`、`error` 等状态。
- 右键/双击角色打开快捷菜单，修改名称、形象、动作、大小和状态显示开关。
- 名称、位置、大小、主题等偏好持久化。
- opencode 插件可自动创建项目角色，并把 opencode 运行状态映射到看板娘动作。
- 浏览器控制台和 CLI/API 都可以控制角色。

## 环境要求

- Node.js 18+
- npm
- Windows 已完整测试；macOS/Linux 理论可运行 Electron 和本地 HTTP 服务，但发布前建议在目标平台实测。

## 安装与启动

如果你只是想尽快启动一次，直接看上面的“快速入口”即可。这里保留完整的基础启动说明。

```powershell
npm install
npm start
```

Windows 也可以双击：

```text
start-mascot.bat
```

启动后打开控制台：

```text
http://127.0.0.1:17890
```

## 快速使用

### 方式一：opencode 插件

适合想让每个 opencode 窗口自动生成项目看板娘，并自动跟随 AI 状态切换动作的人。这也是推荐的默认使用方式。

1. 安装 opencode 插件：

   Windows：

   ```powershell
   .\install-opencode-plugin.bat
   ```

   macOS/Linux：

   ```sh
   chmod +x ./install-opencode-plugin.sh
   ./install-opencode-plugin.sh
   ```

   通用命令：

   ```sh
   node scripts/install-opencode-plugin.js
   ```

2. 启动或重启 opencode。安装脚本已经自动准备依赖并补齐插件配置；插件会在本地 mascot 服务未运行时自动拉起它，并为 opencode 项目创建/更新角色。

检查插件是否连接：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/opencode/state"
```

### 方式二：通用 API / CLI

适合把看板娘接入其他工具、脚本或自己的自动化流程。

1. 启动看板娘：

   ```powershell
   npm start
   ```

2. 查看当前状态：

   ```powershell
   Invoke-RestMethod -Uri "http://127.0.0.1:17890/status"
   ```

3. 用 CLI 或 HTTP API 控制角色：

   ```powershell
   # 切换所有可见角色动作
   node scripts/mascot-status.js working

   # 切换单个角色动作
   node scripts/mascot-status.js error --character assistant

   # 显示/隐藏角色
   node scripts/mascot-character.js show assistant
   node scripts/mascot-character.js hide reviewer
   ```

   ```powershell
   # HTTP API 示例：切换所有可见角色到 working
   Invoke-RestMethod `
     -Method Post `
     -Uri "http://127.0.0.1:17890/status" `
     -ContentType "application/json" `
     -Body '{"status":"working"}'
   ```

## 安装 opencode 插件

Windows：

```powershell
.\install-opencode-plugin.bat
```

macOS/Linux：

```sh
chmod +x ./install-opencode-plugin.sh
./install-opencode-plugin.sh
```

通用命令：

```sh
node scripts/install-opencode-plugin.js
```

安装脚本会复制插件到：

```text
~/.config/opencode/plugins/mascot.js
~/.config/opencode/plugins/opencode-mascot-core.cjs
```

并创建配置：

```text
~/.config/opencode/mascot.json
```

安装脚本还会：

- 在缺少 Electron 运行依赖时自动执行一次 `npm install`
- 自动把 `~/.config/opencode/plugins/mascot.js` 加入 `~/.config/opencode/opencode.json` 的 `plugin` 列表
- 在控制台输出当前安装阶段，方便判断是否卡在 Electron 下载阶段
- 在未手动指定镜像时，默认使用 `https://npmmirror.com/mirrors/electron/` 下载 Electron 二进制

正常情况下，只要安装脚本顺利完成，安装后只需要启动或重启 opencode；如果没有自动出现，再检查 `npm install` 输出、`~/.config/opencode/opencode.json` 和 `~/.config/opencode/mascot.json`。

如果安装过程长时间停在 `Installing mascot dependencies with npm install...`，通常不是脚本死锁，而是 Electron 二进制下载较慢或被网络拦截。此时优先尝试：

```powershell
# 默认已经会自动使用 npmmirror；如果你要覆盖成自定义镜像，可手动指定：
$env:ELECTRON_MIRROR='https://your-mirror.example.com/electron/'
$env:ELECTRON_CUSTOM_DIR='{{ version }}'
$env:ELECTRON_GET_USE_PROXY='1'
```

如果公司网络需要代理，再补：

```powershell
$env:HTTPS_PROXY='http://127.0.0.1:7890'
$env:HTTP_PROXY='http://127.0.0.1:7890'
```

卸载脚本会删除：

- `~/.config/opencode/plugins/mascot.js`
- `~/.config/opencode/plugins/opencode-mascot-core.cjs`
- `~/.config/opencode/opencode.json` 里的 mascot 插件条目

默认**不会删除** `~/.config/opencode/mascot.json`，这样以后重装时可以继续沿用你的用户设置。

## 常用命令

```powershell
# 查看当前状态
Invoke-RestMethod -Uri "http://127.0.0.1:17890/status"

# 切换所有可见角色动作
node scripts/mascot-status.js working

# 切换单个角色动作
node scripts/mascot-status.js error --character assistant

# 显示/隐藏角色
node scripts/mascot-character.js show assistant
node scripts/mascot-character.js hide reviewer
```

## 资源目录

角色资源放在：

```text
assets/mascot/<theme>/<status>/*.{png,webp,jpg,jpeg}
```

例如：

```text
assets/mascot/default/idle/ComfyUI_01121_.png
assets/mascot/default/working/ComfyUI_01131_.png
```

一个动作目录内可以放多张图，会按文件名自然排序播放。缺失状态会回退到同主题的 `idle`；如果 `idle` 也缺失，会显示内置占位图。

当前仓库保留 `assets/mascot/default/` 下的默认大图素材，适合直接提交到 GitHub 展示真实效果。`reviewer` 等其他主题可以按同样目录结构自行添加。

## 如何添加形象

新增一个主题目录，并按动作状态建立子目录：

```text
assets/mascot/catgirl/idle/01.png
assets/mascot/catgirl/working/01.png
assets/mascot/catgirl/done/01.png
assets/mascot/catgirl/error/01.png
```

规则：

- 主题名就是 `assets/mascot/<theme>/` 的文件夹名，例如 `catgirl`。
- 动作名就是 `idle`、`working`、`thinking`、`typing`、`tool`、`permission`、`done`、`error` 等状态名。
- 一个动作目录可以放多张图片，会按文件名自然排序播放。
- 某个动作没有图片时，会回退到同主题的 `idle`。
- 添加完图片后重启或刷新控制台，在角色菜单/控制台里把形象切到新主题即可。

## 最小示例

启动看板娘后，可以运行一个快速演示脚本，让两个角色显示并切换动作：

```powershell
node examples/quick-demo.js
```

## 故障排查

### Electron 进程存在，但桌面没看到看板娘

优先检查本地服务是否真的启动：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/status"
```

如果接口正常但桌面没有角色：

1. 打开 `http://127.0.0.1:17890`，确认角色是否被隐藏。
2. 在控制台把角色设为显示，或运行：
   ```powershell
   node scripts/mascot-character.js show assistant
   node scripts/mascot-character.js show reviewer
   ```
3. 确认 `assets/mascot/<theme>/idle/` 或当前状态目录里有图片；缺失时会回退到 `idle`，再缺失会显示内置占位图。
4. 角色可能被拖到屏幕边缘或屏幕外，重启后会根据当前工作区夹回可见范围。
5. Windows 可用 `start-mascot.bat` 重新启动；脚本会先关闭同项目旧 Electron 进程。
6. 如果通过安装脚本安装，依赖通常已经自动准备完成；只有你跳过安装脚本、直接手动复制插件文件时，才需要自己先执行 `npm install`。
7. 打开开发者工具时如果看到 `window.mascotApi` 相关错误，说明 Electron preload 没有正确加载，需要用 `npm start` 或项目脚本启动，不要直接打开 `src/index.html`。

### opencode 没有生成项目角色

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/opencode/state"
```

如果 `clients` 为空，说明插件还没连接。检查：

- `~/.config/opencode/plugins/mascot.js` 是否存在。
- `~/.config/opencode/mascot.json` 中 `enabled` 是否为 `true`。
- 是否重启了 opencode。
- 是否设置了 `OPENCODE_MASCOT_DISABLE=1`。

## 开发

```powershell
npm install
npm test
```

发布前建议运行：

```powershell
npm test
npm pack --dry-run
```

## 文档

- `docs/mascot-usage.md`：完整使用说明和 HTTP API。
- `docs/opencode插件快速接入.md`：opencode 插件快速接入。

## License

MIT
