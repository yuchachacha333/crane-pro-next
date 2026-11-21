export function getWeekday(isoDate: string): string {
    const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    return '日月火水木金土'.charAt(d.getDay());
  }
  
  export function formatJapaneseMonthDay(isoDate: string): string {
    const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return isoDate;
    return `${Number(m[2])}月${Number(m[3])}日`;
  }
  
  export function shiftIsoDate(isoDate: string, days: number): string {
    const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return isoDate;
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
    d.setDate(d.getDate() + days);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  
  export function getTodayIso(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
  
  export function getRokuyo(isoDate: string): string {
    const m = isoDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (!m) return '';
    const year = Number(m[1]);
    const month = Number(m[2]);
    const day = Number(m[3]);
  
    const fl = Math.floor;
    const norm360 = (deg: number) => {
      const v = deg % 360;
      return v < 0 ? v + 360 : v;
    };
    const rad = (deg: number) => (deg * Math.PI) / 180;
    const ymdNum = (dt: { year: number; month: number; day: number }) =>
      dt.year * 10000 + dt.month * 100 + dt.day;
  
    const jdn = (y: number, mo: number, d: number) => {
      const a = fl((14 - mo) / 12);
      const yy = y + 4800 - a;
      const mm = mo + 12 * a - 3;
      return d + fl((153 * mm + 2) / 5) + 365 * yy + fl(yy / 4) - fl(yy / 100) + fl(yy / 400) - 32045;
    };
  
    const jdToYmd = (jd: number) => {
      const z = fl(jd + 0.5);
      const a = z + 32044;
      const b = fl((4 * a + 3) / 146097);
      const c = a - fl((146097 * b) / 4);
      const d = fl((4 * c + 3) / 1461);
      const e = c - fl((1461 * d) / 4);
      const mo = fl((5 * e + 2) / 153);
      return {
        year: 100 * b + d - 4800 + fl(mo / 10),
        month: mo + 3 - 12 * fl(mo / 10),
        day: e - fl((153 * mo + 2) / 5) + 1,
      };
    };
  
    const jstDate = (jd: number) => jdToYmd(jd + 9 / 24);
  
    const newMoon = (k: number) => {
      const t = k / 1236.85;
      const t2 = t * t;
      const t3 = t2 * t;
      const t4 = t3 * t;
      const e = 1 - 0.002516 * t - 0.0000074 * t2;
      const sun = rad(norm360(2.5534 + 29.1053567 * k - 0.0000014 * t2 - 0.00000011 * t3));
      const moon = rad(norm360(201.5643 + 385.81693528 * k + 0.0107582 * t2 + 0.00001238 * t3 - 0.000000058 * t4));
      const f = rad(norm360(160.7108 + 390.67050284 * k - 0.0016118 * t2 - 0.00000227 * t3 + 0.000000011 * t4));
      const om = rad(norm360(124.7746 - 1.56375588 * k + 0.0020672 * t2 + 0.00000215 * t3));
      return (
        2451550.09765 +
        29.530588861 * k +
        0.0001337 * t2 -
        0.00000015 * t3 +
        0.00000000073 * t4 -
        0.4072 * Math.sin(moon) +
        0.17241 * e * Math.sin(sun) +
        0.01608 * Math.sin(2 * moon) +
        0.01039 * Math.sin(2 * f) +
        0.00739 * e * Math.sin(moon - sun) -
        0.00514 * e * Math.sin(moon + sun) +
        0.00208 * e * e * Math.sin(2 * sun) -
        0.00111 * Math.sin(moon - 2 * f) -
        0.00057 * Math.sin(moon + 2 * f) +
        0.00056 * e * Math.sin(2 * moon + sun) -
        0.00042 * Math.sin(3 * moon) +
        0.00042 * e * Math.sin(sun + 2 * f) +
        0.00038 * e * Math.sin(sun - 2 * f) -
        0.00024 * e * Math.sin(2 * moon - sun) -
        0.00017 * Math.sin(om)
      );
    };
  
    const solarLongitude = (jd: number) => {
      const t = (jd - 2451545.0) / 36525;
      const m0 = 357.52911 + 35999.05029 * t - 0.0001537 * t * t;
      const mr = (m0 * Math.PI) / 180;
      const c =
        (1.914602 - 0.004817 * t - 0.000014 * t * t) * Math.sin(mr) +
        (0.019993 - 0.000101 * t) * Math.sin(2 * mr) +
        0.000289 * Math.sin(3 * mr);
      return norm360(280.46646 + 36000.76983 * t + 0.0003032 * t * t + c);
    };
  
    const chukiIn = (startJd: number, endJd: number) => {
      const startNum = ymdNum(jstDate(startJd));
      const endNum = ymdNum(jstDate(endJd));
      const lon0 = solarLongitude(startJd - 1.5);
      const targets = [0, 30, 60, 90, 120, 150, 180, 210, 240, 270, 300, 330];
      for (const target of targets) {
        let delta = target - lon0;
        if (delta < 0) delta += 360;
        if (delta > 45) continue;
        let guess = startJd - 1.5 + delta / 0.98564736;
        for (let n = 0; n < 8; n++) {
          let diff = target - solarLongitude(guess);
          if (diff > 180) diff -= 360;
          if (diff < -180) diff += 360;
          guess += diff / 0.98564736;
        }
        const when = ymdNum(jstDate(guess));
        if (when >= startNum && when < endNum) return target;
      }
      return null;
    };
  
    const monthMap: Record<number, number> = {
      330: 1, 0: 2, 30: 3, 60: 4, 90: 5, 120: 6, 150: 7, 180: 8, 210: 9, 240: 10, 270: 11, 300: 12,
    };
  
    const noon = jdn(year, month, day);
    let k = fl((noon - 2451550.09765) / 29.530588861);
    const target = year * 10000 + month * 100 + day;
    const startNum = (idx: number) => ymdNum(jstDate(newMoon(idx)));
    while (startNum(k) > target) k--;
    while (startNum(k + 1) <= target) k++;
  
    const start = jstDate(newMoon(k));
    const lunarDay = noon - jdn(start.year, start.month, start.day) + 1;
    let cursor = k;
    let monthNo = 0;
    for (let guard = 0; guard < 4 && !monthNo; guard++) {
      const lon = chukiIn(newMoon(cursor), newMoon(cursor + 1));
      if (lon !== null && monthMap[lon]) monthNo = monthMap[lon];
      cursor--;
    }
    if (!monthNo || lunarDay < 1) return '';
    return ['大安', '赤口', '先勝', '友引', '先負', '仏滅'][(monthNo + lunarDay) % 6];
  }
  
  export function calculateWorkHours(start: string, end: string): number | null {
    const parseMin = (val: string) => {
      const m = String(val || '').trim().match(/^(\d{1,2}):(\d{2})/);
      return m ? Number(m[1]) * 60 + Number(m[2]) : null;
    };
    const startMin = parseMin(start);
    const endMin = parseMin(end);
    if (startMin === null || endMin === null) return null;
  
    let mins = endMin - startMin;
    if (mins < 0) mins += 24 * 60;
    const coversLunch =
      endMin >= startMin ? startMin <= 12 * 60 && endMin >= 13 * 60 : startMin <= 12 * 60;
    const worked = Math.max(0, coversLunch ? mins - 60 : mins);
    return Math.round(worked / 6) / 10;
  }
  
  export function getMachineBadgeColor(name: string): string {
    const text = String(name || '').replace(/\s+/g, '');
    if (!text) return 'bg-slate-100 text-slate-700';
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash * 33 + text.charCodeAt(i)) >>> 0;
    }
    const palettes = [
      'bg-amber-100 text-amber-900 border-amber-300',
      'bg-sky-100 text-sky-900 border-sky-300',
      'bg-emerald-100 text-emerald-900 border-emerald-300',
      'bg-purple-100 text-purple-900 border-purple-300',
      'bg-rose-100 text-rose-900 border-rose-300',
      'bg-teal-100 text-teal-900 border-teal-300',
      'bg-indigo-100 text-indigo-900 border-indigo-300',
    ];
    return palettes[hash % palettes.length];
  }