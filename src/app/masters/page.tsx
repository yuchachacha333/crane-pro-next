import type { Metadata } from 'next';
import MastersClient from './masters-client';

export const metadata: Metadata = {
  title: 'マスタ台帳 | クレーンPRO',
};

export default function MastersPage() {
  return <MastersClient />;
}
