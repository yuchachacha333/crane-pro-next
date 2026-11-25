import { calculateWorkHours } from '@/lib/crane-utils';

/** 配車の基本料金と同じ、1日の所定労働時間。 */
export const STANDARD_DAY_HOURS = 8;

export type AttendanceJob = {
  id: string;
  work_date: string;
  operator_code?: string | null;
  operator_name?: string | null;
  supplier_name?: string | null;
  is_cancelled?: boolean | null;
  shift_type?: string | null;
  start_time?: string | null;
  end_time?: string | null;
  work_hours?: number | null;
  site_name?: string | null;
  customer_name?: string | null;
  requested_model?: string | null;
};

export type OperatorMaster = {
  code?: string | null;
  name?: string | null;
  sort_order?: number | null;
};

export type DayJob = {
  id: string;
  site: string;
  customer: string;
  model: string;
  shift: string;
  night: boolean;
  start: string;
  end: string;
  hours: number | null;
};

export type AttendanceDay = {
  date: string;
  jobs: DayJob[];
  hours: number;
  regular: number;
  overtime: number;
  night: boolean;
  missing: boolean;
};

export type AttendancePerson = {
  key: string;
  code: string;
  name: string;
  registered: boolean;
  sortOrder: number;
  days: AttendanceDay[];
  dayCount: number;
  jobCount: number;
  hours: number;
  regular: number;
  overtime: number;
  nightDays: number;
  missingJobs: number;
};

function text(value: string | null | undefined) {
  return String(value || '').trim();
}

export function isNightShift(shift: string | null | undefined) {
  return text(shift).includes('夜');
}

export function jobHours(job: Pick<AttendanceJob, 'work_hours' | 'start_time' | 'end_time'>): number | null {
  if (job.work_hours != null && Number.isFinite(Number(job.work_hours))) return Number(job.work_hours);
  return calculateWorkHours(job.start_time || '', job.end_time || '');
}

function roundHours(value: number) {
  return Math.round(value * 10) / 10;
}

/** 自社オペレーターの配車。キャンセルと、オペレーターが空の庸車は除く。 */
export function isEmployeeJob(job: AttendanceJob) {
  if (job.is_cancelled) return false;
  const name = text(job.operator_name);
  const code = text(job.operator_code);
  if (!name && !code) return false;
  if (text(job.supplier_name) && !name) return false;
  return true;
}

export function buildAttendance(operators: OperatorMaster[], jobs: AttendanceJob[]): AttendancePerson[] {
  const byCode = new Map<string, OperatorMaster>();
  const byName = new Map<string, OperatorMaster>();
  for (const operator of operators) {
    const name = text(operator.name);
    const code = text(operator.code);
    if (!name && !code) continue;
    if (code && !byCode.has(code)) byCode.set(code, operator);
    if (name && !byName.has(name)) byName.set(name, operator);
  }

  const people = new Map<string, AttendancePerson>();
  const ensure = (operator: OperatorMaster | undefined, fallbackName: string) => {
    const code = text(operator?.code);
    const name = text(operator?.name) || fallbackName || '氏名未入力';
    const key = operator ? `op:${code || name}` : `name:${fallbackName}`;
    const current = people.get(key);
    if (current) return current;
    const created: AttendancePerson = {
      key,
      code,
      name,
      registered: Boolean(operator),
      sortOrder: Number(operator?.sort_order) || 0,
      days: [],
      dayCount: 0,
      jobCount: 0,
      hours: 0,
      regular: 0,
      overtime: 0,
      nightDays: 0,
      missingJobs: 0,
    };
    people.set(key, created);
    return created;
  };

  for (const operator of byCode.values()) ensure(operator, text(operator.name));
  for (const operator of byName.values()) {
    if (!text(operator.code) || !byCode.has(text(operator.code))) ensure(operator, text(operator.name));
  }

  const dayBucket = new Map<string, Map<string, AttendanceDay>>();
  for (const job of jobs) {
    if (!isEmployeeJob(job)) continue;
    const code = text(job.operator_code);
    const name = text(job.operator_name);
    const operator = (code && byCode.get(code)) || (name && byName.get(name)) || undefined;
    const person = ensure(operator, name || code);
    const date = text(job.work_date);
    if (!date) continue;
    const days = dayBucket.get(person.key) ?? new Map<string, AttendanceDay>();
    dayBucket.set(person.key, days);
    const day = days.get(date) ?? {
      date,
      jobs: [],
      hours: 0,
      regular: 0,
      overtime: 0,
      night: false,
      missing: false,
    };
    const hours = jobHours(job);
    const night = isNightShift(job.shift_type);
    day.jobs.push({
      id: job.id,
      site: text(job.site_name),
      customer: text(job.customer_name),
      model: text(job.requested_model),
      shift: text(job.shift_type) || '昼',
      night,
      start: text(job.start_time),
      end: text(job.end_time),
      hours,
    });
    if (night) day.night = true;
    if (hours == null) day.missing = true;
    else day.hours += hours;
    days.set(date, day);
  }

  for (const person of people.values()) {
    const days = [...(dayBucket.get(person.key)?.values() ?? [])];
    days.sort((a, b) => a.date.localeCompare(b.date) || a.jobs[0].id.localeCompare(b.jobs[0].id));
    for (const day of days) {
      day.jobs.sort((a, b) => a.start.localeCompare(b.start) || a.id.localeCompare(b.id));
      day.hours = roundHours(day.hours);
      day.regular = roundHours(Math.min(day.hours, STANDARD_DAY_HOURS));
      day.overtime = roundHours(Math.max(0, day.hours - STANDARD_DAY_HOURS));
      person.hours += day.hours;
      person.regular += day.regular;
      person.overtime += day.overtime;
      person.jobCount += day.jobs.length;
      person.missingJobs += day.jobs.filter((job) => job.hours == null).length;
      if (day.night) person.nightDays += 1;
    }
    person.days = days;
    person.dayCount = days.length;
    person.hours = roundHours(person.hours);
    person.regular = roundHours(person.regular);
    person.overtime = roundHours(person.overtime);
  }

  return [...people.values()].sort(
    (a, b) => b.dayCount - a.dayCount || a.sortOrder - b.sortOrder || a.name.localeCompare(b.name, 'ja')
  );
}
