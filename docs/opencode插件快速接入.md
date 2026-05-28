# opencode 插件快速接入

这份文档只讲最快把 opencode 接入桌面看板娘的步骤。推荐路径是：安装插件后直接启动或重启 opencode，让插件自动拉起看板娘；手动启动 mascot 只作为排障或独立使用时的补充方式。

## 1. 前置条件

- 已在本机安装并能运行 `opencode`。
- 当前目录是看板娘项目根目录：

```powershell
cd "D:\DESKTOP\我的应用\opencode\kanban"
```

## 2. 一键安装插件

### 2.1 Windows 双击安装

直接双击项目根目录的：

```text
install-opencode-plugin.bat
```

它会调用 Node 安装脚本，自动检查并补齐依赖、写入插件文件和全局 opencode 配置；安装完成后会停在窗口里显示结果，方便确认是否成功。

也可以在 PowerShell 里运行：

```powershell
.\install-opencode-plugin.bat
```

### 2.2 macOS / Linux 一键安装

在终端运行：

```sh
chmod +x ./install-opencode-plugin.sh
./install-opencode-plugin.sh
```

Windows 如果想测试这个 `.sh`，需要 Git Bash、WSL 或其他 POSIX shell；普通 PowerShell/cmd 默认不能直接运行 `.sh`。

### 2.3 通用 Node 安装命令

如果你不想用 bat/sh 包装脚本，也可以直接运行：

```powershell
node scripts/install-opencode-plugin.js
```

脚本会做这些事：

1. 如果本项目依赖还没装好，自动执行一次 `npm install`，确保后续自动拉起能找到 Electron。

2. 复制插件文件到 opencode 全局插件目录：

```text
C:\Users\<你的用户名>\.config\opencode\plugins\mascot.js
```

3. 如果配置不存在，创建：

```text
C:\Users\<你的用户名>\.config\opencode\mascot.json
```

默认配置类似：

```json
{
  "enabled": true,
  "autoStart": true,
  "mascotUrl": "http://127.0.0.1:17890",
  "startCommand": ["node", "D:\\DESKTOP\\我的应用\\opencode\\kanban\\scripts\\launch-mascot-detached.js", "D:\\DESKTOP\\我的应用\\opencode\\kanban"],
  "heartbeatMs": 2000
}
```

4. 自动把插件模块写入全局：

```text
C:\Users\<你的用户名>\.config\opencode\opencode.json
```

会确保 `plugin` 列表里包含：

```text
C:\Users\<你的用户名>\.config\opencode\plugins\mascot.js
```

macOS / Linux 下默认配置会使用：

```json
{
  "startCommand": ["node", "看板娘项目目录/scripts/launch-mascot-detached.js", "看板娘项目目录"]
}
```

也就是说：macOS 理论上支持 opencode 插件接入；只要这个 Electron 项目能在 macOS 上正常安装依赖并启动，插件就可以用同一套 HTTP 协议接入。

自动拉起时不会直接运行 `start-mascot.bat` 或 `npm start`。插件会先调用 `scripts/launch-mascot-detached.js`，再由这个启动器以 detached 方式启动本地 Electron 二进制，避免 opencode 或安装验证命令被前台控制台进程卡住。

### 2.4 卸载插件

Windows：

```powershell
.\uninstall-opencode-plugin.bat
```

macOS / Linux：

```sh
chmod +x ./uninstall-opencode-plugin.sh
./uninstall-opencode-plugin.sh
```

通用命令：

```powershell
node scripts/uninstall-opencode-plugin.js
```

卸载脚本会删除插件文件和 `opencode.json` 里的 mascot 插件条目，但默认保留：

```text
C:\Users\<你的用户名>\.config\opencode\mascot.json
```

这样你以后重装时还可以继续沿用原来的用户设置。

## 3. 启动或重启 opencode

