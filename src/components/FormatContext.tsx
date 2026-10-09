import { createContext, useContext, useState, type ReactNode } from 'react';
import { type Format, type GameType, MTT_DEPTHS, makeFormat, parseFormatId } from '../lib/formats.ts';
import { load, save } from '../lib/storage.ts';

interface Ctx {
  format: Format;
  setFormat: (f: Format) => void;
}

const FormatContext = createContext<Ctx | null>(null);

export function FormatProvider({ children }: { children: ReactNode }) {
  const [format, setF] = useState<Format>(() => parseFormatId(load('format', 'cash6-100')));
  const setFormat = (f: Format) => {
    setF(f);
    save('format', f.id);
  };
  return <FormatContext.Provider value={{ format, setFormat }}>{children}</FormatContext.Provider>;
}

export function useFormat(): Ctx {
  const c = useContext(FormatContext);
  if (!c) throw new Error('FormatProvider 缺失');
  return c;
}

/** 牌局格式选择器：现金局/锦标赛、6/9 人、筹码深度 */
export function FormatPicker() {
  const { format, setFormat } = useFormat();
  const setGame = (g: GameType) => setFormat(makeFormat(g, format.players, g === 'cash' ? 100 : format.game === 'mtt' ? format.depth : 20));
  return (
    <div className="format-picker">
      <div className="seg">
        <button className={format.game === 'cash' ? 'on' : ''} onClick={() => setGame('cash')}>
          现金局
        </button>
        <button className={format.game === 'mtt' ? 'on' : ''} onClick={() => setGame('mtt')}>
          锦标赛
        </button>
      </div>
      <div className="seg">
        {([6, 9] as const).map((p) => (
          <button key={p} className={format.players === p ? 'on' : ''} onClick={() => setFormat(makeFormat(format.game, p, format.depth))}>
            {p} 人桌
          </button>
        ))}
      </div>
      {format.game === 'mtt' ? (
        <div className="seg depth">
          {MTT_DEPTHS.map((d) => (
            <button key={d} className={format.depth === d ? 'on' : ''} onClick={() => setFormat(makeFormat('mtt', format.players, d))}>
              {d}bb
            </button>
          ))}
        </div>
      ) : (
        <div className="seg">
          <button className="on">100bb</button>
        </div>
      )}
    </div>
  );
}
