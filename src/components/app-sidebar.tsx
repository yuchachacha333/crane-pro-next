import { BarChart3, Bell, Building2, Calendar, ClipboardList, FileText, MapPin, Receipt } from 'lucide-react';

type NavKey = 'board' | 'billing' | 'sales' | 'attendance' | 'masters' | 'alerts' | 'import' | 'find';

// スマホ: 上の横並びバー / iPad(md〜xl): 細いアイコンだけの縦レール / PC(xl〜): 文字つきサイドバー
const itemClass =
  'flex items-center gap-2 px-3 py-2 md:justify-center xl:justify-start xl:gap-3 xl:py-2.5 md:px-0 xl:px-3 rounded-xl font-medium text-sm transition whitespace-nowrap md:w-full';

const ITEMS: { key: NavKey; href: string; label: string; Icon: typeof Calendar }[] = [
  { key: 'board', href: '/', label: '配車管理', Icon: Calendar },
  { key: 'find', href: '/find-crane', label: 'クレーンを探す', Icon: MapPin },
  { key: 'billing', href: '/billing', label: '請求・締め集計', Icon: Receipt },
  { key: 'sales', href: '/sales', label: '売上集計', Icon: BarChart3 },
  { key: 'attendance', href: '/attendance', label: '出勤集計', Icon: ClipboardList },
  { key: 'masters', href: '/masters', label: 'マスタ台帳', Icon: Building2 },
  { key: 'alerts', href: '/alerts', label: '期限アラート', Icon: Bell },
  { key: 'import', href: '/import', label: 'マスタ一括取込', Icon: FileText },
];

export default function AppSidebar({ active }: { active: NavKey }) {
  return (
    <aside className="flex md:flex-col md:w-14 xl:w-60 bg-[#121826] text-slate-100 p-2 md:px-1.5 xl:p-4 shrink-0 md:sticky md:top-0 md:h-screen overflow-x-auto">
      <a href="/" className="hidden md:flex items-center justify-center xl:justify-start gap-3 xl:px-2 py-3 border-b border-slate-800">
        <div className="w-9 h-9 shrink-0 rounded-xl bg-gradient-to-br from-amber-400 to-teal-600 flex items-center justify-center font-black text-slate-950 shadow">
          CP
        </div>
        <div className="hidden xl:block">
          <div className="font-extrabold text-lg tracking-tight leading-none">クレーンPRO</div>
          <div className="text-[11px] text-slate-400 mt-1">Next.js + Supabase Cloud</div>
        </div>
      </a>

      <nav className="flex md:flex-col md:mt-4 xl:mt-6 flex-1 gap-1">
        {ITEMS.map(({ key, href, label, Icon }) => (
          <a
            key={key}
            href={href}
            title={label}
            aria-label={label}
            className={`${itemClass} ${active === key ? 'bg-teal-600/20 text-teal-300 font-bold' : 'text-slate-300 hover:bg-slate-800/70'}`}
          >
            <Icon className="w-4 h-4 md:w-5 md:h-5 xl:w-4 xl:h-4 shrink-0" />
            <span className="md:hidden xl:inline">{label}</span>
          </a>
        ))}
      </nav>

      <div className="hidden xl:block p-3 rounded-xl bg-slate-800/60 text-xs text-slate-400 leading-relaxed">
        マスタの変更は Supabase へ保存されます。
      </div>
    </aside>
  );
}
