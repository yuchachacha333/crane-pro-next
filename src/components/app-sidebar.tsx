import { Bell, Building2, Calendar, FileText, MapPin, Receipt } from 'lucide-react';

type NavKey = 'board' | 'billing' | 'masters' | 'alerts' | 'import' | 'find';

const itemClass =
  'flex items-center gap-2 md:gap-3 px-3 py-2 md:py-2.5 rounded-xl font-medium text-sm transition whitespace-nowrap md:w-full';

export default function AppSidebar({ active }: { active: NavKey }) {
  return (
    <aside className="flex md:flex-col md:w-60 bg-[#121826] text-slate-100 p-2 md:p-4 shrink-0 md:sticky md:top-0 md:h-screen overflow-x-auto">
      <a href="/" className="hidden md:flex items-center gap-3 px-2 py-3 border-b border-slate-800">
        <div className="w-9 h-9 rounded-xl bg-gradient-to-br from-amber-400 to-teal-600 flex items-center justify-center font-black text-slate-950 shadow">
          CP
        </div>
        <div>
          <div className="font-extrabold text-lg tracking-tight leading-none">クレーンPRO</div>
          <div className="text-[11px] text-slate-400 mt-1">Next.js + Supabase Cloud</div>
        </div>
      </a>

      <nav className="flex md:flex-col md:mt-6 flex-1 gap-1">
        <a
          href="/"
          className={`${itemClass} ${active === 'board' ? 'bg-teal-600/20 text-teal-300 font-bold' : 'text-slate-300 hover:bg-slate-800/70'}`}
        >
          <Calendar className="w-4 h-4" />
          配車ボード
        </a>
        <a
          href="/find-crane"
          className={`${itemClass} ${active === 'find' ? 'bg-teal-600/20 text-teal-300 font-bold' : 'text-slate-300 hover:bg-slate-800/70'}`}
        >
          <MapPin className="w-4 h-4" />
          クレーンを探す
        </a>
        <a
          href="/billing"
          className={`${itemClass} ${active === 'billing' ? 'bg-teal-600/20 text-teal-300 font-bold' : 'text-slate-300 hover:bg-slate-800/70'}`}
        >
          <Receipt className="w-4 h-4" />
          請求・締め集計
        </a>
        <a
          href="/masters"
          className={`${itemClass} ${active === 'masters' ? 'bg-teal-600/20 text-teal-300 font-bold' : 'text-slate-300 hover:bg-slate-800/70'}`}
        >
          <Building2 className="w-4 h-4" />
          マスタ台帳
        </a>
        <a
          href="/alerts"
          className={`${itemClass} ${active === 'alerts' ? 'bg-teal-600/20 text-teal-300 font-bold' : 'text-slate-300 hover:bg-slate-800/70'}`}
        >
          <Bell className="w-4 h-4" />
          期限アラート
        </a>
        <a
          href="/import"
          className={`${itemClass} ${active === 'import' ? 'bg-teal-600/20 text-teal-300 font-bold' : 'text-slate-300 hover:bg-slate-800/70'}`}
        >
          <FileText className="w-4 h-4" />
          マスタ一括取込
        </a>
      </nav>

      <div className="hidden md:block p-3 rounded-xl bg-slate-800/60 text-xs text-slate-400 leading-relaxed">
        マスタの変更は Supabase へ保存されます。
      </div>
    </aside>
  );
}
