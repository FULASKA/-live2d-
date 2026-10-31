# 接口契约 v1（已实现）

> v0 是「只定义接口」的草案；v1 起这套 HTTP/SSE 通道在应用壳里真实可用——
> 下行（agent / 脚本 → 舞台）会执行，上行（舞台 → agent）会落盘。
> 只用 `127.0.0.1`，所有写接口都要 token。

## 0. 形态

```
agent（DSH 插件 / CLI / 脚本）──POST /api/action──┐
                                                ├─► 页面 executeAction ─► 角色
设置窗口（渲染层内部）───────────────────────────┘

页面 ──POST /api/feedback──► 反馈日志（JSONL + 内存环形缓冲）──► agent
页面 ──POST /api/snapshot──► 状态快照（agent 查询 / 订阅）
```

- 舞台只认这套协议，不认「agent 是谁」：DSH 插件、`tools/stage-cli.mjs`、别的脚本走同一个入口。
- 页面不在线时动作不会排队（SSE 连接建立前的 2 秒内除外，见 §4）。

## 1. 发现入口

舞台启动后写 `~/.dsh/live2d/endpoint.json`（每次启动覆盖）：

```json
{
  "url": "http://127.0.0.1:54972",
  "port": 54972,
  "token": "local-app",
  "pid": 20444,
  "model": "C:/.../大肥鱼.model3.json",
  "protocol": 1,
  "at": 1793443983426
}
```

应用退出时不删文件：留下旧端口比文件消失更容易排查（连不上 = 没开 / 已换端口）。

## 2. 下行：动作

`POST /api/action`，头 `X-Stage-Token: <token>`：

```json
{
  "id": "可选，便于回执对账",
  "source": "agent | script | user | state",
  "priority": "BACKGROUND | NORMAL | FORCE",
  "fade": 0.3,
  "ttlMs": 0,
  "action": { "kind": "say", "text": "我回来啦", "ms": 3000 }
}
```

`action.kind` 已实现：

| kind | 字段 | 效果 |
|---|---|---|
| `say` | `text`, `ms?`, `state?` | 气泡说一句；`ms` 到点自动收起。会压过 DSH 工作状态气泡，避免两秒后被盖掉 |
| `expression` | `name \| null` | 叠加表情层（source=`bus`）；`null` 清除 |
| `pose` | `name \| null`, `ms?` | 切终点姿势；`null` 放下 |
| `look` | `x`, `y`（-1..1）, `ms?` | 指定视线；`ms` 内不跟鼠标，默认 2500ms |
| `idle` | `mode: play\|pause\|resume`, `name?`, `ms?` | 立刻演一段待机动作 / 让位 / 解除让位 |
| `state` | `state`, `task?` | 走 DSH 状态映射（气泡 + 表情 + 小动作），同 `agent-link.js` |
| `stop` | `scope: all\|expression` | 撤掉外部指令（不碰用户手动切的表情） |

保留未实现：`motion`、`animation`、`param`、`pose.keys`（v0 草案里列过，等动作编辑器接上再做）。

返回：

```json
{"accepted":true,"id":"…","effectivePriority":"NORMAL","interrupted":null,"rank":4}
```

`accepted` 只代表**受理成功**，真正执行与否看 §3 的 `action-done` 回执。

## 3. 上行：反馈

### 3.1 互动事件

`POST /api/feedback`（页面自动发，脚本也可补发），头同上：

```json
{"type":"interaction","region":"头","gesture":"click|pet|drag","detail":null,"at":{"x":1875,"y":1412}}
```

- `at` 是**模型画布像素**（与热区、PSD 同坐标系），不是屏幕坐标。
- 只报真实发生的：点按、抚摸第一步（`step===1`）、拖动开始/结束；悬停与移动不刷日志。
- `type` 另有 `idle-line`（待机台词）与 `action-done`（动作执行回执）。

### 3.2 日志文件

`~/.dsh/live2d/feedback.jsonl`，一行一条，追加写：

```json
{"run":1793443934647,"seq":1,"at":1793443947454,"type":"interaction","region":"头","gesture":"click","detail":null,"point":{"x":1875,"y":1412}}
```

- `run` = 本次舞台启动的时间戳（`seq` 每次启动从 1 重来，靠 `run` 区分）。
- 写入串行化，文件里顺序与 `seq` 一致。
- 内存只保留最近 500 条；需要历史读文件。

读取：

- `GET /api/feedback?since=<seq>` → `{seq, feedback:[...]}`
- `GET /api/state` → `{snapshot, feedback: 最近 50 条, seq}`

### 3.3 状态快照

页面启动、每次动作执行完、以及每 4 秒会 `POST /api/snapshot`：

```json
{
  "model": "大肥鱼",
  "agent": {"enabled": true, "lastState": "working", "lastAt": 179344…},
  "bubble": {"visible": true, "text": "这一步交给我。", "state": "working", …},
  "idle": {"current": "重心换脚", "progress": 0.61, "plays": 9, …},
  "pose": {"active": "竖手指", …},
  "exprs": ["bus:爱心眼"],
  "look": "cursor | agent"
}
```

## 4. SSE：实时通道

`GET /api/events?token=<token>`（`text/event-stream`，`retry: 2000`）

| 消息 | 何时 | 负载 |
|---|---|---|
| `hello` | 连上时 | `snapshot`、最近 20 条 `feedback`、最近 **2 秒内**的 `actions` |
| `action` | 收到下行指令 | 与 `/api/action` 的 body 同构，带 `id/seq` |
| `feedback` | 有新反馈 | 同 §3.2 记录 |
| `snapshot` | 页面心跳 | `{snapshot}` |
| `lifecycle` | 动作开始/结束 | `{event:{type:'action',phase:'start|end',reason}}` |

页面按 `id` 去重（最多记 120 个），因此收到 hello 里补发的动作不会重复执行；
但「连接建立前 2 秒之外」发出的动作不会补 —— 需要强送达就查快照确认。

## 5. 命令行

```bash
node tools/stage-cli.mjs status
node tools/stage-cli.mjs say 我回来啦 --ms 3000 --state success
node tools/stage-cli.mjs expr 爱心眼        # 清除：expr -
node tools/stage-cli.mjs pose 竖手指 --ms 2000
node tools/stage-cli.mjs look 0.6 -0.3 --ms 2000
node tools/stage-cli.mjs idle 伸懒腰        # 随机：idle play；让位：idle pause --ms 8000
node tools/stage-cli.mjs state working --task "读文件"
node tools/stage-cli.mjs stop all
node tools/stage-cli.mjs feedback --since 0 --n 20
```

也可 `npm run ctl -- status`。CLI 从 `endpoint.json` 读端口与 token，不写进命令历史。

## 6. 安全与边界

- 服务只监听 `127.0.0.1`；`/api/action`、`/api/feedback`、`/api/snapshot`、`/api/state` 都要 token。
- `/api/version`、`/api/capabilities`、`/api/log` 不需要 token（只读）。
- 单实例：同时开两个舞台会互相覆盖 `endpoint.json`，后写的赢。
- 反馈文件只追加、不轮转；长期运行需要外部清理（后续可加按大小切分）。
- 外部指令不写 `settings.json`，重启即回到默认；用户手动切的「前倾 / 竖手指」不受 `stop` 影响。

## 7. 版本

`GET /api/version` → `{"protocol":1,"stage":"0.1.0-dev"}`

加字段不算破坏；删改字段或改变语义必须升 `protocol`。
