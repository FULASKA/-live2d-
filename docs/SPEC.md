# Live2D Stage — 设计决议

> 本文是「已拍板」的记录，不是待选方案。改动这里要先在讨论里推翻它。

## 0. 定位

协作工作台里的**角色演出层**：只要角色、只要干净，一切编辑藏在右键面板里。
DSH 只负责拉起与转发，Stage 是独立软件。

**非目标（v1 明确不做）**：摄像头面捕、在 Live2D 里新增骨骼/变形/新模型本体、
把模型打包进发行物。

## 1. 复用边界

| 来源 | 用来做什么 | 不用它做什么 |
|---|---|---|
| `untitled-pixi-live2d-engine`（MIT，pixi 8） | 渲染、动作/表情播放、`focus()` 视线跟随、参数/部件读写、Cubism 5 乘法色 | — |
| ~~`pixi-live2d-display@0.4`~~ | ~~Cubism 4 管线~~ **已弃用**，见 §2.1 | — |
| `Tisitan/dsh-live2d-companion`（MIT） | Electron 透明窗、置顶、自动/手动穿透、面板骨架 | 不 fork 整个仓库，只取窗口与穿透实现作参考 |
| `shinshin86/live2d-add-motion-web-ui`（MIT） | `motion3.json` 结构、关键帧→动作的生成与校验思路、循环接缝检查 | 不搬 Python 生成器；目标语言是 TS/浏览器 |
| `dsh-xiaoke-widget`（本机，MIT） | `work-status` 事件归约（thinking/working/result/waiting/success/error + 优先级） | 不搬它的泡泡 UI |

**自研**：区域系统、关键帧编辑器、冲突仲裁、档案迁移、ActionBus。

## 2. 渲染与窗口

- 窗口：Electron，`transparent + frameless + alwaysOnTop('screen-saver') + skipTaskbar`。
- **窗口尺寸 A 与模型尺寸 B 绑定**：
  - 改 A → B 按当前比值等比例缩放（保持画面上角色占比不变）。
  - B 可独立调大小与相对窗口的位置；调完之后，新的「B/A 比值」成为后续缩放基准。
  - 面板里给三个数就够：`窗口 W×H`、`模型缩放 k`、`模型偏移 (x,y)`；`k` 是相对 A 的比值，不是像素。
  - 「锁定比例」开关：开着时改窗口只等比缩放，模型内容不裁切；关掉则允许窗口比例变化、模型按 contain 重新适配。
- 纯播放模式：只渲染角色与（可选）气泡；面板用右键唤出，面板不参与穿透判定。
- 拖动区分：指针落在**模型不透明像素**上才响应互动；落在透明区 = 透传给下层软件。

### 2.1 渲染内核（已拍板：换核）

- **采用**：`pixi.js 8` + `untitled-pixi-live2d-engine`（MIT；内部是官方 Cubism 5 框架的封装，
  原生支持 moc3 v5、逐网格乘法色/滤色、大贴图 LOD）。
- **弃用原因**（实测，不是猜测）：原方案 `pixi-live2d-display@0.4` 走 Cubism 4 管线，不认逐网格乘法色。
  本模型的鼻子阴影正是用乘法色做的 → 被画成一整块实心（旧内核里是黑块，换内核后变白块），
  瞳孔同时丢色变灰白圈。已排除贴图缺失、UV 退化、贴图索引越界、遮罩错误四种可能。
  换核后自动正常，**不需要**再隐藏 `Part10/Part46`（鼻子）之类的补丁。
- **边界**：内核只经 `src/stage/engine.js` 访问；上层只拿原语（参数/部件/动作/表情/命中/时钟）。
  若日后要换回官方 Cubism 5 SDK 直写渲染循环，只重写这一个文件。
