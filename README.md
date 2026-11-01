# 大肥鱼 Live2D 桌宠

Windows 桌面上的 Live2D 角色：透明无边框窗口、跟随鼠标视线、点击 / 抚摸 / 捏脸互动、待机小动作，
并且可以接入 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）——让 AI 一边干活一边用气泡和动作「说话」。

![Electron](https://img.shields.io/badge/Electron-33-47848f) ![Live2D](https://img.shields.io/badge/Live2D-Cubism%205-ff6b9d) ![License](https://img.shields.io/badge/code-MIT-blue)

## ⚠️ 模型不随本仓库 / 安装包分发

**本项目的所有下载包都不含「大肥鱼」模型。** 模型版权归原作者，作者明确禁止二次发布，所以：

- **模型出处**：Bilibili UP 主 **神宫凉子**，视频 [BV1KmxY66EZ3](https://www.bilibili.com/video/BV1KmxY66EZ3)；
- 请到上述作者 / 视频处自行获取模型（`大肥鱼.model3.json` 及其 `moc3` / 贴图 / 动作 / 物理文件，通常是一个文件夹或者压缩包）；
- 拿到后在 exe 旁边建一个 `model` 文件夹，把整个模型目录放进去（见下），程序自动读取；
- 也支持任意 Cubism 5 导出的 `.model3.json`，只是互动热区是按大肥鱼模型调校的，别的模型需要自己调。

> 换模型：右键角色 → 设置 →「模型」→「更换 Live2D 模型」，或者直接换 `model` 文件夹里的内容。

## 下载与安装

1. 到 [Releases](../../releases) 下载 `dafeiyu-live2d-pet-v1.0.1-win32-x64.zip`；
2. 解压到一个固定目录（路径含中文没问题）；
3. 在 `大肥鱼Live2d桌宠.exe` 旁边新建 **`model`** 文件夹，把模型整个放进去：

```
大肥鱼Live2d桌宠-v1.0.1-win32-x64\
  大肥鱼Live2d桌宠.exe
  model\
    大肥鱼.model3.json
    大肥鱼.moc3
    大肥鱼.physics3.json
    Animation\  Exp3\  贴图...
```

4. 双击 `大肥鱼Live2d桌宠.exe` —— 自动读 `model\` 里的模型，**不用配置任何路径**。
   - 第一次运行如果还没放模型，程序会开一个引导窗口告诉你怎么放（不再闪退）；
   - 模型贴图超过 2048 时，**首次启动会自动压一次**（约 10 秒，会显示「正在压缩模型贴图」），
     之后一直用 `_opt2048` 副本 —— 常驻软件不该一开机就吃 2GB。

配置里只记相对路径（`model/大肥鱼.model3.json`），整个文件夹挪位置、拷到别的机器都不用改。

无需安装运行时，解压即用；系统要求 Windows 10 / 11 x64。

## 🤖 让 AI 帮你装（推荐：把下面整段粘给 DeepSeek / Claude / Codex）

大多数人是直接让 agent 代装的。下面这段是**可执行**的，agent 照着做完再回报即可：

```text
请帮我在 Windows 上安装「大肥鱼 Live2D 桌宠」，按步骤执行，每步确认结果再继续：

1) 下载发布包
   https://github.com/FULASKA/-live2d-/releases/latest
   资产名形如 dafeiyu-live2d-pet-v1.0.x-win32-x64.zip（约 160MB）

2) 解压到一个固定目录（推荐 %LOCALAPPDATA%\Live2DPet），确认这层就有：
   大肥鱼Live2d桌宠.exe、resources\、locales\、挂载模型.cmd、贴图压缩.cmd
   ⚠️ 必须完整解压，不要直接在压缩包里双击 exe。

3) 放模型（发布包不含模型，这一步不能跳）
   把模型所在的整个文件夹放进 exe 旁边的 model\：
     %LOCALAPPDATA%\Live2DPet\model\大肥鱼.model3.json（以及 moc3 / 贴图 / 动作）
   模型来源见 README「模型不随本仓库分发」一节，需要我自己提供。

