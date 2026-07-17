export type OrderStatus = "submitted" | "processing" | "completed" | "canceled";

export interface AddressSnapshot {
  contactName?: string;
  phone?: string;
  region?: string;
  detail?: string;
}

export interface OrderItem {
  categoryName?: string;
  unit?: "kg" | "件";
  estWeight?: number;
  estCount?: number;
}

export interface Order {
  _id: string;
  orderNo: string;
  source?: "category" | "photo";
  summary?: string;
  status: OrderStatus;
  addressSnapshot?: AddressSnapshot;
  appointDate?: string;
  appointSlot?: string;
  items?: OrderItem[];
  remark?: string;
  photoUrls?: string[];
  estimatePrice?: number | null;
  finalWeight?: number | null;
  finalCount?: number | null;
  finalPrice?: number | null;
  recyclerName?: string;
  recyclerPhone?: string;
  transferProofs?: string[];
  transferProofUrls?: string[];
  cancelReason?: string;
  adminRemark?: string;
  createTime?: number;
  updateTime?: number;
  completedAt?: number | null;
  canceledAt?: number | null;
}

export interface Category {
  _id?: string;
  name: string;
  unit: "kg" | "件";
  priceRef?: string;
  sortOrder: number;
  enabled: boolean;
}

export interface RecycleSettings {
  key: "recycle_rules";
  minWeightKg: number;
  minCount: number;
  photoOrderCheckMinQuantity: boolean;
  siteName?: string;
  servicePhone?: string;
  notifyEnabled?: boolean;
  autoAssign?: boolean;
  maxDistanceKm?: number;
  updateTime?: number;
}

export interface OrderListResult {
  list: Order[];
  total: number;
  hasMore: boolean;
}