安装完成后，优先直接启动或重启 opencode。正常情况下，只要 `autoStart: true` 且本地 mascot 服务尚未运行，插件会自动执行 `startCommand` 拉起看板娘，不需要手动先运行 `start-mascot.bat` 或 `npm start`。

如果你想手动排障，再使用下面这些命令。

Windows 可以手动启动：

```powershell
.\start-mascot.bat
```

macOS / Linux 可以手动启动：

```sh
npm start
```

如果你不手动启动，配置里 `autoStart: true` 时，插件发现看板娘服务不可用，会自动执行 `startCommand` 尝试拉起。

启动成功后浏览器打开：

```text
http://127.0.0.1:17890
```

能看到控制台页面就说明看板娘服务正常。

## 4. 让 opencode 加载插件

插件文件本身导出 opencode 官方插件函数：

```js
MascotPlugin
```

也就是说，opencode 加载这个文件时，拿到的模块导出值必须是函数本身，而不是 `{ MascotPlugin }` 这种对象。

插件文件路径：

```text
C:\Users\<你的用户名>\.config\opencode\plugins\mascot.js
```

安装脚本已经把插件安装到全局插件目录，并尝试写入全局 `opencode.json` 的 `plugin` 列表。大多数情况下，只要安装脚本顺利完成，直接启动或重启 opencode 即可。

如果你的 opencode 使用了不同于 `plugin` 列表的加载机制，或者你想手工复核，全局配置通常在：

```text
C:\Users\<你的用户名>\.config\opencode\opencode.json
```

> 注意：不同 opencode 版本的插件加载配置可能略有差异；本项目安装脚本已经优先处理官方全局插件目录和常见的 `plugin` 列表写法，手工配置仅作为兼容性兜底。另外，若现有 `opencode.json` 不是合法 JSON，安装器会停止并提示你先修复配置，避免覆盖旧文件。

## 5. 验证是否接入成功

### 5.1 看板娘服务健康检查

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/status"
```

正常会返回 `ok: true` 和当前角色列表。

### 5.2 查看 opencode 接入状态

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/opencode/state"
```

如果 opencode 插件已经连接，会看到 `clients` 里有对应 client。

### 5.3 手动模拟一个 opencode 客户端

不启动 opencode 也可以先验证看板娘侧 adapter：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/opencode/client/hello" `
  -ContentType "application/json" `
  -Body '{"clientID":"manual-a","project":"D:\\Project\\Demo","worktree":"D:\\Project\\Demo"}'

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/opencode/event" `
  -ContentType "application/json" `
  -Body '{"clientID":"manual-a","eventType":"session.status","payload":{"status":{"type":"busy"}}}'

Invoke-RestMethod -Uri "http://127.0.0.1:17890/opencode/state"

Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/opencode/client/disconnect" `
  -ContentType "application/json" `
  -Body '{"clientID":"manual-a"}'
```

如果桌面出现一个临时看板娘，并且状态变成 `working`，说明看板娘侧接入正常。

## 6. 运行效果

- 每个 opencode 插件实例会生成一个独立 `clientID`。
- 每个 `clientID` 对应一个临时看板娘角色。
- 同一个项目会复用同一套偏好：形象、位置、宽度、显示名。
- 同项目多个窗口会自动错位，避免完全重叠。
- opencode 窗口关闭或 heartbeat 超时后，对应临时角色会自动删除。
- 网络错误不会影响 opencode 正常运行；插件会静默失败并继续重试。

## 7. 状态映射

| opencode 事件 | 看板娘状态 | 说明 |
|---|---|---|
| `session.status` busy | `working` | 正在工作 |
| `session.status` idle | `idle` | 空闲 |
| `session.status` retry | `error` | 重试或异常 |
| `message.part.updated` reasoning | `thinking` | 正在思考 |
| `message.part.updated` text | `typing` | 正在回复 |
| `tool.execute.before` | `tool` | 正在执行工具 |
| `tool.execute.after` | `working` | 工具结束，回到工作中 |
| `permission.asked` / `permission.updated` | `permission` | 等待授权 |
| `permission.replied` | `working` | 授权后继续 |
| `session.idle` | `done` 后回 `idle` | 完成提示 |
| `session.error` | `error` | 错误提示 |

