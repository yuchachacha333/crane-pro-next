import type { Metadata } from 'next';
import ImportClient from './import-client';

export const metadata: Metadata = {
  title: 'マスタ一括取込 | クレーンPRO',
};

export default function ImportPage() {
  return <ImportClient />;
}
