import { FormEvent, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";
import {
  BarChart2,
  ChevronRight,
  Eye,
  Inbox,
  LogOut,
  Package,
  Pencil,
  RefreshCw,
  RotateCcw,
  Search,
  Settings,
  Tags,
  Users,
  X,
} from "lucide-react";
import { callCloud, CloudError, initCloud, uploadTransferProof } from "./api/cloud";
import { isDevPreview } from "./api/mock";
import FigmaAdminApp from "./figma/FigmaAdmin";
import type { Category, Order, OrderListResult, OrderStatus, RecycleSettings } from "./types";

const STATUS_TEXT: Record<OrderStatus, string> = {
  submitted: "已提交",
  processing: "处理中",
  completed: "已完成",
  canceled: "已取消",
};

const ERROR_TEXT: Record<string, string> = {
  ADMIN_SESSION_REQUIRED: "请先扫码登录",
  ADMIN_SESSION_EXPIRED: "登录已过期，请重新扫码",
  NO_PERMISSION: "当前微信不在管理员白名单",
  LOGIN_TICKET_EXPIRED: "登录码已过期，请刷新",
  TRANSFER_PROOF_REQUIRED: "完成订单前请上传打款凭证",
  FINAL_PRICE_REQUIRED: "完成订单前请填写最终金额",
  ACTUAL_QUANTITY_REQUIRED: "完成订单前请填写实际重量或件数",
  CANCEL_REASON_REQUIRED: "取消订单前请填写取消原因",
  ORDER_STATUS_INVALID: "订单状态已变化，请刷新后重试",
  ORDER_NOT_FOUND: "订单不存在或已被删除",
  PARAM_INVALID: "请检查填写内容",
  DB_ERROR: "系统暂时不可用，请稍后重试",
  CLOUDBASE_SDK_MISSING: "CloudBase SDK 加载失败",
  CLOUDBASE_CONFIG_MISSING: "请先配置云开发环境",
};

const formatTime = (value?: number | null) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(new Date(value));
};

const formatMoney = (value?: number | null) =>
  value == null ? "—" : `¥${Number(value).toFixed(2)}`;

const getErrorText = (error: unknown) => {
  if (error instanceof CloudError) return ERROR_TEXT[error.code] || error.message || "操作失败";
  if (error instanceof Error) return error.message;
  return "操作失败，请稍后重试";
};

interface AuthState {
  token: string;
  adminName: string;
}

interface ToastState {
  kind: "success" | "error";
  text: string;
}

function App() {
  const [ready, setReady] = useState(false);
  const [fatalError, setFatalError] = useState("");
  const [auth, setAuth] = useState<AuthState>(() => ({
    token: isDevPreview() ? "__local_preview__" : localStorage.getItem("admin_session_token") || "",
    adminName: isDevPreview() ? "admin" : localStorage.getItem("admin_name") || "",
  }));
  const [toast, setToast] = useState<ToastState | null>(null);

  useEffect(() => {
    initCloud()
      .then(() => setReady(true))
      .catch((error) => setFatalError(getErrorText(error)));
  }, []);

  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const logout = useCallback(() => {
    localStorage.removeItem("admin_session_token");
    localStorage.removeItem("admin_name");
    setAuth({ token: "", adminName: "" });
  }, []);

  const onAdminError = useCallback(
    (error: unknown) => {
      if (
        error instanceof CloudError &&
        ["ADMIN_SESSION_REQUIRED", "ADMIN_SESSION_EXPIRED", "NO_PERMISSION"].includes(error.code)
      ) {
        logout();
      }
      setToast({ kind: "error", text: getErrorText(error) });
    },
    [logout],
  );

  if (fatalError) return <SystemError text={fatalError} />;
  if (!ready) return <FullscreenLoading text="正在连接云回收服务…" />;

  return (
    <>
      <Routes>
        <Route
          path="/login"
          element={
            auth.token ? (
              <Navigate to="/orders" replace />
            ) : (
              <LoginPage
                onSuccess={(next) => {
                  localStorage.setItem("admin_session_token", next.token);
                  localStorage.setItem("admin_name", next.adminName);
                  setAuth(next);
                }}
              />
            )
          }
        />
        <Route
          path="/*"
          element={
            auth.token ? (
              <FigmaAdminApp token={auth.token} adminName={auth.adminName} onLogout={logout} onError={onAdminError} notify={setToast} />
            ) : (
              <Navigate to="/login" replace />
            )
          }
        />
      </Routes>
      {toast && <div className={`toast ${toast.kind}`} role="status">{toast.text}</div>}
    </>
  );
}

