/**
 * 动作预设：把舞台里内置的「姿势」和「待机动作」翻译成编辑器能直接编辑的动作条目。
 *
 * 目的：左栏不应该只有用户自己新建的动作 —— 内置的那些（举手/竖手指/狗尾草/护胯、
 * 重心换脚/东张西望/伸懒腰…）也应该能点开、拖参数、实时看效果，
 * 这样任何人都能照着改，不用先去读代码。
 *
 * 两套来源的语义不同，转换规则：
 *   · poses.js 的 POSES 是**绝对终点值** → 直接作为关键帧值；
 *   · idle-motions.js 的 ROUTINES 是**相对增量的归一化曲线**（0..1 时间）→
 *     采样成毫秒关键帧，值直接当绝对值用（站立时增量基准≈0，视觉上一致）。
 */

import { POSES } from './poses.js'
import { ROUTINES } from './idle-motions.js'

const REST = {
  Movement1: 0, Movement2: 0, Movement3: 0,
  Param56: 1, Param57: 0,
  Param36: 0, Param39: 0, Param40: 0, Param41: 0, Param42: 0, Param43: 0,
  Param59: 0, Param60: 0, Param61: 0, Param62: 0,
}

/** 采样一条归一化曲线 → [{t, v}]，每 8% 取一个点，首尾必取 */
function sampleTrack(keys, ms, steps = 12) {
  if (!Array.isArray(keys) || !keys.length) return []
  const out = []
  for (let i = 0; i <= steps; i += 1) {
    const p = i / steps
    out.push({ t: Math.round(p * ms), v: sampleAt(keys, p) })
  }
  return out
}

function sampleAt(keys, p) {
  if (p <= keys[0][0]) return keys[0][1]
  for (let i = 1; i < keys.length; i += 1) {
    const [t1, v1] = keys[i]
    if (p <= t1) {
      const [t0, v0] = keys[i - 1]
      const span = t1 - t0 || 1
      const k = Math.min(1, Math.max(0, (p - t0) / span))
      const e = k * k * (3 - 2 * k)
      return v0 + (v1 - v0) * e
    }
  }
  return keys[keys.length - 1][1]
}

/** POSES → 动作：单关键帧（终点姿势），时长够看就行 */
export function poseActions() {
  return Object.entries(POSES).map(([name, p]) => {
    const values = { ...REST, ...(p.params || {}), ...(p.extras || {}) }
    return {
      id: `preset:pose:${name}`,
      name,
      trigger: 'manual',
      preset: 'pose',
      duration: 420,
      lines: [],
      params: Object.keys(values),
      keys: [{ t: 0, values }],
    }
  })
}

/** ROUTINES → 动作：把归一化增量曲线采样成毫秒关键帧 */
export function routineActions() {
  return Object.entries(ROUTINES || {}).map(([name, r]) => {
    const tracks = r.tracks || {}
    const ids = Object.keys(tracks)
    const ms = Math.max(200, Math.round(r.ms || 3000))
    const byTime = new Map()
    for (const id of ids) {
      for (const { t, v } of sampleTrack(tracks[id], ms)) {
        if (!byTime.has(t)) byTime.set(t, {})
        byTime.get(t)[id] = Number(v.toFixed(4))
      }
    }
    const keys = [...byTime.entries()].sort((a, b) => a[0] - b[0]).map(([t, values]) => ({ t, values }))
    return {
      id: `preset:idle:${name}`,
      name,
      trigger: 'manual',
      preset: 'idle',
      duration: ms,
      lines: Array.isArray(r.lines) ? r.lines.slice() : [],
      params: ids,
      keys: keys.length ? keys : [{ t: 0, values: {} }],
    }
  })
}

/** 全部预设（按左栏展示顺序：姿势在前，待机动作用后面） */
export function allPresetActions() {
  return [...poseActions(), ...routineActions()]
}