## 8. 关闭插件

### 临时关闭

在启动 opencode 前设置环境变量：

```powershell
$env:OPENCODE_MASCOT_DISABLE = "1"
opencode
```

### 长期关闭

编辑：

```text
C:\Users\<你的用户名>\.config\opencode\mascot.json
```

改成：

```json
{
  "enabled": false
}
```

重新启用时改回：

```json
{
  "enabled": true
}
```

## 9. 常见问题

### 9.1 没出现 opencode 对应的看板娘

先检查看板娘服务：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/status"
```

如果服务没起来，手动运行：

```powershell
.\start-mascot.bat
```

再检查插件配置：

```text
C:\Users\<你的用户名>\.config\opencode\mascot.json
```

确认：

```json
{
  "enabled": true,
  "mascotUrl": "http://127.0.0.1:17890"
}
```

### 9.2 插件安装后没有自动加载

确认插件文件存在：

```text
C:\Users\<你的用户名>\.config\opencode\plugins\mascot.js
```

先检查 `C:\Users\<你的用户名>\.config\opencode\opencode.json` 里的 `plugin` 列表是否已经包含 `mascot.js`。安装脚本默认会自动写入；只有你的 opencode 版本使用了不同配置机制时，才需要手工补齐。

### 9.3 旧角色没有自动消失

插件默认每 2 秒 heartbeat 一次。看板娘服务大约 10 秒收不到 heartbeat 会删除对应临时角色。

如果仍然残留，可以打开控制台删除：

```text
http://127.0.0.1:17890
```

也可以重启看板娘服务。

### 9.4 端口被占用

看板娘使用本地端口：

```text
17890
```

检查端口：

```powershell
Get-NetTCPConnection -LocalPort 17890 -ErrorAction SilentlyContinue
```

如果是旧 Electron 进程占用，关闭旧看板娘后重新运行：

```powershell
.\start-mascot.bat
```

## 10. 相关文件

| 文件 | 作用 |
|---|---|
| `plugins/opencode-mascot.js` | opencode 全局插件源码 |
| `scripts/install-opencode-plugin.js` | 安装插件到 opencode 全局目录 |
| `install-opencode-plugin.bat` | Windows 双击安装插件 |
| `install-opencode-plugin.sh` | macOS / Linux 一键安装插件 |
| `uninstall-opencode-plugin.bat` | Windows 双击卸载插件 |
| `uninstall-opencode-plugin.sh` | macOS / Linux 一键卸载插件 |
| `src/integrations/opencode.js` | 看板娘服务内的 opencode adapter |
| `docs/mascot-usage.md` | 完整看板娘使用说明 |
| `start-mascot.bat` | 启动看板娘 |

## 11. 如何发布 opencode 插件

opencode 插件有官方标准，但目前更像“标准模块协议 + 本地/全局目录 + npm 包分发”，不是传统 IDE 那种必须上传到插件商店的模式。

### 11.1 官方插件标准

插件模块需要导出一个或多个插件函数。插件函数接收 opencode 传入的上下文，并返回 hooks 对象。

本项目插件当前导出：

```js
module.exports.MascotPlugin = MascotPlugin;
```

插件函数形态：

```js
async function MascotPlugin(input) {
  return {
    event: async ({ event }) => {
      // 处理 opencode 事件
    }
  };
}
```

也就是说，发布前最重要的是保证插件文件符合这个标准：

- 导出的是插件函数，不是已经执行后的 hooks 对象。
- 插件函数返回 hooks。
- hooks 可以包含 `event`，也可以包含具体事件 hook。
- 插件内部错误不要影响 opencode 主流程。

### 11.2 本地发布方式

最简单的发布方式是把插件文件复制给使用者，让使用者放到：

```text
C:\Users\<用户名>\.config\opencode\plugins\mascot.js
```

本项目已经提供安装脚本：

```powershell
node scripts/install-opencode-plugin.js
```

这种方式适合：

- 自己使用。
- 团队内部分发。
- 插件还在快速迭代。
- 插件需要依赖本地看板娘项目路径。

### 11.3 npm 包发布方式

如果想正式给别人安装，推荐做成 npm 包。

建议包结构：

```text
opencode-mascot-plugin/
  package.json
  index.js
  README.md
