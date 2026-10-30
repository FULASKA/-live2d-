// 契约类型：与 docs/PROTOCOL.md 一一对应。
// 只放类型与常量，不放实现——Stage 壳与 DSH 插件两侧都依赖它。

export type Priority = 'BACKGROUND' | 'NORMAL' | 'FORCE'
export type Source = 'agent' | 'script' | 'user' | 'state'

export type StageAction =
  | { kind: 'motion'; name: string; group?: string; loop?: boolean; speed?: number }
  | { kind: 'expression'; name: string | null }
  | { kind: 'animation'; animationId: string; loop?: boolean; speed?: number }
  | { kind: 'param'; id: string; value: number; fade?: number }
  | { kind: 'pose'; keys: Array<{ id: string; value: number }>; fade?: number }
  | { kind: 'state'; state: WorkState }
  | { kind: 'stop'; scope: 'motion' | 'expression' | 'all' }

export interface ActionRequest {
  id?: string
  source?: Source
  priority?: Priority
  fade?: number
  /** 到期自动结束（毫秒），0 = 不自动结束 */
  ttlMs?: number
  /** 结束后是否回落到 L0 基线 */
  revert?: boolean
  action: StageAction
}

export interface ActionReceipt {
  accepted: boolean
  id: string
  effectivePriority: Priority
  interrupted: string | null
}

/** DSH 的 work-status 六档 */
export type WorkState = 'thinking' | 'working' | 'result' | 'waiting' | 'success' | 'error'

export type StageEvent =
  | { type: 'action'; id: string; phase: 'start' | 'end' | 'interrupted'; reason?: 'replaced' | 'ttl' | 'finished' }
  | { type: 'interaction'; region: string; gesture: 'click' | 'slide' | 'drag'; at: { x: number; y: number } }
  | { type: 'state'; state: WorkState; detail?: string }
  | { type: 'region-edit'; op: 'add' | 'remove' | 'update'; region: Region }

/** ---------- 能力清单 ---------- */

export interface ParamInfo {
  id: string
  name: string
  group: string | null
  min: number | null
  max: number | null
  default: number | null
  physics: boolean | null
  lipSync: boolean | null
}

export interface MotionInfo {
  group: string
  name: string
  file: string
  duration: number | null
  /** 注意：VTS 导出的 Meta.Loop 常把一次性动作也标 true，以用户标记为准 */
  loop: boolean
  params: string[]
}

export interface ExpressionInfo {
  name: string
  file: string
  params: Array<{ Id: string; Value: number; Blend: 'Add' | 'Multiply' | 'Overwrite' }>
}

export interface Capabilities {
  model: { name: string; url: string; canvas: { width: number; height: number } | null }
  params: ParamInfo[]
  groups: Array<{ id: string; name: string }>
  parts: Array<{ id: string; name: string }>
  motions: MotionInfo[]
  expressions: ExpressionInfo[]
  textures: string[]
}

/** ---------- 区域 ---------- */

export interface Region {
  id: string
  label: string
  kind: 'face' | 'chest' | 'waist' | 'legs' | 'tail' | 'custom'
  /** 归一化到模型画布 0..1 的多边形 */
  polygon: Array<[number, number]>
  /** 叠加顺序：越大越优先，重叠处只触发最上层 */
  z: number
  gestures: Partial<Record<'click' | 'slide' | 'drag', Reaction>>
  /** 拖拽语义：区域互动 / 拖动整个窗口 / 不响应 */
  dragMode: 'region' | 'window' | 'none'
  /** PSD 来源（若由图层生成） */
  fromLayer?: string
}

export interface Reaction {
  motion?: string
  expression?: string
  /** 参数补间，用于没有对应动作的轻反馈 */
  tween?: { keys: Array<{ id: string; value: number }>; ms: number }
  sound?: string
  bubble?: string
}

/** ---------- 档案 ---------- */

export interface Profile {
  schemaVersion: 1
  model: { name: string; fingerprint: string; path: string }
  window: { width: number; height: number; alwaysOnTop: boolean; clickThrough: 'auto' | 'locked' }
  /** 模型相对窗口：k 是比值而非像素 */
  modelView: { k: number; x: number; y: number; fit: 'contain' | 'cover' }
  gaze: { enabled: boolean; intensity: number; rangeX: number; rangeY: number; deadzone: number; smoothing: number }
  regions: Region[]
  stateMap: Partial<Record<WorkState, Reaction>>
  animations: Array<{ id: string; name: string; duration: number; loop: boolean }>
}
