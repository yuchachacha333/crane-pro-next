import type { Metadata } from 'next';
import BillingClient from './billing-client';

export const metadata: Metadata = {
  title: '請求・締め集計 | クレーンPRO',
};

export default function BillingPage() {
  return <BillingClient />;
}
