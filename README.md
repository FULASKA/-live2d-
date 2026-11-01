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
   第一次运行如果还没放模型，程序会开一个引导窗口告诉你怎么放（不再闪退）。

配置里只记相对路径（`model/大肥鱼.model3.json`），整个文件夹挪位置、拷到别的机器都不用改。

无需安装运行时，解压即用；系统要求 Windows 10 / 11 x64。

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

### 模型贴图太大？跑一下 `贴图压缩.cmd`

模型的 4096/8192 贴图解压后能到 600MB，桌宠整体吃 2GB 内存。双击包内的 `贴图压缩.cmd`，
会把贴图按最长边缩到 2048 并自动切过去（实测 592MB → 64MB，整程序 2.0GB → 0.6GB）。

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
