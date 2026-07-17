import { useState, useRef, useEffect, useMemo, type ReactNode } from "react";
import {
  Package, Settings, Tags, LogOut, Eye, EyeOff, X, Search,
  ChevronRight, RefreshCw, Plus, Phone, MapPin, User, ImageIcon,
  XCircle, Loader, Edit2, Trash2, ToggleLeft, ToggleRight,
  Bell, Database, Save, Users, GripVertical, ChevronDown, Check,
  AlarmClock, Lock, SlidersHorizontal, Store, ChevronUp, Columns3,
  Upload, FileSpreadsheet, Download, AlertCircle, Navigation,
  BarChart2, TrendingUp, CheckCircle2, Coins, ArrowUpRight,
  type LucideIcon,
} from "lucide-react";
import {
  ResponsiveContainer, ComposedChart, LineChart, Line, BarChart, Bar,
  PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend,
} from "recharts";
import { callCloud } from "../api/cloud";
import type {
  Category as CloudCategory,
  Order as CloudOrder,
  OrderListResult,
  OrderStatus as CloudOrderStatus,
  RecycleSettings,
} from "../types";

// ─── Types ────────────────────────────────────────────────────────────────────
type Page = "orders" | "staff" | "cats" | "analytics" | "system";
type OrderStatus = "待接单" | "已接单" | "回收中" | "已完成" | "已取消";
type StaffStatus = "online" | "resting" | "resigned";

interface Staff {
  id: string; name: string; phone: string;
  status: StaffStatus; joinDate: string; area: string; store: string;
}
interface RecycleItem {
  id: string; name: string; unit: string;
  price: string; stationPrice: string;
  fieldEstimate?: boolean; enabled: boolean;
  categoryId?: string; sortOrder?: number; priceRef?: string;
}
interface RecycleGroup {
  id: string; name: string; desc: string;
  allowFieldEstimate?: boolean;
  items: RecycleItem[]; enabled: boolean;
}
interface Order {
  id: string; status: OrderStatus;
  userName: string; phone: string; address: string; description: string;
  appointmentTime: string; images: string[];
  recyclers: string[]; category: string; weight: string;
  createdAt: string; completedAt?: string; lastModified: string; amount?: number;
  docId?: string;
  estimatePrice?: number | null; finalWeight?: number | null; finalCount?: number | null;
  recyclerPhone?: string; adminRemark?: string; cancelReason?: string;
}
interface ColDef { id: string; label: string; width: number; minWidth: number; fixed?: boolean; alwaysVisible?: boolean; }

export interface FigmaAdminProps {
  token: string;
  adminName: string;
  onLogout: () => void;
  onError: (error: unknown) => void;
  notify: (message: { kind: "success" | "error"; text: string }) => void;
}

const CLOUD_TO_FIGMA_STATUS: Record<CloudOrderStatus, OrderStatus> = {
  submitted: "待接单",
  processing: "回收中",
  completed: "已完成",
  canceled: "已取消",
};

const FIGMA_TO_CLOUD_STATUS: Record<OrderStatus, CloudOrderStatus> = {
  待接单: "submitted",
  已接单: "processing",
  回收中: "processing",
  已完成: "completed",
  已取消: "canceled",
};

const formatCloudTime = (value?: number | null) => {
  if (!value) return "—";
  const date = new Date(value);
  const pad = (number: number) => String(number).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
};

const cloudOrderToFigma = (order: CloudOrder): Order => {
  const address = order.addressSnapshot || {};
  const itemNames = (order.items || []).map((item) => item.categoryName).filter(Boolean) as string[];
  const quantity = order.finalWeight
    ? `${order.finalWeight}kg`
    : order.finalCount
      ? `${order.finalCount}件`
      : order.items?.find((item) => item.estWeight)?.estWeight
        ? `约${order.items.find((item) => item.estWeight)?.estWeight}kg`
        : order.items?.find((item) => item.estCount)?.estCount
          ? `约${order.items.find((item) => item.estCount)?.estCount}件`
          : "—";
  return {
    id: order.orderNo,
    docId: order._id,
    status: CLOUD_TO_FIGMA_STATUS[order.status] || "待接单",
    userName: address.contactName || "未填写",
    phone: address.phone || "",
    address: [address.region, address.detail].filter(Boolean).join(" ") || "未填写地址",
    description: order.summary || order.remark || "暂无物品描述",
    appointmentTime: [order.appointDate, order.appointSlot].filter(Boolean).join(" ") || "待确认",
    images: order.photoUrls || [],
    recyclers: order.recyclerName ? [order.recyclerName] : [],
    category: itemNames.join("、") || (order.source === "photo" ? "拍照提交" : "其他"),
    weight: quantity,
    createdAt: formatCloudTime(order.createTime),
    completedAt: order.completedAt ? formatCloudTime(order.completedAt) : undefined,
    lastModified: formatCloudTime(order.updateTime || order.createTime),
    amount: order.finalPrice == null ? undefined : Number(order.finalPrice),
    estimatePrice: order.estimatePrice,
    finalWeight: order.finalWeight,
    finalCount: order.finalCount,
    recyclerPhone: order.recyclerPhone,
    adminRemark: order.adminRemark,
    cancelReason: order.cancelReason,
  };
};

const priceFromReference = (value?: string) => {
  const match = String(value || "").match(/\d+(?:\.\d+)?/);
  return match ? Number(match[0]).toFixed(2) : "—";
};

const categoriesToGroups = (categories: CloudCategory[]): RecycleGroup[] => [{
  id: "cloud-categories",
  name: "回收品类",
  desc: "小程序当前展示的全部可回收品类",
  enabled: categories.some((item) => item.enabled),
  allowFieldEstimate: categories.some((item) => !/\d/.test(item.priceRef || "")),
  items: categories
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .map((item) => {
      const price = priceFromReference(item.priceRef);
      return {
        id: item._id || item.name,
        categoryId: item._id,
        name: item.name,
        unit: item.unit,
        price,
        stationPrice: "—",
        priceRef: item.priceRef,
        sortOrder: item.sortOrder,
        fieldEstimate: price === "—",
        enabled: item.enabled,
      };
    }),
}];

const staffFromOrders = (orders: Order[]): Staff[] => {
  const names = Array.from(new Set(orders.flatMap((order) => order.recyclers).filter(Boolean)));
  return names.map((name, index) => ({
    id: `R${String(index + 1).padStart(3, "0")}`,
    name,
    phone: orders.find((order) => order.recyclers.includes(name))?.recyclerPhone || "",
    status: "online",
    joinDate: "—",
    area: "—",
    store: "未配置门店",
  }));
};

// ─── Initial Data ─────────────────────────────────────────────────────────────
const INIT_STAFF: Staff[] = [
  { id: "S001", name: "王建国", phone: "13901234567", status: "online",   joinDate: "2022-03-15", area: "朝阳区",   store: "朝阳旗舰店" },
  { id: "S002", name: "赵志远", phone: "15812345678", status: "online",   joinDate: "2022-06-01", area: "海淀区",   store: "海淀区店"   },
  { id: "S003", name: "刘铁柱", phone: "18623456789", status: "resting",  joinDate: "2021-11-20", area: "浦东新区", store: "浦东分店"   },
  { id: "S004", name: "孙大伟", phone: "13734567890", status: "online",   joinDate: "2023-01-10", area: "天河区",   store: "天河区店"   },
  { id: "S005", name: "张磊",   phone: "15645678901", status: "resigned", joinDate: "2022-08-05", area: "南山区",   store: "南山区店"   },
  { id: "S006", name: "李明",   phone: "17756789012", status: "online",   joinDate: "2023-04-22", area: "武侯区",   store: "武侯区店"   },
];

// Column widths shared across all category group tables for alignment
const CAT_COL_WIDTHS = [190, 60, 96, 96, 80, 100, 84, 100];
const CAT_COL_HEADERS = ["品类名称","单位","收购单价","打包站价","差价","差价/收购价","状态","操作"];

const INIT_GROUPS: RecycleGroup[] = [
  {
    id: "G1", name: "常见金属", desc: "各类废旧金属回收", enabled: true, allowFieldEstimate: false,
    items: [
      { id:"G1-1", name:"铜",     unit:"kg",  price:"48.00", stationPrice:"52.00", enabled:true  },
      { id:"G1-2", name:"铁",     unit:"kg",  price:"2.00",  stationPrice:"2.30",  enabled:true  },
      { id:"G1-3", name:"钢",     unit:"kg",  price:"2.50",  stationPrice:"2.80",  enabled:true  },
      { id:"G1-4", name:"铝",     unit:"kg",  price:"12.00", stationPrice:"13.50", enabled:true  },
      { id:"G1-5", name:"不锈钢", unit:"kg",  price:"6.00",  stationPrice:"6.80",  enabled:false },
    ],
  },
  {
    id: "G2", name: "纸制品", desc: "各类废纸回收", enabled: true, allowFieldEstimate: false,
    items: [
      { id:"G2-1", name:"书本",   unit:"kg", price:"0.60", stationPrice:"0.70", enabled:true },
      { id:"G2-2", name:"纸壳箱", unit:"kg", price:"0.80", stationPrice:"0.95", enabled:true },
      { id:"G2-3", name:"报纸",   unit:"kg", price:"0.70", stationPrice:"0.80", enabled:true },
      { id:"G2-4", name:"包装纸", unit:"kg", price:"0.50", stationPrice:"0.60", enabled:true },
    ],
  },
  {
    id: "G3", name: "塑料", desc: "各类废旧塑料回收", enabled: true, allowFieldEstimate: false,
    items: [
      { id:"G3-1", name:"矿泉水瓶", unit:"kg", price:"1.50", stationPrice:"1.80", enabled:true  },
      { id:"G3-2", name:"塑料桶",   unit:"kg", price:"1.20", stationPrice:"1.50", enabled:true  },
      { id:"G3-3", name:"PVC管材",  unit:"kg", price:"0.80", stationPrice:"1.00", enabled:true  },
      { id:"G3-4", name:"塑料薄膜", unit:"kg", price:"0.60", stationPrice:"0.75", enabled:false },
    ],
  },
  {
    id: "G4", name: "衣物", desc: "旧衣物纺织品回收", enabled: true, allowFieldEstimate: false,
    items: [
      { id:"G4-1", name:"旧衣服",   unit:"kg", price:"0.50", stationPrice:"0.60", enabled:true },
      { id:"G4-2", name:"床单被套", unit:"kg", price:"0.40", stationPrice:"0.50", enabled:true },
      { id:"G4-3", name:"鞋子",     unit:"双", price:"1.00", stationPrice:"1.20", enabled:true },
    ],
  },
  {
    id: "G5", name: "电子废品", desc: "废旧电子设备（现场估价）", enabled: true, allowFieldEstimate: true,
    items: [
      { id:"G5-1", name:"手机/平板",  unit:"台", price:"—",    stationPrice:"—",    fieldEstimate:true,  enabled:true },
      { id:"G5-2", name:"电脑主机",   unit:"台", price:"—",    stationPrice:"—",    fieldEstimate:true,  enabled:true },
      { id:"G5-3", name:"家用电器",   unit:"台", price:"—",    stationPrice:"—",    fieldEstimate:true,  enabled:true },
      { id:"G5-4", name:"电线电缆",   unit:"kg", price:"8.00", stationPrice:"9.50", fieldEstimate:false, enabled:true },
    ],
  },
  {
    id: "G6", name: "玻璃", desc: "废旧玻璃制品回收", enabled: false, allowFieldEstimate: false,
    items: [
      { id:"G6-1", name:"玻璃瓶", unit:"kg", price:"0.30", stationPrice:"0.35", enabled:false },
      { id:"G6-2", name:"玻璃板", unit:"kg", price:"0.20", stationPrice:"0.25", enabled:false },
    ],
  },
  {
    id: "G7", name: "其他", desc: "其他可回收废品", enabled: true, allowFieldEstimate: false,
    items: [],
  },
];

