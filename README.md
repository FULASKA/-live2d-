# 大肥鱼 Live2D 桌宠

Windows 桌面上的 Live2D 角色：透明无边框窗口、跟随鼠标视线、点击 / 抚摸 / 捏脸互动、待机小动作，
并且可以接入 [DeepSeek Harness](https://github.com/deepseek-ai)（DSH）——让 AI 一边干活一边用气泡和动作「说话」。

![Electron](https://img.shields.io/badge/Electron-33-47848f) ![Live2D](https://img.shields.io/badge/Live2D-Cubism%205-ff6b9d) ![License](https://img.shields.io/badge/code-MIT-blue)

## ⚠️ 模型不随本仓库 / 安装包分发

**本项目的所有下载包都不含「大肥鱼」模型。** 模型版权归原作者，作者明确禁止二次发布，所以：

- 请自行向原作者获取模型（`大肥鱼.model3.json` 及其 `moc3` / 贴图 / 动作 / 物理文件，通常是一个文件夹）；
- 拿到后把它「挂载」给桌宠即可（见下一节），程序按模型名字记忆路径；
- 也支持任意 Cubism 5 导出的 `.model3.json`，只是互动热区是按大肥鱼模型调校的，别的模型需要自己调。

> 换模型：右键角色 → 设置 →「模型」→「更换 Live2D 模型」。

## 下载与安装

1. 到 [Releases](../../releases) 下载 `大肥鱼Live2d桌宠-v1.0.0-win32-x64.zip`；
2. 解压到一个固定目录（路径含中文没问题）；
3. 双击 `大肥鱼Live2d桌宠.exe`；
4. 第一次启动弹窗选模型 → 选你自己的 `大肥鱼.model3.json`，之后启动即记住。

无需安装运行时，解压即用；系统要求 Windows 10 / 11 x64。

### 挂载模型的两个脚本化办法

不想点弹窗（自动化 / 便携部署）时，用包内自带的 `挂载模型.cmd`：

```
把 大肥鱼.model3.json 拖到 挂载模型.cmd 上
```

它会校验 moc3、贴图、动作文件是否齐全，并把路径写进设置文件。等价的命令行：

```
大肥鱼Live2d桌宠.exe --model "D:\模型\大肥鱼.model3.json"
```

环境变量：`STAGE_MODEL=<模型路径>`（优先级低于 `--model`）、`STAGE_HOME=<目录>`（配置改放指定目录，便携用法）。

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

## 接入 DSH（可选）

`dsh-live2d-bridge` 是配套的 DSH 插件：桌宠启动后把「端口 + token」写到 `~/.dsh/live2d/endpoint.json`，插件据此：

1. 把会话状态投到角色上（思考中 / 干活中 / 等你确认 / 成功 / 出错）；
2. 给 agent 注册 `live2d`、`live2d_status` 两个工具，让 AI 主动说话、换表情、做动作；
3. 新会话开始自动报到：「连接成功啦～」+ 竖食指。

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

## 许可与署名

- 本仓库**代码**：MIT，见 [LICENSE](LICENSE)。
- **不含** Cubism Core（Live2D 专有许可）→ `scripts/fetch-core.mjs` 自行获取。
- **不含** 大肥鱼模型与 PSD（作者禁止再分发）→ 自行获取，见开头说明。
- 模型署名（合规使用时）：原画 / 拆分 **神宫凉子**，Live2D 建模 **霓虹猫_NeonNeko**。
- 依赖 `pixi.js`、`untitled-pixi-live2d-engine` 均为 MIT。
- 商用需另行评估 Live2D publication license 与模型作者授权。