function LoginPage({ onSuccess }: { onSuccess: (auth: AuthState) => void }) {
  const [loginMethod, setLoginMethod] = useState<"wechat" | "account">("wechat");
  const [account, setAccount] = useState("");
  const [password, setPassword] = useState("");
  const [accountError, setAccountError] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [ticket, setTicket] = useState("");
  const [webNonce, setWebNonce] = useState("");
  const [fallbackPath, setFallbackPath] = useState("");
  const [message, setMessage] = useState("正在生成登录码…");
  const [loading, setLoading] = useState(false);
  const polling = useRef<number | null>(null);

  const clearPolling = () => {
    if (polling.current) window.clearInterval(polling.current);
    polling.current = null;
  };

  const createTicket = useCallback(async () => {
    clearPolling();
    setLoading(true);
    setQrUrl("");
    setFallbackPath("");
    setMessage("正在生成登录码…");
    try {
      const data = await callCloud<{
        ticket: string;
        webNonce: string;
        qrUrl?: string;
        path?: string;
      }>("adminCreateLoginTicket");
      setTicket(data.ticket);
      setWebNonce(data.webNonce);
      setQrUrl(data.qrUrl || "");
      setFallbackPath(data.path || "");
      setMessage(data.qrUrl ? "请使用微信扫码，并在小程序中确认。" : "登录码生成失败，请检查小程序码权限。");
    } catch (error) {
      setMessage(getErrorText(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void createTicket();
    return clearPolling;
  }, [createTicket]);

  useEffect(() => {
    if (!ticket || !webNonce) return;
    clearPolling();
    polling.current = window.setInterval(async () => {
      try {
        const data = await callCloud<{ status: string; sessionToken?: string; adminName?: string }>(
          "adminCheckLoginTicket",
          { ticket, webNonce },
        );
        if (data.status === "confirmed" && data.sessionToken) {
          clearPolling();
          onSuccess({ token: data.sessionToken, adminName: data.adminName || "管理员" });
        }
      } catch (error) {
        if (error instanceof CloudError && error.code === "LOGIN_TICKET_EXPIRED") {
          clearPolling();
          setMessage(ERROR_TEXT.LOGIN_TICKET_EXPIRED);
        }
      }
    }, 1800);
    return clearPolling;
  }, [ticket, webNonce, onSuccess]);

  const accountLogin = (event: FormEvent) => {
    event.preventDefault();
    setAccountError("");
    if (account !== "admin" || password !== "admin123") {
      setAccountError("账号或密码错误");
      return;
    }
    const previewUrl = `${window.location.origin}${window.location.pathname}?mock=1#/orders`;
    window.location.assign(previewUrl);
  };

  return (
    <main className="login-page">
      <section className="login-card">
        <div className="login-copy">
          <div className="brand-lockup"><span className="brand-mark">云</span><span>云回收</span></div>
          <p className="eyebrow">运营管理平台</p>
          <h1>微信扫码登录</h1>
          <p className="lead">使用已加入管理员白名单的微信扫码，在小程序内确认后进入后台。</p>
          <div className="security-note"><span aria-hidden="true">✓</span> 订单与用户信息均由云函数验证权限</div>
        </div>
        <div className="qr-panel">
          {import.meta.env.DEV && (
            <div className="login-methods" role="tablist" aria-label="登录方式">
              <button type="button" role="tab" aria-selected={loginMethod === "wechat"} className={loginMethod === "wechat" ? "active" : ""} onClick={() => setLoginMethod("wechat")}>微信扫码</button>
              <button type="button" role="tab" aria-selected={loginMethod === "account"} className={loginMethod === "account" ? "active" : ""} onClick={() => { clearPolling(); setLoginMethod("account"); }}>账号密码</button>
            </div>
          )}
          {loginMethod === "wechat" ? (
            <>
              <div className="qr-frame">
                {qrUrl ? <img src={qrUrl} alt="云回收管理后台登录小程序码" /> : <div className="qr-placeholder">{loading ? "生成中…" : "暂无登录码"}</div>}
              </div>
              <p className="login-message" role="status">{message}</p>
              {fallbackPath && !qrUrl && <p className="dev-path">开发环境路径：{fallbackPath}</p>}
              <button className="button secondary full" onClick={() => void createTicket()} disabled={loading}>
                {loading ? "正在刷新…" : "刷新登录码"}
              </button>
            </>
          ) : (
            <form className="account-login-form" onSubmit={accountLogin}>
              <div className="account-login-icon">管</div>
              <div className="account-login-title"><h2>开发账号登录</h2><p>仅用于本地页面开发与交互验证</p></div>
              <label><span>账号</span><input autoComplete="username" value={account} onChange={(event) => setAccount(event.target.value)} placeholder="请输入账号" /></label>
              <label><span>密码</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="请输入密码" /></label>
              {accountError && <p className="account-error" role="alert">{accountError}</p>}
              <button className="button primary full" type="submit">登录并进入本地预览</button>
              <p className="dev-only-note">开发模式专用，不访问真实订单数据</p>
            </form>
          )}
        </div>
      </section>
    </main>
  );
}

function AdminLayout({ auth, logout, children }: { auth: AuthState; logout: () => void; children: ReactNode }) {
  const location = useLocation();
  const title = location.pathname.startsWith("/categories") ? "品类管理" : location.pathname.startsWith("/settings") ? "系统配置" : "订单管理";
  const descriptions: Record<string, string> = {
    "订单管理": "查看真实订单数据并推进回收流程",
    "品类管理": "维护小程序展示的可回收品类",
    "系统配置": "设置用户下单时的最低起收标准",
  };

  return (
    <div className="admin-shell">
      <aside className="sidebar">
        <div className="sidebar-brand"><span className="figma-brand-mark"><RefreshCw size={16} /></span><span><strong>云回收</strong><small>管理后台 v1.0</small></span></div>
        <nav aria-label="主导航">
          <NavLink to="/orders" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><Package size={16} />订单管理<ChevronRight className="nav-chevron" size={13} /></NavLink>
          <span className="nav-item is-disabled" title="人员管理后端接口尚未接入"><Users size={16} />人员管理<small>待接入</small></span>
          <NavLink to="/categories" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><Tags size={16} />品类管理<ChevronRight className="nav-chevron" size={13} /></NavLink>
          <span className="nav-item is-disabled" title="分析统计后端接口尚未接入"><BarChart2 size={16} />分析统计<small>待接入</small></span>
          <NavLink to="/settings" className={({ isActive }) => `nav-item ${isActive ? "active" : ""}`}><Settings size={16} />系统配置<ChevronRight className="nav-chevron" size={13} /></NavLink>
        </nav>
        <div className="sidebar-user">
          <div className="avatar">{(auth.adminName || "管").slice(0, 1)}</div>
          <div><strong>{auth.adminName || "管理员"}</strong><small>admin</small></div>
          <button className="sidebar-logout" onClick={logout}><LogOut size={13} />退出登录</button>
        </div>
      </aside>
      <section className="admin-workspace">
        <header className="workspace-topbar">
          <div><span>首页</span><ChevronRight size={12} /><strong>{title}</strong></div>
          <p><i />系统运行正常</p>
        </header>
        <main className="main-content">
          <header className="page-header"><div><h1>{title}</h1><p>{descriptions[title]}</p></div></header>
          {children}
        </main>
      </section>
    </div>
  );
}

function OrdersPage({ token, onError, notify }: { token: string; onError: (e: unknown) => void; notify: (t: ToastState) => void }) {
  const [orders, setOrders] = useState<Order[]>([]);
  const [status, setStatus] = useState<OrderStatus | "">("");
  const [keyword, setKeyword] = useState("");
  const [query, setQuery] = useState({ status: "", keyword: "" });
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [selected, setSelected] = useState<{ id: string; mode: "detail" | "edit" } | null>(null);
  const requestId = useRef(0);

  const load = useCallback(async () => {
    const currentRequest = ++requestId.current;
    setLoading(true);
    try {
      const data = await callCloud<OrderListResult>("adminListOrders", {
        sessionToken: token,
        status: query.status,
        keyword: query.keyword,
        page,
        pageSize: 20,
      });
      if (currentRequest !== requestId.current) return;
      setOrders(data.list || []);
      setTotal(data.total || 0);
      setHasMore(Boolean(data.hasMore));
    } catch (error) {
      if (currentRequest === requestId.current) onError(error);
    } finally {
      if (currentRequest === requestId.current) setLoading(false);
    }
  }, [token, query, page, onError]);

  useEffect(() => { void load(); }, [load]);

  const statusSummary = Object.entries(STATUS_TEXT).map(([value, label]) => ({
    value: value as OrderStatus,
    label,
    count: orders.filter((order) => order.status === value).length,
  }));
  const recoveredAmount = orders
    .filter((order) => order.status === "completed")
    .reduce((sum, order) => sum + Number(order.finalPrice || 0), 0);

  const filterByStatus = (nextStatus: OrderStatus | "") => {
    setStatus(nextStatus);
    setPage(1);
    setQuery({ status: nextStatus, keyword: "" });
    setKeyword("");
  };

  return (
    <>
      <div className="order-summary-grid" aria-label="当前订单概览">
        {statusSummary.map((item) => (
          <button key={item.value} className={`summary-stat ${item.value} ${query.status === item.value ? "active" : ""}`} onClick={() => filterByStatus(query.status === item.value ? "" : item.value)}>
            <strong>{item.count}</strong><span>{item.label}</span>
          </button>
        ))}
        <div className="summary-stat amount"><strong>{formatMoney(recoveredAmount)}</strong><span>当前页回收金额</span></div>
      </div>
      <section className="page-card">
      <div className="toolbar">
        <div className="filter-group">
          <label><span>订单状态</span><select value={status} onChange={(e) => setStatus(e.target.value as OrderStatus | "")}><option value="">全部状态</option>{Object.entries(STATUS_TEXT).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          <label className="search-field"><span>订单号</span><input value={keyword} onChange={(e) => setKeyword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") { setPage(1); setQuery({ status, keyword: keyword.trim() }); } }} placeholder="输入订单号搜索" /></label>
        </div>
        <div className="toolbar-actions">
          <button className="button ghost" onClick={() => { setStatus(""); setKeyword(""); setPage(1); setQuery({ status: "", keyword: "" }); }}><RotateCcw size={14} />重置</button>
          <button className="button primary" onClick={() => { setPage(1); setQuery({ status, keyword: keyword.trim() }); }}><Search size={14} />查询订单</button>
        </div>
      </div>
      <div className="table-meta"><strong>订单列表</strong><span>共 {total} 条订单</span><button className="text-button refresh-button" onClick={() => void load()}><RefreshCw size={13} />刷新</button></div>
      <div className="table-wrap">
        <table>
          <thead><tr><th>订单号</th><th>状态</th><th>用户信息</th><th>订单摘要</th><th>预约时间</th><th>金额</th><th>创建时间</th><th>操作</th></tr></thead>
          <tbody>
            {loading ? <LoadingRows columns={8} /> : orders.length === 0 ? <tr><td colSpan={8}><EmptyState title="没有找到订单" text={query.status || query.keyword ? "请调整筛选条件后重试。" : "用户提交订单后将在这里显示。"} /></td></tr> : orders.map((order) => {
              const address = order.addressSnapshot || {};
              return <tr key={order._id}>
                <td><button className="order-no" onClick={() => setSelected({ id: order._id, mode: "detail" })}>{order.orderNo}</button></td>
                <td><StatusBadge status={order.status} /></td>
                <td><strong>{address.contactName || "—"}</strong><small>{address.phone || "—"}</small></td>
                <td className="summary-cell">{order.summary || "—"}</td>
                <td>{order.appointDate || "—"}<small>{order.appointSlot || "—"}</small></td>
                <td>{order.finalPrice != null ? <><strong>{formatMoney(order.finalPrice)}</strong><small>最终金额</small></> : order.estimatePrice != null ? <><span>{formatMoney(order.estimatePrice)}</span><small>平台估价</small></> : "—"}</td>
                <td>{formatTime(order.createTime)}</td>
                <td><div className="row-actions"><button className="text-button" onClick={() => setSelected({ id: order._id, mode: "detail" })}><Eye size={12} />详情</button>{!["completed", "canceled"].includes(order.status) && <button className="text-button strong" onClick={() => setSelected({ id: order._id, mode: "edit" })}><Pencil size={12} />处理</button>}</div></td>
              </tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="pagination"><span>第 {page} 页</span><button className="button secondary" disabled={page <= 1 || loading} onClick={() => setPage((p) => p - 1)}>上一页</button><button className="button secondary" disabled={!hasMore || loading} onClick={() => setPage((p) => p + 1)}>下一页</button></div>
      {selected && <OrderDrawer id={selected.id} initialMode={selected.mode} token={token} close={() => setSelected(null)} onError={onError} onSaved={() => { setSelected(null); notify({ kind: "success", text: "订单已更新" }); void load(); }} />}
      </section>
    </>
  );
}

function OrderDrawer({ id, initialMode, token, close, onError, onSaved }: { id: string; initialMode: "detail" | "edit"; token: string; close: () => void; onError: (e: unknown) => void; onSaved: () => void }) {
  const [mode, setMode] = useState(initialMode);
  const [order, setOrder] = useState<Order | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState<Record<string, string>>({});
  const [proofs, setProofs] = useState<string[]>([]);
  const [proofPreviews, setProofPreviews] = useState<string[]>([]);

  useEffect(() => {
    setLoading(true);
    callCloud<Order>("adminGetOrderDetail", { sessionToken: token, id })
      .then((data) => {
        setOrder(data);
        setProofs(data.transferProofs || []);
        setProofPreviews(data.transferProofUrls || []);
        setForm({
          status: data.status,
          estimatePrice: data.estimatePrice == null ? "" : String(data.estimatePrice),
          finalWeight: data.finalWeight == null ? "" : String(data.finalWeight),
          finalCount: data.finalCount == null ? "" : String(data.finalCount),
          finalPrice: data.finalPrice == null ? "" : String(data.finalPrice),
          recyclerName: data.recyclerName || "",
          recyclerPhone: data.recyclerPhone || "",
          cancelReason: data.cancelReason || "",
          adminRemark: data.adminRemark || "",
        });
      })
      .catch(onError)
      .finally(() => setLoading(false));
  }, [id, token, onError]);

  const nextStatuses = useMemo(() => {
    if (!order) return [];
    if (order.status === "submitted") return ["submitted", "processing", "canceled"] as OrderStatus[];
    if (order.status === "processing") return ["processing", "completed", "canceled"] as OrderStatus[];
    return [order.status];
  }, [order]);

  const updateField = (key: string, value: string) => setForm((current) => ({ ...current, [key]: value }));

  const handleFiles = async (files: FileList | null) => {
    if (!order || !files?.length) return;
    const selected = Array.from(files);
    if (proofs.length + selected.length > 9) return onError(new Error("打款凭证最多上传 9 张"));
    const invalid = selected.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024);
    if (invalid) return onError(new Error("请上传 JPG、PNG 或 WebP 图片，单张不超过 10MB"));
    setUploading(true);
    try {
      const uploaded = await Promise.all(selected.map((file) => uploadTransferProof(order.orderNo, file)));
      setProofs((current) => [...current, ...uploaded]);
      setProofPreviews((current) => [...current, ...selected.map((file) => URL.createObjectURL(file))]);
    } catch (error) {
      onError(error);
    } finally {
      setUploading(false);
    }
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!order) return;
    const targetStatus = form.status as OrderStatus;
    if (targetStatus === "completed") {
      if (form.finalPrice === "") return onError(new Error(ERROR_TEXT.FINAL_PRICE_REQUIRED));
      if (!(Number(form.finalWeight) > 0 || Number(form.finalCount) > 0)) return onError(new Error(ERROR_TEXT.ACTUAL_QUANTITY_REQUIRED));
      if (!proofs.length) return onError(new Error(ERROR_TEXT.TRANSFER_PROOF_REQUIRED));
      if (!window.confirm("确认最终金额和打款凭证无误，并将订单标记为已完成？")) return;
    }
    if (targetStatus === "canceled") {
      if (!form.cancelReason.trim()) return onError(new Error(ERROR_TEXT.CANCEL_REASON_REQUIRED));
      if (!window.confirm("确认取消该订单？1.0 不支持恢复已取消订单。")) return;
    }
    setSaving(true);
    try {
      await callCloud("adminUpdateOrder", {
        sessionToken: token,
        id: order._id,
        status: targetStatus,
        estimatePrice: form.estimatePrice,
        finalWeight: form.finalWeight,
        finalCount: form.finalCount,
        finalPrice: form.finalPrice,
        recyclerName: form.recyclerName.trim(),
        recyclerPhone: form.recyclerPhone.trim(),
        transferProofs: proofs,
        cancelReason: form.cancelReason.trim(),
        adminRemark: form.adminRemark.trim(),
      });
      onSaved();
    } catch (error) {
      onError(error);
    } finally {
      setSaving(false);
    }
  };

  return <div className="drawer-layer" role="dialog" aria-modal="true" aria-label="订单详情"><button className="drawer-mask" aria-label="关闭" onClick={close} /><aside className="drawer"><header className="drawer-header"><div><p>{order?.orderNo || "订单"}</p><h2>{mode === "detail" ? "订单详情" : "处理订单"}</h2></div><button className="icon-button close" onClick={close} aria-label="关闭"><X size={18} /></button></header>{loading ? <FullscreenLoading text="正在加载订单…" compact /> : !order ? <EmptyState title="订单加载失败" text="请关闭后重试。" /> : mode === "detail" ? <OrderDetail order={order} edit={() => setMode("edit")} /> : <form className="order-form" onSubmit={submit}>
    <section><h3>订单处理</h3><div className="form-grid"><label><span>订单状态 *</span><select value={form.status} onChange={(e) => updateField("status", e.target.value)}>{nextStatuses.map((value) => <option key={value} value={value}>{STATUS_TEXT[value]}</option>)}</select></label><label><span>平台估价（元）</span><input type="number" min="0" step="0.01" value={form.estimatePrice} onChange={(e) => updateField("estimatePrice", e.target.value)} /></label><label><span>实际重量（kg）</span><input type="number" min="0" step="0.01" value={form.finalWeight} onChange={(e) => updateField("finalWeight", e.target.value)} /></label><label><span>实际件数</span><input type="number" min="0" step="1" value={form.finalCount} onChange={(e) => updateField("finalCount", e.target.value)} /></label><label><span>最终金额（元）</span><input type="number" min="0" step="0.01" value={form.finalPrice} onChange={(e) => updateField("finalPrice", e.target.value)} /></label><label><span>回收人员姓名</span><input value={form.recyclerName} onChange={(e) => updateField("recyclerName", e.target.value)} /></label><label><span>回收人员电话</span><input type="tel" value={form.recyclerPhone} onChange={(e) => updateField("recyclerPhone", e.target.value)} /></label>{form.status === "canceled" && <label className="full"><span>取消原因 *</span><textarea value={form.cancelReason} onChange={(e) => updateField("cancelReason", e.target.value)} /></label>}<label className="full"><span>管理备注</span><textarea maxLength={500} value={form.adminRemark} onChange={(e) => updateField("adminRemark", e.target.value)} /></label></div></section>
    <section><h3>打款凭证 {form.status === "completed" && <em>*</em>}</h3><p className="section-help">支持 JPG、PNG、WebP，单张不超过 10MB，最多 9 张。</p><label className={`upload-box ${uploading ? "disabled" : ""}`}><input type="file" multiple accept="image/jpeg,image/png,image/webp" disabled={uploading} onChange={(e) => void handleFiles(e.target.files)} /><strong>{uploading ? "正在上传…" : "点击选择打款凭证"}</strong><span>完成订单前至少上传 1 张</span></label>{proofPreviews.length > 0 && <div className="image-grid">{proofPreviews.map((url, index) => <div className="image-item" key={`${url}-${index}`}><a href={url} target="_blank" rel="noreferrer"><img src={url} alt={`打款凭证 ${index + 1}`} /></a><button type="button" aria-label="删除该凭证" onClick={() => { setProofs((p) => p.filter((_, i) => i !== index)); setProofPreviews((p) => p.filter((_, i) => i !== index)); }}>×</button></div>)}</div>}</section>
    <footer className="drawer-footer"><button type="button" className="button secondary" onClick={() => setMode("detail")}>取消</button><button className="button primary" disabled={saving || uploading}>{saving ? "正在保存…" : "保存订单"}</button></footer>
  </form>}</aside></div>;
}

function OrderDetail({ order, edit }: { order: Order; edit: () => void }) {
  const address = order.addressSnapshot || {};
  return <div className="detail-content"><div className="detail-status"><StatusBadge status={order.status} /><span>最后更新 {formatTime(order.updateTime)}</span></div><DetailSection title="订单概览"><Detail label="订单号" value={order.orderNo} /><Detail label="下单方式" value={order.source === "photo" ? "拍照提交" : "按品类预约"} /><Detail label="创建时间" value={formatTime(order.createTime)} /><Detail label="预约时间" value={`${order.appointDate || "—"} ${order.appointSlot || ""}`} /></DetailSection><DetailSection title="用户与上门信息"><Detail label="联系人" value={address.contactName} /><Detail label="联系电话" value={address.phone} /><Detail wide label="上门地址" value={`${address.region || ""} ${address.detail || ""}`} /></DetailSection><DetailSection title="物品信息"><Detail wide label="订单摘要" value={order.summary} />{order.items?.map((item, index) => <Detail key={index} label={item.categoryName || `物品 ${index + 1}`} value={item.estCount ? `${item.estCount} 件` : `${item.estWeight || 0} kg`} />)}<Detail wide label="用户备注" value={order.remark} /></DetailSection>{Boolean(order.photoUrls?.length) && <DetailSection title="物品照片"><div className="image-grid wide">{order.photoUrls!.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`物品照片 ${index + 1}`} /></a>)}</div></DetailSection>}<DetailSection title="回收处理"><Detail label="平台估价" value={formatMoney(order.estimatePrice)} /><Detail label="最终金额" value={formatMoney(order.finalPrice)} /><Detail label="实际重量" value={order.finalWeight == null ? "—" : `${order.finalWeight} kg`} /><Detail label="实际件数" value={order.finalCount == null ? "—" : `${order.finalCount} 件`} /><Detail label="回收人员" value={order.recyclerName} /><Detail label="联系电话" value={order.recyclerPhone} /><Detail wide label="管理备注" value={order.adminRemark} />{order.status === "canceled" && <Detail wide label="取消原因" value={order.cancelReason} />}</DetailSection>{Boolean(order.transferProofUrls?.length) && <DetailSection title="打款凭证"><div className="image-grid wide">{order.transferProofUrls!.map((url, index) => <a key={url} href={url} target="_blank" rel="noreferrer"><img src={url} alt={`打款凭证 ${index + 1}`} /></a>)}</div></DetailSection>}{!["completed", "canceled"].includes(order.status) && <footer className="drawer-footer"><button className="button primary" onClick={edit}>处理订单</button></footer>}</div>;
}

function CategoriesPage({ token, onError, notify }: { token: string; onError: (e: unknown) => void; notify: (t: ToastState) => void }) {
  const [list, setList] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState<Category | null | undefined>(undefined);
  const load = useCallback(async () => { setLoading(true); try { setList(await callCloud<Category[]>("adminListCategories", { sessionToken: token })); } catch (error) { onError(error); } finally { setLoading(false); } }, [token, onError]);
  useEffect(() => { void load(); }, [load]);
  return <section className="page-card"><div className="section-top"><div><h2>回收品类</h2><p>品类下架后不影响历史订单快照。</p></div><button className="button primary" onClick={() => setEditing(null)}>+  新增品类</button></div><div className="table-wrap"><table><thead><tr><th>品类名称</th><th>计量单位</th><th>参考价</th><th>排序</th><th>状态</th><th>操作</th></tr></thead><tbody>{loading ? <LoadingRows columns={6} /> : list.length === 0 ? <tr><td colSpan={6}><EmptyState title="暂无回收品类" text="新增后将同步到小程序用户端。" /></td></tr> : list.map((item) => <tr key={item._id}><td><strong>{item.name}</strong></td><td>{item.unit}</td><td>{item.priceRef || "—"}</td><td>{item.sortOrder}</td><td><span className={`enabled-badge ${item.enabled ? "on" : "off"}`}>{item.enabled ? "已上架" : "已下架"}</span></td><td><button className="text-button strong" onClick={() => setEditing(item)}>编辑</button></td></tr>)}</tbody></table></div>{editing !== undefined && <CategoryModal initial={editing} token={token} close={() => setEditing(undefined)} onError={onError} saved={() => { setEditing(undefined); notify({ kind: "success", text: "品类已保存" }); void load(); }} />}</section>;
}

function CategoryModal({ initial, token, close, onError, saved }: { initial: Category | null; token: string; close: () => void; onError: (e: unknown) => void; saved: () => void }) {
  const [form, setForm] = useState<Category>(initial || { name: "", unit: "kg", priceRef: "", sortOrder: 0, enabled: true });
  const [saving, setSaving] = useState(false);
  const submit = async (event: FormEvent) => { event.preventDefault(); if (!form.name.trim()) return onError(new Error("请填写品类名称")); setSaving(true); try { await callCloud("adminSaveCategory", { sessionToken: token, category: { ...form, name: form.name.trim(), priceRef: form.priceRef?.trim() } }); saved(); } catch (error) { onError(error); } finally { setSaving(false); } };
  return <Modal title={initial ? "编辑品类" : "新增品类"} close={close}><form className="modal-form" onSubmit={submit}><label><span>品类名称 *</span><input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label><div className="form-grid"><label><span>计量单位 *</span><select value={form.unit} onChange={(e) => setForm({ ...form, unit: e.target.value as "kg" | "件" })}><option value="kg">kg</option><option value="件">件</option></select></label><label><span>排序</span><input type="number" step="1" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: Number(e.target.value) || 0 })} /></label></div><label><span>参考价</span><input placeholder="例如：0.8元/kg起" value={form.priceRef || ""} onChange={(e) => setForm({ ...form, priceRef: e.target.value })} /></label><label className="switch-row"><div><strong>品类上架</strong><small>关闭后小程序用户端不再展示</small></div><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /></label><footer className="modal-footer"><button type="button" className="button secondary" onClick={close}>取消</button><button className="button primary" disabled={saving}>{saving ? "正在保存…" : "保存品类"}</button></footer></form></Modal>;
}

function SettingsPage({ token, onError, notify }: { token: string; onError: (e: unknown) => void; notify: (t: ToastState) => void }) {
  const [form, setForm] = useState<RecycleSettings | null>(null);
  const [saving, setSaving] = useState(false);
  useEffect(() => { callCloud<RecycleSettings>("adminGetSettings", { sessionToken: token }).then(setForm).catch(onError); }, [token, onError]);
  if (!form) return <section className="page-card"><FullscreenLoading compact text="正在加载系统配置…" /></section>;
  const submit = async (event: FormEvent) => { event.preventDefault(); if (form.minWeightKg < 0 || form.minCount < 0 || !Number.isInteger(form.minCount)) return onError(new Error("请填写有效的起收标准")); setSaving(true); try { const data = await callCloud<RecycleSettings>("adminSaveSettings", { sessionToken: token, settings: form }); setForm(data); notify({ kind: "success", text: "系统配置已保存" }); } catch (error) { onError(error); } finally { setSaving(false); } };
  return <section className="page-card settings-card"><div className="section-top"><div><h2>最低起收标准</h2><p>修改后将影响小程序新建订单的校验规则。</p></div>{form.updateTime ? <span className="updated-at">最后更新 {formatTime(form.updateTime)}</span> : null}</div><form onSubmit={submit}><div className="settings-grid"><label className="setting-item"><div><strong>最低起收重量</strong><p>按重量计量的订单需达到该标准。</p></div><div className="unit-input"><input type="number" min="0" step="0.1" value={form.minWeightKg} onChange={(e) => setForm({ ...form, minWeightKg: Number(e.target.value) })} /><span>kg</span></div></label><label className="setting-item"><div><strong>最低起收件数</strong><p>设为 0 表示不启用件数门槛。</p></div><div className="unit-input"><input type="number" min="0" step="1" value={form.minCount} onChange={(e) => setForm({ ...form, minCount: Number(e.target.value) })} /><span>件</span></div></label><label className="setting-item"><div><strong>拍照订单校验起收量</strong><p>开启后，拍照提交也需满足最低起收标准。</p></div><input type="checkbox" checked={form.photoOrderCheckMinQuantity} onChange={(e) => setForm({ ...form, photoOrderCheckMinQuantity: e.target.checked })} /></label></div><div className="info-callout"><strong>规则影响</strong><p>该配置只影响保存后新提交的订单，不会修改已创建的历史订单。</p></div><div className="settings-actions"><button className="button primary" disabled={saving}>{saving ? "正在保存…" : "保存配置"}</button></div></form></section>;
}

function StatusBadge({ status }: { status: OrderStatus }) { return <span className={`status-badge ${status}`}><i />{STATUS_TEXT[status] || status}</span>; }
function DetailSection({ title, children }: { title: string; children: ReactNode }) { return <section className="detail-section"><h3>{title}</h3><div className="detail-grid">{children}</div></section>; }
function Detail({ label, value, wide = false }: { label: string; value?: ReactNode; wide?: boolean }) { return <div className={`detail-item ${wide ? "wide" : ""}`}><span>{label}</span><strong>{value || "—"}</strong></div>; }
function LoadingRows({ columns }: { columns: number }) { return <>{[0, 1, 2, 3].map((row) => <tr key={row} className="loading-row"><td colSpan={columns}><span /></td></tr>)}</>; }
function EmptyState({ title, text }: { title: string; text: string }) { return <div className="empty-state"><Inbox size={36} /><strong>{title}</strong><p>{text}</p></div>; }
function FullscreenLoading({ text, compact = false }: { text: string; compact?: boolean }) { return <div className={`loading-screen ${compact ? "compact" : ""}`}><span className="spinner" /><p>{text}</p></div>; }
function SystemError({ text }: { text: string }) { return <main className="system-error"><section><h1>管理后台暂时无法启动</h1><p>{text}</p><button className="button primary" onClick={() => location.reload()}>重新加载</button></section></main>; }
function Modal({ title, close, children }: { title: string; close: () => void; children: ReactNode }) { return <div className="modal-layer" role="dialog" aria-modal="true" aria-label={title}><button className="modal-mask" onClick={close} aria-label="关闭" /><section className="modal-card"><header><h2>{title}</h2><button className="icon-button close" onClick={close}><X size={18} /></button></header>{children}</section></div>; }

export default App;
