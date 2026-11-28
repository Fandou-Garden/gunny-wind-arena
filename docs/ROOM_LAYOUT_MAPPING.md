# 经典对战房间：原版源码 → 网页实现对应关系

分支：`feat/room-classic-layout`（基于 `feat/node-server-mode` @ `5633c0c`）
目标：按用户提供的原版中文版房间截图，重做服务端版房间覆盖层布局。
前端为纯静态 `dist/`，战斗 HUD / Canvas / 铁匠铺逻辑均不改；本次只替换房间覆盖层。

---

## 0. 依据与素材来源

| 来源 | 路径 | 用途 |
|---|---|---|
| 原版房间源码 | `Gunny/Source Flash/src/room/` | 结构、状态、坐标语义 |
| 原版组件配置 | `boom_img/inetpub/wwwroot/gunny/ui/vietnam/xml/xml/room.xml` | **精确坐标**（九宫格、玩家位、道具栏、按钮） |
| 原版界面包 | `Gunny/Source Flash/FlashSV1/ui/vietnam/swf/room.swf` | 2.0 MB，FFDec 21.0.1 导出 151 个符号 / 154 张位图 |
| 导出工具 | `Gunny/ffdec/ffdec-cli.jar` | `-export symbolClass / image,sprite,button` |
| 落地素材 | `dist/assets/room/*.png`（35 个） | 木质九宫格、玩家位、撮合插画、道具栏、按钮、徽记 |
| 房间音乐 | `Gunny/Tank.Flash/resource/v1.1/sound/065.flv` → `dist/assets/audio/bgm-room-065.mp3` | 项目内已转换，非 `audio.swf` 短音效 |

越南语版素材上的文案（`Phòng` / `Đạo cụ theo người` / `Rương đạo cụ chiến đấu` / `Quan chiến` /
`Thông tin phòng` / `Click chọn mở` / `Click để đóng` / `Hủy`）已用水平插值擦除，
改由 DOM 中文文本呈现；未改动素材的边框、纹理与插画本身。

---

## 1. 逐项对应关系