const INIT_ORDERS: Order[] = [
  { id:"202401150001", status:"待接单",  userName:"张明辉", phone:"13800123456", address:"北京市朝阳区望京街道望京SOHO T1楼 2301室",    description:"家里翻新，有废旧铁管和铝合金型材，另有铜线若干，约15公斤。", appointmentTime:"2024-01-15 09:00–11:00", images:["https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=280&fit=crop","https://images.unsplash.com/photo-1532996122724-e3c354a0b15b?w=400&h=280&fit=crop"], recyclers:["王建国"], category:"常见金属", weight:"约15kg", createdAt:"2024-01-14 16:32", lastModified:"2024-01-14 16:32" },
  { id:"202401150002", status:"已接单",  userName:"李秀英", phone:"15898765432", address:"上海市浦东新区陆家嘴金融贸易区世纪大道1501号", description:"清理仓库，大量纸箱和书本，约30公斤，方便取走报纸。",           appointmentTime:"2024-01-15 14:00–16:00", images:["https://images.unsplash.com/photo-1604187351574-c75ca79f5807?w=400&h=280&fit=crop"], recyclers:["赵志远","刘铁柱"], category:"纸制品",   weight:"约30kg", createdAt:"2024-01-15 08:10", lastModified:"2024-01-15 09:00" },
  { id:"202401150003", status:"回收中",  userName:"陈建平", phone:"18600234567", address:"广州市天河区珠江新城花城大道88号",             description:"旧电脑主机2台、显示器1台、键鼠若干，还有一部旧手机。",        appointmentTime:"2024-01-15 10:00–12:00", images:["https://images.unsplash.com/photo-1591193686104-fddba9b544a1?w=400&h=280&fit=crop","https://images.unsplash.com/photo-1542601906990-b4d3fb778b09?w=400&h=280&fit=crop","https://images.unsplash.com/photo-1611273426858-450d8e3c9fce?w=400&h=280&fit=crop"], recyclers:["刘铁柱"], category:"电子废品", weight:"约8kg",  createdAt:"2024-01-15 09:05", lastModified:"2024-01-15 10:30" },
  { id:"202401140021", status:"已完成",  userName:"王芳",   phone:"13955667788", address:"深圳市南山区科技园科苑路10号",                 description:"家里旧衣物一大袋，还有几箱矿泉水瓶，一起回收。",             appointmentTime:"2024-01-14 15:00–17:00", images:["https://images.unsplash.com/photo-1562077772-3bd90403f7f0?w=400&h=280&fit=crop"], recyclers:["孙大伟"], category:"塑料",     weight:"约22kg", createdAt:"2024-01-14 11:20", completedAt:"2024-01-14 17:10", lastModified:"2024-01-14 17:10", amount:26.40 },
  { id:"202401130018", status:"已完成",  userName:"周建军", phone:"13612349876", address:"北京市海淀区中关村大街1号",                   description:"废旧铜线一批，电脑主机一台，估计铜线有10公斤。",             appointmentTime:"2024-01-13 10:00–12:00", images:["https://images.unsplash.com/photo-1558618666-fcd25c85cd64?w=400&h=280&fit=crop"], recyclers:["王建国","李明"], category:"常见金属", weight:"约10kg", createdAt:"2024-01-12 20:15", completedAt:"2024-01-13 11:45", lastModified:"2024-01-13 11:45", amount:530.00 },
  { id:"202401140019", status:"已取消",  userName:"刘洋",   phone:"17711223344", address:"成都市武侯区天府大道666号",                   description:"玻璃瓶若干，大约两箱，因搬家需尽快处理。",                   appointmentTime:"2024-01-14 09:00–11:00", images:[], recyclers:[], category:"玻璃",     weight:"—",     createdAt:"2024-01-13 20:44", lastModified:"2024-01-13 20:44" },
  { id:"202401160004", status:"待接单",  userName:"赵雪梅", phone:"13544332211", address:"杭州市西湖区文三路477号",                     description:"搬家整理出来的旧书和纸箱，约三四十公斤，请尽快上门。",       appointmentTime:"2024-01-16 13:00–15:00", images:["https://images.unsplash.com/photo-1567360425618-1594206637d2?w=400&h=280&fit=crop"], recyclers:[], category:"纸制品",   weight:"约40kg", createdAt:"2024-01-15 21:03", lastModified:"2024-01-15 21:03" },
  { id:"202401120010", status:"已完成",  userName:"吴晓峰", phone:"13011112222", address:"上海市静安区南京西路1788号",                   description:"旧家电：洗衣机1台、微波炉1台，另有废铁若干。",               appointmentTime:"2024-01-12 14:00–16:00", images:["https://images.unsplash.com/photo-1604187351574-c75ca79f5807?w=400&h=280&fit=crop"], recyclers:["赵志远"], category:"电子废品", weight:"约35kg", createdAt:"2024-01-11 18:30", completedAt:"2024-01-12 15:40", lastModified:"2024-01-12 15:40", amount:90.00 },
];

const INIT_COLS: ColDef[] = [
  { id:"id",              label:"订单号",   width:140, minWidth:120, alwaysVisible:true },
  { id:"status",          label:"状态",     width:88,  minWidth:80  },
  { id:"contact",         label:"联系人",   width:155, minWidth:130 },
  { id:"address",         label:"地址",     width:175, minWidth:120 },
  { id:"appointmentTime", label:"预约时间", width:150, minWidth:130 },
  { id:"images",          label:"图片",     width:118, minWidth:90  },
  { id:"summary",         label:"物品摘要", width:165, minWidth:120 },
  { id:"recyclers",       label:"回收人员", width:168, minWidth:120 },
  { id:"lastModified",    label:"最后修改", width:118, minWidth:100 },
  { id:"actions",         label:"操作",     width:88,  minWidth:76, fixed:true, alwaysVisible:true },
];

// ─── Shared row action buttons (unified size, page-adaptive layout) ────────────
type RowActionTone = "green" | "blue" | "red" | "gray";

const ROW_ACTION_ICON_SIZE = 11;
const ROW_ACTION_TONE_CLASS: Record<RowActionTone, string> = {
  green: "text-green-700 bg-green-50 border-green-200 hover:bg-green-100",
  blue: "text-blue-700 bg-blue-50 border-blue-200 hover:bg-blue-100",
  red: "text-red-600 bg-red-50 border-red-200 hover:bg-red-100",
  gray: "text-gray-500 bg-gray-50 border-gray-200 hover:bg-gray-100 hover:border-gray-300",
};

/** Canonical size for table row actions across orders / staff / categories. */
const ROW_ACTION_SIZE_CLASS =
  "inline-flex items-center justify-center gap-1 rounded-md border font-medium transition-colors whitespace-nowrap " +
  "px-1.5 py-0.5 text-[10px] sm:px-2 sm:py-1 sm:text-xs";

function RowActionButton({
  tone,
  icon: Icon,
  children,
  onClick,
}: {
  tone: RowActionTone;
  icon: LucideIcon;
  children: ReactNode;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`${ROW_ACTION_SIZE_CLASS} ${ROW_ACTION_TONE_CLASS[tone]}`}
    >
      <Icon size={ROW_ACTION_ICON_SIZE} className="shrink-0" />
      {children}
    </button>
  );
}

/** stack = fill narrow action columns; inline = wrap in wider cells. */
function RowActions({
  layout = "stack",
  children,
}: {
  layout?: "stack" | "inline";
  children: ReactNode;
}) {
  if (layout === "inline") {
    return <div className="flex flex-wrap items-center gap-1.5">{children}</div>;
  }
  return <div className="flex w-full min-w-0 flex-col gap-1 [&_button]:w-full">{children}</div>;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────
const STATUS_CFG: Record<OrderStatus, { color:string; bg:string; dot:string }> = {
  待接单: { color:"text-amber-700",  bg:"bg-amber-50 border border-amber-200",  dot:"bg-amber-500"  },
  已接单: { color:"text-blue-700",   bg:"bg-blue-50 border border-blue-200",    dot:"bg-blue-500"   },
  回收中: { color:"text-violet-700", bg:"bg-violet-50 border border-violet-200",dot:"bg-violet-500" },
  已完成: { color:"text-green-700",  bg:"bg-green-50 border border-green-200",  dot:"bg-green-500"  },
  已取消: { color:"text-gray-500",   bg:"bg-gray-50 border border-gray-200",    dot:"bg-gray-400"   },
};
const STAFF_CFG: Record<StaffStatus,{ label:string; color:string; bg:string; dot:string; next:StaffStatus }> = {
  online:   { label:"在线", color:"text-green-700", bg:"bg-green-50 border border-green-200",  dot:"bg-green-500", next:"resting"  },
  resting:  { label:"休息", color:"text-amber-700", bg:"bg-amber-50 border border-amber-200",  dot:"bg-amber-400", next:"resigned" },
  resigned: { label:"离职", color:"text-gray-500",  bg:"bg-gray-50 border border-gray-200",    dot:"bg-gray-400",  next:"online"   },
};

function maskPhone(p: string) {
  const d = p.replace(/\D/g,""); return d.length < 7 ? d : d.slice(0,3)+"****"+d.slice(-4);
}
function maskName(n: string) {
  if (n.length <= 1) return n;
  if (n.length === 2) return n[0]+"*";
  return n[0]+"*".repeat(n.length-2)+n[n.length-1];
}
function nowStr() {
  const d=new Date(), p=(n:number)=>String(n).padStart(2,"0");
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
function genOrderId(orders: Order[]) {
  const n=new Date(), p=(x:number)=>String(x).padStart(2,"0");
  const prefix=`${n.getFullYear()}${p(n.getMonth()+1)}${p(n.getDate())}`;
  const cnt=orders.filter(o=>o.id.startsWith(prefix)).length;
  return `${prefix}${String(cnt+1).padStart(4,"0")}`;
}
function parseDate(s?:string){ return s ? new Date(s.slice(0,10)) : null; }
function spread(buy:string, station:string) {
  const b=parseFloat(buy), s=parseFloat(station);
  if (isNaN(b)||isNaN(s)) return null;
  return (s-b).toFixed(2);
}

// ─── Status Badges ────────────────────────────────────────────────────────────
function StatusBadge({ status }:{ status:OrderStatus }) {
  const c=STATUS_CFG[status];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.color} ${c.bg}`}><span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`}/>{status}</span>;
}
function StaffBadge({ status }:{ status:StaffStatus }) {
  const c=STAFF_CFG[status];
  return <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${c.color} ${c.bg}`}><span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${c.dot}`}/>{c.label}</span>;
}

// ─── Image thumb with hover zoom ──────────────────────────────────────────────
function ImageThumb({ src, onClick }:{ src:string; onClick:()=>void }) {
  const [hovered,setHovered]=useState(false);
  return (
    <div className="relative" onMouseEnter={()=>setHovered(true)} onMouseLeave={()=>setHovered(false)}>
      <button onClick={onClick} className="w-8 h-8 rounded-lg overflow-hidden border-2 border-white bg-gray-100 block"><img src={src} alt="" className="w-full h-full object-cover"/></button>
      {hovered && <div className="absolute z-50 bottom-full left-1/2 -translate-x-1/2 mb-2 w-40 h-32 rounded-xl overflow-hidden shadow-2xl border-2 border-white pointer-events-none"><img src={src} alt="" className="w-full h-full object-cover"/></div>}
    </div>
  );
}

// ─── Recycler pills + select ──────────────────────────────────────────────────
const PILL_COLORS=["bg-green-100 text-green-800 border-green-200","bg-blue-100 text-blue-800 border-blue-200","bg-violet-100 text-violet-800 border-violet-200","bg-amber-100 text-amber-800 border-amber-200","bg-pink-100 text-pink-800 border-pink-200","bg-cyan-100 text-cyan-800 border-cyan-200"];
function pillColor(name:string,staff:Staff[]){ const i=staff.findIndex(s=>s.name===name); return PILL_COLORS[(i<0?0:i)%PILL_COLORS.length]; }
function RecyclerPills({ recyclers,staff }:{ recyclers:string[];staff:Staff[] }) {
  if (!recyclers.length) return <span className="text-xs text-gray-300">未分配</span>;
  return <div className="flex flex-wrap gap-1">{recyclers.map(n=><span key={n} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${pillColor(n,staff)}`}>{n}</span>)}</div>;
}
function RecyclerSelect({ value,onChange,staff }:{ value:string[];onChange:(v:string[])=>void;staff:Staff[] }) {
  const [open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const h=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false);};
    document.addEventListener("mousedown",h); return ()=>document.removeEventListener("mousedown",h);
  },[]);
  const toggle=(name:string)=>onChange(value.includes(name)?value.filter(n=>n!==name):[...value,name]);
  return (
    <div ref={ref} className="relative">
      <button type="button" onClick={()=>setOpen(v=>!v)} className="min-w-[160px] flex items-center gap-1.5 flex-wrap px-3 py-2 rounded-lg border border-gray-200 bg-white text-sm hover:border-green-400 transition-all text-left">
        {value.length===0?<span className="text-gray-400 text-sm">选择回收人员</span>:value.map(n=><span key={n} className={`inline-flex items-center px-2 py-0.5 rounded-full text-[11px] font-medium border ${pillColor(n,staff)}`}>{n}</span>)}
        <ChevronDown size={12} className="ml-auto text-gray-400 flex-shrink-0"/>
      </button>
      {open && <div className="absolute z-50 mt-1 w-52 bg-white border border-gray-200 rounded-xl shadow-lg py-1 max-h-52 overflow-y-auto">
        {staff.filter(s=>s.status==="online").map(s=>{
          const checked=value.includes(s.name);
          return <button key={s.id} type="button" onClick={()=>toggle(s.name)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-sm text-left transition-colors">
            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${checked?"bg-green-600 border-green-600":"border-gray-300"}`}>{checked&&<Check size={10} className="text-white"/>}</div>
            <span className="text-gray-700">{s.name}</span><span className="text-xs text-gray-400 ml-auto">{s.store}</span>
          </button>;
        })}
        {staff.filter(s=>s.status==="online").length===0&&<p className="text-xs text-gray-400 px-3 py-4 text-center">暂无在线人员</p>}
      </div>}
    </div>
  );
}

// ─── Image Preview Modal ──────────────────────────────────────────────────────
function ImagePreviewModal({ images,initialIndex,onClose }:{ images:string[];initialIndex:number;onClose:()=>void }) {
  const [idx,setIdx]=useState(initialIndex);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/80 backdrop-blur-sm"/>
      <div className="relative z-10 max-w-3xl w-full mx-4" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-3">
          <span className="text-white text-sm font-medium">图片预览 {idx+1}/{images.length}</span>
          <button onClick={onClose} className="text-white/70 hover:text-white"><X size={22}/></button>
        </div>
        <div className="bg-gray-900 rounded-xl overflow-hidden"><img src={images[idx]} alt="" className="w-full max-h-[70vh] object-contain"/></div>
        {images.length>1&&<div className="flex gap-2 mt-3 justify-center">{images.map((img,i)=>(<button key={i} onClick={()=>setIdx(i)} className={`w-14 h-10 rounded-lg overflow-hidden border-2 transition-all ${i===idx?"border-green-400":"border-transparent opacity-50 hover:opacity-80"}`}><img src={img} alt="" className="w-full h-full object-cover"/></button>))}</div>}
      </div>
    </div>
  );
}