```

`index.js` 导出插件函数：

```js
async function MascotPlugin(input) {
  return {
    event: async ({ event }) => {
      // 转发到桌面看板娘 HTTP 服务
    }
  };
}

module.exports.MascotPlugin = MascotPlugin;
```

`package.json` 示例：

```json
{
  "name": "opencode-mascot-plugin",
  "version": "0.1.0",
  "description": "opencode desktop mascot bridge plugin",
  "main": "index.js",
  "type": "commonjs",
  "license": "MIT",
  "keywords": ["opencode", "plugin", "mascot"]
}
```

发布到 npm：

```powershell
npm login
npm publish
```

用户安装 npm 插件有两种方式。

方式一：使用 opencode CLI：

```powershell
opencode plugin opencode-mascot-plugin --global
```

`opencode plugin` 也有别名：

```powershell
opencode plug opencode-mascot-plugin --global
```

`--global` 表示写入全局配置；不加 `--global` 通常是写入当前项目配置。

方式二：手动编辑 opencode 配置，在 `plugin` 数组里加入 npm 包名：

```json
{
  "plugin": ["opencode-mascot-plugin"]
}
```

全局配置通常在：

```text
C:\Users\<你的用户名>\.config\opencode\opencode.json
```

官方文档说明 npm 插件会在 opencode 启动时自动安装/加载，并缓存到本机缓存目录。

### 11.4 是否有官方插件平台

截至当前已核对的 opencode 插件文档，没有看到类似 VS Code Marketplace 那种“官方插件商店 / 官方上传平台”的发布流程。

opencode 有官方文档里的 ecosystem/community 列表，但它更像社区项目收录页面，通常通过提交 PR 收录项目；它不是一个带上传、审核、版本管理、评分和一键安装的官方插件市场。

目前可确认的官方机制是：

- 本地项目插件目录。
- 用户全局插件目录。
- 配置文件里的 npm 插件包。
- `opencode plugin <module>` / `opencode plug <module>` CLI 安装方式。
- opencode 插件函数和 hooks 标准。

所以如果要公开发布，当前最稳妥方式是：

1. 把插件做成 npm 包。
2. 在 README 里写清楚 `opencode plugin <包名> --global` 安装方式。
3. 同时写清楚手动 `opencode.json` 配置方式。
4. 提供本地安装脚本或一键复制脚本，方便不想发 npm 的用户。
5. 标明依赖的桌面看板娘服务地址：`http://127.0.0.1:17890`。

### 11.5 本项目建议的发布拆分

因为看板娘是独立桌面项目，opencode 插件只是桥接层，正式发布时建议拆成两个发布物：

| 发布物 | 内容 | 适合渠道 |
|---|---|---|
| 桌面看板娘应用 | Electron 程序、资源目录、HTTP 服务 | GitHub Release / 压缩包 / 安装包 |
| opencode 插件 | 只包含 `MascotPlugin` 和配置说明 | npm 包 / 插件文件 |

不建议把整个 Electron 项目塞进 opencode 插件包里。插件包应保持轻量，只负责：

- 读取配置。
- 自动拉起看板娘。
- 发送 hello/heartbeat/disconnect。
- 转发 opencode 事件到看板娘 HTTP API。
