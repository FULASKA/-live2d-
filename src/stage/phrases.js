/**
 * 预设台词。
 *
 * 为什么不用「把模型输出整段塞进气泡」：
 *   1. 长文本一定会撑大框、压到角色脸上（参考插件的泡泡也是短句 + 固定半径）；
 *   2. 角色感来自「换一句话」而不是「复述全文」，同一档状态换着说才像活的。
 * 所以对外只暴露 key（状态/互动），句子由这里出。
 */

export const PHRASES = {
  idle: ['在的。', '嗯？', '我在这儿呢。'],
  thinking: ['让我想想……', '嗯…先理顺一下。', '在想了，别催。'],
  working: ['正在动手。', '手上还有一点。', '这一步在做了哦。'],
  waiting: ['要等你点头才行呢。', '这里得你确认一下。', '你看这样可以吗？'],
  success: ['做好啦。', '搞定～', '收工。'],
  error: ['出了点小状况……', '这里卡住了。', '要重来一次吗？'],
  // 互动（摸/点）时顺口说的话，和表情/动作一起出
  head: ['头发要乱啦。', '摸头……好吧。', '别一直摸呀。'],
  hand: ['手在这里。', '要牵手吗？', '别捏。'],
  pinch: ['脸要变形了！', '呜……', '轻一点。'],
}

/** 随机取一句，尽量不连着重复上一句 */
export function pickPhrase(key, last = '') {
  const list = PHRASES[key]
  if (!list || !list.length) return ''
  if (list.length === 1) return list[0]
  for (let i = 0; i < 6; i++) {
    const s = list[Math.floor(Math.random() * list.length)]
    if (s !== last) return s
  }
  return list[0]
}