| # | 原版源码 / 方法 | 资源名称与路径 | 当前网页实现位置 | 差异 | 修复结果 |
|---|---|---|---|---|---|
| 1 | `RoomManager.as`（房间状态/事件） | — | `server-mode.js` → `dataApi.on('room'/'battle_start'/'battle_end')` | 原版为多人 Rooms 状态机；网页为单机服务端房间 | 保留现有事件流，未改协议 |
| 2 | `BaseRoomState.enter()` → `SoundManager.instance.playMusic("065")` | `065.flv` → `dist/assets/audio/bgm-room-065.mp3` | `server-mode.js` → `showLayer()` 里 `audioScene('room')` | 原版流式 BGM；网页已转 MP3 并由 `audio-scenes.js` 调度 | 沿用，无回归 |
| 3 | `BaseRoomView.as` 基础界面 + 九宫格背景 `asset.room.roomBg`（`room.xml`: `room.leftTopAsset`…`rightBottomAsset`，408×425，x=8 y=5） | `dist/assets/room/frame-{lt,tc,rt,lc,c,rc,lb,bc,rb}.png` + 拼合 `room-frame.png` | `styles-room.css` → `.room-shell` `border-image: … 40 fill / 16px`；`.room-beam` 顶部横梁 | 原版 9 切片由 Flash Scale9CornerImage 拉伸 | 用 CSS `border-image` 复刻九宫格，1000×690 舞台 |
| 4 | `RoomPlayerItem.as` / `room.xml`: `roomPlayerItem{Blue,Red,Yellow,Wait,Close}BGAsset`（170×190，导出实测 170×203），`roomPlayerItemHostAsset`、`GuildTxtAsset`、`VipIcon x=134 y=50`、`LevelIcon x=132 y=21` | `seat-{red,blue,yellow,open,closed}.png`、`host-label.png`、`guild-label.png` | `server-mode.js` → `.room-seats` 2×2；房主位 = `ddtPlayerName` + `ddtEquipped` + 头像 + 房主/VIP/Lv 标签 | 原版 4 位可开/关/踢人/邀请；网页单机固定 1 房主 + 3 空位 | 布局与状态外观还原；空位点击为展示，不接多人逻辑 |
| 5 | `MatchRoomView.as` / `room.xml`: `matchRoomBigMapInfoPanel x=418 y=5`；`matchingTxtAsset x=117 y=373`；`freeModeIconAsset`；`room.timeTxt x=178 y=330`（Arial 38 黄字 letterSpacing 6） | `match-preview.png`（343×400 裁切自导出 343×544）、`icon-free.png`、`matching-text.png` | `.room-match` 插画 + `.room-match-bar`（自由战 / `03` / 撮合中，请等待…） | 原版倒计时由服务端撮合驱动；网页为静态演示 | 画面与文字排版还原，倒计时未接撮合（单机无匹配队列） |
| 6 | `RoomRightPropView` / `room.xml`: `asset.room.roomPropView x=762 y=15`；`upCellsContainer x=27 y=105 spacing=32`；`downCellsContainer x=28 y=208 hSpace=32 vSpace=26`；`dropCellBgAsset` | `right-props.png`（244×414）、`prop-cell.png`（49×52）、`prop-cell-over.png` | `.room-props`；`.room-cells-3` = `ddtMaterials`（Z/X/C）；`.room-cells-8` = `ddtWeaponList` | 原版贴身道具 / 战斗道具箱是真实道具；网页复用材料与武器实例 | 格子布局还原；点击武器仍走 `data-action="weapon"` → `equipWeapon()` |
| 7 | `room.xml`: `asset.room.ViewerBg*`、`ViewerClose`、`ViewerWaiting`；观战位 | `viewer-{l,m,r,close}.png` | `.room-props` 下半部 `.room-viewer-x` | 原版可放入观战玩家 | 保留观战框外观，无多人观战逻辑 |
| 8 | `MatchRoomSetView.as` / `chooseMap/`；`room.xml`: `matchRoomSmallMapInfoPanel x=505 y=425`、`roomSmallMapPanelBgAsset`（244×119）、`10secondsAsset x=43 y=85`、`roomGoldText x=190 y=361` | `map-info.png`、`map-item.png`、`time-10s.png` | `.room-mapinfo`（`roomMapThumb` / `roomMapName` / `roomMapTrait` / `ddtWallet`）+ `.room-map-picker`（`ddtMapGrid`） | 原版点击小地图弹出选图框架；网页改为浮层 | 保留 `data-action="map"` → `setMap()` → 带 `?map=` 重载；金币/材料 chip 按 `roomGoldText` 位置摆放 |
| 9 | `room.xml`: `roomIDText x=89 y=-13`、`roomChanelNameText x=160 y=16`、`roomNameText x=7 y=42`、`descriptionBgAsset` | `room-type.png`、`desc-banner.png`（备用） | `.room-head`：「房间 5」「第一频道」「挑战极限，欢乐无边!」 | 原版房间号来自房间列表 | 静态展示中文版文案 |
| 10 | 房间聊天（`RoomPlayerItem` 聊天气泡 `PlayerItemChatBallPos x=110 y=100`） | — | `.room-chat`：聊天记录、当前/公会/私人竖排标签、输入行 | 原版为多人实时聊天 | 静态房间消息展示，不接聊天服务 |
| 11 | `room.xml`: `cancelButton x=877 y=417`、`inviteBtnAsset x=761 y=453`、`crossZoneBtnAsset x=815 y=451`、`startBtnAsset x=877 y=415` | `btn-invite.png`（53×72）、`btn-crosszone.png`（66×78）；取消按钮为 `cancelBtnAsset.png`（126×148，带越南语 `Hủy`） | `.room-actions`：邀请 / 跨区（→ `room-tip` 提示）；大爆炸星 `.room-start` → `data-action="start-battle"` | **语义改动**：原版该位置是「取消/退出房间」，网页版改为开始战斗入口；按钮图形用 CSS `clip-path` 自绘以避开越南语 | 保留视觉形状与位置，功能改为 `startBattle()`；未接入的邀请/跨区明确提示而非静默无响应 |
| 12 | 底部工具栏（`room.xml` 中 RoomToolBar 9 按钮，y≈547） | — | `.room-footbar`：充值 / 商城 / 背包 / 邮件 / 任务 / 社交 / 签到 / 更多 / 返回 | 原版各按钮拉起对应面板；网页单机版仅「背包」有实现 | 「背包」→ `data-action="open-forge"` 打开铁匠铺；其余 → `room-tip` 说明未接入 |
| 13 | `roomLoading/RoomLoadingState.as` + `RoomLoadingView.as` / `VersusItem` / `BattleFieldItem` / `CharacterItem` | `room.swf` → `asset.roomLoading.*`（项目原有 `dist/assets/ui/load-*.png`） | `dist/index.html` 的 `#loading`（本次未改） | 原版从房间进加载态再入战斗 | 沿用现有加载界面；`startBattle()` 仍 `hideLayer()` 进入战斗 |
| 14 | `Game.Server/Rooms/RoomMgr.cs`、`GameRoom/AbstractGameRoomProcessor.cs` | — | `server-node/src/services.ts`、`api.ts`（本次未改） | 原版 C# 房间命令；网页为 Node/SQLite 单机房间 | 不改服务端 |