- **实测更新顺序**（决定自定义层挂哪里）：
  `updateMotions` → `coreModel.saveParameters()` → 内核表情 → 眼眨 → 视线 `focus` → 自然运动 →
  唇形 → 物理 → pose → **`beforeModelUpdate`** → `coreModel.update()`（算顶点） → `coreModel.loadParameters()`。
  所以自定义分层（L2 表情叠加 / L5 受控参数 / 部件覆盖）一律挂在 `beforeModelUpdate`，
  而**读参数校验必须在同一帧的该时刻读**，更新后读只会拿到被 `loadParameters()` 还原的基线值。
- **引擎在渲染时才推进模型**：`model.update(dt)` 只累加，真正的 `internalModel.update()` 发生在渲染管线里。
  因此确定性步进 = 「推进 delta → 渲染一次」，见 `stage.step()`。

## 3. 冲突仲裁（分层，后写覆盖先写）

| 层 | 来源 | 写哪些参数 | 可被谁打断 |
|---|---|---|---|
| L0 | 基线 / Idle 循环 | 未被上层写过的全部参数 | 全部 |
| L1 | 视线跟随、呼吸 | `ParamAngleX/Y/Z`、`ParamEye*` 的朝向分量 | L2+ |
| L2 | 表情 | 表情文件声明的参数（`Add`/`Multiply`/`Overwrite`） | L3+ |
| L3 | 动作 | 该动作曲线覆盖的参数，`NORMAL` 优先级 | L4、L5(FORCE) |
| L4 | 区域互动反馈 | 一次性，接管 150–300ms | L5 |
| L5 | Agent / 脚本 | 声明式，带 `priority` 与 `ttlMs` | 只被更高优先级 |

**硬规则**

1. 同参数由最后写入者胜出，写入按层序执行（L0→L5），不并行抢。
2. 视线是**叠加**（additive），只在动作未声明该参数时生效。
3. **退出必须显式复位**：Cubism 不会自动回默认值，动作结束后走 0.2s 缓动回到 L0 快照。
4. `FORCE` 指令可打断 L3/L4；被打断者回执 `phase:"interrupted"`。
5. 区域互动的「抚摸」是持续手势，`pointerup` 后 300ms 内不重复触发同一反应。

## 4. 鼠标跟随（v0 已实现：三通道）

不只是眼珠。眼 → 头 → 身体，三个通道各有增益与惯性，才像「活的」。

- 通道与量程：`ParamEyeBallX/Y`（±1，最快）→ `ParamAngleX/Y/Z`（±30°，中等，含轻微歪头）
  → `ParamBodyAngleX/Y/Z`（±30°，最慢、幅度最小）。
- **幅度分配要有依据**（实测本模型，画布 3749×7697）：
  `ParamAngleY` 满偏只带动头部约 110–148px；`ParamBodyAngleY`（胸腔）满偏能带动头部约 450px ——
  埋头/抬头真正的杠杆是身体，不是头。`角度Ybs` / `身体位移RY` / `胸↓` 等是物理**输出**，写入会被覆盖。
- 因此默认值：`head 0.75`（22.5°）、`body 0.45`（13.5°），并做**方向非对称**：
  向下（`bowBoost 1.7`）多弯像真的低头，向上（`liftDamp 0.8`）收敛，避免整个人往后折。
- 写法是**加性**：先读当前值（含 Idle 动作自带的摆动）再加偏移并夹到 min/max，
  所以跟随不会把待机动画压死。
- 平滑：指数阻尼，三通道速度不同（眼 20/s、头 7/s、身体 3.5/s）→ 眼睛先到、身体跟上。
- 可调：`enabled / strength / deadZone`，以及每通道增益 `eye / head / headRoll / body / bodyRoll`。
  目标按视口归一化（-1..1，右/上为正）。
- **不用内核 `focus()`**：它只驱动 eyeBall 与少量角度，无法分区调增益，也会和自定义层抢参数。

## 5. 区域系统（PSD 来源）

- 区域 = **模型画布像素**坐标系下的多边形（本模型 3749×7697，与 PSD 1:1，可直接对图层）；
  导出档案时可归一化。
