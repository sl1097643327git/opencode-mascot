# 桌面看板娘使用说明

这是一个轻量 Electron 桌面看板娘程序，支持多个角色同时显示、拖动、多帧动作播放、动作切换，以及本地 HTTP/CLI 控制。

项目本体是独立看板娘服务，不依赖 opencode。opencode 只是 `plugins/` 和 `src/integrations/` 下的一个可选外部接入示例；其他项目也可以通过同一套本地 HTTP API 接入。

## 快速使用方式

### A. opencode 插件模式

适合让看板娘自动跟随 opencode：每个 opencode 窗口会对应一个项目角色，AI 工作、思考、工具调用、完成、报错等事件会映射到不同动作状态。

1. 安装依赖并启动一次看板娘：

```powershell
npm install
npm start
```

Windows 也可以双击：

```text
start-mascot.bat
```

2. 安装 opencode 插件：

```powershell
node scripts/install-opencode-plugin.js
```

Windows 可以直接运行：

```powershell
.\install-opencode-plugin.bat
```

macOS/Linux 可以运行：

```sh
chmod +x ./install-opencode-plugin.sh
./install-opencode-plugin.sh
```

安装脚本会复制插件文件到 `~/.config/opencode/plugins/`，并创建 `~/.config/opencode/mascot.json`。

3. 重启或重新加载 opencode。插件会自动尝试拉起看板娘，并让每个 opencode 窗口对应一个项目角色。

4. 检查 opencode 插件连接状态：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/opencode/state"
```

如果 `clients` 不为空，说明 opencode 已连接到看板娘。

### B. 通用 API / CLI 模式

适合接入其他工具、脚本、编辑器插件或自己的自动化流程。看板娘本体只需要本地 HTTP 服务，不强依赖 opencode。

1. 启动看板娘：

```powershell
npm start
```

或 Windows 双击：

```text
start-mascot.bat
```

2. 打开浏览器控制台：

```text
http://127.0.0.1:17890
```

控制台里可以新增/删除角色、切换形象、修改名称、切换动作、调整大小、隐藏/显示状态文字。

3. 用 CLI 控制：

常用命令：

```powershell
# 启动
.\start-mascot.bat

# 查看当前状态
Invoke-RestMethod -Uri "http://127.0.0.1:17890/status"

# 切换所有可见看板娘动作
node scripts/mascot-status.js working

# 切换单个看板娘动作
node scripts/mascot-status.js error --character assistant

# 显示/隐藏单个看板娘
node scripts/mascot-character.js show assistant
node scripts/mascot-character.js hide reviewer
```

4. 用 HTTP API 控制：

```powershell
# 切换所有可见角色动作
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/status" `
  -ContentType "application/json" `
  -Body '{"status":"working"}'

# 切换单个角色动作
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/characters/assistant/status" `
  -ContentType "application/json" `
  -Body '{"status":"error"}'
```

## 1. 启动

在项目目录双击：

```text
start-mascot.bat
```

或在 PowerShell 中运行：

```powershell
cd "D:\DESKTOP\我的应用\opencode\kanban"
.\start-mascot.bat
```

启动后会开启本地控制服务：

```text
http://127.0.0.1:17890
```

直接在浏览器打开这个地址，会进入浏览器控制台。实际控制接口见下文 HTTP API 章节。

默认有两个角色：

| 角色 ID | 名称 | 资源主题目录 |
|---|---|---|
| `assistant` | 助手 | `assets/mascot/default/` |
| `reviewer` | 审查员 | `assets/mascot/default/` |

## 2. 资源目录结构

资源根目录：

```text
assets/mascot/
```

结构规则：

