import type { Metadata } from 'next';
import FindCraneClient from './find-crane-client';

export const metadata: Metadata = {
  title: 'クレーンを探す | クレーンPRO',
};

export default function FindCranePage() {
  return <FindCraneClient />;
}
