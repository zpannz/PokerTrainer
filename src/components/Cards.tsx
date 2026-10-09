import { RANK_CHARS, SUIT_SYMBOLS, makeCard, rankOf, suitOf } from '../lib/cards.ts';

const SUIT_CLASS = ['s', 'h', 'd', 'c'];

export function PlayingCard({ card, size = 'md' }: { card: number; size?: 'sm' | 'md' | 'lg' }) {
  const r = RANK_CHARS[rankOf(card)];
  const s = suitOf(card);
  return (
    <span className={`pcard ${size} suit-${SUIT_CLASS[s]}`} aria-label={`${r}${SUIT_SYMBOLS[s]}`}>
      <span className="pc-rank">{r === 'T' ? '10' : r}</span>
      <span className="pc-suit">{SUIT_SYMBOLS[s]}</span>
    </span>
  );
}

export function CardRow({ cards, size }: { cards: number[]; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span className="card-row">
      {cards.map((c) => (
        <PlayingCard key={c} card={c} size={size} />
      ))}
    </span>
  );
}

/** 52 张牌的选择器 */
export function CardPicker({ selected, disabled, onPick }: { selected: number[]; disabled: Set<number>; onPick: (card: number) => void }) {
  return (
    <div className="card-picker">
      {[0, 1, 2, 3].map((s) => (
        <div key={s} className="cp-row">
          {Array.from({ length: 13 }, (_, i) => 12 - i).map((r) => {
            const c = makeCard(r, s);
            const sel = selected.includes(c);
            const dis = disabled.has(c) && !sel;
            return (
              <button key={c} className={`cp-card suit-${SUIT_CLASS[s]} ${sel ? 'sel' : ''}`} disabled={dis} onClick={() => onPick(c)}>
                {RANK_CHARS[r]}
                {SUIT_SYMBOLS[s]}
              </button>
            );
          })}
        </div>
      ))}
    </div>
  );
}
