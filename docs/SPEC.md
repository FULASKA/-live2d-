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
| `pixi-live2d-display`（MIT） | 渲染、动作/表情播放、`focus()` 视线跟随、参数读写 | — |
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

## 4. 鼠标跟随

`focus(x, y)` 原生能力 + 参数化：`enabled / intensity / rangeX / rangeY / deadzone / smoothing`。
范围按视口归一化，强度映射到 `ParamAngleX/Y` 的角度上限（默认 ±30° 的 60%）。

## 5. 区域系统（PSD 来源）

- 区域 = **归一化多边形**（相对模型画布 0..1），带 `z` 叠加序号。
- 命中：最上层多边形优先；重叠部分只触发最上层（**叠加即优先级**）。
- 手势：`click` / `slide`（滑动抚摸）/ `drag`（区域内拖拽，与窗口拖动区分）。
- 反馈：动作 / 表情 / 参数补间 / 音效 / 气泡，逐手势可配。
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
| 第三方库（pixi / pixi-live2d-display 等） | 可以（MIT） |

发布形态：仓库不含任何模型与 Core；首次启动走「导入模型 / 下载 Core」向导。
若未来商业化（对外销售），需另评估 Live2D 的 publication license 与模型作者授权。