```text
assets/mascot/
  default/
    idle/
      任意图片名-a.png
      任意图片名-b.png
      任意图片名-c.png
    working/
      任意图片名-a.png
      任意图片名-b.png
      任意图片名-c.png
    done/
      任意图片名-a.png
      任意图片名-b.png
      任意图片名-c.png
    error/
      任意图片名-a.png
      任意图片名-b.png
      任意图片名-c.png

  custom-theme/
    idle/
      任意图片名-a.png
      任意图片名-b.png
      任意图片名-c.png
    busy/
      任意图片名-a.png
      任意图片名-b.png
      任意图片名-c.png
    resting/
      任意图片名-a.png
      任意图片名-b.png
      任意图片名-c.png
```

说明：

- 一个角色主题一个文件夹，例如 `default`、`custom-theme`。
- 一个动作一个文件夹，例如 `idle`、`working`、`busy`。
- 一个动作文件夹里可以放任意数量图片。
- 图片文件名没有固定要求，只要是支持格式即可。
- 图片多，动画帧数就多。
- 只有一张图片时会静态显示，不会开启动画 timer，保持轻量。
- 某个动作没有图片时，会 fallback 到同角色的 `idle` 动作。
- 如果 `idle` 也没有图片，会显示内置占位图。

支持图片格式：

```text
.png
.webp
.jpg
.jpeg
```

播放顺序按图片文件名的自然排序决定。例如：

```text
frame-1.png
frame-2.png
frame-10.png
```

播放顺序会是 `1 -> 2 -> 10`，不会变成 `1 -> 10 -> 2`。

如果你需要严格指定播放顺序，建议给文件名前面加序号前缀，例如：

```text
01-站立.png
02-眨眼.png
03-挥手.png
```

这不是强制命名规则，只是最稳定、最直观的排序方式。

## 3. 已内置的默认资源

项目已经内置 `default` 主题的大图素材，可以直接看到多帧播放和动作切换效果：

```text
assets/mascot/default/idle/
assets/mascot/default/working/
assets/mascot/default/done/
assets/mascot/default/error/
```

其他主题目录可以按相同结构自行添加图片；缺失动作会自动回退到该主题的 `idle`。

## 4. 可用动作状态

当前支持这些状态：

```text
idle
working
thinking
typing
tool
permission
busy
resting
done
error
```

对应动作目录就是同名文件夹。

例如 `working` 动作对应：

```text
assets/mascot/default/working/
assets/mascot/custom-theme/working/
```

如果 `custom-theme/working/` 不存在或为空，会自动使用：

```text
assets/mascot/custom-theme/idle/
```

## 5. CLI 控制动作

### 5.1 切换所有可见角色动作

```powershell
node scripts/mascot-status.js idle
node scripts/mascot-status.js working
node scripts/mascot-status.js busy
node scripts/mascot-status.js resting
node scripts/mascot-status.js done
node scripts/mascot-status.js error
```

示例：

```powershell
node scripts/mascot-status.js working
```

这会把所有可见角色切换到 `working`。

### 5.2 切换单个角色动作

格式：

```powershell
node scripts/mascot-status.js <动作> --character <角色ID>
```

示例：

```powershell
node scripts/mascot-status.js working --character assistant
node scripts/mascot-status.js busy --character reviewer
node scripts/mascot-status.js resting --character reviewer
node scripts/mascot-status.js error --character assistant
```

这样可以让不同角色同时播放不同动作。

## 6. CLI 显示/隐藏角色

显示角色：

```powershell
node scripts/mascot-character.js show assistant
node scripts/mascot-character.js show reviewer
```

隐藏角色：

```powershell
node scripts/mascot-character.js hide assistant
node scripts/mascot-character.js hide reviewer
```

## 7. HTTP API 控制

HTTP 服务只监听本机地址：

```text
127.0.0.1:17890
```

直接打开下面地址会进入浏览器控制台页面：

```text
http://127.0.0.1:17890
```

控制台页面支持：

- 新增看板娘。
- 修改每个看板娘下方显示的文本。
- 用下拉框选择每个看板娘的形象/主题。
- 修改每个看板娘的动作状态。
- 显示或隐藏单个看板娘。
- 删除看板娘。
- 一键切换所有可见看板娘的动作状态。

