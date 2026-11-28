/**
 * 服务端版 UI 层：个人房间、房间内铁匠铺、战后九宫格翻牌接入。
 *
 * 这不是第二套前端：战斗画面、HUD、Canvas 渲染、手机横屏控件全部沿用
 * 现有 dist/ 站点版。本文件只叠加房间/铁匠铺覆盖层，并把结算翻牌切到
 * 统一数据访问接口 dataApi 的 server 实现。
 *
 * 素材说明：
 *  - 房间背景 / 角色 / 地图框 / 结算卡片：均为仓库已导出的原版 room.swf、
 *    gameover.swf 素材（dist/assets/ui/、dist/assets/map-*-thumb.jpg）。
 *  - 铁匠铺：阶段 9 起使用旧版对照库 store.swf 导出的原版红金色素材
 *    （dist/assets/forge/），按 store.xml 的 Strengthpoint0..5 点位摆放
 *    **真实 DOM 槽位**，支持点选 / 拖放，背景图不覆盖任何交互。
 *    阶段 10 起统一采用「原版素材 + 单机自定义强化规则」(SIMPLE_LOCAL_V1)：
 *    +0 ~ +12、每次 1 颗真强化石 + 100×目标等级金币、成功率 100%、
 *    基础伤害 = 未强化基础伤害 × (1 + 0.10 × 强化等级)。
 *    界面 / 素材 / 动画 / 音效来自原版，强化算法不是原版强化算法；
 *    1/2 号强化石槽、3 神恩符槽、4 幸运符槽在单机规则下置灰禁用。
 */
import { dataApi } from './data-api.js?v=33';

const $ = (id) => document.getElementById(id);
const params = new URLSearchParams(location.search);

const state = {
  layer: null,
  room: null,
  forge: null,
  currentBattleId: null,
  selectedForgeWeapon: null,
  selectedForgeItem: '',
  /** 原版 StoreBag 槽位 0/1/2 强化石、3 神恩符、4 幸运符、5 待强化装备。 */
  forgeSlots: [null, null, null, null, null, null],
  activeSlot: null,
  forgeResult: null,
  cardTimer: 0,
  forgeOpen: false,
};

