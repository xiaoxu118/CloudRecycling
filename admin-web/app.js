(function () {
  const config = window.ADMIN_CONFIG || {};
  const bypassAdminAuth = config.bypassAdminAuth === true;
  const state = {
    app: null,
    sessionToken: localStorage.getItem("admin_session_token") || "",
    adminName: localStorage.getItem("admin_name") || "",
    ticket: "",
    webNonce: "",
    pollTimer: null,
    ordersPage: 1,
    ordersPageSize: 20,
    ordersTotal: 0,
    ordersHasMore: false,
    categories: [],
    currentView: "orders",
  };

  const STATUS_TEXT = {
    submitted: "已提交",
    processing: "处理中",
    completed: "已完成",
    canceled: "已取消",
  };

  const ERROR_TEXT = {
    FINAL_PRICE_REQUIRED: "请填写最终金额",
    FINAL_QUANTITY_REQUIRED: "请填写实际重量或数量",
    TRANSFER_PROOF_REQUIRED: "请上传打款截图",
    CANCEL_REASON_REQUIRED: "请选择取消原因",
    ORDER_STATUS_INVALID: "当前状态不可操作",
    PARAM_INVALID: "参数有误",
    DB_ERROR: "服务繁忙，请稍后再试",
  };

  const $ = (id) => document.getElementById(id);

  const escapeHtml = (value) =>
    String(value == null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#039;");

  const formatTime = (ts) => {
    if (!ts) return "";
    const d = new Date(ts);
    const pad = (n) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
      d.getHours()
    )}:${pad(d.getMinutes())}`;
  };

  const errorText = (e) => ERROR_TEXT[e.code] || e.code || e.message;

  const callCloud = async (type, data = {}) => {
    if (!state.app) throw new Error("CloudBase SDK 未初始化");
    const res = await state.app.callFunction({
      name: config.functionName,
      data: { type, ...data },
    });
    const result = res.result || {};
    if (!result.success) {
      const err = new Error(result.errMsg || "CALL_FAILED");
      err.code = result.errMsg || "CALL_FAILED";
      err.data = result.data;
      throw err;
    }
    return result.data;
  };

  const initCloud = async () => {
    if (!window.cloudbase) {
      throw new Error("CloudBase JS SDK 加载失败");
    }
    if (!config.env || !config.functionName) {
      throw new Error("请先配置 admin-web/config.js");
    }
    state.app = window.cloudbase.init({ env: config.env });
    const auth = state.app.auth;
    if (!auth || typeof auth.signInAnonymously !== "function") {
      throw new Error("CloudBase JS SDK 初始化异常，请检查 SDK 版本");
    }
    const loginRes = await auth.signInAnonymously();
    if (loginRes && loginRes.error) {
      const err = new Error(loginRes.error.message || "匿名登录失败");
      err.code = loginRes.error.code;
      throw err;
    }
  };

  const setLoginMessage = (text) => {
    $("loginMessage").textContent = text || "";
  };

  const showApp = () => {
    $("loginView").classList.add("hidden");
    $("appView").classList.remove("hidden");
    $("adminName").textContent = bypassAdminAuth
      ? "临时免登录模式"
      : state.adminName
        ? `当前管理员：${state.adminName}`
        : "";
    $("logoutBtn").classList.toggle("hidden", bypassAdminAuth);
    loadOrders(true);
  };

  const showLogin = () => {
    $("appView").classList.add("hidden");
    $("loginView").classList.remove("hidden");
  };

  const createLoginTicket = async () => {
    clearInterval(state.pollTimer);
    $("qrImage").removeAttribute("src");
    $("qrFallback").textContent = "";
    setLoginMessage("正在生成登录二维码...");
    try {
      const data = await callCloud("adminCreateLoginTicket");
      state.ticket = data.ticket;
      state.webNonce = data.webNonce;
      if (data.qrUrl) {
        $("qrImage").src = data.qrUrl;
        $("qrImage").classList.remove("hidden");
        $("qrFallback").textContent = "";
        setLoginMessage("请使用微信扫码，并在小程序内确认登录。");
      } else {
        $("qrImage").classList.add("hidden");
        $("qrFallback").innerHTML = `小程序码生成失败。<br />可在开发者工具打开：<br />${escapeHtml(
          data.path || ""
        )}`;
        setLoginMessage("请确认云函数 openapi 权限和小程序发布/体验配置。");
      }
      startPollingTicket();
    } catch (e) {
      console.error(e);
      setLoginMessage(`生成二维码失败：${e.code || e.message}`);
    }
  };

  const startPollingTicket = () => {
    state.pollTimer = setInterval(async () => {
      if (!state.ticket) return;
      try {
        const data = await callCloud("adminCheckLoginTicket", {
          ticket: state.ticket,
          webNonce: state.webNonce,
        });
        if (data && data.status === "confirmed") {
          clearInterval(state.pollTimer);
          state.sessionToken = data.sessionToken;
          state.adminName = data.adminName || "管理员";
          localStorage.setItem("admin_session_token", state.sessionToken);
          localStorage.setItem("admin_name", state.adminName);
          showApp();
        }
      } catch (e) {
        if (e.code === "LOGIN_TICKET_EXPIRED") {
          clearInterval(state.pollTimer);
          setLoginMessage("二维码已过期，请刷新。");
        }
      }
    }, 1800);
  };

  const logout = () => {
    state.sessionToken = "";
    state.adminName = "";
    localStorage.removeItem("admin_session_token");
    localStorage.removeItem("admin_name");
    showLogin();
    createLoginTicket();
  };

  const authPayload = () => ({ sessionToken: state.sessionToken });

  const loadOrders = async (resetPage = false) => {
    if (resetPage) state.ordersPage = 1;
    const status = $("statusFilter").value;
    const keyword = $("keywordInput").value.trim();
    $("ordersBody").innerHTML = `<tr><td colspan="7">加载中...</td></tr>`;
    try {
      const data = await callCloud("adminListOrders", {
        ...authPayload(),
        status,
        keyword,
        page: state.ordersPage,
        pageSize: state.ordersPageSize,
      });
      state.ordersTotal = data.total || 0;
      state.ordersHasMore = !!data.hasMore;
      renderOrders(data.list || []);
    } catch (e) {
      handleAdminError(e);
      $("ordersBody").innerHTML = `<tr><td colspan="7">加载失败：${escapeHtml(
        e.code || e.message
      )}</td></tr>`;
    }
  };

  const renderOrders = (list) => {
    if (!list.length) {
      $("ordersBody").innerHTML = `<tr><td colspan="7">暂无订单</td></tr>`;
    } else {
      $("ordersBody").innerHTML = list
        .map((item) => {
          const addr = item.addressSnapshot || {};
          const price =
            item.finalPrice != null
              ? `最终 ${item.finalPrice} 元`
              : item.estimatePrice != null
                ? `估价 ${item.estimatePrice} 元`
                : "-";
          return `<tr>
            <td>${escapeHtml(item.orderNo)}</td>
            <td><span class="status ${escapeHtml(item.status)}">${escapeHtml(
              STATUS_TEXT[item.status] || item.status
            )}</span></td>
            <td>${escapeHtml(item.summary || "")}</td>
            <td>${escapeHtml(addr.contactName || "")}<br />${escapeHtml(addr.phone || "")}</td>
            <td>${escapeHtml(item.appointDate || "")}<br />${escapeHtml(
              item.appointSlot || ""
            )}</td>
            <td>${escapeHtml(price)}</td>
            <td><div class="row-actions">
              <button class="link-btn" data-action="detail" data-id="${escapeHtml(item._id)}">详情</button>
              <button class="link-btn" data-action="update" data-id="${escapeHtml(item._id)}">处理</button>
            </div></td>
          </tr>`;
        })
        .join("");
    }
    $("pageInfo").textContent = `第 ${state.ordersPage} 页，共 ${state.ordersTotal} 条`;
    $("prevPageBtn").disabled = state.ordersPage <= 1;
    $("nextPageBtn").disabled = !state.ordersHasMore;
  };

  const loadOrderDetail = async (id, mode = "detail") => {
    openModal(mode === "detail" ? "订单详情" : "处理订单", "加载中...");
    try {
      const order = await callCloud("adminGetOrderDetail", { ...authPayload(), id });
      if (mode === "detail") {
        renderOrderDetail(order);
      } else {
        renderOrderUpdate(order);
      }
    } catch (e) {
      handleAdminError(e);
      $("modalBody").textContent = `加载失败：${e.code || e.message}`;
    }
  };

  const renderOrderDetail = (order) => {
    const addr = order.addressSnapshot || {};
    const items = (order.items || [])
      .map((item) => {
        const qty = Number(item.estCount) > 0 ? `${item.estCount} 件` : `${item.estWeight || 0} kg`;
        return `<div>${escapeHtml(item.categoryName)}：${escapeHtml(qty)}</div>`;
      })
      .join("");
    const photos = (order.photoUrls || [])
      .map((url) => `<a href="${escapeHtml(url)}" target="_blank"><img src="${escapeHtml(url)}" /></a>`)
      .join("");
    const proofs = (order.transferProofUrls || [])
      .map((url) => `<a href="${escapeHtml(url)}" target="_blank"><img src="${escapeHtml(url)}" /></a>`)
      .join("");
    $("modalBody").innerHTML = `
      <div class="detail-grid">
        <div class="detail-item"><span class="label">订单号</span>${escapeHtml(order.orderNo)}</div>
        <div class="detail-item"><span class="label">状态</span>${escapeHtml(
          STATUS_TEXT[order.status] || order.status
        )}</div>
        <div class="detail-item"><span class="label">预约时间</span>${escapeHtml(
          order.appointDate
        )} ${escapeHtml(order.appointSlot)}</div>
        <div class="detail-item"><span class="label">创建时间</span>${escapeHtml(
          formatTime(order.createTime)
        )}</div>
        <div class="detail-item full"><span class="label">联系人</span>${escapeHtml(
          addr.contactName || ""
        )} ${escapeHtml(addr.phone || "")}<br />${escapeHtml(addr.region || "")} ${escapeHtml(
          addr.detail || ""
        )}</div>
        <div class="detail-item full"><span class="label">物品信息</span>${
          items || escapeHtml(order.summary || "")
        }</div>
        <div class="detail-item full"><span class="label">备注</span>${escapeHtml(
          order.remark || "-"
        )}</div>
        <div class="detail-item"><span class="label">平台估价</span>${escapeHtml(
          order.estimatePrice == null ? "-" : `${order.estimatePrice} 元`
        )}</div>
        <div class="detail-item"><span class="label">最终结果</span>${escapeHtml(
          order.finalPrice == null
            ? "-"
            : `${order.finalWeight || order.finalCount || 0} ${
                order.finalWeight ? "kg" : "件"
              } / ${order.finalPrice} 元`
        )}</div>
        <div class="detail-item"><span class="label">回收人员</span>${escapeHtml(
          [order.recyclerName, order.recyclerPhone].filter(Boolean).join(" / ") || "-"
        )}</div>
        <div class="detail-item"><span class="label">取消原因</span>${escapeHtml(
          order.cancelReason || "-"
        )}</div>
        <div class="detail-item full"><span class="label">管理备注</span>${escapeHtml(
          order.adminRemark || "-"
        )}</div>
      </div>
      ${photos ? `<div class="asset-title">用户照片</div><div class="photos">${photos}</div>` : ""}
      ${proofs ? `<div class="asset-title">打款截图</div><div class="photos">${proofs}</div>` : ""}
    `;
  };

  const uploadTransferProofs = async (orderNo, files) => {
    const list = Array.from(files || []);
    const uploaded = [];
    for (const file of list) {
      const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
      const cloudPath = `transfer-proofs/${orderNo}/${Date.now()}-${Math.random()
        .toString(36)
        .slice(2)}.${ext}`;
      const res = await state.app.uploadFile({ cloudPath, filePath: file });
      uploaded.push(res.fileID);
    }
    return uploaded;
  };

  const renderOrderUpdate = (order) => {
    const currentProofs = Array.isArray(order.transferProofs) ? order.transferProofs : [];
    const proofImages = (order.transferProofUrls || [])
      .map((url) => `<a href="${escapeHtml(url)}" target="_blank"><img src="${escapeHtml(url)}" /></a>`)
      .join("");
    $("modalBody").innerHTML = `
      <form id="orderUpdateForm" class="form-grid">
        <label>订单状态
          <select name="status">
            ${Object.entries(STATUS_TEXT)
              .map(
                ([value, text]) =>
                  `<option value="${value}" ${order.status === value ? "selected" : ""}>${text}</option>`
              )
              .join("")}
          </select>
        </label>
        <label>平台估价
          <input name="estimatePrice" type="number" step="0.01" value="${escapeHtml(
            order.estimatePrice == null ? "" : order.estimatePrice
          )}" />
        </label>
        <label>回收员标识
          <input name="recyclerId" value="${escapeHtml(order.recyclerId || "")}" />
        </label>
        <label>回收人员
          <input name="recyclerName" value="${escapeHtml(order.recyclerName || "")}" />
        </label>
        <label>回收人员电话
          <input name="recyclerPhone" value="${escapeHtml(order.recyclerPhone || "")}" />
        </label>
        <label>实际重量
          <input name="finalWeight" type="number" step="0.01" value="${escapeHtml(
            order.finalWeight == null ? "" : order.finalWeight
          )}" />
        </label>
        <label>实际件数
          <input name="finalCount" type="number" step="1" value="${escapeHtml(
            order.finalCount == null ? "" : order.finalCount
          )}" />
        </label>
        <label>最终金额
          <input name="finalPrice" type="number" step="0.01" value="${escapeHtml(
            order.finalPrice == null ? "" : order.finalPrice
          )}" />
        </label>
        <label class="full">取消原因
          <input name="cancelReason" value="${escapeHtml(order.cancelReason || order.rejectReason || "")}" />
        </label>
        <label class="full">打款截图
          <input name="transferProofFiles" type="file" accept="image/*" multiple />
          <span class="help-text">订单改为已完成时必须至少上传一张打款截图。</span>
        </label>
        ${
          proofImages
            ? `<div class="full"><div class="asset-title">已有打款截图</div><div class="photos">${proofImages}</div></div>`
            : ""
        }
        <label class="full">管理备注
          <textarea name="adminRemark">${escapeHtml(order.adminRemark || "")}</textarea>
        </label>
        <div class="modal-actions full">
          <button type="button" class="secondary-btn" id="cancelUpdateBtn">取消</button>
          <button type="submit" class="primary-btn">保存</button>
        </div>
      </form>
    `;
    $("cancelUpdateBtn").addEventListener("click", closeModal);
    $("orderUpdateForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      delete payload.transferProofFiles;
      try {
        const files = event.currentTarget.elements.transferProofFiles.files;
        const newProofs = await uploadTransferProofs(order.orderNo, files);
        await callCloud("adminUpdateOrder", {
          ...authPayload(),
          id: order._id,
          ...payload,
          transferProofs: [...currentProofs, ...newProofs],
        });
        closeModal();
        loadOrders();
      } catch (e) {
        handleAdminError(e);
        alert(`保存失败：${errorText(e)}`);
      }
    });
  };

  const loadCategories = async () => {
    $("categoriesBody").innerHTML = `<tr><td colspan="6">加载中...</td></tr>`;
    try {
      const list = await callCloud("adminListCategories", authPayload());
      state.categories = list || [];
      renderCategories();
    } catch (e) {
      handleAdminError(e);
      $("categoriesBody").innerHTML = `<tr><td colspan="6">加载失败：${escapeHtml(
        e.code || e.message
      )}</td></tr>`;
    }
  };

  const renderCategories = () => {
    if (!state.categories.length) {
      $("categoriesBody").innerHTML = `<tr><td colspan="6">暂无品类</td></tr>`;
      return;
    }
    $("categoriesBody").innerHTML = state.categories
      .map(
        (item) => `<tr>
          <td>${escapeHtml(item.name)}</td>
          <td>${escapeHtml(item.unit)}</td>
          <td>${escapeHtml(item.priceRef || "")}</td>
          <td>${escapeHtml(item.sortOrder || 0)}</td>
          <td>${item.enabled === false ? "已下架" : "上架中"}</td>
          <td><button class="link-btn" data-action="edit-category" data-id="${escapeHtml(
            item._id
          )}">编辑</button></td>
        </tr>`
      )
      .join("");
  };

  const editCategory = (category = {}) => {
    openModal(category._id ? "编辑品类" : "新增品类", `
      <form id="categoryForm" class="form-grid">
        <label>名称
          <input name="name" required value="${escapeHtml(category.name || "")}" />
        </label>
        <label>单位
          <select name="unit">
            <option value="kg" ${category.unit === "kg" ? "selected" : ""}>kg</option>
            <option value="件" ${category.unit === "件" ? "selected" : ""}>件</option>
          </select>
        </label>
        <label>参考价
          <input name="priceRef" value="${escapeHtml(category.priceRef || "")}" />
        </label>
        <label>排序
          <input name="sortOrder" type="number" value="${escapeHtml(category.sortOrder || 0)}" />
        </label>
        <label>状态
          <select name="enabled">
            <option value="true" ${category.enabled !== false ? "selected" : ""}>上架</option>
            <option value="false" ${category.enabled === false ? "selected" : ""}>下架</option>
          </select>
        </label>
        <div class="modal-actions full">
          <button type="button" class="secondary-btn" id="cancelCategoryBtn">取消</button>
          <button type="submit" class="primary-btn">保存</button>
        </div>
      </form>
    `);
    $("cancelCategoryBtn").addEventListener("click", closeModal);
    $("categoryForm").addEventListener("submit", async (event) => {
      event.preventDefault();
      const form = new FormData(event.currentTarget);
      const payload = Object.fromEntries(form.entries());
      payload.enabled = payload.enabled === "true";
      payload.sortOrder = Number(payload.sortOrder) || 0;
      if (category._id) payload._id = category._id;
      try {
        await callCloud("adminSaveCategory", {
          ...authPayload(),
          category: payload,
        });
        closeModal();
        loadCategories();
      } catch (e) {
        handleAdminError(e);
        alert(`保存失败：${errorText(e)}`);
      }
    });
  };

  const loadSettings = async () => {
    try {
      const data = await callCloud("adminGetSettings", authPayload());
      $("minWeightInput").value = data.minWeightKg || 5;
      $("minCountInput").value = data.minCount || 0;
      $("photoCheckInput").checked = data.photoOrderCheckMinQuantity === true;
    } catch (e) {
      handleAdminError(e);
      alert(`加载配置失败：${errorText(e)}`);
    }
  };

  const saveSettings = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const settings = {
      minWeightKg: Number(form.get("minWeightKg")) || 5,
      minCount: Number(form.get("minCount")) || 0,
      photoOrderCheckMinQuantity: $("photoCheckInput").checked,
    };
    try {
      await callCloud("adminSaveSettings", { ...authPayload(), settings });
      alert("配置已保存");
      loadSettings();
    } catch (e) {
      handleAdminError(e);
      alert(`保存配置失败：${errorText(e)}`);
    }
  };

  const switchView = (view) => {
    state.currentView = view;
    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.view === view);
    });
    $("ordersView").classList.toggle("hidden", view !== "orders");
    $("categoriesView").classList.toggle("hidden", view !== "categories");
    $("settingsView").classList.toggle("hidden", view !== "settings");
    const titles = {
      orders: ["订单管理", "查看真实订单数据并推进订单状态"],
      categories: ["品类管理", "维护小程序展示的回收品类"],
      settings: ["系统配置", "配置小程序下单规则"],
    };
    $("pageTitle").textContent = titles[view][0];
    $("pageDesc").textContent = titles[view][1];
    if (view === "categories") loadCategories();
    if (view === "settings") loadSettings();
  };

  const openModal = (title, body) => {
    $("modalTitle").textContent = title;
    $("modalBody").innerHTML = body;
    $("modal").classList.remove("hidden");
  };

  const closeModal = () => {
    $("modal").classList.add("hidden");
    $("modalBody").innerHTML = "";
  };

  const handleAdminError = (e) => {
    if (e.code === "ADMIN_SESSION_REQUIRED" || e.code === "ADMIN_SESSION_EXPIRED") {
      alert("管理登录已过期，请重新扫码登录。");
      logout();
    }
  };

  const bindEvents = () => {
    $("refreshTicketBtn").addEventListener("click", createLoginTicket);
    $("logoutBtn").addEventListener("click", logout);
    $("searchOrdersBtn").addEventListener("click", () => loadOrders(true));
    $("reloadOrdersBtn").addEventListener("click", () => loadOrders());
    $("prevPageBtn").addEventListener("click", () => {
      if (state.ordersPage > 1) {
        state.ordersPage -= 1;
        loadOrders();
      }
    });
    $("nextPageBtn").addEventListener("click", () => {
      if (state.ordersHasMore) {
        state.ordersPage += 1;
        loadOrders();
      }
    });
    $("reloadCategoriesBtn").addEventListener("click", loadCategories);
    $("newCategoryBtn").addEventListener("click", () => editCategory());
    $("reloadSettingsBtn").addEventListener("click", loadSettings);
    $("settingsForm").addEventListener("submit", saveSettings);
    $("modalCloseBtn").addEventListener("click", closeModal);
    document.querySelector(".modal-mask").addEventListener("click", closeModal);

    document.querySelectorAll(".nav-btn").forEach((btn) => {
      btn.addEventListener("click", () => switchView(btn.dataset.view));
    });

    $("ordersBody").addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-action]");
      if (!btn) return;
      if (btn.dataset.action === "detail") loadOrderDetail(btn.dataset.id, "detail");
      if (btn.dataset.action === "update") loadOrderDetail(btn.dataset.id, "update");
    });

    $("categoriesBody").addEventListener("click", (event) => {
      const btn = event.target.closest("button[data-action='edit-category']");
      if (!btn) return;
      const category = state.categories.find((item) => item._id === btn.dataset.id);
      editCategory(category);
    });
  };

  const bootstrap = async () => {
    bindEvents();
    try {
      await initCloud();
      if (bypassAdminAuth) {
        state.adminName = "临时开发管理员";
        showApp();
      } else if (state.sessionToken) {
        showApp();
      } else {
        showLogin();
        createLoginTicket();
      }
    } catch (e) {
      console.error(e);
      showLogin();
      setLoginMessage(e.message);
    }
  };

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