形象下拉框来自资源目录：

```text
assets/mascot/<形象主题>/
```

例如默认已有：

```text
assets/mascot/default/
```

如果你新建一个：

```text
assets/mascot/catgirl/
```

刷新控制台页面后，形象下拉框里会出现 `catgirl`。

### 7.0 查看 API 元数据

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/api/help"
```

### 7.0.1 查看可用形象主题

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/themes"
```

### 7.1 查看当前状态

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/status"
```

### 7.2 切换所有可见角色动作

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/status" `
  -ContentType "application/json" `
  -Body '{"status":"working"}'
```

### 7.3 切换单个角色动作

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/characters/assistant/status" `
  -ContentType "application/json" `
  -Body '{"status":"error"}'
```

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/characters/reviewer/status" `
  -ContentType "application/json" `
  -Body '{"status":"busy"}'
```

### 7.4 显示/隐藏单个角色

隐藏：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/characters/reviewer/visibility" `
  -ContentType "application/json" `
  -Body '{"visible":false}'
```

显示：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/characters/reviewer/visibility" `
  -ContentType "application/json" `
  -Body '{"visible":true}'
```

### 7.5 新增看板娘

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/characters" `
  -ContentType "application/json" `
  -Body '{"id":"mascot-3","name":"第三只","theme":"default","status":"idle"}'
```

`id` 只能使用字母、数字、下划线、短横线，例如：

```text
mascot-3
catgirl
helper_01
```

### 7.6 修改看板娘文本、形象、动作和显示状态

```powershell
Invoke-RestMethod `
  -Method Patch `
  -Uri "http://127.0.0.1:17890/characters/mascot-3" `
  -ContentType "application/json" `
  -Body '{"name":"新的下方文本","theme":"reviewer","status":"busy","visible":true}'
```

### 7.7 删除看板娘

```powershell
Invoke-RestMethod `
  -Method Delete `
  -Uri "http://127.0.0.1:17890/characters/mascot-3"
```

删除后桌面窗口会立即移除对应看板娘。

## 8. 拖动和鼠标行为

- 直接拖动角色本体即可移动角色。
- 右键角色本体可打开角色快捷菜单。
- 双击角色本体也可打开角色快捷菜单。
- 快捷菜单里可以直接修改该角色的动作、形象和下方文本，也可以删除角色。
- 透明空白区域不会拦截鼠标，可以正常操作桌面和其他窗口。
- 角色不能被拖到屏幕外。
- 拖动后位置会自动保存。
- 下次启动会恢复位置。
- 如果旧版本保存过异常位置，启动时会自动夹回屏幕内。

位置保存文件：

```text
C:\Users\<你的用户名>\AppData\Roaming\opencode-mascot\character-layout.json
```

如果想重置角色位置：

1. 关闭看板娘。
2. 删除上面的 `character-layout.json`。
3. 重新启动 `start-mascot.bat`。

## 9. 如何添加形象

一个“形象”就是 `assets/mascot/` 下的一个主题目录。主题目录里面按动作状态分子目录。

### 9.1 新增一个形象主题

例如新增 `catgirl`：

```text
assets/mascot/catgirl/
  idle/
    001.png
    002.png
  working/
    001.png
    002.png
  done/
    001.png
  error/
    001.png
```

最少建议先放 `idle/`，因为其他动作缺图时会回退到同主题的 `idle`。如果 `idle/` 也没有图片，就会显示内置占位图。

添加后重启看板娘，或刷新浏览器控制台，形象下拉框会出现 `catgirl`。

### 9.2 给角色切换形象

可以在桌面角色上右键/双击打开快捷菜单，然后选择新形象。

也可以用 HTTP API：

