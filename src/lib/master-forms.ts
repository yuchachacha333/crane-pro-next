export type MasterTable = 'customers' | 'customer_contacts' | 'sites' | 'operators' | 'machine_models' | 'products';
export type FieldKind = 'text' | 'number' | 'textarea' | 'date' | 'bool';

export type MasterField = {
  key: string;
  label: string;
  kind: FieldKind;
  required?: boolean;
  auto?: boolean;
  zipFor?: string;
  addressFor?: string;
};

export type MasterDefinition = {
  id?: string;
  table: MasterTable;
  title: string;
  blurb: string;
  searchHint: string;
  requireQuery: boolean;
  searchColumns: string[];
  listColumns: { key: string; label: string }[];
  groups: { name: string; fields: MasterField[] }[];
  /** 一覧と保存をこの列の値に限る。付帯売上は商品テーブルの一部。 */
  match?: Record<string, string>;
  /** 新規保存時に足す固定値 */
  preset?: Record<string, string>;
  hidden?: boolean;
};

export function masterKey(master: MasterDefinition) {
  return master.id || master.table;
}

const text = (key: string, label: string, required = false): MasterField => ({
  key,
  label,
  kind: 'text',
  required,
});

const autoCode = (key: string, label: string): MasterField => ({
  key,
  label,
  kind: 'text',
  auto: true,
});

const zip = (key: string, label: string, zipFor: string): MasterField => ({
  key,
  label,
  kind: 'text',
  zipFor,
});

const addressOf = (key: string, label: string, addressFor: string): MasterField => ({
  key,
  label,
  kind: 'textarea',
  addressFor,
});
const area = (key: string, label: string): MasterField => ({ key, label, kind: 'textarea' });
const number = (key: string, label: string): MasterField => ({ key, label, kind: 'number' });
const date = (key: string, label: string): MasterField => ({ key, label, kind: 'date' });
const bool = (key: string, label: string): MasterField => ({ key, label, kind: 'bool' });

