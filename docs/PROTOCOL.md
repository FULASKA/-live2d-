# 接口契约 v0（DSH 宿主 ↔ Live2D Stage）

> 状态：**草案，只定义接口，不含实现**。开发期以本文件为准，实现方（Stage 壳 / DSH 插件侧）
> 只按此契约通信，两边可独立迭代、各自 mock。

## 0. 形态

- **Stage**：独立软件（Electron 壳 + 一个仅监听 127.0.0.1 的本地 HTTP 服务）。
  骨架永远不显示在 DSH 本体窗口里。
- **DSH 插件**：只负责「拉起 / 关闭 / 转发」，不含渲染。
- **两条控制入口共用同一个 ActionBus**：

```
Agent ──(DSH 工具 live2d_action)──┐
                                  ├─► POST /api/action ─► ActionBus ─► 模型
脚本 ──(HTTP + token)────────────┘
用户右键面板 ─────────────────────┘
```

## 1. 启动参数

```
live2d-stage --port=<n|0> --token=<t> --callback=<url> --model=<path.model3.json> --profile-dir=<dir>
```

| 参数 | 说明 |
|---|---|
| `--port` | 0 = 由系统分配；回执通过 stdout 第一行 JSON 给出 |
| `--token` | 所有 `/api/*` 必须带 `Authorization: Bearer <token>` 或 `X-Stage-Token` |
| `--callback` | Stage 主动上报事件的接收地址（DSH 侧） |
| `--model` | 模型路径；也可启动后通过 `/api/model` 切换 |
| `--profile-dir` | 配置根目录（按模型指纹分文件） |

**启动回执（stdout 单行 JSON）**

```json
{"ready":true,"port":53187,"pid":4242,"model":"大肥鱼","capabilities":{"params":509,"motions":8,"expressions":23}}
```

## 2. 动作指令（ActionBus）

`POST /api/action`，单条指令：

```json
{
  "id": "uuid",
  "source": "agent | script | user | state",
  "priority": "BACKGROUND | NORMAL | FORCE",
  "fade": 0.3,
  "ttlMs": 0,
  "revert": true,
  "action": { "kind": "motion", "name": "举手切默认手" }
}
```

### action.kind

| kind | 字段 | 含义 |
|---|---|---|
| `motion` | `name`, `group?`, `loop?`, `speed?` | 播放模型自带动作 |
| `expression` | `name \| null` | 切换表情；`null` = 清除 |
| `animation` | `animationId`, `loop?`, `speed?` | 播放用户自制动画 |
| `param` | `id`, `value`, `fade?` | 单参数补间（区域反馈用） |
| `pose` | `keys:[{id,value}]`, `fade?` | 多参数同时到位 |
| `state` | `state` | 走状态映射表（见 4） |
| `stop` | `scope:"motion"\|"expression"\|"all"` | 停止 |

### 返回

```json
{"accepted":true,"id":"uuid","effectivePriority":"NORMAL","interrupted":"uuid|null"}
```

冲突与抢占规则见 `docs/SPEC.md` §3。

## 3. 事件上报

`POST {callback}`：

```json
{"type":"action","id":"uuid","phase":"start|end|interrupted","reason":"replaced|ttl|finished"}
{"type":"interaction","region":"chest","gesture":"pet|click|drag","at":{"x":0.42,"y":0.61}}
{"type":"state","state":"working","detail":"读取文件…"}
{"type":"region-edit","op":"add|remove|update","region":{}}
```

## 4. 状态映射

```json
{"version":1,
 "map":{
   "thinking":{"animation":"idle","expression":"圈圈眼","priority":"NORMAL"},
   "working":{"expression":"加载"},
   "waiting":{"expression":"流冷汗","bubble":"要确认一下～"},
   "success":{"expression":"爱心眼","animation":"举手切默认手"},
   "error":{"expression":"流泪"}
 }}
```

状态源：DSH 的 `work-status`（thinking / working / result / waiting / success / error），
由插件侧轮询后转发为 `action.kind="state"`。

## 5. 能力查询

`GET /api/capabilities`

```json
{
  "model":{"name":"大肥鱼","url":"/m/大肥鱼.model3.json","canvas":{"width":0,"height":0}},
  "params":[{"id":"ParamAngleX","name":"AngleX","group":"辅助参数","min":-30,"max":30,"default":0,"physics":false,"lipSync":false}],
  "motions":[{"group":"Action","name":"举手切默认手","file":"Animation/举手切默认手.motion3.json","duration":0.8,"loop":false,"params":["..."]}],
  "expressions":[{"name":"脸紅","file":"Exp3/脸红.exp3.json","params":[{"id":"key7","value":1,"blend":"Add"}]}],
  "parts":[{"id":"Part01","name":"..."}],
  "textures":["大肥鱼.4096/texture_00.png"]
}
```

> `min/max/default/physics` 只有运行时（Cubism Core）才权威，静态扫描给不出时返回 `null`，
> 由前端加载后回填。

## 6. 配置档案

`GET/PUT /api/profile`，按模型指纹存储；结构与迁移规则见 `docs/SPEC.md` §7。

## 7. 兼容与版本

- 契约版本写在 `GET /api/version`：`{"protocol":0,"stage":"0.1.0"}`。
- 加字段不算破坏；删改字段必须升 `protocol`。
