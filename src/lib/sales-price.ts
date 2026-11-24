import { supabase } from '@/lib/supabase';

export type ModelPrice = {
  name?: string | null;
  standard_price_a?: number | null;
  night_standard_price?: number | null;
};

export type SalesPriceJob = {
  customer_code?: string | null;
  customer_name?: string | null;
  requested_model?: string | null;
  shift_type?: string | null;
  unit_price?: number | null;
  total_sales_amount?: number | null;
};

export function finitePrice(value: number | null | undefined): number | null {
  if (value == null) return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? amount : null;
}

export function nightShift(shift: string | null | undefined) {
  return String(shift || '').includes('夜');
}

export function priceKey(customerCode: string, customerName: string, model: string, shift: string) {
  const party = customerCode.trim() || `name:${customerName.trim()}`;
  return `${party}|${model.trim()}|${nightShift(shift) ? 'night' : 'day'}`;
}

export function standardModelPrice(
  models: ModelPrice[],
  modelName: string | null | undefined,
  shift: string | null | undefined
): number | null {
  const name = String(modelName || '').trim();
  if (!name) return null;
  const model = models.find((item) => String(item.name || '').trim() === name);
  if (!model) return null;
  const nightPrice = Number(model.night_standard_price);
  const dayPrice = Number(model.standard_price_a);
  if (nightShift(shift) && Number.isFinite(nightPrice) && nightPrice > 0) return nightPrice;
  if (Number.isFinite(dayPrice) && dayPrice > 0) return dayPrice;
  return null;
}

export function sumExtraAmounts(
  lines: { amount?: number | null; quantity?: number | null; unit_price?: number | null }[]
) {
  return lines.reduce((sum, line) => {
    const stored = finitePrice(line.amount);
    const amount =
      stored != null ? stored : Number(line.quantity || 0) * Number(line.unit_price || 0);
    return sum + (Number.isFinite(amount) ? amount : 0);
  }, 0);
}

// 保存済みの基本単価 → 同じ得意先・機種の直近単価 → 機種マスタの標準単価 → 保存済みの売上合計。
// 売上合計が 0 のときは未計上とみなし、自動単価を優先する。
export function resolveBasePrice(
  job: SalesPriceJob,
  extra: number,
  models: ModelPrice[],
  remembered: Map<string, number>
): number | null {
  const unit = finitePrice(job.unit_price);
  if (unit != null) return unit;

  const model = String(job.requested_model || '').trim();
  const code = String(job.customer_code || '');
  const name = String(job.customer_name || '');
  if (model && (code.trim() || name.trim())) {
    const history = remembered.get(priceKey(code, name, model, String(job.shift_type || '')));
    if (history != null) return history;
  }
  const standard = standardModelPrice(models, model, job.shift_type);
  if (standard != null) return standard;

  const total = finitePrice(job.total_sales_amount);
  if (total != null && total !== 0) return total - extra;
  return null;
}

export async function latestUnitPrice(
  companyId: string,
  customerCode: string,
  customerName: string,
  modelName: string,
  shift: string,
  excludeId?: string
): Promise<number | null> {
  const model = modelName.trim();
  const code = customerCode.trim();
  const name = customerName.trim();
  if (!companyId || !model || (!code && !name)) return null;
  let query = supabase
    .from('dispatches')
    .select('id, unit_price, requested_model, shift_type, is_cancelled')
    .eq('company_id', companyId)
    .not('unit_price', 'is', null)
    .order('work_date', { ascending: false })
    .limit(120);
  query = code ? query.eq('customer_code', code) : query.eq('customer_name', name);
  const { data, error } = await query;
  if (error || !data) return null;
  const night = nightShift(shift);
  const hit = data.find(
    (item) =>
      item.id !== excludeId &&
      !item.is_cancelled &&
      String(item.requested_model || '').trim() === model &&
      nightShift(String(item.shift_type || '')) === night &&
      finitePrice(item.unit_price) != null
  );
  return hit ? finitePrice(hit.unit_price as number | null) : null;
}

export async function rememberedUnitPrices(
  companyId: string,
  wanted: { customerCode: string; customerName: string; model: string; shift: string }[]
): Promise<Map<string, number>> {
  const map = new Map<string, number>();
  const pending = new Map<string, { customerCode: string; customerName: string; model: string; shift: string }>();
  for (const item of wanted) {
    const model = item.model.trim();
    if (!model || (!item.customerCode.trim() && !item.customerName.trim())) continue;
    const key = priceKey(item.customerCode, item.customerName, model, item.shift);
    if (!pending.has(key)) pending.set(key, item);
  }
  const entries = [...pending.entries()];
  for (let index = 0; index < entries.length; index += 8) {
    const slice = entries.slice(index, index + 8);
    const found = await Promise.all(
      slice.map(async ([key, item]) => {
        const price = await latestUnitPrice(companyId, item.customerCode, item.customerName, item.model, item.shift);
        return [key, price] as const;
      })
    );
    for (const [key, price] of found) {
      if (price != null) map.set(key, price);
    }
  }
  return map;
}
