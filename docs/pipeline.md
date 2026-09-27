# 离线预渲染管线技术说明

## 为什么这么做

SimCity 4 的观感来自「离线渲染的 3D 模型 → 精灵」：光学正确、光照统一、细节密度远超
手绘像素图，但运行时只是一堆贴图。本项目的管线用纯 JS 复刻这一工作流：

1. **程序化建模**（无 Blender）：`tools/models/` 下每个建筑是 `build(mesh)` 函数，
   用 `Mesh.box / gable / pyramid / cylinder / cone / flatPoly` 拼装。
2. **固定 2:1 等距正交相机**：`sx = (X−Y)/2`，`sy = (X+Y)/4 − Z`，1 瓦片 = 64 计划像素，
   1 层高 = 16 像素；世界坐标即"计划像素"，材质函数可直接按像素坐标做纹理。
3. **z-buffer 软件光栅化**：`raster.js` 逐三角形扫描，深度 = `X+Y+2Z`（正交线性），
   4 档平面光照 + 近地 AO 压暗，无任何 PBR。
4. **有限色板 + 有序抖动**：32 色分成 6 条色阶 ramp；`palette.js` 先取最近色定位 ramp，
   再按亮度在相邻两色间用 Bayer 4×4 抖动，得到 PC98 式渐变带。
5. **昼夜双版**：同一 mesh 渲染两次，`ctx.night` 驱动材质（夜间建材压暗、窗户按哈希点亮为
   自发光金色），亮窗/路灯/水面夜间表现全部由材质函数自动产生。
6. **图集打包**：shelf 打包到 2048² 页，输出 `manifest.json`（每个精灵的页、矩形、锚点）。
   锚点 = 瓦片原点 `(0,0,0)` 的投影位置，因此运行时放置只需"瓦片坐标 → 屏幕坐标"一次投影。

## 数据流

```
models/buildings.js  ──build()──▶  Mesh（顶点/三角形/材质函数）
                                     │  rotate90 ×0..3（4 朝向，光照固定所以每版重新着色）
                                     │  addShadow()（+X 方向一次性烘焙的抖动阴影）
                                     ▼
                            renderSprite()  ──▶ RGBA 精灵
                                     │  quantize() 32 色 + Bayer
                                     ▼
             atlas.js（shelf 打包）──▶ assets/atlas0.png + manifest.json + preview.html
                                     │
                        verify.js ───┘  校验：像素色板合规 / 清单完整 / 矩形越界

运行时：assets.js 加载 manifest+图集 → scene.js 按对角线合成 → crt.js 后处理
```

## 命名约定（manifest 契约）

| 前缀 | 含义 | 例 |
|---|---|---|
| `b/<model>/<rot>/<day\|night>` | 建筑，rot = 0..3（顺时针 90°） | `b/c_tower/2/night` |
| `t/<surf>/<variant>/h<n>/<day\|night>` | 地形列（顶面 + 落到 z=0 的崖壁） | `t/grass/1/h4/day` |
| `w/<frame>/<variant>/<day\|night>` | 水面 4 帧动画 | `w/2/0/night` |
| `road/<mask>/<day\|night>` | 16 方向自动拼接道路 | `road/15/day` |
| `pr/<prop>/<rot>/<day\|night>` | 树 / 灌木 / 石块 / 路灯 | `pr/lamp/0/night` |
| `zone/<r\|c\|i>`、`ui/noroad` | 分区叠加与"无道路"标记 | `zone/r` |
| `icon/<tool>` | 工具栏图标（模型缩微渲染或手绘 16×16） | `icon/top_hall` |

`manifest.models[]` 提供每个模型的 `fx/fy`（朝向 0 的占地）、`cls`（r/c/i/p/x）、`tier`。

## 常用操作

### 新增一个建筑

1. 在 `tools/models/buildings.js` 的 `BUILDINGS` 数组里追加一项：
   ```js
   { name: 'c_bank', cls: 'c', tier: 3, fx: 2, fy: 2, label: '银行',
     build(m) {
       m.flatPoly([[0,0],[128,0],[128,128],[0,128]], 0, MAT.pavement); // 场地
       const f = M.facade({ base: c(C.grey6), style: 'panel', floorH: 16, pitch: 13, lit: 0.6, seed: 999 });
       m.box(12, 12, 0, 116, 116, 80, { xp: f, xn: f, yp: f, yn: f });
       m.box(8, 8, 80, 120, 120, 84, { top: MAT.flatRoof, all: MAT.concrete });
       parapet(m, 8, 8, 120, 120, 84, 4, MAT.cream);
       rooftop(m, 12, 12, 116, 116, 84, mulberry32(999), { tank: true });
     } },
   ```
2. `npm run build`（自动产出 4 朝向 × 昼夜 + 图标），打开 `assets/preview.html` 检查。
3. 若要玩家能直接放置：在 `src/game/tools.js` 的分组里加入其名字（`makePlopTool` 会自动生成工具）。

### 重新烘焙中英点阵字

1. `npm run dev`，打开 `http://localhost:8123/tools/font-bakery.html`。
2. 页面会自动扫描 `src/` 里的字符集来源（或直接把新字加进页面里的 `CJK` 字符串）。
3. 点 Bake —— 结果写入 `assets/font-glyphs.json`，刷新游戏即可。

## 调色板

32 色分 6 条 ramp（暗→亮），所有渲染像素最终只能取这 32 个值：

| ramp | 索引 | 用途 |
|---|---|---|
| 灰阶 / 墨色 | 0–7 | 轮廓、UI、混凝土、屋顶、路面 |
| 暖棕 / 土色 | 8–13 | 墙体、木材、土壤、沙滩 |
| 砖红 | 14–17 | 砖墙、红瓦、警告 |
| 琥珀金 | 18–21 | 夜窗、招牌、金币色点缀 |
| 绿 | 22–26 | 草地、树冠 |
| 青蓝 / 水 | 27–31 | 玻璃幕墙、水面、夜色 |

## 已知取舍

- 光影是手调的 4 档而非真实光照（刻意如此，利于 32 色量化稳定）。
- 水面为 4 帧交叉淡入式动画 + 逐瓦片变体（避免整片水面完全重复）。
- 地形为 0–6 级离散高度，建筑/道路要求四邻同高的平地（与 SC4 的"整平才能建造"一致）。
- 大底面精灵在同一对角线相邻时理论上存在排序歧义，已用"最前排对角线 + 同排 y 升序"规避，
  并在地图内做了相邻测试用例；如后续加入 3×3 以上建筑请复测。
