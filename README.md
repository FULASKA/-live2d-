# live2d-stage

协作工作台的角色演出层。**只负责角色**：透明窗口、双路动作控制、分区互动、自制关键帧动画。
DSH 只拉起它并转发状态，界面本体不嵌在 DSH 页面里。

> 当前状态：**v0.1.0-dev**。Electron 壳、双向控制总线（动作下发 + 互动反馈）已可用；
> 还没做 DSH 侧的正式插件（目前用 CLI 与状态文件联动）。

## 渲染内核

`pixi.js 8` + [`untitled-pixi-live2d-engine`](https://github.com/Untitled-Story/untitled-pixi-live2d-engine)（MIT，官方 Cubism 5 框架封装）。

> 换核记录：原先用 `pixi-live2d-display@0.4`（Cubism 4 管线），它不认**逐网格乘法色**，
> 而本模型的鼻子阴影正是用乘法色做的 → 鼻子被画成实心黑块、瞳孔丢色变灰白圈。
> 换核后画面正确，无需隐藏任何部件。细节与实测更新顺序见 `docs/SPEC.md` §2.1。

内核只经 `src/stage/engine.js` 访问；上层只拿原语。想换回官方 SDK 直写渲染循环，只重写这一个文件。

## 已经验证过的

在真机 GPU 与无头 Edge 两条路径上验证（`npm run shot` 可复现）：

| 能力 | 状态 | 证据 |
|---|---|---|
| 加载真实模型 | ✅ | 大肥鱼 5 张贴图（含 8192²）/ 16MB moc3 v5 正常渲染 |
| 乘法色 / 瞳孔 | ✅ | 鼻子有阴影不结块、瞳孔保留蓝色（旧内核的病灶已消失） |
| 能力枚举 | ✅ | 509 参数、148 部件、8 动作、23 表情 |
| 运行时参数内省 | ✅ | 取到每个参数的 min/max/default（静态文件给不出） |
| 动作下发 | ✅ | 动作组 `Idle`/`Action` 注册成功 |
| 表情叠加（自持 L2 层） | ✅ | `圈圈眼` 换眼型；`流泪+脸红` 同时成立（脸颊均色 159/148/176 vs 基线 157/154/182） |
| 视线 + 头 + 身体跟随（L1） | ✅ | 鼠标在上 `eyeY=+0.67`、在下 `-0.71`；`ParamAngleX/Y/Z`、`ParamBodyAngleX/Y/Z` 同向联动 |
| 自动眨眼 / 呼吸 | ✅ | 待机 2.4–5.6 秒自己眨（可拍到闭眼帧）；呼吸钉两端 `ChestY1` -0.28 → +0.06，胸口有起伏 |
| 道具待机动作 | ✅ | 吹狗尾草（举草 + 小 O 嘴 + 一阵风）、戴铁盆（钢盆 + 摇头晃脑） |
| 收工三连 | ✅ | `success` = 竖手指 + 兔牙 + 黑框眼镜 + 抿嘴 |
| 分区互动 | ✅ | 自动铺 7 个热区（头/胸/腰/裙摆/腿/脚 + 尾巴）；点击/抚摸/拖动分别触发；手绘区域 + 档案保存 |
| 动作组切换 | ✅ | 连点「头→腰」只留 `＞＜`（前一组的 `爱心眼` 被整组撤掉）；同组再点 = 收回（两次 → 0 层） |
| 物理输入表情 | ✅ | `LeanInput` 写在 `physics.evaluate` 之前：前倾时 `bodyY` 由 0.7 → -23.1，肩/裙摆一起前压 |
| 尾巴差集 | ✅ | 尾巴凸包与身体五段求差，交集挖成洞（`holes`），命中与绘制都不与其它热区重叠 |
| 透明处穿透 | ✅ | 热区覆盖但像素 `alpha=0` → 判为未命中（点背景不触发反馈） |
| 透明背景 | ✅ | 画布 `backgroundAlpha:0`，透明格可透出 |
| 双路指令 | ✅ | `POST /api/action` 下发后页面真实执行（say/表达式/姿势/视线/待机/状态） |
| 互动反馈 | ✅ | 点头 → `feedback.jsonl` 记录 `{region:"头",gesture:"click",point:{…}}` |
| 状态快照 | ✅ | `GET /api/state` 查到气泡文字、当前待机动作、表情层、视线归属 |
| 权限 | ✅ | 写接口无 token → 401 |

## 跑起来

```bash
npm install                      # pixi8 + 引擎 + puppeteer-core
node scripts/fetch-core.mjs      # 取 Cubism Core 到 vendor/（专有许可，不入库）
node scripts/serve.mjs --model "C:/路径/xxx.model3.json"
# 打开 http://127.0.0.1:53180/harness/
```

无头验证（真实时间等待 + 截图 + 参数取样，用于回归）：

```bash
node scripts/shot.mjs --url "http://127.0.0.1:53180/harness/?expr=脸红" --out tmp/x.png
node scripts/shot.mjs --url "...?expr=圈圈眼" --mouse 120,120     # 顺便测视线
```

验证钩子（可复现，也能进 CI）：

```
/harness/?expr=圈圈眼,流泪&steps=90   # 确定性推进 90 帧并叠加表情
/harness/?motion=2                    # 播第 2 个 Action
/harness/?param=ParamAngleX:20        # 钉住某参数（L5）
/harness/?hidepart=Part10,Part46      # 覆盖部件不透明度
/harness/?tap=331,150                 # 模拟点按（stage 坐标），验证热区反馈
/harness/?reaction=头:tap;腰:tap      # 连点两个热区，验证「切换不叠加」
/harness/?regionhit=331,150           # 只报告命中哪个热区 + alpha
/harness/?regions=0                   # 关掉热区叠层
/harness/?invertY=1                   # 轴向校正（极少数模型绑反时用）
/harness/?zoom=1.4&offset=0,0.1       # 视口缩放/位移
/harness/?checker=0&bg=%23ffffff      # 换背景
```

手势回归（真实指针事件，页面坐标）：

```bash
node scripts/shot.mjs --url "…/harness/" --drag "611,140,633,152"   # 摸头 → 爱心眼
node scripts/shot.mjs --url "…/harness/" --drag "610,300,710,330"   # 拖动 → 只报手势
node scripts/shot.mjs --url "…/harness/" --click "1188,124|300,250|340,255|345,300" --key Enter  # 画一个区域
```

## 应用壳（Electron）

透明无边框窗口，角色浮在桌面上；**窗口尺寸 A 与模型尺寸 B 分开调**（A 改窗口、B 只改模型缩放）。

```bash
npm run app      # 启动应用窗口（内置同一个静态服务，端口随机）
npm run pack     # 打便携版：dist/Live2DStage-win32-x64/Live2DStage.exe（约 450MB）
```

- **透明处自动穿透**：鼠标在角色轮廓外时点击会穿到后面的窗口，空白处不会再拖走整块看不见的窗口；
  搬窗口：左键或**中键**按住角色拖（主进程按全局光标锚点搬，中键不产生惯性冲击）
- **窗口跟着角色走**：窗口尺寸 = 模型画布 × 角色大小，角色永远在窗口正中，四周留白均匀；
  设置里打开「显示窗口边框」后拖四边/四角缩放，窗口、角色、气泡按同一比例联动；
  「上下留白」滑杆控制窗框上下空多少（默认 2%，越小越贴角色）
  （原来 Ctrl+滚轮 的缩放已移除：指针滑到桌面时会把滚轮传给桌面，改掉图标大小）
- **设置是独立窗口**：覆盖层只放角色，右键工具条的「设置」开一个普通窗口（可拖动、有标题栏、不参与穿透）。
  覆盖层的尺寸从此与界面无关——它不用为了塞面板临时变宽，关掉设置也不会残留
- **桌面级跟随**：主进程轮询全局光标，鼠标在窗口外、桌面任何位置角色都会看过去
- **待机动作**：不互动时自己在动 —— 常驻的重心微摆，加上每 8–18 秒随机来一段
  （重心换脚 / 东张西望 / 伸懒腰 / 打瞌睡 / 抖尾巴 / 理头发 / 吹狗尾草 / 戴铁盆 / 挥挥手），
  部分动作配一句小台词；吹狗尾草会举草、小 O 嘴、放一阵风，戴铁盆会戴钢盆摇头，
  挥挥手会竖起左食指、用左臂 Z 来回摆、眉毛上下挑；
  一按下去（摸头、捏脸、拖拽）就立刻让位。设置窗口「待机动作」可开关和调频率
- **有生命感**：待机自己眨眼（2.4–5.6 秒一次，偶尔连眨），呼吸带动胸口/前发/裙摆起伏；
  完成一轮任务时举手指 + 兔牙 + 戴黑框眼镜（success 状态，4.6 秒后收起）
- **转头幅度可调**：设置窗口「跟随 → 转头幅度」滑杆（0.5–2.0，默认 1.25）。
  调的是中段灵敏度（指针在角色附近也开始明显转头），满偏固定夹在参数上限 30°
- **分区反应**：点击/抚摸的默认反应仍在，设置窗口不再提供编辑（实际用处不大，已移除）
- **抚摸晃动增益**：滑动时头持续摆动（跟手，停手才淡出），叠一层朝手指方向的偏摆，
  并且**朝手的方向转头**（`ParamAngleX`，身体跟着偏）——摸头时鼠标就在脑袋上，
  光靠视线跟随会「转头量≈0」，这一档才是「在蹭手」的观感。设置窗口里有滑杆调幅度
- **捏脸**：按住「脸」热区拖动 → 表情 `＞＜` + `脸红`（看得见的反馈），同时按方向和力度写
  `CheeckPuff / CheeckPuffL / CheeckPuffR / CheeckPuff2 / CheeksWiggleX`；头也朝手转，松手平滑回零。
  热区只取**眼睛以下**的脸颊（眼睛往上归头部热区）；本 moc 的鼓脸是变形器驱动、幅度很弱，
  PSD 里也没有「鼓脸」图层（只有脸红 / 脸黑），所以主要靠表情组合出效果
- 按在角色分区上 = 互动，不会误拖窗口
- `Ctrl+Alt+L` 切换穿透（穿透时角色不可点，舞台里的「恢复鼠标」浮标仍可点）；`Ctrl+Alt+Q` 退出
- 设置保存在 `%APPDATA%/live2d-stage/settings.json`（角色大小/跟随/增益/气泡/置顶），重启保留
- **agent 双向控制**：舞台启动后把「端口 + token」写到 `~/.dsh/live2d/endpoint.json`，
  任何本机进程都能用 HTTP 控制她说话、换表情、切姿势、指视线、演待机动作；
  反过来，点/摸/拖与「动作已执行」会追加到 `~/.dsh/live2d/feedback.jsonl`，agent 读文件即可接手。
  自带命令行：`node tools/stage-cli.mjs say 我回来啦 --ms 3000`（详见 `docs/PROTOCOL.md`）
- 「验证台」按钮用默认浏览器打开 `/harness/`（调试面板还在那里）

打包注意：

- `tmp/electron-v33.4.11-win32-x64.zip` 是 Electron 运行时（110MB，国内可直接用 npmmirror 拉）；
  缺失时先下载这个文件，`npm run pack` 会用它而不再联网。
- `vendor/live2dcubismcore.min.js` 必须在（专有许可，不入库）；缺了应用启动会提示缺少 Core。
- 默认模型路径写死在 `app/main.mjs` 的 `DEFAULT_MODEL`，也可用环境变量 `STAGE_MODEL` 覆盖。

## 结构

```
app/                  Electron 应用壳：透明覆盖层 / 设置窗口 / 动作编辑器 / 穿透与找回
src/server/           静态服务 + 能力清单 + ActionBus + SSE + 反馈日志（开发服务器与应用壳共用）
tools/stage-cli.mjs   agent/脚本用命令行：say / expr / pose / look / idle / state / feedback
docs/SPEC.md          设计决议（窗口 A/B 绑定、冲突分层、区域、档案、许可、渲染内核）
docs/PROTOCOL.md      接口契约 v1（下行动作 / 上行反馈 / SSE / 快照）
src/contracts.ts      契约类型
src/stage/engine.js   渲染内核适配层（唯一直接碰内核的文件）
src/stage/layers.js   L2 表情叠加 / L5 受控参数 / 部件覆盖
src/stage/reactions.js 分区反应规则（切换不叠加 / 瞬间与长期两层 / 应用壳共用）
src/stage/gaze.js     L1 眼 → 头 → 身体三通道跟随
src/stage/life.js     眨眼 / 耳朵扑棱 / 头发惯性与微风（含一时风 gust）
src/stage/capture.js  伪面捕：呼吸、Angle/Position 物理输入
src/stage/pose-bus.js 姿态总线：头/身角度的唯一写入者（物理前喂入、物理后写回，各层只累加）
src/stage/idle-motions.js 待机动作：常驻微摆 + 随机成套动作（可带小台词）
src/stage/regions.js  热区入口（barrel）：几何 / 仓库 / 读取器 / 输入按职责拆到 regions/ 下
src/stage/regions/    geometry（点内判定·包围盒·凸包）· store（增删查·命中·存档）· zones（实时脸/手区·播种）· input（手势）
src/stage/viewport.js 窗口 A 与模型 B 的绑定、缩放位移
scripts/serve.mjs     开发版服务 CLI（内部调用 src/server）
scripts/shot.mjs      无头验证：真实时间等待 → 取样 → 截图
harness/              验证台：能力清单 / 动作下发 / 参数受控 / 事件日志
```

## 三条来自实机的约束

1. **每帧结尾有 `loadParameters()`**：自定义层必须写在 `beforeModelUpdate` 当帧才生效；
   想读回「真正送进绘制的值」，也只能在同一帧那个时刻读。
2. **`Meta.Loop` 不可信**：这 8 个动作全都标 `Loop:true`，但其中 7 个是切换型一次性动作。
   循环与否必须由用户标记，不能采信文件。
3. **模型没有 `HitAreas`**：区域只能来自 PSD 图层（`psd/大肥鱼公皮分享拆分.psd`，3749×7697）。

## 待确认

- `流泪`（`key2`）单独施加看不出水滴，`key7`（脸红）却立竿见影。是模型本身依赖眼型层，还是另有部件开关，待查。
- 无头环境必须用真实时间等待（`scripts/shot.mjs`）；`--virtual-time-budget` 会把 8192² 贴图解码卡死。

## 许可

- 本仓库代码：MIT。
- **不含** Cubism Core（Live2D 专有许可，禁止再分发）→ `scripts/fetch-core.mjs` 自行获取。
- **不含** 大肥鱼模型与 PSD（作者禁止重新分发）→ 由用户自备。
- 依赖 `pixi.js`、`untitled-pixi-live2d-engine` 均为 MIT，可随代码分发。
- 发布插件时的首次启动引导：导入模型 + 下载 Core。商业化需另评估 Live2D publication license 与模型作者授权。
- 署名（合规使用模型时）：原画/拆分 神宫凉子，Live2D 建模 霓虹猫_NeonNeko。
