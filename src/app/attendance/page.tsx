import type { Metadata } from 'next';
import AttendanceClient from './attendance-client';

export const metadata: Metadata = {
  title: '出勤集計 | クレーンPRO',
};

export default function AttendancePage() {
  return <AttendanceClient />;
}
