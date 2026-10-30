/**
 * 参数分层容器 —— L2 表情叠加 + L5 受控参数 + 部件覆盖。
 *
 * 为什么要有这一层：
 *   内核自带的表情通道是「单层覆盖式」的，一个表情进来会把上一个冲掉；
 *   但本模型的表情里 key1/2/7/8/9/10/11/12/13 彼此无关，天生可以共存
 *   （流泪 + 脸红 + 黑框眼镜 可以同时成立），只有眼型组 key3–key6 因为各自清零互斥。
 *   所以表情不能走内核通道，必须自己按「层」叠：后加入的层覆盖同参数，不同参数照旧叠加。
 *
 * 两个写点（顺序由内核决定，不能合并）：
 *   1. applyPhysics() —— 物理输入参数（LeanInput / Clothes* / Movement*）必须在 physics.evaluate 之前写。
 *      写晚了物理已经算完，只有直接绑参数的网格会动，链条不响应（前倾就是这样错的）。
 *   2. apply() —— 其余参数，在 beforeModelUpdate（coreModel.update 之前一刻）写。
 *
 * 帧计数而不是墙钟计时：无头/虚拟时钟下 performance.now() 会冻住，按帧算才可复现。
 */

export function createLayerStack({ param, part, isPhysicsInput = () => false } = {}) {
  /** 表情层：数组顺序即优先级，后面的同参数覆盖前面的 */
  const exprLayers = []
  /** L5：被外部（面板 / Agent 协议 / 动画编辑器）钉住的参数，永远最上层 */
  const held = new Map()
  /** 部件不透明度覆盖（隐藏鼻子、调试部件都走这里） */
  const partOverride = new Map()
  let frame = 0

  const blendValue = (cur, value, blend, k) => {
    if (blend === 'Multiply') return cur * (1 + (value - 1) * k)
    if (blend === 'Add') return cur + value * k
    return cur + (value - cur) * k
  }

  /** 写一个表情参数；k 是淡入进度 */
  const writeParam = (p, k) => {
    const cur = param.get(p.Id)
    if (cur == null) return
    param.set(p.Id, blendValue(cur, p.Value ?? 0, p.Blend, k))
  }

  /** 淡入系数：按帧算，无头环境也一致 */
  const fadeOf = (layer, f) =>
    layer.fadeFrames > 0 ? Math.min(1, Math.max(0, (f - layer.t0) / layer.fadeFrames)) : 1

  const api = {
    /** 加一层表情。同名已在层里则忽略（幂等，便于协议重发）。source 用来整组切换/清除 */
    addExpression(name, params = [], { fade = 0.3, fps = 60, source = 'manual' } = {}) {
      if (exprLayers.some((l) => l.name === name)) return false
      exprLayers.push({ name, params, t0: frame, fadeFrames: Math.max(0, fade) * fps, source })
      return true
    },
    removeExpression(name) {
      const i = exprLayers.findIndex((l) => l.name === name)
      if (i < 0) return false
      exprLayers.splice(i, 1)
      return true
    },
    /**
     * 清掉某个来源的表情层，但**保留 keep 里已有的层**（原地不动，不重播淡入）。
     * 分区互动的「切换不叠加」用它：连点同一个区域的两个手势时，
     * 两边都有的表情（比如 腿:点击 的「加载」→ 腿:滑动 的「加载+脸红」）必须保留，
     * 否则会被移除再重建，加载动画从头开始 —— 看起来就是「被重置了一次」。
     */
    removeSourceExcept(source, keep = null) {
      const removed = []
      for (let i = exprLayers.length - 1; i >= 0; i--) {
        const l = exprLayers[i]
        if (l.source !== source) continue
        if (keep && keep.has(l.name)) continue
        removed.unshift(exprLayers.splice(i, 1)[0].name)
      }
      return removed
    },
    removeSource(source) { return api.removeSourceExcept(source, null) },
    toggleExpression(name, params, opts) {
      return api.removeExpression(name) || api.addExpression(name, params, opts)
    },
    clearExpressions() {
      const n = exprLayers.length
      exprLayers.length = 0
      return n
    },
    hasExpression: (name) => exprLayers.some((l) => l.name === name),
    expressions: () => exprLayers.map((l) => l.name),
    /** 单层的调试信息（t0 = 加入时的帧号，用来确认「有没有被重置重播」） */
    entry(name) {
      const l = exprLayers.find((x) => x.name === name)
      return l ? { name: l.name, source: l.source, t0: l.t0, fadeFrames: l.fadeFrames, params: l.params.length } : null
    },
    /** 当前每层的来源，排查「谁叠上来的」用 */
    layers: () => exprLayers.map((l) => ({ name: l.name, source: l.source, params: l.params.length })),

    /** L5：钉住一个参数（值是最终值，直接覆盖叠加结果） */
    hold(id, value) {
      if (param.get(id) == null) return false
      held.set(id, value)
      return true
    },
    release(id) { return held.delete(id) },
    held: () => [...held.entries()],
    clearHeld() { held.clear() },

    /** 部件覆盖：0 = 隐藏。注意这是「不透明度」不是 visibility，遮罩仍会参与计算 */
    setPart(id, opacity) {
      if (!part.has(id)) return false
      partOverride.set(id, opacity)
      return true
    },
    clearPart(id) { return partOverride.delete(id) },
    parts: () => [...partOverride.entries()],
    clearParts() { partOverride.clear() },

    /**
     * 物理输入：必须在 physics.evaluate 之前写（engine.onBeforePhysics 里调用）。
     * 只写 isPhysicsInput 命中的参数，其余交给 apply()，不会重复写。
     */
    applyPhysics() {
      const f = frame + 1
      for (const layer of exprLayers) {
        const k = fadeOf(layer, f)
        for (const p of layer.params) {
          if (!isPhysicsInput(p.Id)) continue
          writeParam(p, k)
        }
      }
      for (const [id, v] of held) {
        if (isPhysicsInput(id)) param.set(id, v)
      }
    },

    /**
     * 每帧调用（在 beforeModelUpdate 时刻）。顺序即优先级：
     * 表情层（按加入顺序）→ L5 受控参数 → 部件覆盖
     */
    apply() {
      frame += 1
      for (const layer of exprLayers) {
        const k = fadeOf(layer, frame)
        for (const p of layer.params) {
          if (isPhysicsInput(p.Id)) continue
          writeParam(p, k)
        }
      }
      for (const [id, v] of held) {
        if (isPhysicsInput(id)) continue
        param.set(id, v)
      }
      for (const [id, v] of partOverride) part.set(id, v)
    },

    /** 调试：当前每层各会自动哪些参数（冲突排查用） */
    inspect() {
      const touched = new Map()
      for (const l of exprLayers) for (const p of l.params) {
        if (!touched.has(p.Id)) touched.set(p.Id, [])
        touched.get(p.Id).push(l.name)
      }
      const conflicts = [...touched.entries()].filter(([, ls]) => ls.length > 1)
      return {
        frame,
        layers: exprLayers.map((l) => ({ name: l.name, source: l.source, params: l.params.length })),
        conflictParams: conflicts.map(([id, ls]) => ({ id, layers: ls })),
        held: [...held.keys()],
        parts: [...partOverride.keys()],
      }
    },

    get frame() { return frame },
  }

  return api
}
