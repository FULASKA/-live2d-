/**
 * 姿态链 —— 头 → 胸 → 腰 的逐级跟随（弹簧 + 轻微过冲）。
 *
 * 为什么单独一层：视线只该负责「看哪里」，身体的跟随是另一套动力学。
 * 真人转头时，胸口慢半拍、腰再慢一拍，回正时还会稍微过一点再稳住；
 * 一条弹簧链就能把这个层次做出来，而单写角度只会让整个人像一块板。
 *
 * 写点：**物理之前**。这是关键 —— ParamBodyAngleX/Z 是 physics3 里权重最高的两个输入
 * （1064 / 860），喂给它们，头发、胸、裙摆的物理才会跟着身体甩起来。
 * 写在物理之后等于白写（物理已经算完了）。
 *
 * 加性写（add）：默认值是 0，所以「加性」等价于「设定偏移」，
 * 而抚摸晃动之类的其它层还能继续在上面叠。
 */

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v)

export function createPosture({ param, gaze, bus, options = {} } = {}) {
  const cfg = {
    strength: 1,
    chest: 26,          // 胸满偏角度（度）
    // 弹簧刚度：原来 3.4 的等效时间常数接近 1 秒，身体跟手像在水里。
    // ω=√k，ζω≈0.72×6.7≈4.8 → 大约 0.2 秒到位，还保留一点过冲。
    chestK: 45,
    chestRatio: 0.72,   // 阻尼比（<1 会过冲一点，像真的）
    hip: 11,            // 腰满偏角度
    hipK: 12,
    hipRatio: 0.9,
    roll: 0.28,         // 胸口侧倾 = -横向 × 这个比例
    bowBoost: 1.7,      // 低头时胸口多弯
    liftDamp: 0.75,     // 抬头时收敛
    breathY: 1.1,       // 呼吸让胸口上下起伏的幅度（度）
    shoulderY: 0.22,    // 肩膀跟着俯仰轻微动
    hipTwist: 0.45,     // 腰部反向扭转比例（头转右 → 胯略反向）
    ...options,
  }

  let t = Math.random() * 10
  // 每个关节一条弹簧：v0 = 位置，v1 = 速度
  const chestX = { v0: 0, v1: 0 }
  const chestY = { v0: 0, v1: 0 }
  const hipZ = { v0: 0, v1: 0 }

  const has = (id) => !!param.info(id)
  // 姿态总线优先：角度类参数由总线统一在「物理前 / 物理后」各写一次，
  // 各层只管累加增量，避免互相覆盖（见 pose-bus.js 的说明）。
  const add = (id, delta) => {
    if (!delta) return
    if (bus) { bus.add(id, delta); return }
    const i = param.info(id)
    if (!i) return
    param.set(id, clamp(param.get(id) + delta, i.min, i.max))
  }

  /** 半隐式欧拉积分一步弹簧 */
  const spring = (o, target, k, ratio, dt) => {
    const c = 2 * Math.sqrt(k) * ratio
    o.v1 += (k * (target - o.v0) - c * o.v1) * dt
    o.v0 += o.v1 * dt
    return o.v0
  }

  function apply(dtMs = 1000 / 60) {
    const dt = clamp(dtMs / 1000, 0.001, 0.12)
    t += dt
    const tgt = gaze?.state?.().target || { x: 0, y: 0 }
    const s = cfg.strength
    const tx = clamp(tgt.x, -1, 1) * s
    const ty = clamp(tgt.y, -1, 1) * s

    // 胸：跟头同向，但慢半拍 + 一点点过冲
    const cx = spring(chestX, tx, cfg.chestK, cfg.chestRatio, dt)
    const cyv = spring(chestY, ty, cfg.chestK * 0.9, cfg.chestRatio, dt)
    // 腰：跟着胸走，更慢、更小，并且反向拧一点（真实身体的对抗）
    const hz = spring(hipZ, -tx * cfg.hipTwist, cfg.hipK, cfg.hipRatio, dt)

    // 呼吸：胸口轻微起伏，静止时也有活气
    const breath = Math.sin(t * 0.23 * Math.PI * 2) * cfg.breathY
    const bow = cyv < 0 ? cfg.bowBoost : cfg.liftDamp // 目标向下（低头）时多弯

    add('ParamBodyAngleX', cx * cfg.chest)
    add('ParamBodyAngleY', cyv * cfg.chest * bow + breath)
    add('ParamBodyAngleZ', -cx * cfg.roll * 30)
    add('HipAngleZ', hz * cfg.hip)
    if (has('ShoulderY')) add('ShoulderY', cyv * cfg.chest * cfg.shoulderY)
    if (has('HipZ1')) add('HipZ1', hz * 0.04)
    if (has('HipZ2')) add('HipZ2', hz * 0.04)
  }

  return {
    apply,
    set(patch = {}) { Object.assign(cfg, patch) },
    options: cfg,
    state: () => ({
      chest: [Math.round(chestX.v0 * 100) / 100, Math.round(chestY.v0 * 100) / 100],
      hip: Math.round(hipZ.v0 * 100) / 100,
    }),
  }
}
