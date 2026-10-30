# live2d-stage

协作工作台的角色演出层。**只负责角色**：透明窗口、双路动作控制、分区互动、自制关键帧动画。
DSH 只拉起它并转发状态，界面本体不嵌在 DSH 页面里。

> 当前状态：**接口骨架 + 可验证演示**（v0.1.0-dev）。还没有做正式插件、没有 Electron 壳。

## 已经验证过的

| 能力 | 状态 | 证据 |
|---|---|---|
| 加载真实模型 | ✅ | 大肥鱼 5 张贴图 / 16MB moc3 正常渲染 |
| 能力枚举 | ✅ | 509 参数、148 部件、8 动作、23 表情 |
| 运行时参数内省 | ✅ | 取到每个参数的 min/max/default（静态文件给不出） |
| 动作下发 | ✅ | 动作组 `Idle`/`Action` 注册成功 |
| 表情叠加（自持 L2 层） | ✅ | `圈圈眼` 让眼睛变圈圈，可淡入 |
| 双路指令 | ✅ | `POST /api/action` 接受 agent/script 指令并回执 |
| 权限 | ✅ | 无 token → 401 |

## 跑起来

```bash
node scripts/fetch-core.mjs      # 取 Cubism Core 到 vendor/（专有许可，不入库）
node scripts/serve.mjs --model "C:/路径/xxx.model3.json"
# 打开 http://127.0.0.1:53180/harness/
```

验证钩子（可复现，也能进 CI）：

```
/harness/?expr=圈圈眼&steps=90      # 确定性推进 90 帧并套表情
/harness/?motion=2                  # 播第 2 个 Action
/harness/?param=ParamAngleX:20      # 强制某参数
/harness/?checker=0                 # 关掉透明格
```

## 结构

```
docs/SPEC.md          设计决议（窗口 A/B 绑定、冲突分层、区域、档案、许可）
docs/PROTOCOL.md      接口契约 v0（DSH ↔ Stage）
src/contracts.ts      契约类型
scripts/serve.mjs     开发版 Stage 服务器（静态 + 模型挂载 + ActionBus 桩）
scripts/fetch-core.mjs  Cubism Core 下载
harness/              验证台：能力清单 / 动作下发 / 参数受控 / 事件日志
```

## 三条来自实机的约束

1. **每帧结尾有 `model.loadParameters()`**：直接写参数会被还原。自定义层必须写在
   `beforeModelUpdate`（或 `coreModel.update()` 之前），当帧网格才吃到值；
   读回值要在写入当刻读，不能在 update 之后读。
2. **`Meta.Loop` 不可信**：这 8 个动作全都标 `Loop:true`，但其中 7 个是切换型一次性动作。
   循环与否必须由用户标记，不能采信文件。
3. **模型没有 `HitAreas`**：区域只能来自 PSD 图层（`psd/大肥鱼公皮分享拆分.psd`，3749×7697）。

## 许可

- 本仓库代码：MIT。
- **不含** Cubism Core（Live2D 专有许可，禁止再分发）→ `scripts/fetch-core.mjs` 自行获取。
- **不含** 大肥鱼模型与 PSD（作者禁止重新分发）→ 由用户自备。
- 发布插件时的首次启动引导：导入模型 + 下载 Core。商业化需另评估 Live2D publication license 与模型作者授权。
- 署名（合规使用模型时）：原画/拆分 神宫凉子，Live2D 建模 霓虹猫_NeonNeko。
