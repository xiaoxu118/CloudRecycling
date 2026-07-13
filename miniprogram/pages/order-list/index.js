const { callCloud } = require("../../utils/cloud");
const { checkLogin } = require("../../utils/auth");

// 状态映射：与设计稿一致的标签、颜色、图标
//   type: submitted=待上门(green时钟), processing=进行中(blue卡车), completed=已完成(green勾选), canceled=已取消(gray)
const STATUS_META = {
  submitted: {
    label: "待上门",
    color: "green",
    icon: "clock-green",
  },
  processing: {
    label: "进行中",
    color: "blue",
    icon: "truck-blue",
  },
  completed: {
    label: "已完成",
    color: "green",
    icon: "check-green",
  },
  canceled: {
    label: "已取消",
    color: "gray",
    icon: "",
  },
};

// 格式化预约时间段展示
const formatSlot = (slot) => {
  if (!slot) return "";
  // "14:00-18:00" → "14:00-18:00"（保持）
  return slot;
};

// 把 items 数组提取为品类名数组（给标签用）
const extractCategoryNames = (items) => {
  if (!Array.isArray(items) || !items.length) return [];
  return items.map((i) => i.categoryName).filter(Boolean);
};

Page({
  data: {
    tabs: [
      { key: "all", label: "全部" },
      { key: "ongoing", label: "进行中" },
      { key: "completed", label: "已完成" },
    ],
    activeTab: "all",
    counts: { all: 0, ongoing: 0, completed: 0 },
    keyword: "",
    list: [],
    loading: false,
    hasMore: true,
    page: 1,
    total: 0,
    loadError: "",
  },

  onShow() {
    if (!checkLogin()) return;
    this.loadList(true, true);
  },

  onTabChange(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ activeTab: key, page: 1, list: [], hasMore: true, loadError: "" });
    this.loadList(true);
  },

  onKeywordInput(e) {
    this.setData({ keyword: e.detail.value });
  },

  onKeywordConfirm() {
    this.loadList(true);
  },

  onClearKeyword() {
    this.setData({ keyword: "" });
    this.loadList(true);
  },

  async loadList(reset = false, includeCounts = false) {
    if (reset) {
      this.setData({ page: 1, hasMore: true });
    }
    if (!this.data.hasMore && !reset) return;

    this.setData({ loading: true, loadError: "" });
    const currentPage = reset ? 1 : this.data.page;

    try {
      const filter = this.buildFilterPayload();
      const res = await callCloud(
        "getOrderList",
        {
          ...filter,
          page: currentPage,
          pageSize: 20,
          includeCounts,
        },
        { toast: false }
      );

      if (res.ok) {
        const { list, total, hasMore, counts } = res.data;
        const formattedList = list.map((item) => this.formatItem(item));

        const nextData = {
          list: reset ? formattedList : [...this.data.list, ...formattedList],
          total,
          hasMore,
          page: currentPage + 1,
        };
        if (counts) nextData.counts = counts;
        this.setData(nextData);
      } else {
        this.setData({ loadError: "订单加载失败，请稍后重试" });
      }
    } catch (e) {
      console.error("loadList failed:", e);
      this.setData({ loadError: "订单加载失败，请稍后重试" });
    } finally {
      this.setData({ loading: false });
      wx.stopPullDownRefresh();
    }
  },

  formatItem(item) {
    const meta = STATUS_META[item.status] || STATUS_META.submitted;
    const address = item.addressSnapshot || {};
    const addressText = [address.region, address.detail].filter(Boolean).join(" ") || item.summary;
    const catNames = extractCategoryNames(item.items);
    const appointText = item.appointDate
      ? `${item.appointDate.replace(/-/g, "/").slice(5)} · ${formatSlot(item.appointSlot)}`
      : "";
    return {
      ...item,
      statusLabel: meta.label,
      statusColor: meta.color,
      statusIcon: meta.icon,
      addressText,
      appointText,
      categoryText: catNames.join("、"),
    };
  },

  buildFilterPayload() {
    const filter = {};
    if (this.data.activeTab === "ongoing") {
      filter.status = ["submitted", "processing"];
    } else if (this.data.activeTab === "completed") {
      filter.status = "completed";
    }
    // 关键词暂不在后端搜索字段内，此处只做本地占位（后续 adminListOrders 有 keyword 支持可加）
    return filter;
  },

  onPullDownRefresh() {
    this.loadList(true, true);
  },

  onReachBottom() {
    if (!this.data.loading && this.data.hasMore) {
      this.loadList();
    }
  },

  retryLoad() {
    this.loadList(true);
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
  },

  goCreate() {
    wx.switchTab({ url: "/pages/home/index" });
  },
});