- 命中：最上层多边形优先（`z` 大者先），重叠处只触发最上层（**叠加即优先级**）。
- **透明处穿透**：几何命中后还要过 alpha 采样（渲染一帧 + `readPixels`）；落在透明像素视为未命中。
  这是「只点亮着的角色」和后续窗口穿透判定的共同基础。
- 手势阈值按**画布宽度比例**给（窗口缩放、模型分辨率都不影响）：
  - `tap`：位移 ≤ 2% 且 ≤ 420ms
  - `pet`：按住滑动，每 3% 宽上报一次；连抚 3 次以上优先判为抚摸（人在顺毛，不是要拖走角色）
  - `drag`：位移 > 8% 宽；与窗口拖动区分，语义由上层决定（demo 里：区域拖动 vs 背景拖动）
- 自动铺初稿：按部件名分组取顶点包围盒 → 按「头→胸→腰→腿」的重心分带切开，尾巴用凸包。
  只是起点，用户可用「画区域」重画（点击加点 → 回车闭合）。
- 反馈：动作 / 表情 / 参数补间 / 音效 / 气泡，逐手势可配；当前 demo 配了表情与动作。
- PSD 用途：分层拆分图 → 读出每层名称与包围盒 → 作为区域候选（含矩形一键转多边形）。
  PSD 画布与模型画布若不是 1:1，用「对齐标定」：在模型上拖两个参考点，求仿射参数。

## 6. 自编辑动画

- 参数内省取**模型真实**的 id / min / max / default；剔除物理输出参数与口型参数（可解除）。
- 轨道模型：`{id, keys:[{t, v, interp:"linear|bezier|stepped|ease"}]}`，全局 `duration/loop/fadeIn/fadeOut`。
- 保存为自有 JSON（`animations/<id>.json`），**不写模型目录**；调用时运行时注册给 MotionManager。
- 导出 `motion3.json` 为可选动作，供外部工具（VTube Studio 等）使用。

## 7. 档案与迁移

```
profiles/
  <fingerprint>.json     # fingerprint = sha1(moc3 + model3 + 文件名)
  exports/<name>.zip     # profile + animations + 音效
```

```json
{"schemaVersion":1,
 "model":{"name":"大肥鱼","fingerprint":"...","path":"..."},
 "window":{"width":420,"height":640,"alwaysOnTop":true,"clickThrough":"auto"},
 "modelView":{"scale":1,"x":0,"y":0,"fit":"contain"},
 "gaze":{"enabled":true,"intensity":0.6,"rangeX":1,"rangeY":1,"deadzone":0.05,"smoothing":0.2},
 "regions":[],
 "stateMap":{},
 "animations":[]}
```

迁移：`schemaVersion` 小于当前则跑迁移链；未知更高版本 → 只读打开并提示。

## 8. 能力识别与绑定

- 枚举：参数（含中文显示名/分组）、动作（含时长/循环/涉及参数）、表情（含参数与混合模式）、
  部件、贴图、画布尺寸、`HitAreas`（本模型没有，靠区域替代）。
- 手动绑定：任何自动化候选（如「状态→表情」的推荐）都必须可被用户改写，绑定表是唯一事实来源。

## 9. 许可（发布前必读）

| 对象 | 能否随代码分发 |
|---|---|
| 本项目代码 | 可以（MIT） |
| Cubism Core（`live2dcubismcore.min.js`） | **不可以**，专有许可；发布时引导用户自行下载 |
| 大肥鱼模型（moc3/贴图/PSD） | **不可以**，作者明确禁止重新分发；只能由用户自备 |
| 第三方库（pixi / untitled-pixi-live2d-engine 等） | 可以（MIT） |

发布形态：仓库不含任何模型与 Core；首次启动走「导入模型 / 下载 Core」向导。
若未来商业化（对外销售），需另评估 Live2D 的 publication license 与模型作者授权。
