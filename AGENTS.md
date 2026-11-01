# AGENTS.md —— 交接文档

给「接了这摊活的 AI / 下一个人」看的。README 面向下载者，`docs/SPEC.md` 是设计稿，
`docs/PROTOCOL.md` 是接口契约；**这份讲现状、命令和踩过的坑**，改代码前先读完。

## 现状（截至 2026-11-01）

- 版本 `1.0.1`，已发布：<https://github.com/FULASKA/-live2d-/releases/tag/v1.0.1>
  - `dafeiyu-live2d-pet-v1.0.1-win32-x64.zip` 158,963,959 字节
    sha256 `f08e6dec9fd7e5f6ba2e8391cb24b4553a234a32aa76c2929e7d7504e15eac75`
  - `dsh-live2d-bridge.zip`（DSH 插件）、`SHA256SUMS.txt`
- 最近提交：`dab8ca4 v1.0.1 加固：首次启动自动压缩贴图、崩溃自愈、诊断与兼容模式`
- **v1.0.0 旧 Release 仍在**，里面是修过 bug 之前的包（待决定：删除或改成指向 v1.0.1）。

## 常用命令

```bash
npm run app                     # 开发模式跑（需要 node_modules/electron）
npm run pack                    # 打 dist/完整版 + dist/发布版
node scripts/serve.mjs --model "D:/路径/xxx.model3.json"   # 只起静态服务，浏览器验证
STAGE_HOME=/tmp/x npm run app   # 便携测试：设置/日志放到指定目录，不污染真实配置
STAGE_NO_SHRINK=1 npm run app   # 跳过贴图自动压缩
```

发布（v1.0.1 实测流程）：

```bash
# 1. 打 zip（约 4 分钟，410MB → 152MB）
powershell -Command "Compress-Archive -Path 'dist/大肥鱼Live2d桌宠-发布版-win32-x64' -DestinationPath 'release/dafeiyu-live2d-pet-v1.0.1-win32-x64.zip' -CompressionLevel Optimal"
# 2. sha256 → release/SHA256SUMS.txt
# 3. 上传：gh 在 C:\Users\33153\tools\gh\bin\gh.exe，仓库 FULASKA/-live2d-
#    直连能通就别挂代理；挂代理 7897 时经常 EOF，失败就卸掉代理重试（最多 3 次）
gh release upload v1.0.1 <zip> <bridge.zip> <SHA256SUMS.txt> --repo FULASKA/-live2d- --clobber
gh release edit v1.0.1 --repo FULASKA/-live2d- --notes-file release/发布说明.md
```

**资产名必须纯 ASCII**：GitHub 会把中文名转义成 `Live2d.-v1.0.0...`，以前踩过。

## 目录地图

| 路径 | 作用 |
| --- | --- |
| `app/main.mjs` | 主进程：窗口 / 设置 / 日志 / 贴图自动压缩 / 崩溃自愈 / IPC |
| `app/renderer.js` | 舞台渲染层：模型加载、视线、姿势链、物理钩子、热区 |
| `app/firstrun.html` | 找不到模型时的引导窗口（一次性设置页） |
| `app/optimizing.html` | 首次启动压缩贴图时的进度小窗 |
| `src/stage/*` | 舞台能力：`engine.js` 内核、`posture.js` 姿势、`gaze.js` 视线、`regions/` 热区 |
| `src/server/stage-server.mjs` | 本地静态服务 + 模型文件服务（端口随机） |
| `tools/shrink-textures.ps1` | 贴图压缩（PowerShell + System.Drawing，无第三方依赖） |
| `tools/diagnose.ps1` / `诊断.cmd` | 生成 `诊断报告.txt`（系统/显卡/日志尾部，不联网） |
| `兼容模式.cmd` | `--safe --no-sandbox` 启动，兜底显卡/杀软 |
| `挂载模型.cmd` / `贴图压缩.cmd` | 用户侧入口（GBK 编码，别改成 UTF-8） |
| `harness/` | 调试用的控制台页（不进包） |
| `tmp/` | 测试夹具，可随便删 |

