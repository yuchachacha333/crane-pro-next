import type { Metadata } from 'next';
import AlertsClient from './alerts-client';

export const metadata: Metadata = {
  title: '期限アラート | クレーンPRO',
};

export default function AlertsPage() {
  return <AlertsClient />;
}
