// app.js
const { loadLoginStatus, isLoggedIn, ensureOpenid } = require("./utils/auth");

App({
  onLaunch: function () {
    loadLoginStatus();

    this.globalData = {
      env: "cloud1-d9gxprjx1b20af56e",
      selectedCategories: [],
      pickedAddress: null,
      editingAddress: null,
    };

    if (!wx.cloud) {
      console.error("请使用 2.2.3 或以上的基础库以使用云能力");
    } else {
      wx.cloud.init({
        env: this.globalData.env,
        traceUser: true,
      });
      // 打开小程序就拉一次 openid，保证 checkLogin 前就有身份可用
      ensureOpenid().catch((e) => console.warn("ensureOpenid failed:", e));
    }
  },

  isLoggedIn: () => isLoggedIn(),
});