```powershell
Invoke-RestMethod `
  -Method Patch `
  -Uri "http://127.0.0.1:17890/characters/assistant" `
  -ContentType "application/json" `
  -Body '{"theme":"catgirl"}'
```

### 9.3 替换默认形象图片

如果只是替换默认两个角色的图片，不需要改代码。

例如替换助手的 `working` 动作：

```text
assets/mascot/default/working/
  001.png
  002.png
  003.png
  004.png
```

然后运行：

```powershell
node scripts/mascot-status.js working --character assistant
```

### 9.4 添加更多动作

如果添加自定义主题的 `busy` 动作：

```text
assets/mascot/custom-theme/busy/
  001.png
  002.png
  003.png
  004.png
```

然后运行：

```powershell
node scripts/mascot-status.js busy --character reviewer
```

## 10. 快速测试多个角色和动作

启动后运行：

```powershell
node scripts/mascot-character.js show assistant
node scripts/mascot-character.js show reviewer
node scripts/mascot-status.js working --character assistant
node scripts/mascot-status.js busy --character reviewer
```

再切换：

```powershell
node scripts/mascot-status.js done --character assistant
node scripts/mascot-status.js resting --character reviewer
```

再测试错误状态：

```powershell
node scripts/mascot-status.js error --character assistant
```

如果能看到两个角色同时显示、同时播放不同动作，并且拖动不丢失，就说明多角色、多帧播放、动作切换都正常。

## 11. 故障排查

### 11.1 启动后看不到角色

先检查服务是否启动：

```powershell
Invoke-RestMethod -Uri "http://127.0.0.1:17890/status"
```

如果服务正常，尝试显示两个角色：

```powershell
node scripts/mascot-character.js show assistant
node scripts/mascot-character.js show reviewer
```

如果仍然看不到，可以重置位置：

```text
C:\Users\<你的用户名>\AppData\Roaming\opencode-mascot\character-layout.json
```

删除该文件后重启。

### 11.2 动作没有变化

确认动作目录里有图片：

```text
assets/mascot/<主题>/<动作>/
```

例如：

```text
assets/mascot/default/working/
```

如果目录为空，会回退到 `idle`。

### 11.3 空白区域挡住鼠标

当前版本默认会让透明区域鼠标穿透。如果遇到空白区域挡鼠标，先确认已重新启动最新版本：

```powershell
.\start-mascot.bat
```

### 11.4 端口被占用

程序使用端口：

```text
17890
```

检查端口：

```powershell
Get-NetTCPConnection -LocalPort 17890 -ErrorAction SilentlyContinue
```

如果有旧进程残留，可以关闭旧的 Electron 进程后重启。

## 12. 外部项目接入边界

看板娘核心只认识“角色”和“动作状态”，不认识 opencode、IDE、浏览器或其他业务系统。外部项目接入时推荐按这个分层：

| 层 | 位置 | 职责 |
|---|---|---|
| 核心看板娘 | `src/state-store.js`、`src/renderer.js`、`src/frame-manifest.js` | 管理角色、播放帧、拖动、菜单、鼠标穿透 |
| 本地协议 | `src/http-server.js` | 暴露通用角色 API，并可选挂载 integrations |
| 外部适配器 | `src/integrations/<name>.js` | 把某个外部系统事件转换成角色增删改和状态变化 |
| 外部插件 | `plugins/<name>.js` | 运行在外部系统内，只通过 HTTP 调用看板娘 |

通用接入方式：

1. 启动看板娘，让 `http://127.0.0.1:17890` 可访问。
2. 外部项目用 `POST /characters` 创建自己的角色。
3. 用 `PATCH /characters/:id` 修改文本、形象、位置、宽度、动作。
4. 用 `POST /characters/:id/status` 推送动作状态。
5. 外部项目结束时用 `DELETE /characters/:id` 删除对应角色。

核心接口示例：

