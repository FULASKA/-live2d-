/**
 * 分区（Region）—— 角色身上的可交互热区。
 *
 * 坐标空间：**模型画布像素**（本模型 3749×7697，与 PSD 同尺寸，可直接对图层）。
 *   - 原点左上、y 轴向下，与 internalModel.getDrawableVertices() 同一坐标系。
 *   - 好处：模型怎么缩放/移动，区域都不用重算；换分辨率也不用改数据。
 *
 * 三条设计约束（来自 SPEC）：
 *   1. 区域由用户编辑，不写死 —— 这里只给「自动铺初稿」的便利，最终以用户画的为准。
 *   2. 叠加即优先级 —— z 大的先命中（脸压在胸上，胸口那块就不该抢点击）。
 *   3. 手势要区分「点 / 抚摸 / 拖动」，拖动还要与窗口移动区分（由上层决定语义）。
 *
 * 这一层只管几何与手势，不决定「点了之后演什么」。
 */

// 实现按职责拆到 ./regions/ 下；这里保留原来的导出面，调用方无需改动。
export { pointInPolygon, polygonBounds, convexHull } from './regions/geometry.js'
export { createRegionStore } from './regions/store.js'
export { faceRegions, createFaceZoneReader, createHandZoneReader, seedRegions } from './regions/zones.js'
export { createRegionInput } from './regions/input.js'
