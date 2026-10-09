import { useEffect, useState } from 'react';
import { loadData } from './data/equityData.ts';
import { FormatProvider } from './components/FormatContext.tsx';
import { HomePage } from './pages/HomePage.tsx';
import { RangesPage } from './pages/RangesPage.tsx';
import { TrainerPage } from './pages/TrainerPage.tsx';
import { EquityPage } from './pages/EquityPage.tsx';
import { IcmPage } from './pages/IcmPage.tsx';
import { DrillsPage } from './pages/DrillsPage.tsx';
import { LessonsPage } from './pages/LessonsPage.tsx';
import { StatsPage } from './pages/StatsPage.tsx';
import { AboutPage } from './pages/AboutPage.tsx';
import { SolverPage } from './pages/SolverPage.tsx';

function useHashRoute(): string {
  const get = () => (window.location.hash.replace(/^#/, '') || '/').split('?')[0];
  const [route, setRoute] = useState(get);
  useEffect(() => {
    const on = () => {
      setRoute(get());
      window.scrollTo(0, 0);
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return route;
}

const NAV: { path: string; label: string }[] = [
  { path: '/ranges', label: '范围库' },
  { path: '/train', label: '翻前训练' },
  { path: '/solver', label: '翻后求解' },
  { path: '/tools/equity', label: '胜率计算' },
  { path: '/tools/icm', label: 'ICM' },
  { path: '/tools/drills', label: '概念练习' },
  { path: '/learn', label: '入门课程' },
  { path: '/stats', label: '统计' },
  { path: '/about', label: '数据说明' },
];

export function App() {
  const route = useHashRoute();
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadData()
      .then(() => setReady(true))
      .catch((e) => setError(String(e)));
  }, []);

  let page: JSX.Element;
  if (!ready) page = <div className="card">{error ? `数据加载失败：${error}` : '正在加载数据…'}</div>;
  else if (route.startsWith('/ranges')) page = <RangesPage />;
  else if (route.startsWith('/train')) page = <TrainerPage />;
  else if (route.startsWith('/solver')) page = <SolverPage />;
  else if (route.startsWith('/tools/equity')) page = <EquityPage />;
  else if (route.startsWith('/tools/icm')) page = <IcmPage />;
  else if (route.startsWith('/tools/drills')) page = <DrillsPage />;
  else if (route.startsWith('/learn')) page = <LessonsPage route={route} />;
  else if (route.startsWith('/stats')) page = <StatsPage />;
  else if (route.startsWith('/about')) page = <AboutPage />;
  else page = <HomePage />;

  return (
    <FormatProvider>
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-suit">♠</span> 翻前 GTO 训练
        </a>
        <nav className="nav">
          {NAV.map((n) => (
            <a key={n.path} href={`#${n.path}`} className={route.startsWith(n.path) ? 'active' : ''}>
              {n.label}
            </a>
          ))}
        </nav>
      </header>
      <main className="main">{page}</main>
      <footer className="footer">
        学习与复盘工具 · 只支持手动输入局面，不读取牌桌、不做实时辅助 · 学习数据只保存在本机浏览器
      </footer>
    </FormatProvider>
  );
}
