/**
 * 姿态总线 —— 头部/身体角度**只有一个写入者**。
 *
 * 为什么会有这一层：
 *   本模型 physics3 里 `ParamAngle*` / `ParamBodyAngle*` 是**既入又出**的参数：
 *   物理拿它们当输入算头发/耳朵/衣服，又会回头重算它们自身。
 *   于是「谁在物理后写它们」就成了地盘争夺：
 *     - 只有 gaze 写 → 转头被物理削掉；
 *     - 物理后恢复 gaze 的旧值 → 同期写进去的抚摸晃动/姿态链被整块抹掉。
 *   两种都试过，都会丢东西。
 *
 * 现在的约定：
 *   1. 各层（视线、姿态链、抚摸、捏脸）**只往总线上累加**，谁也不直接写参数；
 *   2. 物理前 `flush()` 一次 —— 物理拿到的是一致的姿态，头发/耳朵/衣服照常跟着动；
 *   3. 物理后（beforeModelUpdate）`flush()` 一次 —— 视觉上看到的就是这份合成姿态，
 *      物理回算不会把它削掉，也不存在谁覆盖谁。
 *
 * 语义是**加性**的：每帧第一次 `add()` 时记下当时的基准值（含待机动作自带的小幅摆动），
 * 最终值 = 基准 + 累计增量，再夹到参数量程内。所以待机动画不会被压死。
 */
export function createPoseBus({ param } = {}) {
  /** id → { base, delta, min, max } */
  const pending = new Map()

  const info = (id) => {
    const i = param.info(id)
    return i && Number.isFinite(i.min) && Number.isFinite(i.max) ? i : null
  }

  /** 累加一个增量（同帧多次调用会叠加） */
  function add(id, delta) {
    if (!delta || !Number.isFinite(delta)) return
    const r = info(id)
    if (!r) return
    let e = pending.get(id)
    if (!e) {
      e = { base: param.get(id) ?? 0, delta: 0, min: r.min, max: r.max }
      pending.set(id, e)
    }
    e.delta += delta
  }

  /** 只读：合成后的值（物理前给面捕层用，避免它又写一遍参数） */
  function peek(id) {
    const e = pending.get(id)
    if (!e) return param.get(id) ?? 0
    return clamp(e.base + e.delta, e.min, e.max)
  }

  /** 把合成结果写进参数。物理前后各调一次，值相同。 */
  function flush() {
    for (const [id, e] of pending) param.set(id, clamp(e.base + e.delta, e.min, e.max))
  }

  /** 新的一帧：清空累计（在物理前的钩子最开头调用） */
  function clear() {
    pending.clear()
  }

  return {
    add, peek, flush, clear,
    size: () => pending.size,
    /** 调试：当前累计了哪些参数、合成值多少 */
    snapshot() {
      const out = {}
      for (const [id, e] of pending) out[id] = { base: +e.base.toFixed(2), delta: +e.delta.toFixed(2), value: +clamp(e.base + e.delta, e.min, e.max).toFixed(2) }
      return out
    },
  }
}

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)