export const MASTER_FORMS: MasterDefinition[] = [
  {
    table: 'customers',
    title: '取引先',
    blurb: '得意先・仕入先と請求条件',
    searchHint: 'コード、名前、電話、検索ワード',
    requireQuery: false,
    searchColumns: ['code', 'name', 'kana', 'search_word', 'tel', 'address1', 'sales_staff_name', 'notes'],
    listColumns: [
      { key: 'code', label: 'コード' },
      { key: 'name', label: '取引先名' },
      { key: 'search_word', label: '検索ワード' },
      { key: 'partner_type', label: '区分' },
      { key: 'address1', label: '住所' },
      { key: 'tel', label: '電話' },
    ],
    groups: [
      {
        name: '基本',
        fields: [
          text('code', '得意先コード', true),
          text('name', '得意先名', true),
          text('search_word', '検索ワード'),
          text('kana', 'フリガナ'),
          text('partner_type', '取引先区分'),
          text('status', '状態'),
          area('notes', '備考'),
        ],
      },
      {
        name: '連絡先',
        fields: [
          zip('postal_code', '郵便番号', 'address1'),
          addressOf('address1', '住所', 'postal_code'),
          text('address2', '住所下段'),
          number('latitude', '緯度'),
          number('longitude', '経度'),
          text('tel', '電話番号'),
          text('tel2', '電話番号2'),
          text('fax', 'FAX'),
          text('email', 'メール'),
          text('website', 'ホームページ'),
        ],
      },
      {
        name: '担当',
        fields: [text('sales_staff_code', '営業担当者コード'), text('sales_staff_name', '営業担当者名')],
      },
      {
        name: '請求・回収',
        fields: [
          number('closing_day', '請求締日'),
          number('payment_closing_day', '支払締日'),
          number('collection_day', '回収日'),
          number('collection_month', '回収月'),
          text('collection_month_name', '回収月の名称'),
          text('collection_method', '回収方法'),
        ],
      },
    ],
  },
  {
    table: 'customer_contacts',
    title: '担当者',
    blurb: '得意先ごとの担当者名、携帯番号、メールアドレス',
    searchHint: '担当者名、得意先、電話、メール',
    requireQuery: false,
    searchColumns: ['code', 'name', 'customer_code', 'customer_name', 'tel', 'email'],
    listColumns: [
      { key: 'code', label: 'コード' },
      { key: 'name', label: '担当者名' },
      { key: 'customer_name', label: '得意先' },
      { key: 'tel', label: '携帯番号' },
      { key: 'email', label: 'メールアドレス' },
    ],
    groups: [
      {
        name: '担当',
        fields: [
          autoCode('code', '担当者コード'),
          text('customer_code', '得意先コード'),
          text('customer_name', '得意先名'),
          text('name', '担当者名', true),
          text('tel', '携帯番号'),
          text('email', 'メールアドレス'),
        ],
      },
    ],
  },
  {
    table: 'sites',
    title: '現場',
    blurb: '工事・作業現場と入場条件',
    searchHint: '現場名、住所、得意先で検索',
    requireQuery: true,
    searchColumns: [
      'code',
      'name',
      'address',
      'tel',
      'contact_name',
      'contact_tel',
      'customer_code',
      'customer_name',
      'client_site_code',
      'construction_no',
      'notes',
    ],
    listColumns: [
      { key: 'code', label: '現場コード' },
      { key: 'name', label: '現場名' },
      { key: 'address', label: '住所' },
      { key: 'customer_name', label: '得意先' },
      { key: 'default_entry_time', label: '入場' },
    ],
    groups: [
      {
        name: '基本',
        fields: [
          autoCode('code', '現場コード'),
          text('name', '現場名', true),
          text('default_entry_time', '標準入場時間'),
          text('customer_code', '得意先コード'),
          text('customer_name', '得意先名'),
          text('client_site_code', '客先現場コード'),
          text('construction_no', '工事番号'),
          area('notes', '備考'),
        ],
      },
      {
        name: '現場の場所',
        fields: [
          zip('postal_code', '郵便番号', 'address'),
          addressOf('address', '住所', 'postal_code'),
          number('latitude', '緯度'),
          number('longitude', '経度'),
          text('tel', '電話番号'),
        ],
      },
      {
        name: '事務所',
        fields: [
          zip('office_postal_code', '事務所郵便番号', 'office_address1'),
          addressOf('office_address1', '事務所住所', 'office_postal_code'),
          text('office_address2', '事務所住所下段'),
          text('office_tel', '事務所TEL'),
          text('office_fax', '事務所FAX'),
        ],
      },
      {
        name: '担当者',
        fields: [
          text('contact_name', '担当者'),
          text('contact_tel', '担当者TEL'),
          text('contact_name2', '担当者2'),
          text('contact_tel2', '担当者TEL2'),
        ],
      },
    ],
  },
  {
    table: 'operators',
    title: 'オペレータ',
    blurb: '自社オペレーターと資格。日給が空欄の山科重機工業の従業員は2万円で計算します',
    searchHint: 'コード、名前、電話、資格',
    requireQuery: false,
    searchColumns: ['code', 'name', 'kana', 'mobile_tel', 'qualifications', 'licenses', 'large_class'],
    listColumns: [
      { key: 'code', label: 'コード' },
      { key: 'name', label: '氏名' },
      { key: 'daily_wage', label: '日給' },
      { key: 'mobile_tel', label: '携帯' },
      { key: 'large_class', label: '大型区分' },
      { key: 'licenses', label: '免許' },
    ],
    groups: [
      {
        name: '基本',
        fields: [
          text('code', 'オペレータコード', true),
          text('name', '氏名', true),
          text('kana', 'フリガナ'),
          text('mobile_tel', '携帯電話'),
          text('large_class', '大型区分'),
          number('daily_wage', '日給'),
          number('sort_order', '表示順'),
          bool('show_in_report', '配車実績表に表示'),
        ],
      },
      {
        name: '資格',
        fields: [
          area('qualifications', '資格'),
          area('licenses', '免許'),
          text('default_product_code', '標準商品コード'),
        ],
      },
    ],
  },
  {
    table: 'machine_models',
    title: '機種',
    blurb: '受付機種と標準単価',
    searchHint: 'コード、機種名',
    requireQuery: false,
    searchColumns: ['code', 'name'],
    listColumns: [
      { key: 'code', label: '機種ID' },
      { key: 'name', label: '機種名' },
      { key: 'unit_name', label: '単位' },
      { key: 'standard_price_a', label: '標準単価' },
    ],
    groups: [
      {
        name: '基本',
        fields: [
          text('code', '機種ID', true),
          text('name', '機種名', true),
        ],
      },
      {
        name: '単価',
        fields: [
          text('unit_name', '単位'),
          number('standard_price_a', '標準単価'),
          number('standard_price_b', '標準単価2'),
          number('standard_price_c', '標準単価3'),
          number('night_standard_price', '夜間標準単価'),
        ],
      },
    ],
  },
  {
    id: 'extra_sales',
    table: 'products',
    title: '付帯売上',
    blurb: '残業・鉄板・高速代などの名前と単位。配車で選ぶと単位が入ります',
    searchHint: 'コード、名前、単位',
    requireQuery: false,
    searchColumns: ['code', 'name', 'kana', 'unit_name'],
    match: { category1: '付帯' },
    preset: { category1: '付帯', product_type: 'クレーン' },
    listColumns: [
      { key: 'code', label: 'コード' },
      { key: 'name', label: '付帯名' },
      { key: 'unit_name', label: '単位' },
      { key: 'dispatch_sort_order', label: '表示順' },
    ],
    groups: [
      {
        name: '基本',
        fields: [
          autoCode('code', 'コード'),
          text('name', '付帯名', true),
          text('unit_name', '単位'),
          number('dispatch_sort_order', '表示順'),
        ],
      },
    ],
  },
  {
    table: 'products',
    title: '商品',
    hidden: true,
    blurb: '車両・クレーンと車検期限',
    searchHint: 'コード、商品名、型式、管理番号',
    requireQuery: false,
    searchColumns: ['code', 'name', 'name2', 'kana', 'management_no', 'model_type', 'category1', 'operator_name'],
    listColumns: [
      { key: 'code', label: '商品コード' },
      { key: 'name', label: '商品名' },
      { key: 'category1', label: '分類' },
      { key: 'model_type', label: '型式' },
      { key: 'ownership_type', label: '区分' },
    ],
    groups: [
      {
        name: '基本',
        fields: [
          text('code', '商品コード', true),
          text('name', '商品名', true),
          text('name2', '商品名2'),
          text('kana', 'ふりがな'),
          text('management_no', '管理番号'),
          text('unit_name', '単位'),
          text('status', '状態'),
          text('product_type', '商品種別'),
          bool('is_scrapped', '廃車'),
          area('notes', '備考'),
        ],
      },
      {
        name: '仕様',
        fields: [
          text('category1', '商品分類1'),
          text('category2', '商品分類2'),
          text('category3', '商品分類3'),
          text('ownership_type', '自社他社区分'),
          text('vehicle_large_class', '車両大型区分'),
          text('model_type', '型式'),
          number('tonnage', 't数'),
          text('tonnage_text', 't数文字列'),
          text('capacity', '能力'),
          text('engine', 'エンジン'),
          text('model_year', '年式'),
          number('dispatch_sort_order', '配車表の表示順'),
        ],
      },
      {
        name: '担当と料金',
        fields: [
          text('operator_code', 'オペレータコード'),
          text('operator_name', 'オペレータ名'),
          number('base_management_fee', '基本管理料'),
          number('insurance_daily', '保険料日額'),
          number('insurance_monthly', '保険料月額'),
        ],
      },
      {
        name: '期限',
        fields: [
          date('inspection_expiry', '車検満了日'),
          date('crane_inspection_expiry', 'クレーン検査満了日'),
          date('lower_inspection_expiry', '下車検満了日'),
          date('upper_inspection_expiry', '上車検満了日'),
        ],
      },
    ],
  },
];

export function fieldsOf(master: MasterDefinition): MasterField[] {
  return master.groups.flatMap((group) => group.fields);
}