function esc(text) {
  return String(text ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}

function fmt(n) { return Number(n || 0).toLocaleString('zh-CN'); }

function stoneTotal(wallet) {
  return (wallet?.items || []).reduce((sum, i) => sum + Number(i.quantity || 0), 0);
}

/** dist/assets/weapon-*.png 中确实存在的图标；翻牌奖励武器无对应图，只显示文字。 */
const ROOM_WEAPON_ICONS = new Set([
  'appliance', 'axe', 'bow', 'brick', 'cannon', 'fire', 'fruit', 'goldgun',
  'gun', 'scalpel', 'thunder', 'toilet', 'wind', 'bazooka3',
]);

/** 顶部钱包 chip 始终显示服务端余额（刷新/重启后一致）。 */
export function paintWalletChips(wallet) {
  if (!wallet) return;
  const coins = $('walletCoins');
  const stones = $('walletStones');
  const coinCount = Number(wallet.coins || 0);
  const stoneCount = stoneTotal(wallet);
  if (coins) coins.textContent = fmt(coinCount);
  if (stones) stones.textContent = fmt(stoneCount);
  $('walletCoinsChip')?.setAttribute('aria-label', `金币 ${coinCount}`);
  $('walletStonesChip')?.setAttribute('aria-label', `材料 ${stoneCount}`);
  dataApi.wallet = wallet;
}

function buildLayer() {
  const layer = document.createElement('div');
  layer.id = 'ddtServerLayer';
  layer.className = 'ddt-layer';
  layer.innerHTML = `
    <!-- 经典对战房间：布局按 Gunny room.xml 组件坐标 + 用户提供的原版截图。
         素材为 room.swf 经 FFDec 导出（dist/assets/room/），越南语文案已擦除并改为中文 DOM。
         全部原有 id / data-action 保留，房间/铁匠铺/战斗的数据流不变。 -->
    <section class="ddt-room room-classic" id="ddtRoom" aria-label="对战房间">
      <div class="room-beam"></div>
      <div class="room-shell"></div>
      <div class="room-ruler">
        <span>0</span><span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
        <span>6</span><span>7</span><span>8</span><span>9</span><span>10</span>
      </div>

      <!-- 左侧 2×2 玩家位（room.xml: asset.room.roomBg 408×425） -->
      <div class="room-seats">
        <div class="room-seat is-host">
          <img class="room-seat-bg" src="assets/room/seat-red.png?v=35" alt="">
          <div class="room-seat-host-top">
            <span class="room-seat-guild">公会 · 风场弹道</span>
            <span class="room-seat-icons">VIP</span>
          </div>
          <div class="room-seat-avatar"><img src="assets/portrait-player.png?v=35" alt="玩家头像"></div>
          <div class="room-seat-name" id="ddtPlayerName">本地玩家</div>
          <div class="room-seat-equip" id="ddtEquipped"></div>
          <span class="room-seat-lv">Lv44</span>
          <span class="room-seat-host">房主</span>
        </div>
        <div class="room-seat is-closed">
          <img class="room-seat-bg" src="assets/room/seat-closed.png?v=35" alt="">
          <span class="room-seat-caption">点击关闭</span>
        </div>
        <div class="room-seat">
          <img class="room-seat-bg" src="assets/room/seat-open.png?v=35" alt="">
          <span class="room-seat-caption">点击开启</span>
        </div>
        <div class="room-seat">
          <img class="room-seat-bg" src="assets/room/seat-open.png?v=35" alt="">
          <span class="room-seat-caption">点击开启</span>
        </div>
      </div>

      <!-- 中间撮合大图（room.xml: matchRoomBigMapInfoPanel x=418 y=5） -->
      <div class="room-match">
        <img class="room-match-art" src="assets/room/match-preview.png?v=35" alt="战斗预告">
        <div class="room-match-bar">
          <div class="room-free-box"><img src="assets/room/icon-free.png?v=35" alt=""><b>自由战</b></div>
          <b class="room-count" id="roomCount">03</b>
          <span class="room-matching">撮合中，请等待…</span>
        </div>
      </div>

      <!-- 右侧房间标题（room.xml: roomIDText / roomChanelNameText / roomNameText） -->
      <div class="room-head">
        <div class="room-head-title">房间 <b>5</b><span class="room-channel">第一频道</span></div>
        <div class="room-slogan">挑战极限，欢乐无边!</div>
      </div>

      <!-- 右侧道具栏（room.xml: RoomRightPropView x=762 y=15；upCellsContainer / downCellsContainer） -->
      <div class="room-props">
        <img class="room-props-bg" src="assets/room/right-props.png?v=35" alt="">
        <div class="room-props-title t1">贴身道具</div>
        <div class="room-cells-3" id="ddtMaterials"></div>
        <div class="room-props-title t2">战斗道具箱</div>
        <div class="room-cells-8" id="ddtWeaponList"></div>
        <div class="room-props-title t3">观战</div>
        <div class="room-viewer-x">×</div>
      </div>

      <!-- 邀请 / 跨区 / 开始（原版 cancelBtnAsset 位，改为开始战斗入口） -->
      <div class="room-actions">
        <button class="room-mini-btn invite" type="button" data-action="room-tip"
                data-tip="邀请好友：服务端单机版暂未接入多人房间">
          <img src="assets/room/btn-invite.png?v=35" alt=""><span>邀请</span></button>
        <button class="room-mini-btn cross" type="button" data-action="room-tip"
                data-tip="跨区：服务端单机版暂未接入跨区匹配">
          <img src="assets/room/btn-crosszone.png?v=35" alt=""><span>跨区</span></button>
        <button class="room-start" type="button" data-action="start-battle" title="开始战斗" aria-label="开始战斗">
          <span class="room-star"></span><span class="room-start-label">开始</span>
        </button>
        <span class="room-start-tip">进入战斗</span>
        <div class="room-bot" id="ddtBot"></div>
        <button class="room-cards ddt-btn ddt-btn-continue" type="button"
                data-action="continue-cards" hidden>继续翻牌</button>
      </div>

      <!-- 左下聊天框 -->
      <div class="room-chat">
        <div class="room-chat-log">
          <p class="sys">[当前] 欢迎来到风场弹道对战房间</p>
          <p class="sys">[当前] 熊取天：在撮合</p>
          <p>[当前] 无味布布：在的</p>
          <p class="gift">[当前] 天马行空：欢迎</p>
          <p>您获得了 550 金币</p>
          <p class="sys">好友 [火小鸡] 上线了</p>
        </div>
        <div class="room-chat-tabs">
          <span class="is-active">当前</span><span>公会</span><span>私人</span>
        </div>
        <div class="room-chat-input"><b>当前</b><i></i><em>发送</em><em>表情</em></div>
      </div>

      <!-- 中下房间信息（room.xml: matchRoomSmallMapInfoPanel x=505 y=425） -->
      <div class="room-mapinfo">
        <div class="room-mapinfo-title">房间信息</div>
        <button class="room-map-thumb" type="button" data-action="toggle-map-picker" title="点击选择地图">
          <img id="roomMapThumb" src="assets/map-1156-thumb.jpg?v=35" alt="当前地图">
        </button>
        <span class="room-map-badge">全部</span>
        <div class="room-map-name" id="roomMapName">随机地图</div>
        <div class="room-map-time"><img src="assets/room/time-10s.png?v=35" alt="">10 秒</div>
        <div class="room-map-trait" id="roomMapTrait">原版 · 竞技主场</div>
        <!-- 原版 roomGoldText (room.xml x=190 y=361) 对应房间钱包 -->
        <div class="ddt-wallet" id="ddtWallet"></div>
      </div>
      <div class="room-map-picker" id="roomMapPicker" hidden>
        <div class="room-map-picker-head">
          <b>选择地图</b>
          <button type="button" data-action="close-map-picker" aria-label="关闭地图选择">×</button>
        </div>
        <div class="ddt-map-grid" id="ddtMapGrid"></div>
      </div>

      <!-- 底部功能条（原版 RoomToolBar 9 个按钮；背包接入铁匠铺） -->
      <div class="room-footbar">
        <button class="room-tool" type="button" data-action="room-tip" data-tip="充值：服务端单机版暂未接入商城"><i>充</i>充值</button>
        <button class="room-tool" type="button" data-action="room-tip" data-tip="商城：服务端单机版暂未接入商城"><i>商</i>商城</button>
        <button class="room-tool is-action" type="button" data-action="open-forge" title="打开铁匠铺"><i>包</i>背包</button>
        <button class="room-tool" type="button" data-action="room-tip" data-tip="邮件：服务端单机版暂未接入邮件"><i>邮</i>邮件</button>
        <button class="room-tool" type="button" data-action="room-tip" data-tip="任务：服务端单机版暂未接入任务"><i>任</i>任务</button>
        <button class="room-tool" type="button" data-action="room-tip" data-tip="社交：服务端单机版暂未接入好友"><i>社</i>社交</button>
        <button class="room-tool" type="button" data-action="room-tip" data-tip="签到：服务端单机版暂未接入签到"><i>签</i>签到</button>
        <button class="room-tool" type="button" data-action="room-tip" data-tip="更多：暂无额外功能"><i>多</i>更多</button>
        <button class="room-tool" type="button" data-action="room-tip" data-tip="返回：从战斗结算返回房间即可"><i>返</i>返回</button>
      </div>

      <p class="ddt-status room-status" id="ddtStatus"></p>
    </section>

    <section class="ddt-forge" id="ddtForge" aria-label="铁匠铺" hidden>
      <div class="ddt-forge-frame" data-asset-slot="forge-panel">
        <header class="ddt-forge-head">
          <div><h2>铁匠铺 · 武器强化</h2>
            <p class="ddt-asset-note">原版 store.swf 红金色素材 · 槽位/按钮为真实可交互 DOM · 当前为「原版素材 + 单机自定义强化规则」，<b>不是原版强化算法</b></p></div>
          <div class="ddt-forge-head-actions">
            <button class="ddt-btn ddt-btn-ghost" type="button" data-action="forge-volume" data-volume="0.12">音量 低</button>
            <button class="ddt-btn ddt-btn-ghost" type="button" data-action="forge-volume" data-volume="0.22">音量 中</button>
            <button class="ddt-btn ddt-btn-ghost" type="button" data-action="forge-volume" data-volume="0">静音</button>
            <button class="ddt-btn ddt-btn-ghost" type="button" data-action="close-forge">关闭，返回房间</button>
          </div>
        </header>
        <div class="ddt-forge-rule-top" id="ddtForgeRuleTop"></div>
        <div class="ddt-forge-body">
          <div class="ddt-strength-stage" id="ddtStrengthStage">
            <img class="ddt-strength-bg" src="assets/forge/store-strength-bg.jpg?v=34" alt="原版强化台背景" draggable="false">
            <div class="ddt-strength-cells" id="ddtStrengthCells"></div>
            <div class="ddt-success-rate" id="ddtSuccessRate"></div>
            <button class="ddt-strength-btn" type="button" data-action="strengthen" id="ddtStrengthBtn"
                    aria-label="确认强化" title="确认强化（原版 store.StrengthBtn）">
              <img src="assets/forge/btn-strength.png?v=34" alt="">
            </button>
            <div class="ddt-forge-result-art" id="ddtForgeResultArt" hidden></div>
          </div>
          <aside class="ddt-forge-side">
            <div class="ddt-forge-col">
              <h3><img src="assets/forge/tab-equip.png?v=34" alt="">装备栏（点击放入 5 号槽）</h3>
              <div class="ddt-forge-weapons" id="ddtForgeWeapons"></div>
            </div>
            <div class="ddt-forge-col">
              <h3><img src="assets/forge/tab-prop.png?v=34" alt="">道具栏（点击放入选中槽 / 拖到槽位）</h3>
              <div class="ddt-forge-bag" id="ddtForgeBag"></div>
            </div>
            <div class="ddt-forge-col ddt-forge-detail">
              <h3>强化预览</h3>
              <div id="ddtForgeDetail"></div>
              <div class="ddt-forge-rule" id="ddtForgeRule"></div>
            </div>
          </aside>
        </div>
        <p class="ddt-forge-result" id="ddtForgeResult"></p>
      </div>
    </section>
  `;
  document.body.appendChild(layer);
  state.layer = layer;
  layer.addEventListener('click', onLayerClick);
  // 原版 StoreDragInArea / DragManager 的拖放语义保留，但交付规则每次只需 1 颗强化石：
  // 只有 0 号强化石槽与 5 号装备槽接受拖放，其余槽位及符咒/合成石一律拒绝。
  layer.addEventListener('dragstart', (event) => {
    const item = event.target.closest('[data-action="forge-bag-item"], [data-action="forge-weapon"]');
    if (!item || item.disabled) { event.preventDefault(); return; }
    const payload = item.dataset.action === 'forge-weapon'
      ? { kind: 'weapon', key: item.dataset.weapon }
      : { kind: item.dataset.kind, key: item.dataset.item };
    if (payload.kind !== 'strength-stone' && payload.kind !== 'weapon') {
      event.preventDefault(); return;
    }
    event.dataTransfer.setData('text/plain', JSON.stringify(payload));
    event.dataTransfer.effectAllowed = 'move';
  });
  layer.addEventListener('dragover', (event) => {
    const slot = event.target.closest('.ddt-slot');
    if (!slot || slot.disabled) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = 'move';
    slot.classList.add('is-drop-target');
  });
  layer.addEventListener('dragleave', (event) => {
    event.target.closest('.ddt-slot')?.classList.remove('is-drop-target');
  });
  layer.addEventListener('drop', (event) => {
    const slotEl = event.target.closest('.ddt-slot');
    if (!slotEl || slotEl.disabled) return;
    event.preventDefault();
    slotEl.classList.remove('is-drop-target');
    let payload;
    try { payload = JSON.parse(event.dataTransfer.getData('text/plain')); } catch { return; }
    const index = Number(slotEl.dataset.slot);
    const def = SLOT_LAYOUT[index];
    if (!def?.enabled || def.kind !== payload.kind) {
      setStatus('该槽位已禁用或道具类型不匹配（当前单机规则每次只需 1 颗真强化石）', true);
      return;
    }
    state.forgeSlots[index] = payload.key;
    state.activeSlot = null;
    if (payload.kind === 'weapon') state.selectedForgeWeapon = payload.key;
    renderForge(state.forge);
    setStatus(`已拖入 ${def.label}：${payload.key}`);
  });

  fitRoom();
  window.addEventListener('resize', fitRoom);
}

/** 原版房间舞台约 1000×600，此处为 1000×690；按视口等比缩放保证完整可见。 */
function fitRoom() {
  const el = $('ddtRoom');
  if (!el || !el.classList.contains('room-classic')) return;
  const scale = Math.min(1, (window.innerWidth - 24) / 1000, (window.innerHeight - 24) / 690);
  el.style.setProperty('--room-scale', String(Math.max(0.28, scale)));
}

function renderRoom(room) {
  if (!room) return;
  state.room = room;
  paintWalletChips(room.wallet);
  $('ddtPlayerName').textContent = room.playerName || '本地玩家';

  $('ddtWallet').innerHTML = `
    <span class="ddt-chip"><img src="assets/ui/icon-gold.png?v=33" alt=""><b>${fmt(room.wallet.coins)}</b><small>金币</small></span>
    <span class="ddt-chip"><img src="assets/ui/icon-stones.png?v=33" alt=""><b>${fmt(stoneTotal(room.wallet))}</b><small>材料</small></span>`;

  $('ddtEquipped').innerHTML = `
    <div class="ddt-label">当前武器</div>
    <div class="ddt-equipped-name">${esc(room.equipped.label)} <span>+${room.equipped.level}</span></div>
    <div class="ddt-attr">基础伤害 ${fmt(room.equipped.attackPrecise ?? room.equipped.attack)} · 强化等级 +${room.equipped.level}</div>`;

  // 原版「贴身道具」只有 3 格（Z/X/C），只取前三种材料；完整背包仍在铁匠铺里。
  $('ddtMaterials').innerHTML = `
    <div class="ddt-label">主要材料</div>
    <div class="ddt-mat-row">${room.wallet.items.slice(0, 3).map((i) => `
      <span class="ddt-mat" title="TemplateID ${i.templateId ?? '—'}">
        <img src="${esc(i.icon)}?v=33" alt="" draggable="false"><b>${fmt(i.quantity)}</b><small>${esc(i.name)}</small>
      </span>`).join('')}</div>`;

  $('ddtMapGrid').innerHTML = room.maps.map((m) => `
    <button class="ddt-map ${m.id === room.mapId ? 'is-active' : ''}" type="button"
            data-action="map" data-map="${esc(m.id)}" aria-label="选择地图 ${esc(m.name)}">
      <img src="${esc(m.thumb)}?v=33" alt="" loading="lazy" draggable="false">
      <span>${esc(m.name)}</span><small>${esc(m.trait)}</small>
    </button>`).join('');

  $('ddtBot').innerHTML = `
    <div class="ddt-label">弱机器人（服务端固定规则）</div>
    <div class="ddt-bot-row"><img src="assets/ui/load-char-red.png?v=33" alt="" draggable="false">
      <div><b>${esc(room.bot.label)}</b><small>角度 ${room.bot.angle}° · 力度 ${room.bot.force} · 攻击倍率 ${room.bot.attackScale}</small>
      <small>不接大模型 · 无必中与额外伤害</small></div></div>`;

  // 战斗道具箱格子用原版武器图标（assets/weapon-<weaponId>.png），
  // 与 RoomPlayerItem / WeaponInfo 的武器展示语义一致；文字保留在 title 与底部小字。
  // 翻牌奖励等特殊武器（如 hq_brick）没有对应图标，只显示文字，避免 404。
  $('ddtWeaponList').innerHTML = `
    <div class="ddt-label">房间内选择武器</div>
    <div class="ddt-weapon-row">${room.weapons.map((w) => `
      <button class="ddt-weapon ${w.equipped ? 'is-active' : ''}" type="button"
              data-action="weapon" data-weapon="${esc(w.id)}" title="${esc(w.label)} 强化 +${w.level}">
        ${ROOM_WEAPON_ICONS.has(w.weaponId) ? `<img src="assets/weapon-${esc(w.weaponId)}.png?v=35" alt="">` : ''}
        <span>${esc(w.label)}</span><small>+${w.level}</small></button>`).join('')}</div>`;

  const continueBtn = state.layer.querySelector('[data-action="continue-cards"]');
  if (continueBtn) {
    const pending = room.pendingReward;
    continueBtn.hidden = !pending || pending.picksUsed >= pending.maxPicks;
    if (pending) continueBtn.textContent = `继续翻牌（${pending.picksUsed}/${pending.maxPicks}）`;
  }
  $('ddtStatus').textContent = room.status === 'result' && room.pendingReward
    ? '上一局奖励尚未翻完，回房间后可继续领取'
    : `当前地图：${esc(room.mapName)} · ${room.maps.length} 张可选`;

  // 房间信息面板（对应原版 smallMapInfoPanel 的地图预览 / 名称 / 10 秒出手时间）。
  const currentMap = room.maps.find((m) => m.id === room.mapId);
  const thumb = $('roomMapThumb');
  if (thumb && currentMap?.thumb) thumb.src = `${currentMap.thumb}?v=35`;
  const mapName = $('roomMapName');
  if (mapName) mapName.textContent = currentMap?.name || room.mapName || '随机地图';
  const mapTrait = $('roomMapTrait');
  if (mapTrait) mapTrait.textContent = currentMap?.trait || room.mapName || '';
}

/**
 * store.xml:215-220 的 Strengthpoint0..5，坐标仍是原版实测值。
 * 交付规则为「原版素材 + 单机自定义强化规则」：每次只需 1 颗强化石，
 * 因此只有 0 号强化石槽与 5 号装备槽启用；1/2 号强化石槽、3 神恩符槽、
 * 4 幸运符槽置灰并说明原因（物品仍保留在背包，不消耗、不删除）。
 */
const SLOT_LAYOUT = [
  { index: 0, x: 106, y: -6, kind: 'strength-stone', label: '强化石', frame: 'slot-strength.png', enabled: true },
  { index: 1, x: 206, y: 95, kind: 'strength-stone', label: '强化石 2', frame: 'slot-strength.png', enabled: false, why: '当前单机规则每次只需 1 颗强化石' },
  { index: 2, x: 106, y: 195, kind: 'strength-stone', label: '强化石 3', frame: 'slot-strength.png', enabled: false, why: '当前单机规则每次只需 1 颗强化石' },
  { index: 3, x: 6, y: 141, kind: 'god-charm', label: '神恩符', frame: 'slot-god.png', enabled: false, why: '当前单机规则无需使用神恩符，物品保留' },
  { index: 4, x: 6, y: 49, kind: 'lucky-charm', label: '幸运符', frame: 'slot-lucky.png', enabled: false, why: '当前单机规则无需使用幸运符，物品保留' },
  { index: 5, x: 123, y: 111, kind: 'weapon', label: '待强化装备', frame: 'slot-equip.png', enabled: true },
];

/** 把 forge.materials 的原版字段并回钱包条目。 */
function forgeItemLookup(forge) {
  const m = forge.materials || {};
  const decorated = [
    ...(m.strengthStones || []), ...(m.luckyCharms || []),
    ...(m.godCharms || []), ...(m.composeStones || []),
  ];
  const byKey = new Map(decorated.map((i) => [i.itemKey, i]));
  return (key) => {
    const base = (forge.wallet?.items || []).find((i) => i.itemKey === key);
    return base ? { ...base, ...(byKey.get(key) || {}) } : null;
  };
}

function slotAccepts(index, kind) {
  const def = SLOT_LAYOUT[index];
  return !!def?.enabled && def.kind === kind;
}

function renderSlots(forge) {
  const get = forgeItemLookup(forge);
  $('ddtStrengthCells').innerHTML = SLOT_LAYOUT.map((s) => {
    const val = s.enabled ? state.forgeSlots[s.index] : null;
    let inner = '<span class="ddt-slot-empty">空</span>';
    if (val && s.kind === 'weapon') {
      const w = forge.weapons.find((x) => x.id === val);
      inner = `<span class="ddt-slot-weapon">${esc(w?.label || '装备')}<small>+${w?.level ?? 0}</small></span>`;
    } else if (val) {
      const item = get(val);
      if (item) inner = `<img src="${esc(item.icon)}?v=34" alt=""><span>${esc(item.name)}</span>`;
    }
    const cls = ['ddt-slot', val ? 'is-filled' : '',
      state.activeSlot === s.index ? 'is-active' : '',
      s.enabled ? '' : 'is-disabled'].filter(Boolean).join(' ');
    const title = s.enabled
      ? `${s.label} · store.xml Strengthpoint${s.index} (${s.x}, ${s.y})`
      : `${s.label} · 已禁用：${s.why}`;
    return `<button class="${cls}" type="button" data-action="forge-slot" data-slot="${s.index}"
        data-accept="${s.kind}" ${s.enabled ? '' : 'disabled aria-disabled="true"'}
        style="--sx:${s.x}px;--sy:${s.y}px" title="${esc(title)}"
        aria-label="${esc(s.label)}${val ? '（已放入，点击移除）' : (s.enabled ? '（点击选中后可放入道具）' : '（已禁用）')}">
        <img class="ddt-slot-frame" src="assets/forge/${s.frame}?v=34" alt="" draggable="false">
        <span class="ddt-slot-content">${inner}</span>
        <span class="ddt-slot-tag">${esc(s.enabled ? s.label : `${s.label}（禁用）`)}</span>
      </button>`;
  }).join('');
}

function renderBag(forge) {
  const usable = (i) => i.kind === 'strength-stone';
  $('ddtForgeBag').innerHTML = (forge.wallet.items || []).map((i) => {
    const ok = usable(i);
    const why = i.kind === 'compose-stone' ? '四圣兽合成石，不能作为强化材料'
      : (i.kind === 'lucky-charm' || i.kind === 'god-charm')
        ? '当前单机规则无需使用，物品保留' : '';
    return `<button class="ddt-bag-item ${ok ? '' : 'is-disabled'}" type="button"
            data-action="forge-bag-item" data-item="${esc(i.itemKey)}" data-kind="${esc(i.kind)}"
            draggable="${ok ? 'true' : 'false'}" ${ok ? '' : 'disabled'}
            title="${esc(i.name)} · TemplateID ${i.templateId ?? '—'} · ${esc(i.kind)}${why ? ` · ${esc(why)}` : ''}">
      <img src="${esc(i.icon)}?v=34" alt="" draggable="false"><b>${fmt(i.quantity)}</b>
      <small>${ok ? esc(i.name) : (i.kind === 'compose-stone' ? '合成石' : '无需使用')}</small>
    </button>`;
  }).join('');
}

function renderSuccessRate(forge, weapon) {
  const placed = state.forgeSlots[0] ? 1 : 0;
  $('ddtSuccessRate').innerHTML = `
    <img src="assets/forge/rate-label.png?v=34" alt="">
    <div class="ddt-rate-body"><span>成功率</span><b>100%</b>
      <small>每次 1 颗真强化石 · 金币 ${fmt(weapon?.cost?.coins || 0)} · 已放入 ${placed}/1</small></div>`;
}

function renderForge(forge) {
  if (!forge) return;
  state.forge = forge;
  paintWalletChips(forge.wallet);
  const selectedId = state.forgeSlots[5] || state.selectedForgeWeapon
    || forge.weapons.find((w) => w.equipped)?.id || forge.weapons[0]?.id;
  state.selectedForgeWeapon = selectedId;
  if (!state.forgeSlots[5] && selectedId) state.forgeSlots[5] = selectedId;
  // 单机规则只保留 0 号材料槽，其它槽位一律清空，不参与提交。
  for (const i of [1, 2, 3, 4]) state.forgeSlots[i] = null;
  const weapon = forge.weapons.find((w) => w.id === state.forgeSlots[5]) || forge.weapons[0];

  $('ddtForgeWeapons').innerHTML = forge.weapons.map((w) => `
    <button class="ddt-forge-weapon ${w.id === state.forgeSlots[5] ? 'is-active' : ''}" type="button"
            data-action="forge-weapon" data-weapon="${esc(w.id)}" draggable="true">
      <span>${esc(w.label)}</span><small>+${w.level} · 基础伤害 ${fmt(w.attackPrecise ?? w.attack)}</small>
    </button>`).join('');

  renderSlots(forge);
  renderBag(forge);
  renderSuccessRate(forge, weapon);

  const label = forge.ruleLabel || '原版素材 + 单机自定义强化规则';
  $('ddtForgeRuleTop').innerHTML = `
    <b>${esc(label)}</b>
    <span> · 规则来源 ${esc(forge.ruleSource)}</span>
    <span> · 上限 +${esc(String(forge.maxLevel))}</span>
    <span> · 成功率 100%</span>
    <span> · 每次 1 颗真强化石</span>`;
  $('ddtForgeRule').innerHTML = `
    <div class="ddt-label">${esc(label)}</div>
    <p>${esc(forge.ruleNote)}</p>
    <p class="ddt-hint">伤害公式：${esc(forge.damageFormula || '最终基础伤害 = 未强化基础伤害 × (1 + 0.10 × 强化等级)')}</p>
    <p class="ddt-hint">${esc(forge.disabledSlotNote || '')}</p>
    ${forge.composeStoneNote ? `<p class="ddt-hint">${esc(forge.composeStoneNote)}</p>` : ''}
    ${forge.weaponNameStatus ? `<p class="ddt-hint">翻牌武器：${esc(forge.weaponNameStatus)}</p>` : ''}
    <p class="ddt-asset-note">铁匠铺界面 / 素材 / 动画 / 音效来自原版 store.swf；强化算法是本项目自定的单机规则，<b>不是原版强化算法</b>。</p>`;

  if (weapon) {
    const cost = weapon.cost || {};
    const atMax = weapon.atMax ?? !weapon.canStrengthen;
    const reason = weapon.reason;
    $('ddtForgeDetail').innerHTML = `
      <div class="ddt-detail-name">${esc(weapon.label)}</div>
      <dl>
        <dt>当前等级</dt><dd>+${weapon.level}</dd>
        <dt>目标等级</dt><dd>${atMax ? '—' : `+${cost.targetLevel ?? weapon.level + 1}`}</dd>
        <dt>当前基础伤害</dt><dd>${fmt(weapon.attackPrecise ?? weapon.attack)}</dd>
        <dt>强化后基础伤害</dt><dd class="is-good">${atMax ? '已达上限' : fmt(cost.nextAttackPrecise ?? cost.nextAttack)}</dd>
        <dt>未强化基础值</dt><dd>${fmt(weapon.baseAttack)}</dd>
        <dt>消耗金币</dt><dd>${atMax ? '—' : fmt(cost.coins)}（持有 ${fmt(forge.coinsNow ?? 0)}）</dd>
        <dt>消耗材料</dt><dd>${atMax ? '—' : `${fmt(cost.stones ?? 1)} 颗真强化石`}（持有 ${fmt(forge.availableStones ?? 0)}）</dd>
        <dt>成功率</dt><dd>${atMax ? '—' : '100%'}</dd>
        <dt>上限</dt><dd>+${weapon.maxLevel}</dd>
        <dt>规则版本</dt><dd>${esc(weapon.ruleVersion || forge.ruleSource)}</dd>
      </dl>
      ${atMax ? `<p class="ddt-hint">已达 +${weapon.maxLevel} 上限，不能继续强化。</p>` : ''}
      ${reason && !atMax ? `<p class="ddt-reason">当前不可强化：${esc(reason)}</p>` : ''}`;
  }
  // 上限才彻底禁用按钮；金币/材料不足时保持可点击，由服务端返回明确原因，
  // 前端同时把原因显示在预览区，避免「按钮灰掉但不知道为什么」。
  const btn = $('ddtStrengthBtn');
  if (btn) btn.disabled = !!weapon?.atMax;
}

async function onLayerClick(event) {
  const target = event.target.closest('[data-action]');
  if (!target) return;
  const action = target.dataset.action;
  try {
    if (action === 'room-tip') {
      setStatus(target.dataset.tip || '服务端单机版暂未接入该功能');
      return;
    }
    if (action === 'toggle-map-picker') {
      const picker = $('roomMapPicker');
      if (picker) picker.hidden = !picker.hidden;
      return;
    }
    if (action === 'close-map-picker') {
      const picker = $('roomMapPicker');
      if (picker) picker.hidden = true;
      return;
    }
    if (action === 'map') {
      const mapId = target.dataset.map;
      await dataApi.setMap(mapId);
      const next = new URL(location.href);
      next.searchParams.set('map', mapId);
      next.searchParams.set('mode', 'server');
      location.assign(next.href);
      return;
    }
    if (action === 'weapon') {
      renderRoom(await dataApi.equipWeapon(target.dataset.weapon));
      return;
    }
    if (action === 'open-forge') {
      state.forgeOpen = true;
      $('ddtRoom').hidden = true;
      $('ddtForge').hidden = false;
      window.__GUNNY_HOOKS__?.audioPause?.();
      renderForge(await dataApi.getForge());
      return;
    }
    if (action === 'close-forge') {
      state.forgeOpen = false;
      $('ddtForge').hidden = true;
      $('ddtRoom').hidden = false;
      window.__GUNNY_HOOKS__?.audioResume?.();
      renderRoom(await dataApi.getRoom());
      return;
    }
    if (action === 'forge-weapon') {
      state.selectedForgeWeapon = target.dataset.weapon;
      state.forgeSlots[5] = target.dataset.weapon;
      renderForge(state.forge);
      return;
    }
    if (action === 'forge-slot') {
      const index = Number(target.dataset.slot);
      const def = SLOT_LAYOUT[index];
      if (!def?.enabled) {
        setStatus(`该槽位已禁用：${def?.why || '当前单机规则无需使用'}`, true);
        return;
      }
      if (state.forgeSlots[index]) state.forgeSlots[index] = null;
      else state.activeSlot = state.activeSlot === index ? null : index;
      renderForge(state.forge);
      return;
    }
    if (action === 'forge-bag-item') {
      const key = target.dataset.item;
      const kind = target.dataset.kind;
      if (kind !== 'strength-stone') {
        setStatus(kind === 'compose-stone'
          ? '四圣兽合成石不能作为强化材料'
          : '当前单机规则无需使用幸运符 / 神恩符，物品保留', true);
        return;
      }
      // 只有 0 号槽接受强化石；重复点选即为替换。
      state.forgeSlots[0] = key;
      state.activeSlot = null;
      renderForge(state.forge);
      setStatus(`已放入强化石：${key}（每次只需 1 颗）`);
      return;
    }
    if (action === 'forge-volume') {
      const v = Number(target.dataset.volume);
      window.__GUNNY_HOOKS__?.audioVolume?.(v);
      setStatus(v === 0 ? '背景音乐已静音' : `背景音乐音量 ${Math.round(v * 100)}%`);
      return;
    }
    if (action === 'strengthen') {
      await doStrengthen(target);
      return;
    }
    if (action === 'start-battle') {
      await startBattle(target);
      return;
    }
    if (action === 'continue-cards') {
      await reopenSettlement();
      return;
    }
  } catch (error) {
    setStatus(`操作失败：${error.message}`, true);
  }
}

function setStatus(text, alert = false) {
  const el = $('ddtStatus');
  if (el) { el.textContent = text; el.classList.toggle('is-alert', alert); }
}

async function doStrengthen(button) {
  const forge = state.forge;
  const weaponId = state.forgeSlots[5] || state.selectedForgeWeapon;
  const weapon = forge?.weapons.find((w) => w.id === weaponId);
  if (!weapon) return;
  if (weapon.atMax || weapon.level >= weapon.maxLevel) {
    setStatus(`已达 +${weapon.maxLevel} 强化上限`, true);
    $('ddtForgeResult').textContent = `强化未完成：已达 +${weapon.maxLevel} 强化上限`;
    return;
  }
  if (weapon.reason) setStatus(`当前不可强化：${weapon.reason}（仍以服务端判定为准）`, true);
  const stoneKey = state.forgeSlots[0];
  button.disabled = true;
  const panel = $('ddtForge');
  panel.classList.remove('is-success', 'is-fail');
  try {
    const result = await dataApi.strengthen({
      weaponInstanceId: weapon.id,
      itemKey: stoneKey || undefined,
      requestId: dataApi.newRequestId(),
    });
    panel.classList.add('is-success');
    // 结果反馈沿用原版成功素材与站点版 win 音效；强化算法是单机自定义规则。
    window.__GUNNY_HOOKS__?.playSound?.('win');
    const art = $('ddtForgeResultArt');
    if (art) {
      art.hidden = false;
      art.style.backgroundImage = 'url("assets/forge/result-success.png?v=34")';
      window.clearTimeout(state.forgeResult);
      state.forgeResult = window.setTimeout(() => { art.hidden = true; }, 1600);
    }
    $('ddtForgeResult').textContent =
      `强化成功：+${result.weapon.levelBefore} → +${result.weapon.levelAfter}，` +
      `基础伤害 ${result.weapon.attackBefore} → ${result.weapon.attackAfter}` +
      `（金币 -${result.cost.coins}，消耗 ${result.cost.stones} 颗 ${result.cost.stoneName}）`;
    // 材料已消耗：清空材料槽，装备槽保留当前武器。
    state.forgeSlots = [null, null, null, null, null, weapon.id];
    state.activeSlot = null;
    state.selectedForgeWeapon = weapon.id;
    // 立即刷新背包与装备展示（服务端在同一事务返回最新钱包）。
    renderForge(await dataApi.getForge());
    renderRoom(await dataApi.getRoom());
  } catch (error) {
    // 金币不足 / 材料不足 / 上限 / 版本冲突都要明确显示，不能静默。
    const message = error?.message || '服务端拒绝该请求';
    panel.classList.add('is-fail');
    $('ddtForgeResult').textContent = `强化未完成：${message}`;
    setStatus(`强化未完成：${message}`, true);
  } finally {
    button.disabled = false;
  }
}

async function startBattle(button) {
  button.disabled = true;
  try {
    const result = await dataApi.startBattle();
    state.currentBattleId = result.battleId;
    // 原版 GameViewBase 按 LoadMapsItems.xml 的 BackMusic 播放战斗音乐；
    // 地图编号 ≠ 音乐编号（如 1157 -> 1071），映射见 audio-scenes.js。
    window.__GUNNY_HOOKS__?.audioScene?.('battle', state.room?.mapId);
    hideLayer();
    setStatus('', false);
    window.__GUNNY_HOOKS__?.playSound?.('008');
  } finally {
    button.disabled = false;
  }
}

function showLayer() {
  if (!state.layer) return;
  state.layer.hidden = false;
  state.layer.classList.add('room-mode');
  $('ddtForge').hidden = true;
  $('ddtRoom').hidden = false;
  $('roomMapPicker').hidden = true;
  state.forgeOpen = false;
  fitRoom();
  // 原版 BaseRoomState.as: playMusic("065") → dist/assets/audio/bgm-room-065.mp3。
  window.__GUNNY_HOOKS__?.audioScene?.('room');
}

function hideLayer() {
  if (state.layer) state.layer.hidden = true;
}

/** 结算弹窗「再战一局」在服务端模式下改为返回房间。 */
export async function returnToRoom() {
  const modal = $('modal');
  if (modal) { modal.hidden = true; modal.classList.remove('is-result'); }
  window.clearInterval(state.cardTimer);
  state.cardTimer = 0;
  try {
    const room = await dataApi.leaveBattle();
    renderRoom(room);
  } catch (error) {
    console.warn('[ddt] 返回房间失败', error);
  }
  showLayer();
}

/** 刷新页面后，从房间入口恢复未翻完的奖励盘。 */
export async function reopenSettlement() {
  const room = await dataApi.getRoom();
  const pending = room?.pendingReward;
  const last = room?.lastResult;
  if (!pending || !last) { setStatus('没有可继续领取的奖励盘', true); return; }
  state.currentBattleId = pending.battleId;
  const hooks = window.__GUNNY_HOOKS__;
  if (!hooks?.showResult) { setStatus('结算界面尚未就绪，请稍后重试', true); return; }
  hideLayer();
  hooks.showResult({
    winner: last.winner,
    stats: last.stats || {},
    round: last.stats?.round || 1,
    battleId: pending.battleId,
  });
}

// ---------------------------------------------------------------- 战后九宫格翻牌

function cardHtml(card) {
  return `
    <button class="result-card ${card.revealed ? 'is-flipped' : ''}" type="button"
            data-card="${card.index}" aria-label="第 ${card.index + 1} 张卡">
      <span class="card-inner">
        <span class="card-back"><img src="assets/ui/card-back.png?v=33" alt="" draggable="false"></span>
        <span class="card-flip" aria-hidden="true"></span>
        <span class="card-face">
          <img class="card-face-bg" src="assets/ui/card-face.png?v=33" alt="" draggable="false">
          <img class="card-frame" src="assets/ui/card-selected.png?v=33" alt="" draggable="false">
          <span class="ddt-card-prize"></span>
        </span>
      </span>
    </button>`;
}

function fillPrize(cardEl, reward) {
  const slot = cardEl.querySelector('.ddt-card-prize');
  if (!slot || !reward) return;
  const isCoin = reward.kind === 'coin';
  slot.innerHTML = `
    ${isCoin ? '<img class="card-gold-label" src="assets/ui/card-gold-label.png?v=33" alt="Gold" draggable="false">' : ''}
    <img class="card-icon" src="${esc(reward.icon)}?v=33" alt="" draggable="false">
    <b>+${fmt(reward.amount)}</b><small>${esc(reward.label)}</small>`;
}

/**
 * 由 main.js 的 setupResultCards 在 server 模式下调用。
 * 复用原版九宫格 DOM/CSS/卡背素材；奖励内容只有服务端翻牌后才下发。
 */
export async function renderServerCards({ resultData, sound, showToast }) {
  const row = $('cardsRow');
  const timer = $('cardsCountdown');
  const claimBtn = $('claimReward');
  const sumEl = $('rewardSum');
  const balanceEl = $('rewardBalance');
  if (!row) return;
  window.clearInterval(state.cardTimer);

  let battleId = resultData?.battleId || state.currentBattleId;
  if (!battleId) {
    try {
      const room = await dataApi.getRoom();
      battleId = room?.pendingReward?.battleId || room?.lastResult?.battleId;
    } catch { /* handled below */ }
  }
  if (!battleId) {
    row.innerHTML = '<p class="ddt-cards-error">奖励盘尚未就绪，请返回房间后重试</p>';
    return;
  }
  state.currentBattleId = battleId;

  let board;
  try { board = await dataApi.getRewards(battleId); } catch (error) {
    row.innerHTML = `<p class="ddt-cards-error">读取奖励盘失败：${esc(error.message)}</p>`;
    return;
  }

  let picksUsed = board.picksUsed;
  let closed = board.status === 'closed';
  let busy = false;
  const tally = { coins: 0, stones: 0 };
  const MAX = board.maxPicks;

  row.style.setProperty('--card-columns', '3');
  row.innerHTML = board.cards.map(cardHtml).join('');
  const cards = [...row.querySelectorAll('.result-card')];
  for (const card of cards) {
    const info = board.cards[Number(card.dataset.card)];
    if (!info?.revealed) continue;
    fillPrize(card, info.reward);
    if (info.reward?.kind === 'coin') tally.coins += Number(info.reward.amount || 0);
    else tally.stones += Number(info.reward?.amount || 0);
  }

  const refresh = () => {
    if (sumEl) sumEl.textContent = `已翻开 ${picksUsed}/${MAX} · 金币 +${fmt(tally.coins)} · 材料 +${fmt(tally.stones)}`;
    if (balanceEl && board.wallet) {
      balanceEl.textContent = `存档余额：金币 ${fmt(board.wallet.coins)} · 材料 ${fmt(stoneTotal(board.wallet))}`;
    }
  };

  const finish = (auto) => {
    window.clearInterval(state.cardTimer);
    state.cardTimer = 0;
    for (const card of cards) if (!card.classList.contains('is-flipped')) card.classList.add('is-disabled');
    if (timer) timer.textContent = auto ? '翻牌时间到 · 剩余次数可在房间继续领取' : '翻牌结束';
    showToast?.(auto ? '倒计时结束，未翻卡片可在房间继续领取' : '翻牌完成', { duration: 2200 });
  };

  if (claimBtn) {
    claimBtn.disabled = false;
    claimBtn.textContent = '返回房间 / 稍后继续翻牌';
    claimBtn.onclick = () => { returnToRoom(); };
  }
  refresh();

  if (closed) {
    for (const card of cards) card.classList.add('is-disabled');
    if (timer) timer.textContent = '本局翻牌已完成';
  } else {
    let remaining = 5;
    if (timer) timer.textContent = `翻牌倒计时 ${remaining}s`;
    // 原版 CardCountDown.as：067 起始提示 + 014 每秒滴答。
    sound?.play?.('067');
    state.cardTimer = window.setInterval(() => {
      remaining -= 1;
      if (timer) timer.textContent = `翻牌倒计时 ${Math.max(0, remaining)}s`;
      if (remaining > 0) sound?.play?.('014');
      if (remaining <= 0) finish(true);
    }, 1000);
  }

  row.onclick = async (event) => {
    const card = event.target.closest('.result-card');
    if (!card || busy || closed || card.classList.contains('is-flipped') || card.classList.contains('is-disabled')) return;
    const cardIndex = Number(card.dataset.card);
    busy = true;
    card.classList.add('is-disabled');
    const requestId = dataApi.newRequestId();
    try {
      sound?.play?.('008');
      const result = await dataApi.claimCard(battleId, cardIndex, requestId);
      sound?.play?.('048');
      card.classList.remove('is-disabled');
      card.classList.add('is-flipped');
      fillPrize(card, result.reward);
      if (result.reward?.kind === 'coin') tally.coins += Number(result.reward.amount || 0);
      else tally.stones += Number(result.reward?.amount || 0);
      picksUsed = result.picksUsed;
      closed = result.status === 'closed' || picksUsed >= MAX;
      board.wallet = result.wallet;
      paintWalletChips(result.wallet);
      refresh();
      if (balanceEl) balanceEl.textContent = `存档余额：金币 ${fmt(result.wallet.coins)} · 材料 ${fmt(stoneTotal(result.wallet))}`;
      if (closed) {
        for (const c of cards) if (!c.classList.contains('is-flipped')) c.classList.add('is-disabled');
        window.clearInterval(state.cardTimer);
        if (timer) timer.textContent = '本局翻牌已完成';
      }
    } catch (error) {
      card.classList.remove('is-disabled');
      showToast?.(`翻牌失败：${error.message}`, { alert: true });
      // 重试或并发导致的已领卡：重新同步服务端盘面，避免界面与存档不一致。
      try {
        const fresh = await dataApi.getRewards(battleId);
        const info = fresh.cards[cardIndex];
        if (info?.revealed) {
          card.classList.add('is-flipped', 'is-disabled');
          fillPrize(card, info.reward);
        }
        picksUsed = fresh.picksUsed;
        closed = fresh.status === 'closed';
        refresh();
      } catch { /* keep current view */ }
    } finally {
      busy = false;
    }
  };
}

// ---------------------------------------------------------------- 初始化

function createHooks() {
  const hooks = {
    isServerMode: () => dataApi.isServer(),
    getWallet: () => dataApi.getCachedWallet(),
    get currentBattleId() { return state.currentBattleId; },
    renderServerCards,
    returnToRoom,
    reopenSettlement,
  };
  window.__GUNNY_SERVER_UI__ = hooks;
  return hooks;
}

export async function initServerMode() {
  createHooks();
  if (!dataApi.isServer()) return; // 站点版：保持原样，不叠加任何 UI

  buildLayer();

  dataApi.on('wallet', (wallet) => paintWalletChips(wallet));
  dataApi.on('room', (room) => {
    if (!state.layer?.hidden && !state.forgeOpen && $('ddtRoom') && !$('ddtRoom').hidden) renderRoom(room);
  });
  dataApi.on('battle_start', (data) => {
    state.currentBattleId = data.battleId;
    hideLayer();
  });
  dataApi.on('battle_end', (data) => {
    state.currentBattleId = data.battleId;
  });
  dataApi.on('forge', (forge) => {
    if (state.forgeOpen) renderForge(forge);
  });

  try {
    const room = await dataApi.getRoom();
    // 前端显示层由 ?map= 决定，服务端房间状态是权威：二者不一致时统一到房间。
    const urlMap = params.get('map');
    if ((urlMap && urlMap !== room.mapId) || (!urlMap && room.mapId !== '1156')) {
      const next = new URL(location.href);
      next.searchParams.set('map', room.mapId);
      location.replace(next.href);
      return;
    }
    renderRoom(room);
    showLayer();
  } catch (error) {
    console.error('[ddt] 房间初始化失败', error);
    setStatus(`房间加载失败：${error.message}`, true);
    showLayer();
  }
}

export default { initServerMode, renderServerCards, returnToRoom, paintWalletChips };