```powershell
Invoke-RestMethod `
  -Method Post `
  -Uri "http://127.0.0.1:17890/characters" `
  -ContentType "application/json" `
  -Body '{"id":"my-app-1","name":"我的项目","theme":"default","status":"working","x":420,"y":40,"width":180}'
```

这样接入的项目不需要知道 Electron、renderer 或内部 store 结构。

## 13. opencode 全局插件接入

opencode 集成是一个可选 adapter，不是看板娘核心依赖。它由两部分组成：

- 看板娘服务内 adapter：`src/integrations/opencode.js`
- opencode 全局插件：`plugins/opencode-mascot.js`

### 13.1 安装全局插件

在看板娘项目目录运行：

```powershell
node scripts/install-opencode-plugin.js
```

安装脚本会复制插件到：

```text
C:\Users\<你的用户名>\.config\opencode\plugins\mascot.js
```

并创建配置文件：

```text
C:\Users\<你的用户名>\.config\opencode\mascot.json
```

默认配置类似：

```json
{
  "enabled": true,
  "autoStart": true,
  "mascotUrl": "http://127.0.0.1:17890",
  "startCommand": ["cmd.exe", "/c", "D:\\DESKTOP\\我的应用\\opencode\\kanban\\start-mascot.bat"],
  "heartbeatMs": 2000
}
```

### 13.2 启用插件

插件文件会导出 opencode 官方插件函数 `MascotPlugin`。opencode 支持从全局插件目录或配置加载插件模块。安装后插件文件在：

```text
C:\Users\<你的用户名>\.config\opencode\plugins\mascot.js
```

如果你的 opencode 配置使用插件数组，请在全局 `opencode.json` 中加入对应插件模块；如果你的版本支持自动扫描 `~/.config/opencode/plugins/`，安装后重启 opencode 即可。

### 13.3 关闭插件

临时关闭：

```powershell
$env:OPENCODE_MASCOT_DISABLE = "1"
opencode
```

长期关闭：编辑 `C:\Users\<你的用户名>\.config\opencode\mascot.json`：

```json
{
  "enabled": false
}
```

要重新启用，把 `enabled` 改回 `true`。

### 13.4 自动拉起看板娘

当插件向看板娘发送事件失败时，如果配置里 `autoStart: true`，会执行：

```json
"startCommand": ["cmd.exe", "/c", "...\\start-mascot.bat"]
```

网络错误不会影响 opencode 正常工作；插件会静默失败并继续发送后续 heartbeat/event。

### 13.5 多窗口和同项目复用

- 每个 opencode 插件实例会生成一个独立 `clientID`。
- 每个 `clientID` 对应一个临时看板娘角色。
- 同一个项目会生成稳定 `projectKey`，并复用同一套偏好：形象、位置、宽度、显示名。
- 同项目多窗口会稍微错位显示，避免完全重叠。
- 插件每 `heartbeatMs` 毫秒发送一次 heartbeat。
- 看板娘服务 10 秒左右收不到 heartbeat，会自动删除对应临时角色。

项目偏好保存文件：

```text
C:\Users\<你的用户名>\AppData\Roaming\opencode-mascot\opencode-projects.json
```

### 13.6 opencode 状态映射

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

为了防止状态卡死：

- `thinking` 超时后回 `working`。
- `typing` 超时后回 `working`。
- `tool` 超时后回 `working`。
- `done` 短暂停留后回 `idle`。
- `permission` 不自动清除，必须等授权回复、idle、error 或窗口断开。

### 13.7 手动测试 opencode adapter

启动看板娘后，可以不启动 opencode，直接模拟一个外部客户端：

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

## 14. 开发验证命令

运行全部测试：

```powershell
npm test
```

当前测试覆盖内容包括：

- 多角色状态管理
- HTTP API
- CLI 控制
- 多帧资源扫描
- 动作切换
- 拖动与位置保存
- 鼠标穿透
- 屏幕边界限制
- 样例资源存在性
- opencode 可选 adapter
- opencode 全局插件桥
