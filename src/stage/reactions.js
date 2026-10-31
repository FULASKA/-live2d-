/**
 * 分区反应规则（应用壳与验证台共用）。
 *
 * 三条硬规则（都是踩出来的）：
 *   1. 切换，不叠加：同一个热区同一时刻只有一组反应在场；换组先把上一组临时层撤掉。
 *   2. 两边都有的表情原地保留：腿「点击=加载」→「滑动=加载+脸红」时加载不能重建，否则动画从头播。
 *   3. 换装 / 脱鞋 / 尾巴这类切换是**长期状态**：放在独立 source（switch），别的点击滑动都不许动它。
 *
 * 这一层只决定「谁上谁下」，不碰渲染与计时；真正的写入在 layers.js（beforeModelUpdate / beforePhysics）。
 */

export const DEFAULT_REACTIONS = {
  头: { tap: { toggle: '爱心眼' }, pet: { expr: ['＞＜', '脸红'] } },
  胸: { tap: { toggle: '胸口衣服' }, pet: { expr: ['屑屑眼'] } },
  腰: { tap: { expr: ['＞＜'] }, pet: { expr: ['＞＜', '流泪', '流冷汗'] } },
  裙摆: { tap: { toggle: '裙子切换' }, pet: { expr: ['黑脸', '屑屑眼', '竖食指开'] } },
  腿: { tap: { expr: ['加载'] }, pet: { expr: ['加载', '脸红', '圈圈眼'] } },
  // 摸脚 = 被挠痒：＞＜（眼睛挤起来笑）+ 脸红；嘴部的笑意由 mouth 情绪层补
  脚: { tap: { toggle: '脱鞋' }, pet: { expr: ['＞＜', '脸红'] } },
  // 手：摸手 = 不好意思（＞＜ + 脸红），点一下轻轻缩一下。
  // 竖手指留在裙摆那套反应里，但手有了自己的热区，手不会被裙摆的矩形抢走
  左手: { tap: { expr: ['＞＜'] }, pet: { expr: ['＞＜', '脸红'] } },
  右手: { tap: { expr: ['＞＜'] }, pet: { expr: ['＞＜', '脸红'] } },
  尾巴: { tap: { toggle: '尾巴开关' } },
}

export function createReactions({
  layers,
  expressionDefs = [],
  onEvent = () => {},
  switchSource = 'switch',
  reactionSource = 'reaction',
  ttlMs = 6000,
  fade = 0.3,
  /** 允许按区域名覆盖默认反应（应用里可做用户配置） */
  reactions = null,
} = {}) {
  const active = { group: null, timer: 0 }
  const table = reactions || DEFAULT_REACTIONS
  const defOf = (name) => expressionDefs.find((e) => e.name === name)

  function addExpression(name, source) {
    const def = defOf(name)
    if (!def) { onEvent({ type: 'warn', text: `没有表情：${name}` }); return false }
    const ok = layers.addExpression(name, def.params, { fade, source })
    if (ok) onEvent({ type: 'added', name, source })
    return ok
  }

  /** 撤掉当前这一组临时反应（switch 层不受影响） */
  function clear(reason) {
    if (active.timer) { clearTimeout(active.timer); active.timer = 0 }
    const removed = layers.removeSource(reactionSource)
    active.group = null
    if (removed.length) onEvent({ type: 'removed', names: removed, reason })
  }

  function apply(region, kind) {
    if (!region) return false
    const rx = region.reaction?.[kind] || table[region.name]?.[kind]
    if (!rx) {
      onEvent({ type: 'warn', text: `${region.name} · ${kind} 没有配置反应（现有：${Object.keys(region.reaction || {}).join('/') || '空'}）` })
      return false
    }

    // 切换型：独立层，长期保持；只有再点同一个热区才收回
    if (rx.toggle) {
      const on = layers.hasExpression(rx.toggle)
      if (on) layers.removeExpression(rx.toggle)
      else addExpression(rx.toggle, switchSource)
      onEvent({ type: on ? 'removed' : 'added', names: on ? [rx.toggle] : undefined, name: on ? undefined : rx.toggle, source: switchSource, reason: on ? '切换关' : undefined, persist: true })
      if (active.group) clear('切换互动')
      active.group = null
      onEvent({ type: 'group', text: `${region.name} · ${kind} → ${on ? '收回' : '打开'} ${rx.toggle}` })
      return true
    }

    const wanted = [...(rx.expr || (rx.expression ? [rx.expression] : []))]
    if (active.timer) { clearTimeout(active.timer); active.timer = 0 }
    const keep = new Set(wanted)
    const removed = layers.removeSourceExcept(reactionSource, keep)
    active.group = `${region.name}:${kind}`

    const added = []
    for (const name of wanted) if (addExpression(name, reactionSource)) added.push(name)
    if (removed.length) onEvent({ type: 'removed', names: removed, reason: '切换动作组' })

    const kept = wanted.filter((n) => !added.includes(n))
    const shown = [...added, ...kept.map((n) => `${n}（续）`)].join(' + ')
    onEvent({ type: 'group', text: `${region.name} · ${kind} → ${shown || '（无预设）'}` })
    active.timer = setTimeout(() => clear('到时'), ttlMs)
    return true
  }

  return {
    apply,
    clear,
    get group() { return active.group },
    table,
  }
}
