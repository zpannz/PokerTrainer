import { beforeAll, describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { loadData } from '../src/data/equityData.ts';
import { parseCards } from '../src/lib/cards.ts';
import { icm } from '../src/lib/icm.ts';
import { parseHandHistory } from '../src/lib/handHistory.ts';
import { applyAction, startHand } from '../src/sim/engine.ts';
import { allinEvNet } from '../src/sim/allinEv.ts';
import { blindLevels, newSession, beginHand, finishHand, type TourneyConfig, type CashConfig, bbPer100, cashProfit } from '../src/sim/session.ts';
import { playHandSync, playHandAsync, aiAct } from '../src/sim/driver.ts';
import { STYLES, STYLE_IDS, type StyleId } from '../src/sim/styles.ts';
import { seededU32 } from '../src/sim/rng.ts';
import { statLine, addStats, emptyStats } from '../src/sim/stats.ts';
import { exportHand, exportSession } from '../src/sim/history.ts';
import { reviewSession } from '../src/sim/review.ts';
import { solverView } from '../src/sim/solver.ts';
import { expandCompact, type CompactFile } from '../src/postflop/precomputed.ts';
import { canonicalFlop, suitMapping } from '../src/postflop/flops.ts';
import type { SpotProvider } from '../src/sim/solver.ts';

beforeAll(() => loadData());

/** 从仓库中的预计算文件读取（代替浏览器 fetch） */
const fileProvider: SpotProvider = async (id, flop) => {
  const idx = JSON.parse(readFileSync('public/postflop/index.json', 'utf8'));
  const sc = idx.scenarios.find((s: { id: string }) => s.id === id);
  if (!sc) return null;
  const canon = canonicalFlop(flop);
  if (!sc.flops.some((f: { flop: string }) => f.flop === canon)) return null;
  const f = JSON.parse(readFileSync(`public/postflop/${sc.dir}/${canon}.json`, 'utf8')) as CompactFile;
  return { spot: expandCompact(f), map: suitMapping(flop) };
};

const sngConfig = (size: 6 | 9, extra: Partial<TourneyConfig> = {}): TourneyConfig => ({
  kind: 'sng',
  tableSize: size,
  startStack: 1500,
  structure: 'fast',
  anteMode: 'bb',
  payouts: size === 6 ? [65, 35] : [50, 30, 20],
  styles: ['tag', 'lag', 'station', 'nit', 'gto', 'tag', 'lag', 'station'],
  ...extra,
});

describe('全下 EV 调整', () => {
  it('翻牌后全下：按剩余两张牌精确枚举', () => {
    // AsAh vs KsKh，翻牌 2c 7d 9h：KK 只有两张 K 可以赢（加上同花/顺子极少）
    const deck = [...parseCards('AsKsAhKh2c7d9h3c4d'), ...Array.from({ length: 52 }, (_, i) => i)];
    const uniq = [...new Set(deck)];
    const st = startHand({ seats: [{ seat: 0, stack: 1000 }, { seat: 1, stack: 1000 }], button: 0, sb: 5, bb: 10, ante: 0, anteMode: 'none', deck: uniq });
    applyAction(st, { type: 'call' });
    applyAction(st, { type: 'check' });
    // 翻牌：大盲（座位 1）先行动，全下，小盲跟注
    applyAction(st, { type: 'bet', to: 990 });
    applyAction(st, { type: 'call' });
    expect(st.done).toBe(true);
    expect(st.result!.allinBoard).toBe(3);
    const ev = allinEvNet(st)!;
    // 座位 0 拿 AA。KK 的胜率约 8.4%（2 张 K：2/45 + ...）
    const eqAA = (ev[0] + 1000) / 2000;
    expect(eqAA).toBeGreaterThan(0.89);
    expect(eqAA).toBeLessThan(0.93);
    expect(ev[0] + ev[1]).toBeCloseTo(0, 6);
  });
  it('翻前全下三人（含边池）：EV 合计为 0，且与实际结果的期望一致', () => {
    const deck = [...new Set([...parseCards('AsKsQsAhKhQh'), ...Array.from({ length: 52 }, (_, i) => i)])];
    const st = startHand({ seats: [{ seat: 0, stack: 300 }, { seat: 1, stack: 600 }, { seat: 2, stack: 1000 }], button: 2, sb: 5, bb: 10, ante: 0, anteMode: 'none', deck });
    applyAction(st, { type: 'raise', to: 1000 });
    applyAction(st, { type: 'call' });
    applyAction(st, { type: 'call' });
    const ev = allinEvNet(st, 20000, seededU32(1))!;
    expect(ev[0] + ev[1] + ev[2]).toBeCloseTo(0, 6);
    // AA（座位 0，300）赢主池的概率约 2/3 以上：主池 900
    expect(ev[0]).toBeGreaterThan(200);
  });
});

describe('现金桌', () => {
  it('打 300 手：筹码守恒、盈利曲线与 bb/100 一致、手牌历史可被复盘工具解析', () => {
    const u = seededU32(21);
    const cfg: CashConfig = { kind: 'cash', tableSize: 6, sb: 50, bb: 100, buyinBB: 100, styles: ['tag', 'lag', 'station', 'nit', 'gto'], hands: 300, autoTopUp: true };
    const s = newSession(cfg, u);
    while (!s.finished) playHandSync(s, { u, heroAuto: STYLES.gto });
    expect(s.history.length).toBe(300);
    const totalBought = s.seats.reduce((a, p) => a + p.bought, 0);
    const totalStack = s.seats.reduce((a, p) => a + p.stack, 0);
    expect(totalStack).toBe(totalBought);
    const last = s.curve[s.curve.length - 1];
    expect(last.net).toBe(cashProfit(s));
    expect(bbPer100(s)).toBeCloseTo((cashProfit(s) / 100 / 300) * 100, 6);
    // 每手牌的文本历史都能被解析，且主角手牌、位置、行动数量一致
    for (const h of s.history) {
      const text = exportHand(s, h);
      const rec = parseHandHistory(text);
      const hero = h.p.find((p) => p[0] === s.heroSeat)!;
      expect(rec.heroCards).toEqual([hero[2], hero[3]]);
      expect(rec.board).toEqual(h.b);
      const nActs = h.l.filter((e) => e[2] >= 3).length;
      expect(rec.actions.length).toBe(nActs);
      expect(rec.game).toBe('cash');
    }
    expect(exportSession(s).split('PokerTrainer Hand #').length - 1).toBe(300);
  });
  it('暂停与继续：牌局状态可以序列化后恢复（中途保存到本地）', () => {
    const u = seededU32(5);
    const s = newSession({ kind: 'cash', tableSize: 9, sb: 50, bb: 100, buyinBB: 100, styles: ['tag'], hands: 20, autoTopUp: true }, u);
    beginHand(s, u);
    // 行动到一半
    for (let i = 0; i < 3 && s.current && !s.current.done; i++) aiAct(s, { u, heroAuto: STYLES.tag, provider: null });
    const restored = JSON.parse(JSON.stringify(s));
    while (restored.current && !restored.current.done) aiAct(restored, { u, heroAuto: STYLES.tag, provider: null });
    finishHand(restored, u);
    while (!restored.finished) playHandSync(restored, { u, heroAuto: STYLES.tag });
    expect(restored.history.length).toBe(20);
  });
});

describe('锦标赛', () => {
  it('盲注结构递增、前注设置', () => {
    const lv = blindLevels(1500, 'bb');
    expect(lv[0]).toEqual({ sb: 10, bb: 20, ante: 20 });
    for (let i = 1; i < lv.length; i++) expect(lv[i].bb).toBeGreaterThan(lv[i - 1].bb);
    expect(blindLevels(1500, 'none')[3].ante).toBe(0);
    expect(blindLevels(1500, 'each')[0].ante).toBe(3);
  });
  for (const size of [6, 9] as const)
    for (const structure of ['fast', 'standard'] as const)
      it(`${size} 人 SNG（${structure === 'fast' ? '快速' : '标准'}）能打到结束，名次与奖金正确`, () => {
        for (let trial = 0; trial < 3; trial++) {
          const u = seededU32(100 + trial + size * 7 + (structure === 'fast' ? 0 : 50));
          const s = newSession(sngConfig(size, { structure, anteMode: trial === 1 ? 'each' : trial === 2 ? 'none' : 'bb' }), u);
          let hands = 0;
          // 主角由 AI 代打，比赛一直打到只剩一人（主角被淘汰也继续）
          while (s.seats.filter((p) => !p.busted).length > 1) {
            if (s.finished) s.finished = false;
            playHandSync(s, { u, heroAuto: STYLES.tag });
            const total = s.seats.reduce((a, p) => a + p.stack, 0);
            expect(total).toBe(1500 * size);
            hands++;
            expect(hands).toBeLessThan(2000);
          }
          const places = s.seats.map((p) => p.place).sort((a, b) => a! - b!);
          expect(places).toEqual(Array.from({ length: size }, (_, i) => i + 1));
          const winner = s.seats.find((p) => p.place === 1)!;
          expect(winner.stack).toBe(1500 * size);
          const prizes = s.seats.reduce((a, p) => a + (p.prize ?? 0), 0);
          expect(prizes).toBe(100);
          for (const p of s.seats) expect(p.prize).toBe(sngConfig(size).payouts[p.place! - 1] ?? 0);
        }
      });
  it('同一手牌多人被淘汰：起始筹码多的名次靠前', () => {
    const u = seededU32(3);
    const s = newSession(sngConfig(6), u);
    // 构造：三名玩家同时全下
    s.seats.forEach((p, i) => (p.stack = [100, 200, 300, 5000, 2000, 1400][i]));
    s.button = 5;
    s.handNo = 1;
    const st = beginHand(s, u);
    // 让所有人全下
    while (!st.done) applyAction(st, { type: 'raise', to: 1e9 });
    finishHand(s, u);
    const busted = s.seats.filter((p) => p.busted).sort((a, b) => a.place! - b.place!);
    for (let i = 1; i < busted.length; i++) {
      const a = st.players.find((p) => p.seat === busted[i - 1].seat)!;
      const b = st.players.find((p) => p.seat === busted[i].seat)!;
      expect(a.startStack).toBeGreaterThanOrEqual(b.startStack);
    }
    const alive = s.seats.filter((p) => !p.busted).length;
    if (busted.length) expect(busted[busted.length - 1].place).toBe(6);
    if (busted.length) expect(busted[0].place).toBe(alive + 1);
  });
  it('决赛桌残局：3~6 人、筹码深浅不一，ICM 价值合计等于剩余奖金', () => {
    for (const n of [3, 4, 5, 6]) {
      const u = seededU32(n);
      const payouts = [3000, 2000, 1450, 1100, 850, 650].slice(0, n);
      const s = newSession({ ...sngConfig(6), kind: 'ft', ftPlayers: n, ftDepth: 'medium', payouts }, u);
      expect(s.seats.length).toBe(n);
      const stacks = s.seats.map((p) => p.stack);
      expect(Math.max(...stacks)).toBeGreaterThan(Math.min(...stacks) * 1.3);
      const ev = icm(stacks, payouts);
      expect(ev.reduce((a, b) => a + b, 0)).toBeCloseTo(payouts.reduce((a, b) => a + b, 0), 6);
      while (s.seats.filter((p) => !p.busted).length > 1) {
        if (s.finished) s.finished = false;
        playHandSync(s, { u, heroAuto: STYLES.gto });
      }
      expect(s.seats.map((p) => p.place).sort()).toEqual(Array.from({ length: n }, (_, i) => i + 1));
      expect(s.seats.reduce((a, p) => a + (p.prize ?? 0), 0)).toBe(payouts.reduce((a, b) => a + b, 0));
    }
  });
});

describe('AI 风格数据', () => {
  for (const size of [6, 9] as const)
    it(`${size} 人桌：各风格的 VPIP / PFR 在设定范围内`, () => {
      const u = seededU32(size * 13);
      const styles: StyleId[] = ['nit', 'tag', 'lag', 'station', 'gto', 'tag', 'lag', 'station'];
      const s = newSession({ kind: 'cash', tableSize: size, sb: 50, bb: 100, buyinBB: 100, styles, hands: 100000, autoTopUp: true }, u);
      for (let i = 0; i < 2500; i++) playHandSync(s, { u, heroAuto: STYLES.gto, samples: 150 });
      const agg = new Map<StyleId, ReturnType<typeof emptyStats>>();
      for (const seat of s.seats) {
        const k = seat.style ?? 'gto';
        agg.set(k, addStats(agg.get(k) ?? emptyStats(), s.stats[seat.seat]));
      }
      for (const id of STYLE_IDS) {
        const st = agg.get(id)!;
        const l = statLine(st);
        const t = STYLES[id].target[size];
        expect(l.vpip, `${id} VPIP`).toBeGreaterThanOrEqual(t.vpip[0]);
        expect(l.vpip, `${id} VPIP`).toBeLessThanOrEqual(t.vpip[1]);
        expect(l.pfr, `${id} PFR`).toBeGreaterThanOrEqual(t.pfr[0]);
        expect(l.pfr, `${id} PFR`).toBeLessThanOrEqual(t.pfr[1]);
      }
      // 风格之间的相对关系
      const v = (id: StyleId) => statLine(agg.get(id)!);
      expect(v('nit').vpip).toBeLessThan(v('tag').vpip);
      expect(v('tag').vpip).toBeLessThan(v('lag').vpip);
      expect(v('lag').vpip).toBeLessThan(v('station').vpip);
      expect(v('station').pfr).toBeLessThan(v('nit').pfr);
      expect(v('station').af).toBeLessThan(v('lag').af);
    });
  it('锦标赛短筹码按全下/弃牌表：首先入池时只有全下或弃牌', () => {
    let unopened = 0;
    let nonAllinOpens = 0;
    for (let trial = 0; trial < 8; trial++) {
      const u = seededU32(8 + trial);
      const s = newSession({ ...sngConfig(6), kind: 'ft', ftPlayers: 6, ftDepth: 'short', payouts: [50, 30, 20] }, u);
      for (let i = 0; i < 200 && s.seats.filter((p) => !p.busted).length > 1; i++) {
        if (s.finished) s.finished = false;
        const st = beginHand(s, u);
        while (!st.done) {
          const before = st.log.filter((e) => e.street === 0 && (e.kind === 'raise' || e.kind === 'call')).length;
          const me = st.players[st.toAct];
          const deep = me.startStack / st.bb;
          const eff = Math.min(deep, Math.max(...st.players.filter((p) => p !== me).map((p) => p.startStack)) / st.bb);
          const n0 = st.log.length;
          aiAct(s, { u, heroAuto: STYLES.gto, provider: null });
          const e = st.log[n0];
          if (st.street === 0 && e && e.street === 0 && before === 0 && eff <= 17 && e.kind !== 'fold' && e.kind !== 'check') {
            unopened++;
            if (!e.allin) nonAllinOpens++;
          }
        }
        finishHand(s, u);
      }
    }
    expect(unopened).toBeGreaterThan(20);
    expect(nonAllinOpens).toBe(0);
  });
});

describe('翻后匹配预计算牌面', () => {
  it('BTN 开池、BB 跟注、翻牌 Qs8h3d（库中有）时 AI 按求解结果行动', async () => {
    const u = seededU32(2);
    const s = newSession({ kind: 'cash', tableSize: 6, sb: 50, bb: 100, buyinBB: 100, styles: ['gto'], hands: 10, autoTopUp: true }, u);
    s.seats.forEach((p) => (p.stack = 10000));
    // 构造牌局：座位 0 为 UTG … 按钮在座位 3（6 人：UTG=4? 按小盲顺序分配）
    s.button = 3;
    s.handNo = 0;
    const st = beginHand(s, u);
    // 指定牌：替换牌堆（发牌顺序：小盲开始）
    const want = parseCards('Qs8h3d');
    // 找到 BTN 与 BB 的手牌，重新设定公共牌
    const rest = st.deck.slice(st.deckPos).filter((c) => !want.includes(c));
    st.deck.splice(st.deckPos, st.deck.length - st.deckPos, ...want, ...rest);
    // 前位弃牌，BTN 开池 2.5bb，小盲弃牌，大盲跟注
    const btn = st.players.find((p) => p.seat === 3)!;
    const ensureNoConflict = st.players.every((p) => !p.hole.some((c) => want.includes(c)));
    if (!ensureNoConflict) return; // 极少数情况下手牌与公共牌冲突，跳过
    while (st.players[st.toAct].seat !== 3) applyAction(st, { type: 'fold' });
    applyAction(st, { type: 'raise', to: 250 });
    applyAction(st, { type: 'fold' });
    applyAction(st, { type: 'call' });
    expect(st.street).toBe(1);
    const { ensureSolver } = await import('../src/sim/solver.ts');
    await ensureSolver(st, 'cash', fileProvider);
    // 大盲先行动（这个预设中大盲在翻牌圈没有领先下注选项，只能过牌）
    const bbView = solverView(st, st.players[st.toAct].seat);
    expect(bbView).not.toBeNull();
    expect(bbView!.node.player).toBe(0);
    applyAction(st, { type: 'check' });
    const view = solverView(st, btn.seat);
    expect(view).not.toBeNull();
    expect(view!.node.player).toBe(1);
    expect(view!.node.actions.length).toBeGreaterThan(1);
    // 求解树的下注额换算成实际筹码：33% 底池 ≈ 1.8bb = 180
    const bet = view!.node.actions.find((a) => a.startsWith('B'))!;
    const real = view!.toReal(Number(bet.slice(1)));
    expect(real).toBeGreaterThan(150);
    expect(real).toBeLessThan(450);
    const d = aiAct(s, { u, provider: fileProvider, heroAuto: STYLES.gto });
    expect(d!.basis === 'solver' || view!.handIndex < 0).toBe(true);
  });
  it('异步驱动 + 预计算牌面：完整打 40 手不出错', async () => {
    const u = seededU32(4);
    const s = newSession({ kind: 'cash', tableSize: 6, sb: 50, bb: 100, buyinBB: 100, styles: ['gto', 'tag', 'lag', 'nit', 'station'], hands: 40, autoTopUp: true }, u);
    while (!s.finished) await playHandAsync(s, { u, heroAuto: STYLES.gto, provider: fileProvider });
    expect(s.history.length).toBe(40);
  });
});

describe('打完复盘', () => {
  it('列出偏离范围的决策并按 EV 损失排序', async () => {
    const u = seededU32(9);
    const s = newSession({ kind: 'cash', tableSize: 6, sb: 50, bb: 100, buyinBB: 100, styles: ['tag', 'lag', 'station', 'nit', 'gto'], hands: 150, autoTopUp: true }, u);
    // 主角用跟注站风格代打，会大量偏离范围
    while (!s.finished) playHandSync(s, { u, heroAuto: STYLES.station });
    const r = await reviewSession(s, { provider: fileProvider });
    expect(r.hands).toBeGreaterThan(50);
    expect(r.graded).toBeGreaterThan(30);
    expect(r.deviations.length).toBeGreaterThan(5);
    for (let i = 1; i < r.deviations.length; i++) expect(r.deviations[i - 1].evLoss).toBeGreaterThanOrEqual(r.deviations[i].evLoss);
    for (const d of r.deviations) expect(d.step.grade).not.toBe('best');
    expect(r.best + r.ok + r.wrong).toBe(r.graded);
  });
  it('锦标赛短筹码的偏离按纳什表的 EV 计算（精确）', async () => {
    const u = seededU32(10);
    const s = newSession({ ...sngConfig(6), kind: 'ft', ftPlayers: 6, ftDepth: 'short', payouts: [50, 30, 20] }, u);
    for (let i = 0; i < 80 && !s.finished; i++) playHandSync(s, { u, heroAuto: STYLES.lag });
    const r = await reviewSession(s, { provider: null });
    const exact = r.deviations.filter((d) => d.exact);
    if (r.deviations.length > 0) expect(exact.length).toBeGreaterThan(0);
    const rec = parseHandHistory(exportHand(s, s.history[0]));
    expect(rec.game).toBe('mtt');
    expect(rec.antePerPlayer).toBeCloseTo(1 / s.history[0].p.length, 6);
  });
});
