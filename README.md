# live2d-stage

协作工作台的角色演出层。**只负责角色**：透明窗口、双路动作控制、分区互动、自制关键帧动画。
DSH 只拉起它并转发状态，界面本体不嵌在 DSH 页面里。

> 当前状态：**接口骨架 + 可验证演示**（v0.1.0-dev）。还没有做正式插件、没有 Electron 壳。

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
| 视线跟随（L1） | ✅ | 鼠标左上 → `ParamEyeBallX=-0.98`；右下 → `+0.97` |
| 透明背景 | ✅ | 画布 `backgroundAlpha:0`，透明格可透出 |
| 双路指令 | ✅ | `POST /api/action` 接受 agent/script 指令并回执 |
| 权限 | ✅ | 无 token → 401 |

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
/harness/?zoom=1.4&offset=0,0.1       # 视口缩放/位移
/harness/?checker=0&bg=%23ffffff      # 换背景
```

## 结构

```
docs/SPEC.md          设计决议（窗口 A/B 绑定、冲突分层、区域、档案、许可、渲染内核）
docs/PROTOCOL.md      接口契约 v0（DSH ↔ Stage）
src/contracts.ts      契约类型
src/stage/engine.js   渲染内核适配层（唯一直接碰内核的文件）
src/stage/layers.js   L2 表情叠加 / L5 受控参数 / 部件覆盖
src/stage/viewport.js 窗口 A 与模型 B 的绑定、缩放位移
scripts/serve.mjs     开发版 Stage 服务器（静态 + 模型挂载 + ActionBus 桩）
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
