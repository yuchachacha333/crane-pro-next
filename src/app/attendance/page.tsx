import type { Metadata } from 'next';
import AttendanceClient from './attendance-client';

export const metadata: Metadata = {
  title: '出勤・給与 | クレーンPRO',
};

export default function AttendancePage() {
  return <AttendanceClient />;
}