4) 贴图压缩（默认自动，不需要你手动执行）
   首次启动发现贴图 >2048 会自动压一次（约 10 秒，界面显示「正在压缩模型贴图」），
   然后自动把配置指向 _opt2048 副本。
   验证：日志里有 "[opt] 压缩完成，改用："；没有的话把日志贴给我。
   需要手动重跑时：powershell -ExecutionPolicy Bypass -File tools\shrink-textures.ps1

5) 启动并验证
   Start-Process ".\大肥鱼Live2d桌宠.exe"
   判定装成功：进程里有 大肥鱼Live2d桌宠.exe，且
     %APPDATA%\live2d-stage\logs\main.log 里出现 "[boot] 模型：<路径>"

6) 如果没起来，先读日志最后 20 行，再按 README「打不开？按现象排查」处理，
   把日志贴给我，不要自己反复重试。
```

**给 agent 的硬性判定**：日志里出现 `[boot] 模型：` 且进程存活 = 安装成功；
出现 `[boot] 未找到模型` = 只差放模型；完全没有日志文件 = 程序根本没启动（按排查表走）。


### 模型放在别处时：挂载

模型不方便挪进 `model\` 的，用包内自带的 `挂载模型.cmd`：

```
把 大肥鱼.model3.json 拖到 挂载模型.cmd 上
```

它会校验 moc3、贴图、动作文件是否齐全，并把路径写进设置文件。等价的命令行：

```
大肥鱼Live2d桌宠.exe --model "D:\模型\大肥鱼.model3.json"
```

`--model` 优先于 `model\` 目录。环境变量：`STAGE_MODEL=<模型路径>`（优先级低于 `--model`）、`STAGE_HOME=<目录>`（配置改放指定目录，便携用法）。

## 打不开？按现象排查

先做两件事，比什么都快：

1. **看日志**：`%APPDATA%\live2d-stage\logs\main.log`（引导窗口右下角「打不开？看日志」能直接打开）。
   日志里每一行都有时间戳，最后几行就是它停在哪一步。
2. **试兼容模式**：双击包里的 `兼容模式.cmd`（关掉渲染沙箱），能起来就是驱动 / 杀软 / 沙箱的锅。

| 现象 | 多半是什么 | 怎么处理 |
| --- | --- | --- |
| 双击后完全没反应，进程也没有 | 在压缩包里直接运行；或被杀软静默拦掉 | 右键解压到普通文件夹再运行；把整个目录加进杀软白名单 |
| 弹一下窗口就没了，退出码 `0xC000013A`「主动中止」 | 进程被外部终止（杀软 / 启动器 / 关闭终端），Electron 本身没崩 | 用 `兼容模式.cmd` 启动；能复现就把日志发我 |
| 有窗口但看不到角色 / 全黑 | 显卡驱动对透明窗口 / 硬件加速不兼容 | 用 `兼容模式.cmd`；程序也有**崩溃自愈**：上次没成功起来，这次会自动关硬件加速重试一次 |
| 窗口开着但没有模型 | `model\` 里没东西，或模型放错层级 | 跑一次 `挂载模型.cmd`，把 `.model3.json` 拖上去；首次运行也会有引导窗口 |
| 提示缺 `live2dcubismcore.min.js` / 白屏 | 解压不完整（`resources\app\` 缺文件） | 重新完整解压，别只拷 exe |
| 占用内存 1.5–2GB | 模型贴图 4096/8192 太大（不是泄漏） | 双击 `贴图压缩.cmd`，实测 2.0GB → 0.6GB |
| 双击两次只开一个 | 单实例设计（防止两份角色叠在一起） | 正常现象；要重开先把托盘 / 任务管理器里的旧进程关掉 |
| Windows 7 / 8 打不开 | Electron 33 只支持 Win10 1809+ / Win11 x64 | 换系统，或改用浏览器版（`npm run serve`） |
| 设置 / 动作编辑器点了没反应 | 舞台窗口被最小化或已退出 | 先确保桌宠在，再从右键菜单进 |

### 崩溃自愈 & 安全模式

程序每次启动会写一个标记（`%APPDATA%\live2d-stage\boot.json`）：

- 上次**没走到窗口显示**就结束了 → 这次自动关硬件加速（`--safe` 等效）重试；
- 成功启动一次后标记复位，下次回到正常模式（不会永远降级）。

想强制安全模式：`大肥鱼Live2d桌宠.exe --safe`。
想清掉自愈状态（比如换好显卡驱动了）：删掉 `boot.json` 再启动。

### 收集问题信息

发我 / 提 issue 时最省事的是直接双击包里的 **`诊断.cmd`**：它会在 exe 旁边生成
`诊断报告.txt`（系统版本、显卡/驱动、屏幕、exe 与设置、日志尾部、模型目录，不联网不上传），
把那个文件发过来基本就能定位。

手动收集也可以：

```
%APPDATA%\live2d-stage\logs\main.log     ← 启动日志（最重要）
systeminfo | findstr /B /C:"OS 名称" /C:"OS 版本"
```

日志里有版本号、exe 路径、模型路径、安全模式状态、渲染层报错和 GPU 信息，基本能定位 90% 的「打不开」。

## 玩法

- **左键拖角色**：搬窗口（拖动时有拖拽物理，头发 / 裙子会甩）
- **右键角色 / 空白处**：工具条（设置 / 退出）
- **点头部**：摸头；**点额头**：常态 / 爱心眼 / 眼镜 三态循环
- **按住脸拖动**：捏脸（跟随鼠标力度，耳朵扑棱 + 身体小抖）
- **摸脚 / 摸腰**：痒痒的（胸腔骨盆快抖 + 两侧小臂反相摆 + 两只耳朵连扑）
- **摸胸 / 摸胯**：举手 + 护住，胯部另有眯眼黑脸神态
- **点手**：竖食指 / 放下
- 待机时自己眨眼、呼吸、每 8–18 秒随机来一段小动作（换脚 / 东张西望 / 伸懒腰 / 挥挥手 / 戴铁盆…），
  一有互动就停掉当前动作并复位
- 设置里可调：角色大小、上下留白、跟随强度、转头幅度、待机频率、
  全部表情与官方姿势（默认手 / 竖手指 / 举手 / 狗尾草）、体型拉条、拖拽物理、开机自启、气泡开关…
- 快捷键：`Ctrl+Alt+L` 鼠标穿透，`Ctrl+Alt+Q` 退出

### 贴图自动压缩（默认流程，一次性）

模型的 4096/8192 图集是「整页图集」，解压后单张 8192×8192 就占 256MB，五张合计 592MB，
桌宠常驻能吃到 2GB。所以**首次启动会自动把最长边缩到 2048**（约 10 秒，有进度提示），
生成 `_opt2048` 副本并自动切过去，之后每次启动都直接用副本：

| | 贴图内存 | 整程序 |
| --- | --- | --- |
| 原模型 | 592 MB | ≈ 2.0 GB |
| 压缩后 | 64 MB | ≈ 0.6 GB |

- **想重跑**：双击包内 `贴图压缩.cmd`（比如换了模型、或删了 `_opt2048`）；
- **想跳过**：设环境变量 `STAGE_NO_SHRINK=1` 再启动；
- **想更狠**：`powershell -ExecutionPolicy Bypass -File tools\shrink-textures.ps1 -Max 1024`；
- 原模型文件不会被修改，只多一个 `_opt2048\` 目录，删掉即可还原。

### 动作编辑器

设置窗口 →「动作编辑器」，或 `大肥鱼Live2d桌宠.exe` 里由设置面板打开。可以：

- 实时拖参数、试播、复制/粘贴关键帧（`Ctrl+C` / `Ctrl+V`）
- 调预览的大小与位置（拖动 / 滚轮 / 双击复位）
- 内置的姿势（默认手 / 竖手指 / 举手 / 狗尾草 / 护胯）和 10 个待机动作都列在左栏，可直接改成自己的版本
- 动作存档：`actions.json`（`%APPDATA%\live2d-stage\`），带台词字段，插件的 `live2d_actions` 工具读写同一份

## 接入 DSH（可选）

`dsh-live2d-bridge` 是配套的 DSH 插件：桌宠启动后把「端口 + token」写到 `~/.dsh/live2d/endpoint.json`，插件据此：

1. 把会话状态投到角色上（思考中 / 干活中 / 等你确认 / 成功 / 出错），干活时会带上具体动作：
   「写文件 · editor.js」「搜代码 · agent-link」「跑命令 · npm run pack」；
2. 给 agent 注册 `live2d`、`live2d_status`、`live2d_actions` 三个工具：
   让 AI 主动说话、换表情、做动作，也能直接读写动作存档（和编辑器同一份 `actions.json`）；
3. 回合结束时把最终回复说进气泡：**60 字以内原文直出**，更长的才压成一句；
   回复里带 `[表情: 描述]` 时还会去表情包库里取图，气泡上图下字；
4. 新会话开始自动报到：「连接成功啦～」+ 竖食指（320ms 到位，不再拖 4 秒）。

插件包见 Releases 里的 `dsh-live2d-bridge.zip`；源码在 [dsh-live2d-bridge](../../)（同账号仓库）。装法见包内说明。

## 从源码跑 / 打包

```bash
npm install
node scripts/fetch-core.mjs          # 取 Cubism Core 到 vendor/（专有许可，不入库）
npm run app                          # 开发：Electron 窗口
node scripts/serve.mjs --model "C:/路径/xxx.model3.json"   # 或只开浏览器验证台
npm run pack                         # 打便携版到 release/
```

无头回归（真实时间等待 + 截图 + 参数取样）：`node scripts/shot.mjs --url ... --out tmp/x.png`。
设计决议与接口契约见 [`docs/SPEC.md`](docs/SPEC.md)、[`docs/PROTOCOL.md`](docs/PROTOCOL.md)。

## 致谢

这个项目几乎每一步都站在别人的肩膀上，认真列一下：

- **Live2D Inc.** —— Cubism 5 SDK / Cubism Core。没有它就没有任何 Live2D 角色。
- **PixiJS 团队** —— `pixi.js`，整个渲染底座。
- **pixi-live2d-display（guansss）** 与 **untitled-pixi-live2d-engine** —— Cubism 的 Pixi 运行时。
  本项目用后者加载模型，物理 / 姿态 / 参数写点的那套约定也是在它的文档和源码里反复读出来的。
- **DeepSeek Harness（DSH）** —— 桌宠的「大脑」接入口；`dsh-live2d-bridge` 就是它的插件。
- **dsh-pet、dsh-xiaoke-widget** —— 工作状态的档位语义（thinking / working / waiting / success / error）
  直接对齐了这两位的实现，省了很多试错；后者二创自 **MeteorNOX/DeepSeek-Balance-Whale-Widget**。
- **模型作者** —— 原画 / 拆分 **神宫凉子**（[BV1KmxY66EZ3](https://www.bilibili.com/video/BV1KmxY66EZ3)），
  Live2D 建模 **霓虹猫_NeonNeko**。模型不随包分发，请尊重作者要求。
- 以及在 B 站 / 贴吧 / Discord 里分享参数、动作和踩坑经验的朋友们——很多细节（比如物理输入参数必须在
  `physics.evaluate` 之前写）都是从你们留下的讨论里学到的。

## 许可与署名

- 本仓库**代码**：MIT，见 [LICENSE](LICENSE)。
- **不含** Cubism Core（Live2D 专有许可）→ `scripts/fetch-core.mjs` 自行获取。
- **不含** 大肥鱼模型与 PSD（作者禁止再分发）→ 自行获取，见开头说明。
- 模型来源：Bilibili UP 主 **神宫凉子**（[BV1KmxY66EZ3](https://www.bilibili.com/video/BV1KmxY66EZ3)），
  原画 / 拆分 神宫凉子，Live2D 建模 **霓虹猫_NeonNeko**；使用前请遵守作者要求。
- 依赖 `pixi.js`、`untitled-pixi-live2d-engine` 均为 MIT。
- 商用需另行评估 Live2D publication license 与模型作者授权。