// ─── New Order Modal ──────────────────────────────────────────────────────────
function NewOrderModal({ onSave,onClose,staff,groups,orders }:{ onSave:(o:Order)=>void;onClose:()=>void;staff:Staff[];groups:RecycleGroup[];orders:Order[] }) {
  const [form,setForm]=useState({ userName:"",phone:"",address:"",description:"",category:"",weight:"",appointmentDate:"",appointmentSlot:"09:00–11:00",recyclers:[] as string[] });
  const [errors,setErrors]=useState<Record<string,string>>({});
  const set=(k:string,v:string|string[])=>setForm(f=>({...f,[k]:v}));
  const slots=["09:00–11:00","11:00–13:00","13:00–15:00","15:00–17:00","17:00–19:00"];
  function validate() {
    const e:Record<string,string>={};
    if(!form.userName.trim()) e.userName="请填写用户名";
    if(!form.phone.trim()||form.phone.length<11) e.phone="请填写正确的手机号";
    if(!form.address.trim()) e.address="请填写地址";
    if(!form.category) e.category="请选择品类";
    if(!form.appointmentDate) e.appointmentDate="请选择预约日期";
    setErrors(e); return Object.keys(e).length===0;
  }
  function handleSave() {
    if(!validate()) return;
    const now=nowStr();
    onSave({
      id: genOrderId(orders), status:"待接单",
      userName:form.userName, phone:form.phone, address:form.address,
      description:form.description, category:form.category, weight:form.weight||"待确认",
      appointmentTime:`${form.appointmentDate} ${form.appointmentSlot}`,
      images:[], recyclers:form.recyclers,
      createdAt:now, lastModified:now,
    });
  }
  const inp="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all";
  const err=(k:string)=>errors[k]?<p className="text-xs text-red-500 mt-1">{errors[k]}</p>:null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"/>
      <div className="relative z-10 w-full max-w-xl mx-4 bg-white rounded-2xl shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">新建订单</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[72vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">用户名 <span className="text-red-400">*</span></label>
              <input value={form.userName} onChange={e=>set("userName",e.target.value)} placeholder="请输入用户名" className={`${inp} ${errors.userName?"border-red-300":"border-gray-200"}`}/>{err("userName")}</div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">联系电话 <span className="text-red-400">*</span></label>
              <input value={form.phone} onChange={e=>set("phone",e.target.value.replace(/\D/g,""))} maxLength={11} placeholder="11位手机号" className={`${inp} font-mono ${errors.phone?"border-red-300":"border-gray-200"}`}/>{err("phone")}</div>
          </div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1.5">回收地址 <span className="text-red-400">*</span></label>
            <textarea value={form.address} onChange={e=>set("address",e.target.value)} rows={2} placeholder="省市区街道门牌号" className={`${inp} resize-none ${errors.address?"border-red-300":"border-gray-200"}`}/>{err("address")}</div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1.5">物品摘要</label>
            <textarea value={form.description} onChange={e=>set("description",e.target.value)} rows={2} placeholder="描述需要回收的物品（选填）" className={`${inp} resize-none border-gray-200`}/></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">品类 <span className="text-red-400">*</span></label>
              <select value={form.category} onChange={e=>set("category",e.target.value)} className={`${inp} bg-white ${errors.category?"border-red-300":"border-gray-200"}`}>
                <option value="">选择品类</option>
                {groups.filter(g=>g.enabled).map(g=>(
                  <optgroup key={g.id} label={g.name}>
                    {g.items.filter(i=>i.enabled).map(item=>(<option key={item.id} value={`${g.name}·${item.name}`}>{item.name}</option>))}
                  </optgroup>
                ))}
              </select>{err("category")}</div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">预估重量</label>
              <input value={form.weight} onChange={e=>set("weight",e.target.value)} placeholder="如：约20kg" className={`${inp} border-gray-200`}/></div>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">预约日期 <span className="text-red-400">*</span></label>
              <input type="date" value={form.appointmentDate} onChange={e=>set("appointmentDate",e.target.value)} className={`${inp} ${errors.appointmentDate?"border-red-300":"border-gray-200"}`}/>{err("appointmentDate")}</div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">时间段</label>
              <select value={form.appointmentSlot} onChange={e=>set("appointmentSlot",e.target.value)} className={`${inp} bg-white border-gray-200`}>
                {slots.map(s=><option key={s}>{s}</option>)}
              </select></div>
          </div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1.5">指定回收人员（选填）</label>
            <RecyclerSelect value={form.recyclers} onChange={v=>set("recyclers",v as any)} staff={staff}/></div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-all">取消</button>
          <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90" style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}>
            <Plus size={14}/>创建订单
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Order Edit Modal ─────────────────────────────────────────────────────────
function OrderEditModal({ order,staff,onSave,onClose }:{ order:Order;staff:Staff[];onSave:(o:Order)=>void;onClose:()=>void }) {
  const [form,setForm]=useState({...order});
  const statuses:OrderStatus[]=["待接单","已接单","回收中","已完成","已取消"];
  const set=<K extends keyof Order>(k:K,v:Order[K])=>setForm(f=>({...f,[k]:v}));
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"/>
      <div className="relative z-10 w-full max-w-lg mx-4 bg-white rounded-2xl shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div><h2 className="font-semibold text-gray-900">编辑订单</h2><p className="text-xs text-gray-400 font-mono mt-0.5">{order.id}</p></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="px-6 py-5 space-y-4 max-h-[68vh] overflow-y-auto">
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">用户名</label>
              <input value={form.userName} onChange={e=>set("userName",e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all"/></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">联系电话</label>
              <input value={form.phone} onChange={e=>set("phone",e.target.value.replace(/\D/g,""))} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm font-mono outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all"/></div>
          </div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1.5">地址</label>
            <textarea value={form.address} onChange={e=>set("address",e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all resize-none"/></div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1.5">物品摘要</label>
            <textarea value={form.description} onChange={e=>set("description",e.target.value)} rows={2} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all resize-none"/></div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">预约时间</label>
              <input value={form.appointmentTime} onChange={e=>set("appointmentTime",e.target.value)} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all"/></div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">状态</label>
              <select value={form.status} onChange={e=>set("status",e.target.value as OrderStatus)} className="w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-green-400 bg-white transition-all">
                {statuses.map(s=><option key={s}>{s}</option>)}
              </select></div>
          </div>
          <div><label className="block text-xs font-medium text-gray-500 mb-1.5">回收人员</label>
            <RecyclerSelect value={form.recyclers} onChange={v=>set("recyclers",v)} staff={staff}/></div>
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50 transition-all">取消</button>
          <button onClick={()=>onSave({...form,lastModified:nowStr()})} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90" style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}>
            <Save size={14}/>保存修改
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Order Detail Panel ───────────────────────────────────────────────────────
function OrderDetailPanel({ order,staff,onClose }:{ order:Order;staff:Staff[];onClose:()=>void }) {
  const [previewIdx,setPreviewIdx]=useState<number|null>(null);
  const [showContact,setShowContact]=useState(false);
  return (
    <div className="fixed inset-0 z-40 flex justify-end" onClick={onClose}>
      <div className="absolute inset-0 bg-black/20"/>
      <div className="relative w-full max-w-[460px] bg-white h-full shadow-2xl overflow-y-auto" onClick={e=>e.stopPropagation()}>
        <div className="sticky top-0 bg-white border-b border-gray-100 px-6 py-4 flex items-center justify-between z-10">
          <div><h2 className="text-base font-semibold text-gray-900">订单详情</h2><p className="text-xs text-gray-400 font-mono mt-0.5">{order.id}</p></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="px-6 py-5 space-y-5">
          <div className="flex items-center gap-3"><StatusBadge status={order.status}/><span className="text-xs text-gray-400">创建于 {order.createdAt}</span></div>
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">联系人信息</h3>
            <div className="bg-gray-50 rounded-xl p-4 space-y-3">
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0"><User size={14} className="text-green-700"/></div>
                <div className="flex-1">
                  <p className="text-xs text-gray-400">用户名 / 联系电话</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <div>
                      <p className="text-sm font-medium text-gray-800">{showContact?order.userName:maskName(order.userName)}</p>
                      <p className="text-xs font-mono text-gray-500">{showContact?order.phone:maskPhone(order.phone)}</p>
                    </div>
                    <button onClick={()=>setShowContact(v=>!v)} className="text-gray-400 hover:text-green-600 transition-colors ml-1">{showContact?<EyeOff size={14}/>:<Eye size={14}/>}</button>
                  </div>
                </div>
              </div>
              <div className="flex items-start gap-3">
                <div className="w-8 h-8 rounded-full bg-orange-100 flex items-center justify-center flex-shrink-0 mt-0.5"><MapPin size={14} className="text-orange-700"/></div>
                <div><p className="text-xs text-gray-400">回收地址</p><p className="text-sm font-medium text-gray-800 leading-relaxed">{order.address}</p></div>
              </div>
            </div>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">物品摘要</h3>
            <div className="bg-gray-50 rounded-xl p-4"><p className="text-sm text-gray-700 leading-relaxed">{order.description||"暂无描述"}</p></div>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">订单信息</h3>
            <div className="grid grid-cols-2 gap-3">
              {[["预约时间",order.appointmentTime],["废品品类",order.category],["预估重量",order.weight],["最后修改",order.lastModified]].map(([l,v])=>(
                <div key={l} className="bg-gray-50 rounded-xl p-3"><p className="text-xs text-gray-400 mb-1">{l}</p><p className="text-sm font-medium text-gray-800">{v}</p></div>
              ))}
            </div>
            <div className="bg-gray-50 rounded-xl p-3 mt-3"><p className="text-xs text-gray-400 mb-2">回收人员</p><RecyclerPills recyclers={order.recyclers} staff={staff}/></div>
          </section>
          <section>
            <h3 className="text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3">用户上传图片</h3>
            {order.images.length===0?<div className="bg-gray-50 rounded-xl py-8 flex flex-col items-center gap-2 text-gray-300"><ImageIcon size={32}/><p className="text-sm">暂无图片</p></div>
            :<div className="grid grid-cols-3 gap-2">{order.images.map((img,i)=>(<button key={i} onClick={()=>setPreviewIdx(i)} className="group relative aspect-square rounded-xl overflow-hidden bg-gray-100"><img src={img} alt="" className="w-full h-full object-cover"/><div className="absolute inset-0 bg-black/0 group-hover:bg-black/30 transition-all flex items-center justify-center opacity-0 group-hover:opacity-100"><Eye size={18} className="text-white"/></div></button>))}</div>}
          </section>
        </div>
      </div>
      {previewIdx!==null&&<ImagePreviewModal images={order.images} initialIndex={previewIdx} onClose={()=>setPreviewIdx(null)}/>}
    </div>
  );
}

// ─── Auto-accept Modal ────────────────────────────────────────────────────────
function AutoAcceptModal({ enabled,minutes,onSave,onClose }:{ enabled:boolean;minutes:number;onSave:(en:boolean,min:number)=>void;onClose:()=>void }) {
  const [en,setEn]=useState(enabled); const [min,setMin]=useState(minutes);
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/30 backdrop-blur-sm"/>
      <div className="relative z-10 w-full max-w-sm mx-4 bg-white rounded-2xl shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2"><AlarmClock size={18} className="text-green-600"/><h2 className="font-semibold text-gray-900">超时自动接单</h2></div>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={18}/></button>
        </div>
        <div className="px-5 py-5 space-y-4">
          <p className="text-sm text-gray-500 leading-relaxed">开启后，系统将自动把超时未处理的「待接单」订单变更为「已接单」状态。</p>
          <div className="flex items-center justify-between py-2 border border-gray-100 rounded-xl px-4">
            <div><p className="text-sm font-medium text-gray-800">启用自动接单</p><p className="text-xs text-gray-400 mt-0.5">{en?"当前已开启":"当前已关闭"}</p></div>
            <button onClick={()=>setEn(v=>!v)}>{en?<ToggleRight size={28} className="text-green-500"/>:<ToggleLeft size={28} className="text-gray-300"/>}</button>
          </div>
          <div className={`space-y-2 transition-opacity ${en?"opacity-100":"opacity-40 pointer-events-none"}`}>
            <label className="block text-xs font-medium text-gray-500">超时时长（分钟）</label>
            <div className="flex items-center gap-3"><input type="range" min={5} max={120} step={5} value={min} onChange={e=>setMin(+e.target.value)} className="flex-1 accent-green-600"/>
              <span className="text-sm font-mono font-bold text-green-700 w-16 text-right">{min} 分钟</span></div>
            <div className="flex gap-2">{[10,20,30,60].map(v=>(<button key={v} onClick={()=>setMin(v)} className={`flex-1 py-1.5 rounded-lg text-xs font-medium border transition-all ${min===v?"bg-green-600 text-white border-green-600":"border-gray-200 text-gray-500 hover:border-green-400"}`}>{v}分</button>))}</div>
          </div>
        </div>
        <div className="px-5 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">取消</button>
          <button onClick={()=>{onSave(en,min);onClose();}} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90" style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}><Save size={14}/>保存设置</button>
        </div>
      </div>
    </div>
  );
}

// ─── Column Visibility Dropdown ───────────────────────────────────────────────
function ColVisibilityMenu({ cols,hidden,onToggle }:{ cols:ColDef[];hidden:Set<string>;onToggle:(id:string)=>void }) {
  const [open,setOpen]=useState(false);
  const ref=useRef<HTMLDivElement>(null);
  useEffect(()=>{
    const h=(e:MouseEvent)=>{if(ref.current&&!ref.current.contains(e.target as Node))setOpen(false);};
    document.addEventListener("mousedown",h); return ()=>document.removeEventListener("mousedown",h);
  },[]);
  const toggleable=cols.filter(c=>!c.alwaysVisible);
  return (
    <div ref={ref} className="relative">
      <button onClick={()=>setOpen(v=>!v)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm border transition-all ${open?"border-green-400 text-green-700 bg-green-50":"border-gray-200 text-gray-600 hover:border-gray-300"}`}>
        <Columns3 size={14}/> 列设置 {hidden.size>0&&<span className="text-xs bg-green-600 text-white rounded-full px-1.5 py-0.5 leading-none">{hidden.size}</span>}
      </button>
      {open&&<div className="absolute right-0 mt-1 w-44 bg-white border border-gray-200 rounded-xl shadow-lg py-2 z-40">
        <p className="text-[10px] font-semibold text-gray-400 uppercase px-3 pb-1">显示字段</p>
        {toggleable.map(col=>{
          const visible=!hidden.has(col.id);
          return <button key={col.id} onClick={()=>onToggle(col.id)} className="w-full flex items-center gap-2 px-3 py-2 hover:bg-gray-50 text-sm transition-colors">
            <div className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 ${visible?"bg-green-600 border-green-600":"border-gray-300"}`}>{visible&&<Check size={10} className="text-white"/>}</div>
            <span className="text-gray-700">{col.label}</span>
          </button>;
        })}
      </div>}
    </div>
  );
}

// ─── Orders Page ──────────────────────────────────────────────────────────────
function OrdersPage({ staff,groups,orders,onSaveOrder,onUnsupported }:{ staff:Staff[];groups:RecycleGroup[];orders:Order[];onSaveOrder:(order:Order)=>Promise<void>;onUnsupported:(feature:string)=>void }) {
  const [cols,setCols]=useState<ColDef[]>(INIT_COLS);
  const [hiddenCols,setHiddenCols]=useState<Set<string>>(new Set());
  const [search,setSearch]=useState("");
  const [filterStatus,setFilterStatus]=useState<OrderStatus|"全部">("全部");
  const [detailOrder,setDetailOrder]=useState<Order|null>(null);
  const [editOrder,setEditOrder]=useState<Order|null>(null);
  const [showNew,setShowNew]=useState(false);
  const [previewInfo,setPreviewInfo]=useState<{images:string[];idx:number}|null>(null);
  const [showAutoModal,setShowAutoModal]=useState(false);
  const [autoEnabled,setAutoEnabled]=useState(false);
  const [autoMinutes,setAutoMinutes]=useState(30);
  const [dateFilterType,setDateFilterType]=useState<"appointment"|"completed">("appointment");
  const [dateFrom,setDateFrom]=useState(""); const [dateTo,setDateTo]=useState("");
  const [visibleContacts,setVisibleContacts]=useState<Set<string>>(new Set());

  const toggleContact=(id:string)=>setVisibleContacts(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});
  const toggleHiddenCol=(id:string)=>setHiddenCols(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});

  // Column resize
  const resizing=useRef<{colId:string;startX:number;startW:number}|null>(null);
  function startResize(e:React.MouseEvent,colId:string){
    e.preventDefault();e.stopPropagation();
    const col=cols.find(c=>c.id===colId)!;
    resizing.current={colId,startX:e.clientX,startW:col.width};
    const onMove=(ev:MouseEvent)=>{if(!resizing.current)return;const delta=ev.clientX-resizing.current.startX;const col2=cols.find(c=>c.id===resizing.current!.colId)!;setCols(prev=>prev.map(c=>c.id===resizing.current!.colId?{...c,width:Math.max(col2.minWidth,resizing.current!.startW+delta)}:c));};
    const onUp=()=>{resizing.current=null;document.removeEventListener("mousemove",onMove);document.removeEventListener("mouseup",onUp);};
    document.addEventListener("mousemove",onMove);document.addEventListener("mouseup",onUp);
  }
  // Column drag reorder
  const dragCol=useRef<string|null>(null);
  const onDragStart=(e:React.DragEvent,colId:string)=>{dragCol.current=colId;e.dataTransfer.effectAllowed="move";};
  const onDrop=(e:React.DragEvent,targetId:string)=>{
    e.preventDefault();if(!dragCol.current||dragCol.current===targetId)return;
    setCols(prev=>{const arr=[...prev];const fi=arr.findIndex(c=>c.id===dragCol.current);const ti=arr.findIndex(c=>c.id===targetId);if(fi<0||ti<0)return prev;const[item]=arr.splice(fi,1);arr.splice(ti,0,item);return arr;});
    dragCol.current=null;
  };

  const statuses:( OrderStatus|"全部")[]=["全部","待接单","已接单","回收中","已完成","已取消"];
  const visibleCols=cols.filter(c=>!hiddenCols.has(c.id));
  const filtered=orders.filter(o=>{
    if(filterStatus!=="全部"&&o.status!==filterStatus)return false;
    const q=search.toLowerCase();
    if(q&&!o.id.includes(q)&&!o.userName.includes(q)&&!o.phone.includes(q)&&!o.description.includes(q))return false;
    if(dateFrom||dateTo){
      const ds=dateFilterType==="appointment"?o.createdAt:o.completedAt;
      if(!ds)return false;
      const d=parseDate(ds);
      if(dateFrom&&d&&d<new Date(dateFrom))return false;
      if(dateTo&&d&&d>new Date(dateTo))return false;
    }
    return true;
  });
  const totalAmount=filtered.filter(o=>o.status==="已完成").reduce((s,o)=>s+(o.amount??0),0);

  function renderCell(col:ColDef,order:Order){
    switch(col.id){
      case "id": return <span className="font-mono text-xs text-gray-600 tracking-wide">{order.id}</span>;
      case "status": return <StatusBadge status={order.status}/>;
      case "contact":{
        const show=visibleContacts.has(order.id);
        return(
          <div className="flex items-center gap-1.5">
            <div className="w-7 h-7 rounded-full bg-green-100 flex items-center justify-center flex-shrink-0"><span className="text-xs font-semibold text-green-700">{order.userName[0]}</span></div>
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-gray-800 leading-tight">{show?order.userName:maskName(order.userName)}</p>
              <p className="text-xs font-mono text-gray-500 leading-tight">{show?order.phone:maskPhone(order.phone)}</p>
            </div>
            <button onClick={()=>toggleContact(order.id)} className="text-gray-300 hover:text-green-600 transition-colors flex-shrink-0">{show?<EyeOff size={12}/>:<Eye size={12}/>}</button>
          </div>
        );
      }
      case "address": return (
        <div className="flex items-center gap-1 min-w-0">
          <span className="text-xs text-gray-600 truncate flex-1" title={order.address}>{order.address}</span>
          <a href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(order.address)}`} target="_blank" rel="noopener noreferrer" className="flex-shrink-0 p-1 rounded-md text-gray-300 hover:text-blue-500 hover:bg-blue-50 transition-colors" title="查看路线" onClick={e=>e.stopPropagation()}>
            <Navigation size={12}/>
          </a>
        </div>
      );
      case "summary": return <span className="text-xs text-gray-500 block truncate" title={order.description}>{order.description||"—"}</span>;
      case "appointmentTime": return <span className="text-xs text-gray-600 whitespace-nowrap">{order.appointmentTime}</span>;
      case "images": return order.images.length===0?<span className="text-xs text-gray-300">暂无</span>:(
        <div className="flex -space-x-1">
          {order.images.slice(0,3).map((img,i)=>(<ImageThumb key={i} src={img} onClick={()=>setPreviewInfo({images:order.images,idx:i})}/>))}
          {order.images.length>3&&<div className="w-8 h-8 rounded-lg bg-gray-100 border-2 border-white flex items-center justify-center flex-shrink-0"><span className="text-[10px] font-bold text-gray-500">+{order.images.length-3}</span></div>}
        </div>
      );
      case "recyclers": return <RecyclerPills recyclers={order.recyclers} staff={staff}/>;
      case "lastModified": return <span className="text-xs text-gray-400 font-mono">{order.lastModified}</span>;
      case "actions": return(
        <RowActions layout="stack">
          <RowActionButton tone="green" icon={Eye} onClick={()=>setDetailOrder(order)}>详情</RowActionButton>
          <RowActionButton tone="blue" icon={Edit2} onClick={()=>setEditOrder(order)}>修改</RowActionButton>
        </RowActions>
      );
      default: return null;
    }
  }

  const totalW=visibleCols.reduce((s,c)=>s+c.width,0);

  return(
    <div className="p-6 space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-xl font-semibold text-gray-900">订单管理</h1><p className="text-xs text-gray-400 mt-0.5">拖动列标题调整顺序 · 拖动右边框调整宽度</p></div>
        <div className="flex items-center gap-2 flex-wrap">
          {autoEnabled&&<span className="flex items-center gap-1.5 text-xs text-green-700 bg-green-50 border border-green-200 px-3 py-1.5 rounded-lg font-medium"><span className="w-2 h-2 rounded-full bg-green-500 animate-pulse"/>自动接单已开启 · {autoMinutes}分钟</span>}
          <button onClick={()=>setShowAutoModal(true)} className={`flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium border transition-all ${autoEnabled?"border-green-400 text-green-700 bg-green-50":"border-gray-200 text-gray-600 hover:border-gray-300"}`}><AlarmClock size={14}/>超时自动接单</button>
          <button onClick={()=>setShowNew(true)} className="flex items-center gap-1.5 px-3 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all" style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}><Plus size={14}/>新建订单</button>
        </div>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-6 gap-3">
        {(["待接单","已接单","回收中","已完成","已取消"] as OrderStatus[]).map(s=>{
          const cnt=filtered.filter(o=>o.status===s).length;
          const cfg=STATUS_CFG[s];
          return(<button key={s} onClick={()=>setFilterStatus(filterStatus===s?"全部":s)} className={`bg-white rounded-xl p-3.5 text-left border transition-all ${filterStatus===s?"border-green-400 shadow-sm":"border-transparent hover:border-gray-200"}`}>
            <p className={`text-xl font-bold font-mono ${cfg.color}`}>{cnt}</p><p className="text-xs text-gray-400 mt-1">{s}</p>
          </button>);
        })}
        <div className="bg-white rounded-xl p-3.5 border border-green-100">
          <p className="text-xl font-bold font-mono text-green-700">¥{totalAmount.toFixed(2)}</p><p className="text-xs text-gray-400 mt-1">已回收金额</p>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white rounded-xl p-4 space-y-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative flex-1 min-w-[200px]">
            <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
            <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索订单号、用户名、电话、物品摘要…" className="w-full pl-9 pr-4 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all"/>
          </div>
          <div className="flex gap-1.5 flex-wrap">
            {statuses.map(s=>(<button key={s} onClick={()=>setFilterStatus(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${filterStatus===s?"bg-green-600 text-white":"bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{s}</button>))}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-gray-50">
          <span className="text-xs font-medium text-gray-500 whitespace-nowrap">日期筛选：</span>
          <div className="flex gap-1.5">
            {([{v:"appointment" as const,l:"按预约时间"},{v:"completed" as const,l:"按完成时间"}]).map(opt=>(<button key={opt.v} onClick={()=>setDateFilterType(opt.v)} className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${dateFilterType===opt.v?"bg-green-600 text-white":"bg-gray-100 text-gray-500 hover:bg-gray-200"}`}>{opt.l}</button>))}
          </div>
          <div className="flex items-center gap-2">
            <input type="date" value={dateFrom} onChange={e=>setDateFrom(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-green-400 transition-all"/>
            <span className="text-xs text-gray-400">至</span>
            <input type="date" value={dateTo} onChange={e=>setDateTo(e.target.value)} className="px-3 py-1.5 rounded-lg border border-gray-200 text-xs outline-none focus:border-green-400 transition-all"/>
            {(dateFrom||dateTo)&&<button onClick={()=>{setDateFrom("");setDateTo("");}} className="text-gray-400 hover:text-red-500 transition-colors p-1.5 rounded-lg hover:bg-red-50"><X size={13}/></button>}
          </div>
          <div className="ml-auto"><ColVisibilityMenu cols={cols} hidden={hiddenCols} onToggle={toggleHiddenCol}/></div>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl overflow-hidden border border-gray-100">
        <div className="overflow-x-auto">
          <table style={{tableLayout:"fixed",width:totalW,minWidth:"100%"}}>
            <colgroup>{visibleCols.map(c=><col key={c.id} style={{width:c.width}}/>)}</colgroup>
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {visibleCols.map((col,ci)=>(
                  <th key={col.id} draggable={!col.fixed}
                    onDragStart={e=>!col.fixed&&onDragStart(e,col.id)}
                    onDragOver={e=>{e.preventDefault();e.dataTransfer.dropEffect="move";}}
                    onDrop={e=>!col.fixed&&onDrop(e,col.id)}
                    className={`text-left px-4 py-3 text-xs font-semibold text-gray-500 relative select-none whitespace-nowrap group ${ci<visibleCols.length-1?"border-r border-gray-200":""}`}
                    style={{width:col.width}}>
                    <div className="flex items-center gap-1">
                      {!col.fixed&&<GripVertical size={11} className="text-gray-300 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0 cursor-grab"/>}
                      {col.label}
                    </div>
                    <div onMouseDown={e=>startResize(e,col.id)} className="absolute right-0 top-0 bottom-0 w-3 flex items-center justify-center cursor-col-resize opacity-0 group-hover:opacity-100 transition-opacity z-10">
                      <div className="w-0.5 h-4 bg-green-400 rounded-full"/>
                    </div>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {filtered.map((order,i)=>(
                <tr key={order.id} className={`border-b border-gray-50 hover:bg-green-50/20 transition-colors ${i%2===1?"bg-gray-50/20":""}`}>
                  {visibleCols.map((col,ci)=>(
                    <td key={col.id} className="px-4 py-3" style={{width:col.width,maxWidth:col.width,overflow:"hidden"}}>
                      {renderCell(col,order)}
                    </td>
                  ))}
                </tr>
              ))}
              {filtered.length===0&&<tr><td colSpan={visibleCols.length} className="px-4 py-12 text-center text-gray-300 text-sm">暂无符合条件的订单</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between">
          <span className="text-xs text-gray-400">显示 {filtered.length} / {orders.length} 条</span>
          <div className="flex gap-1">{[1,2,3].map(n=>(<button key={n} className={`w-7 h-7 rounded-lg text-xs font-medium transition-all ${n===1?"bg-green-600 text-white":"text-gray-500 hover:bg-gray-100"}`}>{n}</button>))}</div>
        </div>
      </div>

      {detailOrder&&<OrderDetailPanel order={detailOrder} staff={staff} onClose={()=>setDetailOrder(null)}/>}
      {editOrder&&<OrderEditModal order={editOrder} staff={staff} onSave={o=>{void onSaveOrder(o).then(()=>setEditOrder(null)).catch(()=>undefined);}} onClose={()=>setEditOrder(null)}/>} 
      {showNew&&<NewOrderModal onSave={()=>{setShowNew(false);onUnsupported("后台新建订单");}} onClose={()=>setShowNew(false)} staff={staff} groups={groups} orders={orders}/>} 
      {previewInfo&&<ImagePreviewModal images={previewInfo.images} initialIndex={previewInfo.idx} onClose={()=>setPreviewInfo(null)}/>} 
      {showAutoModal&&<AutoAcceptModal enabled={autoEnabled} minutes={autoMinutes} onSave={(en,min)=>{setAutoEnabled(false);setAutoMinutes(min);setShowAutoModal(false);onUnsupported(en?"超时自动接单":"超时自动接单配置");}} onClose={()=>setShowAutoModal(false)}/>} 
    </div>
  );
}

// ─── Staff Page ───────────────────────────────────────────────────────────────
function StaffPage({ staff,onUnsupported }:{ staff:Staff[];onUnsupported:(feature:string)=>void }) {
  const [showPhone,setShowPhone]=useState<Set<string>>(new Set());
  const togglePhone=(id:string)=>setShowPhone(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});
  const cycleStatus=()=>onUnsupported("回收人员状态管理");
  const counts={online:staff.filter(s=>s.status==="online").length,resting:staff.filter(s=>s.status==="resting").length,resigned:staff.filter(s=>s.status==="resigned").length};
  return(
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between">
        <div><h1 className="text-xl font-semibold text-gray-900">人员管理</h1><p className="text-sm text-gray-400 mt-0.5">共 {staff.length} 名回收人员</p></div>
        <button onClick={()=>onUnsupported("添加回收人员")} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all" style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}><Plus size={14}/>添加人员</button>
      </div>
      <div className="grid grid-cols-3 gap-3">
        {[{label:"在线（可接单）",val:counts.online,color:"text-green-600"},{label:"休息（暂停接单）",val:counts.resting,color:"text-amber-600"},{label:"离职",val:counts.resigned,color:"text-gray-400"}].map(item=>(
          <div key={item.label} className="bg-white rounded-xl p-4 border border-transparent">
            <p className={`text-2xl font-bold font-mono ${item.color}`}>{item.val}</p><p className="text-xs text-gray-400 mt-1">{item.label}</p>
          </div>
        ))}
      </div>
      <div className="bg-white rounded-xl overflow-hidden border border-gray-100">
        <table className="w-full">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-100">
              {["工号","姓名","联系电话","门店","服务区域","入职日期","状态","权限管理","操作"].map(h=>(
                <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-gray-500 border-r border-gray-200 last:border-0">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {staff.map((s,i)=>(
              <tr key={s.id} className={`border-b border-gray-50 hover:bg-gray-50/50 transition-colors ${i%2===1?"bg-gray-50/20":""}`}>
                <td className="px-4 py-3 border-r border-gray-50"><span className="font-mono text-xs text-gray-400">{s.id}</span></td>
                <td className="px-4 py-3 border-r border-gray-50">
                  <div className="flex items-center gap-2">
                    <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0 text-white text-xs font-bold ${s.status==="online"?"":"opacity-40"}`} style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}>
                      {s.name[0]}
                    </div>
                    <span className="text-sm font-medium text-gray-800">{s.name}</span>
                  </div>
                </td>
                <td className="px-4 py-3 border-r border-gray-50">
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-xs text-gray-700">{showPhone.has(s.id)?s.phone:maskPhone(s.phone)}</span>
                    <button onClick={()=>togglePhone(s.id)} className="text-gray-400 hover:text-green-600 transition-colors">{showPhone.has(s.id)?<EyeOff size={12}/>:<Eye size={12}/>}</button>
                  </div>
                </td>
                <td className="px-4 py-3 border-r border-gray-50">
                  <div className="flex items-center gap-1"><Store size={12} className="text-gray-400 flex-shrink-0"/><span className="text-xs text-gray-600">{s.store}</span></div>
                </td>
                <td className="px-4 py-3 border-r border-gray-50"><span className="text-sm text-gray-600">{s.area}</span></td>
                <td className="px-4 py-3 border-r border-gray-50"><span className="text-xs font-mono text-gray-500">{s.joinDate}</span></td>
                <td className="px-4 py-3 border-r border-gray-50"><button onClick={cycleStatus} title="点击切换状态"><StaffBadge status={s.status}/></button></td>
                <td className="px-4 py-3 border-r border-gray-50">
                  <RowActionButton tone="gray" icon={Lock} onClick={()=>onUnsupported("人员权限配置")}>权限配置</RowActionButton>
                </td>
                <td className="px-4 py-3">
                  <RowActions layout="stack">
                    <RowActionButton tone="blue" icon={Edit2} onClick={()=>onUnsupported("编辑回收人员")}>编辑</RowActionButton>
                    <RowActionButton tone="red" icon={Trash2} onClick={()=>onUnsupported("删除回收人员")}>删除</RowActionButton>
                  </RowActions>
                </td>
              </tr>
            ))}
            {staff.length===0&&<tr><td colSpan={9} className="px-6 py-16 text-center"><Users size={32} className="mx-auto text-gray-200 mb-3"/><p className="text-sm text-gray-400">暂无回收人员数据</p><p className="text-xs text-gray-300 mt-1">人员接口接入后将在这里显示真实人员</p></td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Add Item Modal ───────────────────────────────────────────────────────────
function AddItemModal({ groups,onSave,onClose }:{ groups:RecycleGroup[];onSave:(gid:string,item:RecycleItem)=>void;onClose:()=>void }) {
  const [form,setForm]=useState({ name:"",unit:"kg",price:"",stationPrice:"",groupId:groups[0]?.id||"",fieldEstimate:false,enabled:true });
  const [err,setErr]=useState<Record<string,string>>({});
  const set=(k:string,v:string|boolean)=>setForm(f=>({...f,[k]:v}));
  const selGroup=groups.find(g=>g.id===form.groupId);
  function validate(){
    const e:Record<string,string>={};
    if(!form.name.trim()) e.name="请填写品类名称";
    if(!form.fieldEstimate&&!form.price.trim()) e.price="请填写收购单价";
    setErr(e); return Object.keys(e).length===0;
  }
  function handleSave(){
    if(!validate()) return;
    const newItem:RecycleItem={
      id:`${form.groupId}-${Date.now()}`,name:form.name,unit:form.unit,
      price:form.fieldEstimate?"—":form.price, stationPrice:form.fieldEstimate?"—":form.stationPrice||"—",
      fieldEstimate:form.fieldEstimate, enabled:form.enabled,
    };
    onSave(form.groupId,newItem);
  }
  const inp="w-full px-3 py-2 rounded-lg border text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all";
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center" onClick={onClose}>
      <div className="absolute inset-0 bg-black/40 backdrop-blur-sm"/>
      <div className="relative z-10 w-full max-w-md mx-4 bg-white rounded-2xl shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <h2 className="font-semibold text-gray-900">添加品类</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600"><X size={20}/></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1.5">所属分组 <span className="text-red-400">*</span></label>
            <select value={form.groupId} onChange={e=>set("groupId",e.target.value)} className={`${inp} bg-white border-gray-200`}>
              {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">品类名称 <span className="text-red-400">*</span></label>
              <input value={form.name} onChange={e=>set("name",e.target.value)} placeholder="如：铜线" className={`${inp} ${err.name?"border-red-300":"border-gray-200"}`}/>
              {err.name&&<p className="text-xs text-red-500 mt-1">{err.name}</p>}
            </div>
            <div><label className="block text-xs font-medium text-gray-500 mb-1.5">计量单位</label>
              <select value={form.unit} onChange={e=>set("unit",e.target.value)} className={`${inp} bg-white border-gray-200`}>
                {["kg","台","件","双","袋","箱"].map(u=><option key={u}>{u}</option>)}
              </select>
            </div>
          </div>
          {selGroup?.allowFieldEstimate&&(
            <div className="flex items-center justify-between py-2 px-3 bg-amber-50 border border-amber-100 rounded-xl">
              <div><p className="text-sm font-medium text-amber-800">现场估价</p><p className="text-xs text-amber-600 mt-0.5">开启后该品类将在上门时估价，不设固定单价</p></div>
              <button onClick={()=>set("fieldEstimate",!form.fieldEstimate)}>{form.fieldEstimate?<ToggleRight size={26} className="text-amber-500"/>:<ToggleLeft size={26} className="text-gray-300"/>}</button>
            </div>
          )}
          {!form.fieldEstimate&&(
            <div className="grid grid-cols-2 gap-4">
              <div><label className="block text-xs font-medium text-gray-500 mb-1.5">收购单价（元） <span className="text-red-400">*</span></label>
                <input value={form.price} onChange={e=>set("price",e.target.value)} placeholder="0.00" className={`${inp} font-mono ${err.price?"border-red-300":"border-gray-200"}`}/>
                {err.price&&<p className="text-xs text-red-500 mt-1">{err.price}</p>}
              </div>
              <div><label className="block text-xs font-medium text-gray-500 mb-1.5">打包站价格（元）</label>
                <input value={form.stationPrice} onChange={e=>set("stationPrice",e.target.value)} placeholder="0.00" className={`${inp} font-mono border-gray-200`}/>
              </div>
            </div>
          )}
        </div>
        <div className="px-6 py-4 border-t border-gray-100 flex justify-end gap-3">
          <button onClick={onClose} className="px-4 py-2 rounded-lg border border-gray-200 text-sm text-gray-600 hover:bg-gray-50">取消</button>
          <button onClick={handleSave} className="flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90" style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}><Plus size={14}/>添加品类</button>
        </div>
      </div>
    </div>
  );
}

// ─── Import Excel Modal ───────────────────────────────────────────────────────
interface ImportRow { name:string; unit:string; price:string; stationPrice:string; }
function ImportModal({groups,onImport,onClose}:{groups:RecycleGroup[];onImport:(gid:string,items:RecycleItem[])=>void;onClose:()=>void}) {
  const [rows,setRows]=useState<ImportRow[]>([]);
  const [error,setError]=useState("");
  const [dragging,setDragging]=useState(false);
  const [gid,setGid]=useState(groups[0]?.id||"");
  const [fileName,setFileName]=useState("");
  const inputRef=useRef<HTMLInputElement>(null);

  function parseCSV(text:string):ImportRow[] {
    const lines=text.split(/\r?\n/).filter(l=>l.trim());
    if(lines.length<2) return [];
    return lines.slice(1).map(line=>{
      const cols=line.split(",").map(c=>c.replace(/^"|"$/g,"").trim());
      return {name:cols[0]||"",unit:cols[1]||"个",price:cols[2]||"0",stationPrice:cols[3]||cols[2]||"0"};
    }).filter(r=>r.name);
  }

  async function parseXLSX(file:File):Promise<ImportRow[]> {
    const {Workbook}=await import("exceljs");
    const workbook=new Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const worksheet=workbook.worksheets[0];
    if(!worksheet) return [];
    const result:ImportRow[]=[];
    worksheet.eachRow((row,rowNumber)=>{
      if(rowNumber===1) return;
      const values=[1,2,3,4].map(index=>String(row.getCell(index).text||"").trim());
      if(values[0]) result.push({name:values[0],unit:values[1]||"个",price:values[2]||"0",stationPrice:values[3]||values[2]||"0"});
    });
    return result;
  }

  async function handleFile(file:File) {
    setError(""); setRows([]);
    setFileName(file.name);
    const isCSV=file.name.toLowerCase().endsWith(".csv");
    const isXLSX=/\.xlsx?$/.test(file.name.toLowerCase());
    if(!isCSV&&!isXLSX){setError("仅支持 .xlsx 或 .csv 格式文件");return;}
    try{
      const parsed=isCSV?parseCSV(await file.text()):await parseXLSX(file);
      if(!parsed.length){setError("未找到有效数据行，请检查格式");return;}
      setRows(parsed);
    }catch{ setError("解析失败，请检查文件格式"); }
  }

  async function downloadTemplate() {
    const {Workbook}=await import("exceljs");
    const workbook=new Workbook();
    const worksheet=workbook.addWorksheet("品类模板");
    worksheet.addRows([["品类名称","单位","收购单价(元)","打包站价格(元)"],["铜线","公斤","35.00","38.00"],["铁","公斤","1.20","1.50"]]);
    const buffer=await workbook.xlsx.writeBuffer();
    const url=URL.createObjectURL(new Blob([new Uint8Array(buffer)],{type:"application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"}));
    const link=document.createElement("a");link.href=url;link.download="品类导入模板.xlsx";link.click();URL.revokeObjectURL(url);
  }

  function handleImport() {
    if(!rows.length){setError("请先选择文件并解析数据");return;}
    const items:RecycleItem[]=rows.map((r,i)=>({id:`import_${Date.now()}_${i}`,name:r.name,unit:r.unit,price:r.price,stationPrice:r.stationPrice,enabled:true}));
    onImport(gid,items);
  }

  return(
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl max-h-[90vh] flex flex-col" onClick={e=>e.stopPropagation()}>
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-gray-100">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-green-50 flex items-center justify-center"><FileSpreadsheet size={16} className="text-green-600"/></div>
            <div><p className="font-semibold text-gray-900 text-sm">Excel 批量导入品类</p><p className="text-xs text-gray-400 mt-0.5">支持 .xlsx / .xls / .csv 格式</p></div>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"><X size={16}/></button>
        </div>

        <div className="overflow-y-auto flex-1 p-6 space-y-4">
          {/* Template + Group selector */}
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">导入到分组：</span>
              <select value={gid} onChange={e=>setGid(e.target.value)} className="text-sm border border-gray-200 rounded-lg px-3 py-1.5 outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all bg-white">
                {groups.map(g=><option key={g.id} value={g.id}>{g.name}</option>)}
              </select>
            </div>
            <button onClick={()=>void downloadTemplate()} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium text-blue-600 bg-blue-50 border border-blue-100 hover:bg-blue-100 transition-colors"><Download size={12}/>下载模板</button>
          </div>

          {/* Drop zone */}
          <div
            onDragOver={e=>{e.preventDefault();setDragging(true);}}
            onDragLeave={()=>setDragging(false)}
            onDrop={e=>{e.preventDefault();setDragging(false);const f=e.dataTransfer.files[0];if(f)void handleFile(f);}}
            onClick={()=>inputRef.current?.click()}
            className={`border-2 border-dashed rounded-xl py-10 flex flex-col items-center gap-3 cursor-pointer transition-all ${dragging?"border-green-400 bg-green-50":"border-gray-200 hover:border-green-300 hover:bg-gray-50"}`}
          >
            <div className={`w-12 h-12 rounded-full flex items-center justify-center ${dragging?"bg-green-100":"bg-gray-100"}`}><Upload size={22} className={dragging?"text-green-600":"text-gray-400"}/></div>
            {fileName
              ?<div className="text-center"><p className="text-sm font-medium text-green-700">{fileName}</p><p className="text-xs text-gray-400 mt-0.5">点击重新选择文件</p></div>
              :<div className="text-center"><p className="text-sm font-medium text-gray-600">拖拽文件到此处，或点击选择</p><p className="text-xs text-gray-400 mt-0.5">支持 .xlsx、.xls、.csv 格式</p></div>
            }
            <input ref={inputRef} type="file" accept=".xlsx,.xls,.csv" className="hidden" onChange={e=>{const f=e.target.files?.[0];if(f)void handleFile(f);e.target.value="";}}/>
          </div>

          {/* Error */}
          {error&&<div className="flex items-center gap-2 p-3 bg-red-50 border border-red-100 rounded-lg text-sm text-red-600"><AlertCircle size={14} className="flex-shrink-0"/>{error}</div>}

          {/* Preview */}
          {rows.length>0&&(
            <div>
              <div className="flex items-center justify-between mb-2">
                <p className="text-xs font-semibold text-gray-500 uppercase tracking-wide">预览（共 {rows.length} 条）</p>
                <button onClick={()=>{setRows([]);setFileName("");setError("");}} className="text-xs text-gray-400 hover:text-red-500 transition-colors">清除</button>
              </div>
              <div className="border border-gray-100 rounded-xl overflow-hidden">
                <table className="w-full">
                  <thead><tr className="bg-gray-50 border-b border-gray-100">
                    {["品类名称","单位","收购单价","打包站价"].map(h=><th key={h} className="text-left px-4 py-2 text-xs font-semibold text-gray-400">{h}</th>)}
                  </tr></thead>
                  <tbody>
                    {rows.slice(0,10).map((r,i)=>(
                      <tr key={i} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/50">
                        <td className="px-4 py-2 text-sm font-medium text-gray-800">{r.name}</td>
                        <td className="px-4 py-2 text-sm text-gray-500 font-mono">{r.unit}</td>
                        <td className="px-4 py-2 text-sm font-bold text-gray-800 font-mono">¥{r.price}</td>
                        <td className="px-4 py-2 text-sm font-bold text-blue-700 font-mono">¥{r.stationPrice}</td>
                      </tr>
                    ))}
                    {rows.length>10&&<tr><td colSpan={4} className="px-4 py-2 text-xs text-gray-400 text-center">… 还有 {rows.length-10} 条</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 px-6 py-4 border-t border-gray-100 bg-gray-50/50 rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 rounded-lg text-sm font-medium text-gray-600 hover:bg-gray-100 transition-colors">取消</button>
          <button
            onClick={handleImport}
            disabled={rows.length===0}
            className="flex items-center gap-2 px-5 py-2 rounded-lg text-sm font-medium text-white transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}
          >
            <FileSpreadsheet size={14}/>导入 {rows.length>0?`${rows.length} 条品类`:""}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Recycle Cats Page ────────────────────────────────────────────────────────
function RecycleCatsPage({ groups,onSaveCategory,onUnsupported }:{ groups:RecycleGroup[];onSaveCategory:(item:RecycleItem)=>Promise<void>;onUnsupported:(feature:string)=>void }) {
  const [expanded,setExpanded]=useState<Set<string>>(new Set(groups.map((group)=>group.id)));
  const [search,setSearch]=useState("");
  const [showAddItem,setShowAddItem]=useState(false);
  const [showImport,setShowImport]=useState(false);

  useEffect(()=>{setExpanded(prev=>new Set([...prev,...groups.map((group)=>group.id)]));},[groups]);
  const toggleGroup=()=>onUnsupported("品类分组启停");
  const toggleItem=(gid:string,iid:string)=>{
    const item=groups.find((group)=>group.id===gid)?.items.find((entry)=>entry.id===iid);
    if(item) void onSaveCategory({...item,enabled:!item.enabled});
  };
  const toggleExpand=(id:string)=>setExpanded(prev=>{const s=new Set(prev);s.has(id)?s.delete(id):s.add(id);return s;});

  function addItem(_gid:string,item:RecycleItem){ void onSaveCategory(item).then(()=>setShowAddItem(false)); }
  function addItems(_gid:string,items:RecycleItem[]){ void Promise.all(items.map(onSaveCategory)).then(()=>setShowImport(false)); }

  const filteredGroups=groups.map(g=>{
    const q=search.toLowerCase();
    if(!q) return g;
    const groupMatch=g.name.toLowerCase().includes(q);
    const matchedItems=g.items.filter(i=>i.name.toLowerCase().includes(q));
    if(!groupMatch&&matchedItems.length===0) return null;
    return {...g,items:groupMatch?g.items:matchedItems};
  }).filter(Boolean) as RecycleGroup[];

  return(
    <div className="p-6 space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div><h1 className="text-xl font-semibold text-gray-900">品类管理</h1><p className="text-sm text-gray-400 mt-0.5">管理回收分组及具体品类单价</p></div>
        <div className="flex items-center gap-2">
          <button onClick={()=>onUnsupported("添加品类分组")} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:border-gray-300 transition-all"><Plus size={14}/>添加分组</button>
          <button onClick={()=>setShowImport(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium border border-gray-200 text-gray-600 hover:border-gray-300 transition-all"><Upload size={14}/>导入Excel</button>
          <button onClick={()=>setShowAddItem(true)} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all" style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}><Plus size={14}/>添加品类</button>
        </div>
      </div>

      {/* Search */}
      <div className="relative">
        <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
        <input value={search} onChange={e=>setSearch(e.target.value)} placeholder="搜索品类名称或分组名称…" className="w-full pl-9 pr-4 py-2.5 rounded-xl border border-gray-200 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all bg-white"/>
        {search&&<button onClick={()=>setSearch("")} className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"><X size={14}/></button>}
      </div>

      {filteredGroups.length===0&&<div className="bg-white rounded-xl py-12 flex flex-col items-center gap-2 text-gray-300 border border-gray-100"><Search size={32}/><p>未找到匹配的品类</p></div>}

      <div className="space-y-3">
        {filteredGroups.map(group=>(
          <div key={group.id} className={`bg-white rounded-xl border overflow-hidden ${group.enabled?"border-gray-100":"border-gray-100 opacity-60"}`}>
            {/* Group header */}
            <div className="flex items-center gap-3 px-5 py-3.5 bg-gray-50 border-b border-gray-100">
              <button onClick={()=>toggleExpand(group.id)} className="text-gray-400 hover:text-gray-600 transition-colors">
                {expanded.has(group.id)?<ChevronUp size={16}/>:<ChevronDown size={16}/>}
              </button>
              <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0" style={{background:"linear-gradient(135deg,#e8f5ed,#d4edda)"}}>
                <Package size={15} className="text-green-700"/>
              </div>
              <div className="flex-1">
                <div className="flex items-center gap-2">
                  <p className="font-semibold text-gray-900 text-sm">{group.name}</p>
                  {group.allowFieldEstimate&&<span className="text-[10px] font-semibold bg-amber-100 text-amber-700 border border-amber-200 px-1.5 py-0.5 rounded-full">现场估价</span>}
                </div>
                <p className="text-xs text-gray-400">{group.desc} · {group.items.filter(i=>i.enabled).length}/{group.items.length} 个品类启用</p>
              </div>
              <button onClick={toggleGroup}>{group.enabled?<ToggleRight size={22} className="text-green-500"/>:<ToggleLeft size={22} className="text-gray-300"/>}</button>
            </div>

            {/* Items — 1 per row table */}
            {expanded.has(group.id)&&(
              group.items.length===0
              ?<div className="py-8 flex flex-col items-center gap-1 text-gray-300"><p className="text-sm">暂无品类</p><button onClick={()=>setShowAddItem(true)} className="text-xs text-green-600 hover:text-green-800 mt-1 flex items-center gap-1"><Plus size={11}/>添加品类</button></div>
              :<table className="w-full" style={{tableLayout:"fixed"}}>
                <colgroup>{CAT_COL_WIDTHS.map((w,i)=><col key={i} style={{width:w}}/>)}</colgroup>
                <thead>
                  <tr className="border-b border-gray-100">
                    {CAT_COL_HEADERS.map(h=>(
                      <th key={h} className="text-left px-4 py-2 text-xs font-semibold text-gray-400">{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {group.items.map((item,i)=>{
                    const sp=spread(item.price,item.stationPrice);
                    const pct=sp!==null&&parseFloat(item.price)>0?((parseFloat(sp)/parseFloat(item.price))*100).toFixed(1):null;
                    return(
                      <tr key={item.id} className={`border-b border-gray-50 last:border-0 hover:bg-gray-50/40 transition-colors ${!item.enabled?"opacity-50":""} ${i%2===1?"bg-gray-50/20":""}`}>
                        <td className="px-4 py-2.5">
                          <div className="flex items-center gap-2">
                            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${item.enabled?"bg-green-400":"bg-gray-300"}`}/>
                            <span className="text-sm font-medium text-gray-800">{item.name}</span>
                            {item.fieldEstimate&&<span className="text-[10px] font-medium bg-amber-50 text-amber-600 border border-amber-200 px-1.5 py-0.5 rounded-full">现场估价</span>}
                          </div>
                        </td>
                        <td className="px-4 py-2.5"><span className="text-xs text-gray-500 bg-gray-100 px-2 py-0.5 rounded font-mono">{item.unit}</span></td>
                        <td className="px-4 py-2.5">
                          {item.fieldEstimate?<span className="text-xs text-amber-600 italic">面议</span>:<span className="text-sm font-bold text-gray-800 font-mono">¥{item.price}</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {item.fieldEstimate?<span className="text-xs text-amber-600 italic">面议</span>:item.stationPrice!=="—"?<span className="text-sm font-bold text-blue-700 font-mono">¥{item.stationPrice}</span>:<span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {sp!==null?<span className={`text-sm font-bold font-mono ${parseFloat(sp)>0?"text-green-600":"text-red-500"}`}>{parseFloat(sp)>0?"+":""}{sp}</span>:<span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          {pct!==null?<span className={`text-xs font-semibold font-mono px-1.5 py-0.5 rounded ${parseFloat(pct)>0?"bg-green-50 text-green-700":"bg-red-50 text-red-600"}`}>{parseFloat(pct)>0?"+":""}{pct}%</span>:<span className="text-xs text-gray-300">—</span>}
                        </td>
                        <td className="px-4 py-2.5">
                          <button onClick={()=>toggleItem(group.id,item.id)}>
                            {item.enabled
                              ?<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 border border-green-200">已上架</span>
                              :<span className="inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-600 border border-red-200">已下架</span>
                            }
                          </button>
                        </td>
                        <td className="px-4 py-2.5">
                          <RowActions layout="inline">
                            <RowActionButton tone="blue" icon={Edit2} onClick={()=>onUnsupported("编辑品类详情")}>编辑</RowActionButton>
                            <RowActionButton tone="red" icon={Trash2} onClick={()=>onUnsupported("删除品类")}>删除</RowActionButton>
                          </RowActions>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        ))}
      </div>
      {showAddItem&&<AddItemModal groups={groups} onSave={addItem} onClose={()=>setShowAddItem(false)}/>}
      {showImport&&<ImportModal groups={groups} onImport={addItems} onClose={()=>setShowImport(false)}/>}
    </div>
  );
}

// ─── System Page ──────────────────────────────────────────────────────────────
function SystemPage({ settings,onSave }:{ settings:RecycleSettings;onSave:(settings:RecycleSettings)=>Promise<void> }) {
  const [siteName,setSiteName]=useState(settings.siteName||"绿源废品回收平台");
  const [servicePhone,setServicePhone]=useState(settings.servicePhone||"4008889999");
  const [notifyEnabled,setNotifyEnabled]=useState(settings.notifyEnabled!==false);
  const [autoAssign,setAutoAssign]=useState(Boolean(settings.autoAssign));
  const [maxDistance,setMaxDistance]=useState(String(settings.maxDistanceKm||10));
  const [saved,setSaved]=useState(false);
  const [saving,setSaving]=useState(false);
  useEffect(()=>{
    setSiteName(settings.siteName||"绿源废品回收平台");
    setServicePhone(settings.servicePhone||"4008889999");
    setNotifyEnabled(settings.notifyEnabled!==false);
    setAutoAssign(Boolean(settings.autoAssign));
    setMaxDistance(String(settings.maxDistanceKm||10));
  },[settings]);
  const save=async()=>{
    setSaving(true);
    try{
      await onSave({...settings,siteName,servicePhone,notifyEnabled,autoAssign,maxDistanceKm:Number(maxDistance)});
      setSaved(true);
      window.setTimeout(()=>setSaved(false),2000);
    }finally{setSaving(false);}
  };
  return(
    <div className="p-6 space-y-5 max-w-2xl">
      <div><h1 className="text-xl font-semibold text-gray-900">系统配置</h1><p className="text-sm text-gray-400 mt-0.5">管理平台基础设置</p></div>
      <div className="bg-white rounded-xl p-6 space-y-4 border border-gray-100">
        <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-blue-50 flex items-center justify-center"><Database size={14} className="text-blue-600"/></div><h3 className="font-semibold text-gray-800 text-sm">基础信息</h3></div>
        {[{label:"平台名称",val:siteName,set:setSiteName,mono:false},{label:"客服电话",val:servicePhone,set:setServicePhone,mono:true}].map(item=>(
          <div key={item.label}><label className="block text-xs font-medium text-gray-500 mb-1.5">{item.label}</label>
            <input value={item.val} onChange={e=>item.set(e.target.value)} className={`w-full px-3 py-2 rounded-lg border border-gray-200 text-sm outline-none focus:border-green-400 focus:ring-2 focus:ring-green-50 transition-all ${item.mono?"font-mono":""}`}/></div>
        ))}
        <div><label className="block text-xs font-medium text-gray-500 mb-1.5">最大服务半径（公里）</label>
          <div className="flex items-center gap-3"><input type="range" min={1} max={50} value={maxDistance} onChange={e=>setMaxDistance(e.target.value)} className="flex-1 accent-green-600"/>
            <span className="text-sm font-mono font-semibold text-green-700 w-14 text-right">{maxDistance} km</span></div></div>
      </div>
      <div className="bg-white rounded-xl p-6 space-y-4 border border-gray-100">
        <div className="flex items-center gap-2 mb-2"><div className="w-8 h-8 rounded-lg bg-amber-50 flex items-center justify-center"><Bell size={14} className="text-amber-600"/></div><h3 className="font-semibold text-gray-800 text-sm">通知设置</h3></div>
        {[{label:"新订单消息通知",desc:"有新订单时向管理员发送系统通知",value:notifyEnabled,set:setNotifyEnabled},{label:"自动分配回收员",desc:"系统根据距离自动匹配最近回收员",value:autoAssign,set:setAutoAssign}].map(item=>(
          <div key={item.label} className="flex items-center justify-between py-1">
            <div><p className="text-sm font-medium text-gray-800">{item.label}</p><p className="text-xs text-gray-400 mt-0.5">{item.desc}</p></div>
            <button onClick={()=>item.set(!item.value)}>{item.value?<ToggleRight size={26} className="text-green-500"/>:<ToggleLeft size={26} className="text-gray-300"/>}</button>
          </div>
        ))}
      </div>
      <button disabled={saving} onClick={()=>void save()} className="flex items-center gap-2 px-5 py-2.5 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all" style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}>
        <Save size={14}/>{saving?"正在保存…":saved?"已保存 ✓":"保存设置"}
      </button>
    </div>
  );
}

// ─── Login ────────────────────────────────────────────────────────────────────
function LoginPage({ onLogin }:{ onLogin:()=>void }) {
  const [username,setUsername]=useState(""); const [password,setPassword]=useState("");
  const [error,setError]=useState(""); const [loading,setLoading]=useState(false);
  const handleSubmit=(e:React.FormEvent)=>{
    e.preventDefault();
    if(!username||!password){setError("请输入用户名和密码");return;}
    setLoading(true);setError("");
    setTimeout(()=>{username==="admin"&&password==="admin123"?onLogin():(setError("用户名或密码错误"),setLoading(false));},700);
  };
  return(
    <div className="min-h-screen flex items-center justify-center relative overflow-hidden" style={{background:"linear-gradient(135deg,#1e2d1e 0%,#2a4a2a 40%,#1a7a3c 100%)"}}>
      <div className="absolute top-[-80px] left-[-80px] w-80 h-80 rounded-full opacity-10" style={{background:"#2ecc71"}}/>
      <div className="absolute bottom-[-60px] right-[-60px] w-64 h-64 rounded-full opacity-10" style={{background:"#27ae60"}}/>
      <div className="relative z-10 w-full max-w-[400px] mx-4">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 rounded-2xl mb-4" style={{background:"rgba(46,204,113,0.2)",border:"1px solid rgba(46,204,113,0.3)"}}><RefreshCw size={30} className="text-green-400"/></div>
          <h1 className="text-2xl font-bold text-white tracking-wide">绿源废品回收</h1>
          <p className="text-green-300 text-sm mt-1 opacity-80">后台管理系统</p>
        </div>
        <div className="bg-white rounded-2xl p-8 shadow-2xl">
          <h2 className="text-lg font-semibold text-gray-800 mb-6">登录账号</h2>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div><label className="block text-sm font-medium text-gray-600 mb-1.5">用户名</label>
              <div className="relative"><User size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input type="text" value={username} onChange={e=>setUsername(e.target.value)} placeholder="请输入用户名" className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition-all"/>
              </div>
            </div>
            <div><label className="block text-sm font-medium text-gray-600 mb-1.5">密码</label>
              <div className="relative"><Lock size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"/>
                <input type="password" value={password} onChange={e=>setPassword(e.target.value)} placeholder="请输入密码" className="w-full pl-9 pr-4 py-2.5 rounded-lg border border-gray-200 text-sm outline-none focus:border-green-500 focus:ring-2 focus:ring-green-100 transition-all"/>
              </div>
            </div>
            {error&&<div className="flex items-center gap-2 text-red-600 text-sm bg-red-50 px-3 py-2 rounded-lg"><XCircle size={14}/>{error}</div>}
            <button type="submit" disabled={loading} className="w-full py-2.5 rounded-lg font-medium text-sm text-white mt-2 flex items-center justify-center gap-2 disabled:opacity-70 hover:opacity-90 transition-all" style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}>
              {loading&&<Loader size={14} className="animate-spin"/>}{loading?"登录中…":"登 录"}
            </button>
          </form>
          <p className="text-center text-xs text-gray-400 mt-5">演示账号: admin / admin123</p>
        </div>
      </div>
    </div>
  );
}

// ─── Analytics Page ───────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string,string> = {
  "待接单":"#f59e0b","已接单":"#3b82f6","回收中":"#8b5cf6","已完成":"#22c55e","已取消":"#ef4444",
};
const CAT_PALETTE = ["#1a7a3c","#27ae60","#3b82f6","#8b5cf6","#f59e0b","#ef4444","#14b8a6","#ec4899"];

function AnalyticsPage({ orders }:{ orders:Order[] }) {
  type Range = "7"|"30"|"90"|"all";
  const [range,setRange]=useState<Range>("all");
  const RANGES:{label:string;value:Range}[]=[
    {label:"近7天",value:"7"},{label:"近30天",value:"30"},{label:"近90天",value:"90"},{label:"全部",value:"all"},
  ];

  const filtered=useMemo(()=>{
    if(range==="all") return orders;
    const days=parseInt(range);
    const cutoff=Date.now()-days*86400_000;
    return orders.filter(o=>new Date(o.createdAt.replace(" ","T")).getTime()>=cutoff);
  },[orders,range]);

  // KPIs
  const total=filtered.length;
  const completedOrders=filtered.filter(o=>o.status==="已完成");
  const cancelledCount=filtered.filter(o=>o.status==="已取消").length;
  const completionRate=total?(completedOrders.length/total*100).toFixed(1):"0";
  const totalAmount=completedOrders.reduce((s,o)=>s+(o.amount||0),0);
  const avgAmount=completedOrders.length?(totalAmount/completedOrders.length).toFixed(0):"0";

  // Status pie data
  const statusData=useMemo(()=>
    (["待接单","已接单","回收中","已完成","已取消"] as OrderStatus[])
      .map(s=>({name:s,value:filtered.filter(o=>o.status===s).length,color:STATUS_COLORS[s]}))
      .filter(d=>d.value>0),
  [filtered]);

  // Date trend data
  const trendData=useMemo(()=>{
    const map:Record<string,{count:number;amount:number}>={};
    filtered.forEach(o=>{
      const d=o.createdAt.split(" ")[0];
      if(!map[d]) map[d]={count:0,amount:0};
      map[d].count++;
      if(o.amount) map[d].amount+=o.amount;
    });
    return Object.entries(map)
      .sort(([a],[b])=>a.localeCompare(b))
      .map(([date,{count,amount}])=>({日期:date.slice(5),订单量:count,回收金额:parseFloat(amount.toFixed(2))}));
  },[filtered]);

  // Category data
  const catData=useMemo(()=>{
    const map:Record<string,{count:number;amount:number}>={};
    filtered.forEach(o=>{
      if(!map[o.category]) map[o.category]={count:0,amount:0};
      map[o.category].count++;
      if(o.amount) map[o.category].amount+=o.amount;
    });
    return Object.entries(map)
      .map(([name,{count,amount}])=>({name,订单数:count,回收金额:parseFloat(amount.toFixed(0))}))
      .sort((a,b)=>b.订单数-a.订单数);
  },[filtered]);

  // Recycler performance
  const recyclerData=useMemo(()=>{
    const map:Record<string,{total:number;completed:number;amount:number}>={};
    filtered.forEach(o=>{
      o.recyclers.forEach(r=>{
        if(!map[r]) map[r]={total:0,completed:0,amount:0};
        map[r].total++;
        if(o.status==="已完成"){map[r].completed++;map[r].amount+=(o.amount||0);}
      });
    });
    return Object.entries(map)
      .map(([name,{total,completed,amount}])=>({name,接单量:total,完成量:completed,回收金额:parseFloat(amount.toFixed(0))}))
      .sort((a,b)=>b.接单量-a.接单量)
      .slice(0,8);
  },[filtered]);

  function handleExport(){
    const quote=(value:unknown)=>`"${String(value??"").replace(/"/g,'""')}"`;
    const rows=[
      ["订单号","状态","用户名","电话","地址","品类","重量","预约时间","回收人员","创建时间","完成时间","回收金额"],
      ...filtered.map(o=>[o.id,o.status,o.userName,o.phone,o.address,o.category,o.weight,o.appointmentTime,o.recyclers.join("、"),o.createdAt,o.completedAt||"",o.amount||""]),
    ];
    const content="\uFEFF"+rows.map(row=>row.map(quote).join(",")).join("\n");
    const url=URL.createObjectURL(new Blob([content],{type:"text/csv;charset=utf-8"}));
    const link=document.createElement("a");link.href=url;link.download=`废品回收分析报表_${new Date().toISOString().slice(0,10)}.csv`;link.click();URL.revokeObjectURL(url);
  }

  const kpis=[
    {label:"总订单",value:String(total),sub:`取消 ${cancelledCount} 单`,icon:Package,color:"#1a7a3c",bg:"#e8f5ed"},
    {label:"完成率",value:`${completionRate}%`,sub:`完成 ${completedOrders.length} 单`,icon:CheckCircle2,color:"#3b82f6",bg:"#eff6ff"},
    {label:"总回收金额",value:`¥${totalAmount.toFixed(2)}`,sub:`${completedOrders.length} 笔已结算`,icon:Coins,color:"#f59e0b",bg:"#fffbeb"},
    {label:"平均每单",value:`¥${avgAmount}`,sub:"已完成订单均值",icon:TrendingUp,color:"#8b5cf6",bg:"#f5f3ff"},
  ];

  const CustomPieLabel=({cx,cy,midAngle,innerRadius,outerRadius,name,value,percent}:any)=>{
    if(percent<0.06) return null;
    const RADIAN=Math.PI/180;
    const r=outerRadius+18;
    const x=cx+r*Math.cos(-midAngle*RADIAN);
    const y=cy+r*Math.sin(-midAngle*RADIAN);
    return <text x={x} y={y} fill="#6b7280" textAnchor={x>cx?"start":"end"} dominantBaseline="central" style={{fontSize:11}}>{name} {value}</text>;
  };

  return(
    <div className="p-6 space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-xl font-semibold text-gray-900">分析统计</h1>
          <p className="text-sm text-gray-400 mt-0.5">多维度订单数据分析与导出</p>
        </div>
        <div className="flex items-center gap-2">
          {/* Range filter */}
          <div className="flex items-center bg-gray-100 rounded-xl p-1 gap-0.5">
            {RANGES.map(r=>(
              <button key={r.value} onClick={()=>setRange(r.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${range===r.value?"bg-white shadow-sm text-gray-800":"text-gray-500 hover:text-gray-700"}`}
              >{r.label}</button>
            ))}
          </div>
          <button onClick={handleExport}
            className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium text-white hover:opacity-90 transition-all"
            style={{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}}
          ><Download size={14}/>导出报表</button>
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid grid-cols-4 gap-4">
        {kpis.map(({label,value,sub,icon:Icon,color,bg})=>(
          <div key={label} className="bg-white rounded-xl p-5 border border-gray-100 flex items-start justify-between">
            <div>
              <p className="text-xs font-medium text-gray-400 mb-1">{label}</p>
              <p className="text-2xl font-bold text-gray-900 leading-tight">{value}</p>
              <p className="text-xs text-gray-400 mt-1.5">{sub}</p>
            </div>
            <div className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0" style={{background:bg}}>
              <Icon size={18} style={{color}}/>
            </div>
          </div>
        ))}
      </div>

      {/* Trend + Status Row */}
      <div className="grid grid-cols-5 gap-4">
        {/* Order Trend */}
        <div className="col-span-3 bg-white rounded-xl p-5 border border-gray-100">
          <div className="flex items-center justify-between mb-4">
            <div>
              <p className="text-sm font-semibold text-gray-800">订单趋势</p>
              <p className="text-xs text-gray-400 mt-0.5">按创建日期统计</p>
            </div>
            <div className="flex items-center gap-4 text-xs text-gray-500">
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 inline-block rounded-full bg-green-600"/><span>订单量</span></span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-0.5 inline-block rounded-full bg-blue-500"/><span>回收金额</span></span>
            </div>
          </div>
          {trendData.length===0
            ?<div className="h-48 flex items-center justify-center text-gray-300 text-sm">暂无数据</div>
            :<ResponsiveContainer width="100%" height={200}>
              <ComposedChart data={trendData} margin={{top:4,right:16,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false}/>
                <XAxis dataKey="日期" tick={{fontSize:11,fill:"#9ca3af"}} axisLine={false} tickLine={false}/>
                <YAxis yAxisId="left" tick={{fontSize:11,fill:"#9ca3af"}} axisLine={false} tickLine={false} width={28}/>
                <YAxis yAxisId="right" orientation="right" tick={{fontSize:11,fill:"#9ca3af"}} axisLine={false} tickLine={false} width={40}/>
                <Tooltip contentStyle={{borderRadius:10,border:"1px solid #e5e7eb",boxShadow:"0 4px 12px rgba(0,0,0,0.08)",fontSize:12}}/>
                <Bar yAxisId="left" dataKey="订单量" fill="#e8f5ed" radius={[4,4,0,0]}/>
                <Line yAxisId="left" type="monotone" dataKey="订单量" stroke="#1a7a3c" strokeWidth={2.5} dot={{fill:"#1a7a3c",r:4,strokeWidth:0}} activeDot={{r:5}}/>
                <Line yAxisId="right" type="monotone" dataKey="回收金额" stroke="#3b82f6" strokeWidth={2} dot={{fill:"#3b82f6",r:3,strokeWidth:0}} strokeDasharray="5 3" activeDot={{r:5}}/>
              </ComposedChart>
            </ResponsiveContainer>
          }
        </div>

        {/* Status Pie */}
        <div className="col-span-2 bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm font-semibold text-gray-800 mb-1">订单状态分布</p>
          <p className="text-xs text-gray-400 mb-3">各状态占比</p>
          {statusData.length===0
            ?<div className="h-48 flex items-center justify-center text-gray-300 text-sm">暂无数据</div>
            :<>
              <ResponsiveContainer width="100%" height={160}>
                <PieChart>
                  <Pie data={statusData} dataKey="value" nameKey="name" innerRadius={45} outerRadius={70} paddingAngle={3} labelLine={false} label={({name,percent})=>(percent??0)>0.08?`${((percent??0)*100).toFixed(0)}%`:""} style={{fontSize:11,fill:"#fff",fontWeight:600}}>
                    {statusData.map((entry,i)=><Cell key={i} fill={entry.color}/>)}
                  </Pie>
                  <Tooltip contentStyle={{borderRadius:10,border:"1px solid #e5e7eb",fontSize:12}}/>
                </PieChart>
              </ResponsiveContainer>
              <div className="mt-2 space-y-1.5">
                {statusData.map(d=>(
                  <div key={d.name} className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{background:d.color}}/>
                      <span className="text-xs text-gray-600">{d.name}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-xs font-semibold text-gray-800">{d.value}</span>
                      <span className="text-xs text-gray-400">{total?(d.value/total*100).toFixed(0):0}%</span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          }
        </div>
      </div>

      {/* Category + Recycler Row */}
      <div className="grid grid-cols-2 gap-4">
        {/* Category Bar */}
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm font-semibold text-gray-800 mb-0.5">品类订单分布</p>
          <p className="text-xs text-gray-400 mb-4">各品类订单数量</p>
          {catData.length===0
            ?<div className="h-44 flex items-center justify-center text-gray-300 text-sm">暂无数据</div>
            :<ResponsiveContainer width="100%" height={180}>
              <BarChart data={catData} layout="vertical" margin={{top:0,right:40,left:4,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" horizontal={false}/>
                <XAxis type="number" tick={{fontSize:11,fill:"#9ca3af"}} axisLine={false} tickLine={false}/>
                <YAxis type="category" dataKey="name" tick={{fontSize:11,fill:"#4b5563"}} axisLine={false} tickLine={false} width={58}/>
                <Tooltip contentStyle={{borderRadius:10,border:"1px solid #e5e7eb",fontSize:12}}/>
                <Bar dataKey="订单数" radius={[0,4,4,0]} barSize={14}>
                  {catData.map((_,i)=><Cell key={i} fill={CAT_PALETTE[i%CAT_PALETTE.length]}/>)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          }
        </div>

        {/* Recycler Bar */}
        <div className="bg-white rounded-xl p-5 border border-gray-100">
          <p className="text-sm font-semibold text-gray-800 mb-0.5">回收员业绩</p>
          <p className="text-xs text-gray-400 mb-4">接单量 vs 完成量</p>
          {recyclerData.length===0
            ?<div className="h-44 flex items-center justify-center text-gray-300 text-sm">暂无数据</div>
            :<ResponsiveContainer width="100%" height={180}>
              <BarChart data={recyclerData} margin={{top:0,right:8,left:0,bottom:0}}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f3f4f6" vertical={false}/>
                <XAxis dataKey="name" tick={{fontSize:11,fill:"#4b5563"}} axisLine={false} tickLine={false}/>
                <YAxis tick={{fontSize:11,fill:"#9ca3af"}} axisLine={false} tickLine={false} width={24} allowDecimals={false}/>
                <Tooltip contentStyle={{borderRadius:10,border:"1px solid #e5e7eb",fontSize:12}}/>
                <Legend iconSize={8} wrapperStyle={{fontSize:11,paddingTop:8}}/>
                <Bar dataKey="接单量" fill="#d1fae5" stroke="#1a7a3c" strokeWidth={0} radius={[4,4,0,0]} barSize={14}/>
                <Bar dataKey="完成量" fill="#1a7a3c" radius={[4,4,0,0]} barSize={14}/>
              </BarChart>
            </ResponsiveContainer>
          }
        </div>
      </div>

      {/* Completed Orders Table */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
          <div>
            <p className="text-sm font-semibold text-gray-800">已完成订单明细</p>
            <p className="text-xs text-gray-400 mt-0.5">有回收金额的已结算订单</p>
          </div>
          <span className="text-xs text-gray-400 bg-gray-100 px-2.5 py-1 rounded-full font-medium">{completedOrders.filter(o=>o.amount).length} 笔</span>
        </div>
        <table className="w-full">
          <thead><tr className="border-b border-gray-100 bg-gray-50/60">
            {["订单号","用户","品类","回收人员","完成时间","回收金额"].map(h=>(
              <th key={h} className="text-left px-5 py-2.5 text-xs font-semibold text-gray-400">{h}</th>
            ))}
          </tr></thead>
          <tbody>
            {completedOrders.filter(o=>o.amount).length===0
              ?<tr><td colSpan={6} className="px-5 py-10 text-center text-sm text-gray-300">当前筛选范围内无已结算订单</td></tr>
              :completedOrders.filter(o=>o.amount).sort((a,b)=>(b.amount||0)-(a.amount||0)).map(o=>(
                <tr key={o.id} className="border-b border-gray-50 last:border-0 hover:bg-gray-50/40 transition-colors">
                  <td className="px-5 py-3"><span className="text-xs font-mono text-gray-500">{o.id}</span></td>
                  <td className="px-5 py-3"><span className="text-sm text-gray-800">{o.userName}</span></td>
                  <td className="px-5 py-3"><span className="text-xs px-2 py-0.5 rounded-full bg-green-50 text-green-700 border border-green-100 font-medium">{o.category}</span></td>
                  <td className="px-5 py-3"><div className="flex flex-wrap gap-1">{o.recyclers.map(r=><span key={r} className="text-xs px-1.5 py-0.5 bg-gray-100 text-gray-600 rounded">{r}</span>)}</div></td>
                  <td className="px-5 py-3"><span className="text-xs text-gray-500">{o.completedAt||"—"}</span></td>
                  <td className="px-5 py-3"><span className="text-sm font-bold text-green-700">¥{(o.amount||0).toFixed(2)}</span></td>
                </tr>
              ))
            }
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ─── Main Layout ──────────────────────────────────────────────────────────────
const NAV=[
  {id:"orders"    as Page, label:"订单管理", icon:Package  },
  {id:"staff"     as Page, label:"人员管理", icon:Users    },
  {id:"cats"      as Page, label:"品类管理", icon:Tags     },
  {id:"analytics" as Page, label:"分析统计", icon:BarChart2},
  {id:"system"    as Page, label:"系统配置", icon:Settings },
];

function MainLayout({ token,adminName,onLogout,onError,notify }:FigmaAdminProps) {
  const [page,setPage]=useState<Page>("orders");
  const [orders,setOrders]=useState<Order[]>([]);
  const [groups,setGroups]=useState<RecycleGroup[]>([]);
  const [settings,setSettings]=useState<RecycleSettings>({key:"recycle_rules",minWeightKg:5,minCount:0,photoOrderCheckMinQuantity:false});
  const [loading,setLoading]=useState(true);

  const refresh=async()=>{
    setLoading(true);
    try{
      const [orderResult,categories,settingsResult]=await Promise.all([
        callCloud<OrderListResult>("adminListOrders",{sessionToken:token,page:1,pageSize:50,status:"",keyword:""}),
        callCloud<CloudCategory[]>("adminListCategories",{sessionToken:token}),
        callCloud<RecycleSettings>("adminGetSettings",{sessionToken:token}),
      ]);
      const details=await Promise.all((orderResult.list||[]).map(async(order)=>{
        try{return await callCloud<CloudOrder>("adminGetOrderDetail",{sessionToken:token,id:order._id});}
        catch{return order;}
      }));
      setOrders(details.map(cloudOrderToFigma));
      setGroups(categoriesToGroups(categories||[]));
      setSettings(settingsResult);
    }catch(error){onError(error);}finally{setLoading(false);}
  };

  useEffect(()=>{void refresh();},[token]);

  const staff=useMemo(()=>staffFromOrders(orders),[orders]);
  const unsupported=(feature:string)=>notify({kind:"error",text:`${feature}尚未接入后端，当前未保存任何演示数据`});

  const saveOrder=async(order:Order)=>{
    if(!order.docId){unsupported("订单更新");return;}
    try{
      await callCloud("adminUpdateOrder",{
        sessionToken:token,
        id:order.docId,
        status:FIGMA_TO_CLOUD_STATUS[order.status],
        estimatePrice:order.estimatePrice ?? "",
        finalWeight:order.finalWeight ?? "",
        finalCount:order.finalCount ?? "",
        finalPrice:order.amount ?? "",
        recyclerName:order.recyclers[0] || "",
        recyclerPhone:order.recyclerPhone || "",
        adminRemark:order.adminRemark || "",
        cancelReason:order.cancelReason || (order.status==="已取消"?"管理员取消":""),
      });
      notify({kind:"success",text:"订单已更新"});
      await refresh();
    }catch(error){onError(error);throw error;}
  };

  const saveCategory=async(item:RecycleItem)=>{
    const unit:CloudCategory["unit"]=item.unit==="件"?"件":"kg";
    const category:CloudCategory={
      _id:item.categoryId,
      name:item.name,
      unit,
      priceRef:item.fieldEstimate?"现场估价":item.priceRef || `${item.price}元/${unit}起`,
      sortOrder:item.sortOrder ?? groups.flatMap((group)=>group.items).length+1,
      enabled:item.enabled,
    };
    try{
      await callCloud("adminSaveCategory",{sessionToken:token,category});
      notify({kind:"success",text:"品类已保存"});
      const categories=await callCloud<CloudCategory[]>("adminListCategories",{sessionToken:token});
      setGroups(categoriesToGroups(categories||[]));
    }catch(error){onError(error);throw error;}
  };

  const saveSettings=async(next:RecycleSettings)=>{
    try{
      const saved=await callCloud<RecycleSettings>("adminSaveSettings",{sessionToken:token,settings:next});
      setSettings(saved);
      notify({kind:"success",text:"系统配置已保存"});
    }catch(error){onError(error);throw error;}
  };

  return(
    <div className="min-h-screen flex" style={{fontFamily:"'Noto Sans SC',sans-serif"}}>
      <aside className="w-56 flex-shrink-0 flex flex-col" style={{background:"#1e2d1e"}}>
        <div className="px-5 py-5 border-b" style={{borderColor:"rgba(255,255,255,0.06)"}}>
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-xl flex items-center justify-center" style={{background:"rgba(46,204,113,0.2)"}}><RefreshCw size={16} className="text-green-400"/></div>
            <div><p className="text-white font-semibold text-sm leading-tight">绿源回收</p><p className="text-green-500 text-[10px] opacity-70">管理后台 v1.0</p></div>
          </div>
        </div>
        <nav className="flex-1 px-3 py-4 space-y-1">
          {NAV.map(({id,label,icon:Icon})=>{
            const active=page===id;
            return(<button key={id} onClick={()=>setPage(id)} className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${active?"text-white":"text-green-200/60 hover:text-green-100 hover:bg-white/5"}`} style={active?{background:"linear-gradient(135deg,#1a7a3c,#27ae60)"}:{}}>
              <Icon size={16}/>{label}{active&&<ChevronRight size={13} className="ml-auto opacity-70"/>}
            </button>);
          })}
        </nav>
        <div className="px-4 py-4 border-t" style={{borderColor:"rgba(255,255,255,0.06)"}}>
          <div className="flex items-center gap-3 mb-3">
            <div className="w-8 h-8 rounded-full bg-green-700 flex items-center justify-center flex-shrink-0"><span className="text-xs font-bold text-white">管</span></div>
            <div className="flex-1 min-w-0"><p className="text-sm font-medium text-green-100 truncate">超级管理员</p><p className="text-[11px] text-green-500/60">{adminName||"admin"}</p></div>
          </div>
          <button onClick={onLogout} className="w-full flex items-center gap-2 px-3 py-2 rounded-lg text-xs text-green-300/50 hover:text-red-300 hover:bg-red-900/20 transition-all"><LogOut size={13}/>退出登录</button>
        </div>
      </aside>
      <main className="flex-1 overflow-auto bg-gray-50">
        <div className="bg-white border-b border-gray-100 px-6 py-3.5 flex items-center justify-between sticky top-0 z-30">
          <div className="flex items-center gap-2 text-sm text-gray-400"><span>首页</span><ChevronRight size={12}/><span className="text-gray-700 font-medium">{NAV.find(n=>n.id===page)?.label}</span></div>
          <div className="flex items-center gap-2 text-xs text-gray-400"><div className="w-2 h-2 rounded-full bg-green-400 animate-pulse"/>系统运行正常</div>
        </div>
        {loading?<div className="min-h-[420px] flex flex-col items-center justify-center text-gray-400 gap-3"><Loader size={24} className="animate-spin text-green-600"/><p className="text-sm">正在加载真实业务数据…</p></div>:<>
          {page==="orders"    &&<OrdersPage staff={staff} groups={groups} orders={orders} onSaveOrder={saveOrder} onUnsupported={unsupported}/>} 
          {page==="staff"     &&<StaffPage staff={staff} onUnsupported={unsupported}/>} 
          {page==="cats"      &&<RecycleCatsPage groups={groups} onSaveCategory={saveCategory} onUnsupported={unsupported}/>} 
          {page==="analytics" &&<AnalyticsPage orders={orders}/>} 
          {page==="system"    &&<SystemPage settings={settings} onSave={saveSettings}/>} 
        </>}
      </main>
    </div>
  );
}

export default function FigmaAdminApp(props:FigmaAdminProps) {
  return <MainLayout {...props}/>;
}
