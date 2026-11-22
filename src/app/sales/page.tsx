import type { Metadata } from 'next';
import SalesClient from './sales-client';

export const metadata: Metadata = {
  title: '売上集計 | クレーンPRO',
};

export default function SalesPage() {
  return <SalesClient />;
}
