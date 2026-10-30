/**
 * 视线与身体跟随（L1 层）—— 让角色「看着你」而不是只有眼珠转。
 *
 * 分三个通道，增益与惯性各不同，这是「灵动」的来源：
 *   眼珠（最快）→ 头部角度（中）→ 身体角度（最慢最轻）
 * 全部是**加性**写入：先读当前值（含 Idle 动作自带的小幅摆动），再加偏移并夹到参数范围内，
 * 所以跟随不会把待机动画压死。写点仍然是 beforeModelUpdate。
 *
 * 不使用内核的 focus()：它只给 eyeBall 与少量角度，无法分区调增益；而且会和这里打架。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createGaze({ param, options = {} } = {}) {
  const cfg = {
    enabled: true,
    strength: 1,        // 总强度 0..1
    deadZone: 0.06,     // 中心死区，避免静止时抖
    // 各通道：满偏时写多少（eye 是 ±1 的量程，head/body 是角度制的比例）
    eye: 0.85,
    head: 0.5,          // × ParamAngleX 的 30° → 15°
    headRoll: 0.12,     // × 30° → 3.6°，横向看时轻微歪头
    body: 0.2,          // × 30° → 6°
    bodyRoll: 0.08,
    // 阻尼（1/s）：越大越跟手
    dampingEye: 20,
    dampingHead: 7,
    dampingBody: 3.5,
    // 轴向翻转：某些模型把 eyeBall / angle 绑反了，或用户的直觉要求相反时用它校正。
    // 默认不翻转（本模型实测：+EyeBallY / +AngleY 均向上，+AngleX / +BodyAngleX 均向右）。
    invertX: false,
    invertY: false,
    ...options,
  }

  const target = { x: 0, y: 0 }
  const state = { eyeX: 0, eyeY: 0, headX: 0, headY: 0, bodyX: 0, bodyY: 0 }

  /** 指针屏幕坐标 → 归一化目标（-1..1，右/上为正），以角色中心为原点 */
  function setTargetFromScreen(px, py, centerX, centerY, halfW, halfH) {
    const nx = clamp((px - centerX) / (halfW || 1), -1, 1)
    const ny = clamp((centerY - py) / (halfH || 1), -1, 1)
    setTarget(nx, ny)
  }

  function setTarget(nx, ny) {
    const dead = cfg.deadZone
    target.x = cfg.invertX ? -nx : nx
    target.y = cfg.invertY ? -ny : ny
    if (Math.abs(target.x) < dead) target.x = 0
    if (Math.abs(target.y) < dead) target.y = 0
  }

  const add = (id, delta) => {
    if (!delta) return
    const info = param.info(id)
    if (!info) return
    param.set(id, clamp(param.get(id) + delta, info.min, info.max))
  }

  /** 每帧调用（beforeModelUpdate 时刻） */
  function apply(dtMs = 1000 / 60) {
    const dt = Math.max(1, dtMs) / 1000
    const k = (damping) => 1 - Math.exp(-damping * dt)

    const tx = target.x * cfg.strength
    const ty = target.y * cfg.strength

    const ke = k(cfg.dampingEye)
    state.eyeX += (tx - state.eyeX) * ke
    state.eyeY += (ty - state.eyeY) * ke

    const kh = k(cfg.dampingHead)
    state.headX += (tx - state.headX) * kh
    state.headY += (ty - state.headY) * kh

    const kb = k(cfg.dampingBody)
    state.bodyX += (tx - state.bodyX) * kb
    state.bodyY += (ty - state.bodyY) * kb

    if (!cfg.enabled) return

    add('ParamEyeBallX', state.eyeX * cfg.eye)
    add('ParamEyeBallY', state.eyeY * cfg.eye)
    add('ParamAngleX', state.headX * cfg.head * 30)
    add('ParamAngleY', state.headY * cfg.head * 30)
    add('ParamAngleZ', -state.headX * cfg.headRoll * 30)
    add('ParamBodyAngleX', state.bodyX * cfg.body * 30)
    add('ParamBodyAngleY', state.bodyY * cfg.body * 0.6 * 30)
    add('ParamBodyAngleZ', -state.bodyX * cfg.bodyRoll * 30)
  }

  return {
    setTarget, setTargetFromScreen, apply,
    options: cfg,
    set(patch) { Object.assign(cfg, patch) },
    /** 当前平滑后的归一化状态（调试/截图用） */
    state: () => ({ ...state, target: { ...target } }),
  }
}
