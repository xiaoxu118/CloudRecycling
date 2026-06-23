const { callCloud } = require("../../utils/cloud");
const { checkLogin } = require("../../utils/auth");

const STATUS_MAP = {
  submitted: "已提交",
  confirmed: "已确认",
  assigned: "回收中",
  recycling: "回收中",
  completed: "已完成",
  canceled: "已取消",
  rejected: "暂不可回收",
};

const STATUS_COLOR = {
  submitted: "#999",
  confirmed: "#ff9800",
  assigned: "#07c160",
  recycling: "#07c160",
  completed: "#07c160",
  canceled: "#999",
  rejected: "#f44336",
};

Page({
  data: {
    tabs: [
      { key: "all", label: "全部" },
      { key: "ongoing", label: "进行中" },
      { key: "done", label: "已结束" },
    ],
    activeTab: "all",
    list: [],
    loading: false,
    hasMore: true,
    page: 1,
    total: 0,
  },

  onShow() {
    if (!checkLogin()) return;
    this.loadList(true);
  },

  onTabChange(e) {
    const key = e.currentTarget.dataset.key;
    this.setData({ activeTab: key, page: 1, list: [], hasMore: true });
    this.loadList();
  },

  async loadList(reset = false) {
    if (!this.data.hasMore) return;
    
    this.setData({ loading: true });
    
    try {
      const res = await callCloud("getOrderList", {
        statusGroup: this.data.activeTab === "all" ? "" : this.data.activeTab,
        page: this.data.page,
        pageSize: 20,
      });
      
      if (res.ok) {
        const { list, total, hasMore } = res.data;
        const formattedList = list.map((item) => ({
          ...item,
          statusText: STATUS_MAP[item.status] || item.status,
          statusColor: STATUS_COLOR[item.status] || "#999",
          timeText: this.formatTime(item.createTime),
        }));
        
        this.setData({
          list: reset ? formattedList : [...this.data.list, ...formattedList],
          total,
          hasMore,
          page: reset ? 1 : this.data.page + 1,
        });
      }
    } catch (e) {
      console.error("loadList failed:", e);
    } finally {
      this.setData({ loading: false });
    }
  },

  onPullDownRefresh() {
    this.setData({ page: 1, list: [], hasMore: true });
    this.loadList().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  onReachBottom() {
    if (!this.data.loading && this.data.hasMore) {
      this.loadList();
    }
  },

  goDetail(e) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({ url: `/pages/order-detail/index?id=${id}` });
  },

  formatTime(timestamp) {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    const h = String(date.getHours()).padStart(2, "0");
    const min = String(date.getMinutes()).padStart(2, "0");
    return `${m}-${d} ${h}:${min}`;
  },
});