---

## 2. 落地文件清单

| 文件 | 变更 |
|---|---|
| `dist/index.html` | 新增 `<link rel="stylesheet" href="styles-room.css?v=35">` |
| `dist/js/server-mode.js` | `buildLayer()` 中 `.ddt-room` 结构换成经典布局（保留全部 id / `data-action`）；`renderRoom()` 适配新容器 + 房间信息/地图预览；新增 `fitRoom()`、`room-tip`/地图浮层分支、`ROOM_WEAPON_ICONS`；`showLayer()` 加 `room-mode` 与自适应缩放 |
| `dist/styles-room.css` | 新建，仅作用于 `.ddt-room.room-classic` |
| `dist/assets/room/*.png` | 新建 35 张原版导出/处理素材 |
| `docs/ROOM_LAYOUT_MAPPING.md` | 本文档 |

`dist/styles.css`、`dist/js/main.js`、`server-node/**`、战斗 HUD、铁匠铺逻辑均未改动。

---

## 3. 验证记录（2026-11-28）

- `node --check dist/js/server-mode.js` 通过
- `tsc --noEmit -p server-node/tsconfig.json` 通过
- `boom` 起服务 → `GET /?map=<current>&mode=server` → HTTP 200、`/api/server/config` 正常
- Puppeteer + Chrome 无头截图（1400×900）：`ddtRoom` 1000×690、4 个玩家位、3 个贴身道具格、15 个武器格、12 张可选地图、房间层可见
- 交互冒烟：地图选择器开/关 ✓；背包 → 铁匠铺 → 返回房间 ✓；`room-tip` 状态提示 ✓；武器格切换 `equipWeapon()` ✓
- 控制台：`pageErrors = []`、`404 = []`
- 测试过程中临时切换的装备已恢复为「水果篮」

---

## 4. 明确未还原 / 已知差异

1. **多人能力**：玩家位开/关、踢人、邀请、跨区、观战、公会、实时聊天、撮合倒计时，均为外观还原，单机服务端没有对应逻辑；点击后给出明确提示或静态展示。
2. **取消按钮语义**：原版大爆炸按钮是退出房间，网页版改为「开始战斗」，因为该版本没有房间列表可退。
3. **文字**：素材来自越南语版 `room.swf`，越南语文案已擦除并用中文 DOM 替代；少量图标内嵌小字（邀请/跨区按钮）保留原图，未逐像素清理。
4. **人物**：房主位使用项目现有 `portrait-player.png`，并非原版 `RoomCharacter` / `RoomCharaterLoader` 的装备合成角色；未移植 Flash 人物换装系统。
5. **底部刻度条 0–10** 与顶部竹木横梁为 CSS 装饰（截图可见），不对应力度条逻辑。
6. 房间音乐沿用已有 `bgm-room-065.mp3`，未重新从 `065.flv` 转换；未与 `audio.swf` 按钮短音效混淆。
