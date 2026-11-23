import { ImageResponse } from 'next/og';

/** ホーム画面・デスクトップ・タブに出すアプリのアイコン（白いクレーンを、明るいティール地に置く） */
export function appIcon(size: number, rounded = false) {
  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          borderRadius: rounded ? size * 0.22 : 0,
          background: 'linear-gradient(145deg, #2dd4bf 0%, #0d9488 55%, #0f766e 100%)',
        }}
      >
        <svg width={size} height={size} viewBox="0 0 1024 1024">
          <circle cx="760" cy="260" r="230" fill="#ffffff" fillOpacity="0.1" />
          <line x1="410" y1="610" x2="770" y2="250" stroke="#ffffff" strokeWidth="64" strokeLinecap="round" />
          <line x1="770" y1="250" x2="770" y2="470" stroke="#ffffff" strokeWidth="16" strokeLinecap="round" />
          <path d="M770 470 v34 a34 34 0 1 1 -34 34" fill="none" stroke="#ffffff" strokeWidth="18" strokeLinecap="round" />
          <rect x="210" y="590" width="440" height="150" rx="34" fill="#ffffff" />
          <path d="M650 640 h120 q40 0 62 40 l30 60 h-212 z" fill="#ffffff" />
          <circle cx="330" cy="760" r="68" fill="#ffffff" />
          <circle cx="330" cy="760" r="26" fill="#0d9488" />
          <circle cx="720" cy="760" r="68" fill="#ffffff" />
          <circle cx="720" cy="760" r="26" fill="#0d9488" />
          <circle cx="410" cy="610" r="30" fill="#0d9488" />
        </svg>
      </div>
    ),
    { width: size, height: size }
  );
}