## 几条必须知道的机制

1. **模型解析顺序**：`--model` → 设置里的路径 → exe 旁 `model/` → 包内 `resources/app/model` → `STAGE_MODEL`。
   设置里存**相对 exe 的路径**（在 exe 目录内时），换机免改。
2. **贴图自动压缩是默认流程**：启动时读 PNG 头判断最长边 >2048 → spawn `shrink-textures.ps1` →
   脚本生成 `<模型目录>/_opt2048/` 并改写 settings → 主进程 `loadSettings()` 重读后继续启动。
   实测 592MB → 64MB，整程序 2.0GB → 0.67GB。跳过用 `STAGE_NO_SHRINK=1`。
3. **崩溃自愈**：`boot.json` 记录上次是否走到窗口显示；没走到 → 本次 `app.disableHardwareAcceleration()`。
   强制：`--safe`；复位：删 `%APPDATA%\live2d-stage\boot.json`。
4. **窗口尺寸**：渲染层 `applyFit()` → `win:fit`。主进程**尺寸没变就直接返回**（以前用四舍五入后的
   中心重算位置，导致 +1px/次、5px/s 漂移）。
5. **物理写点**：Cubism 顺序是 `physics.evaluate()` → pose → `beforeModelUpdate` → `coreModel.update()`。
   要影响物理链条的参数（如 `LeanInput`）必须在 `physics.evaluate` **之前**写（`engine.js` 里裹了 evaluate）。
6. **退出**：`window-all-closed` 里有个 `bootGuard`——启动阶段关掉 splash/引导窗不算退出，
   否则压缩完一关小窗，整个程序跟着走（踩过）。

## 踩坑清单（别再踩）

- **PowerShell 5.1 读无 BOM 的 .ps1 会按 GBK 解析**，中文注释直接变语法错误。
  `tools/*.ps1` 必须带 UTF-8 BOM；`scripts/pack.mjs` 会自动补，但编辑工具可能又把 BOM 抹掉。
- **`.cmd` 用 GBK 写**（`chcp 936`），写成 UTF-8 会显示乱码。
- 压缩中间那个 splash 是**独立窗口**：销毁它以前会触发 `window-all-closed`。
- 打包时 `dist/` 被运行中的 exe 占用会 `EBUSY`，先关进程再 `npm run pack`。
- `electron`/`@electron` 依赖在 pack 后会被删掉；再跑 `npm run app` 前要 `npm i`。
- `pack.mjs` 的 ignore 只看仓库根目录第一段；写成路径片段会误伤 `node_modules/.../dist`，打出黑窗口。
- 用户反馈「双击没反应」时，先看 `%APPDATA%\live2d-stage\logs\main.log`，
  再让他跑 `诊断.cmd`；`0xC000013A` = 进程被外部终止，不是我们的崩溃。
- **模型不可再分发**：任何发布包都不能带 `model/`；`pack.mjs` 发布版会删掉它，别绕过。

## 验证手法

- 无头截图：`node scripts/shot.mjs --url <服务地址>/app/ --out tmp/x.png`
- 起一个干净环境：`STAGE_HOME=<空目录> npm run app`（不碰真实配置）
- 装完判定：日志里出现 `[boot] 模型：` 且进程存活；出现 `[opt] 压缩完成，改用：` 说明压缩成功
- 实测内存：`Get-CimInstance Win32_Process -Filter "Name='大肥鱼Live2d桌宠.exe'"`，
  按 `--type=` 区分 main / renderer / gpu-process

## 已知未完成

- **v1.0.0 旧 Release** 未处理（可能有人下到旧包）。
- `main.log` 里显卡名显示「未知」（Electron 拿不到 `deviceString`），但 `诊断.cmd` 用 WMI 能读到显卡名/驱动。
- 首次运行引导窗口的「打开 model 文件夹」在 exe 目录只读时会失败，目前只回退到打开日志目录。
- 模型贴图 `-Max 1024` 模式没有做画质对比验证。
