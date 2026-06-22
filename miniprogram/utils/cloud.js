// 云回收 · 云函数调用统一封装
// 所有页面通过 callCloud 调用后端，集中处理：环境未配置 / 云函数未部署 / 业务错误码

// 业务错误码 → 中文提示（接口契约 0.4）
const ERR_MSG_MAP = {
  PARAM_INVALID: "参数有误",
  ADDRESS_NOT_FOUND: "地址不存在",
  ORDER_NOT_FOUND: "订单不存在",
  ORDER_STATUS_INVALID: "当前状态不可操作",
  BELOW_MIN_QUANTITY: "未达最低起收量",
  NO_PERMISSION: "无权限",
  DB_ERROR: "服务繁忙，请稍后再试",
};

// 全局提示弹窗状态：页面可通过 getEnvTip() 读取后传给 cloudTipModal
let envTip = { show: false, title: "", content: "" };

const setEnvTip = (title, content) => {
  envTip = { show: true, title, content };
};

const getEnvTip = () => envTip;

const clearEnvTip = () => {
  envTip = { show: false, title: "", content: "" };
};

/**
 * 调用云函数
 * @param {string} type   接口 type
 * @param {object} data   其它入参
 * @param {object} opts   { toast: 是否自动 toast 业务错误，默认 true }
 * @returns {Promise<{ok:boolean, data?:any, errMsg?:string}>}
 *          ok=true 时 data 为业务数据；ok=false 时 errMsg 为错误码
 */
const callCloud = (type, data = {}, opts = {}) => {
  const { toast = true } = opts;
  return wx.cloud
    .callFunction({ name: "quickstartFunctions", data: { type, ...data } })
    .then((res) => {
      const result = res.result || {};
      if (result.success) {
        return { ok: true, data: result.data };
      }
      // 业务错误
      const code = result.errMsg || "DB_ERROR";
      if (toast) {
        wx.showToast({ title: ERR_MSG_MAP[code] || "操作失败", icon: "none" });
      }
      return { ok: false, errMsg: code };
    })
    .catch((err) => {
      // 平台级错误：环境未配置 / 云函数未部署，用弹窗提示（沿用现有套路）
      const msg = (err && err.errMsg) || "";
      if (msg.includes("Environment not found")) {
        setEnvTip("云开发环境未配置", "请在 app.js 中填入正确的环境 ID");
      } else if (msg.includes("could not be found")) {
        setEnvTip("云函数未上传部署", "请右键 quickstartFunctions 上传并部署");
      } else if (toast) {
        wx.showToast({ title: "网络异常，请重试", icon: "none" });
      }
      return { ok: false, errMsg: msg || "NETWORK_ERROR" };
    });
};

module.exports = { callCloud, getEnvTip, clearEnvTip, ERR_MSG_MAP };
