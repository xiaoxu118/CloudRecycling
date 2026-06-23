const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
// 获取openid
const getOpenId = async () => {
  // 获取基础信息
  const wxContext = cloud.getWXContext();
  // 统一返回契约：{ success, data }，与前端 callCloud 保持一致
  return {
    success: true,
    data: {
      openid: wxContext.OPENID,
      appid: wxContext.APPID,
      unionid: wxContext.UNIONID,
    },
  };
};

// 解密用户手机号：前端 <button open-type="getPhoneNumber"> 拿到 code，
// 云函数用 cloud.openapi.phonenumber.getPhoneNumber 换取明文手机号。
// 注意：需小程序为「非个人主体」，且 config.json 登记 phonenumber.getPhoneNumber 权限。
const getPhoneNumber = async (event) => {
  const { code } = event;
  if (!code) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }
  try {
    const res = await cloud.openapi.phonenumber.getPhoneNumber({ code });
    const info = res.phoneInfo || {};
    return {
      success: true,
      data: {
        phoneNumber: info.phoneNumber,
        purePhoneNumber: info.purePhoneNumber,
        countryCode: info.countryCode,
      },
    };
  } catch (e) {
    console.error("getPhoneNumber failed:", e);
    return { success: false, errMsg: "PHONE_DECRYPT_FAILED" };
  }
};

// 获取小程序二维码
const getMiniProgramCode = async () => {
  // 获取小程序二维码的buffer
  const resp = await cloud.openapi.wxacode.get({
    path: "pages/index/index",
  });
  const { buffer } = resp;
  // 将图片上传云存储空间
  const upload = await cloud.uploadFile({
    cloudPath: "code.png",
    fileContent: buffer,
  });
  return upload.fileID;
};

// 创建集合
const createCollection = async () => {
  try {
    // 创建集合
    await db.createCollection("sales");
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "上海",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华东",
        city: "南京",
        sales: 11,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "广州",
        sales: 22,
      },
    });
    await db.collection("sales").add({
      // data 字段表示需新增的 JSON 数据
      data: {
        region: "华南",
        city: "深圳",
        sales: 22,
      },
    });
    return {
      success: true,
    };
  } catch (e) {
    // 这里catch到的是该collection已经存在，从业务逻辑上来说是运行成功的，所以catch返回success给前端，避免工具在前端抛出异常
    return {
      success: true,
      data: "create collection success",
    };
  }
};

// 查询数据
const selectRecord = async () => {
  // 返回数据库查询结果
  return await db.collection("sales").get();
};

// 更新数据
const updateRecord = async (event) => {
  try {
    // 遍历修改数据库信息
    for (let i = 0; i < event.data.length; i++) {
      await db
        .collection("sales")
        .where({
          _id: event.data[i]._id,
        })
        .update({
          data: {
            sales: event.data[i].sales,
          },
        });
    }
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// 新增数据
const insertRecord = async (event) => {
  try {
    const insertRecord = event.data;
    // 插入数据
    await db.collection("sales").add({
      data: {
        region: insertRecord.region,
        city: insertRecord.city,
        sales: Number(insertRecord.sales),
      },
    });
    return {
      success: true,
      data: event.data,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// ============ 云回收业务 ============
// 业务逻辑拆分到 recycle/ 子模块，按需 require
const recycleCategories = require("./recycle/categories");
const recycleAddress = require("./recycle/address");
const recycleOrders = require("./recycle/orders");

// 删除数据
const deleteRecord = async (event) => {
  try {
    await db
      .collection("sales")
      .where({
        _id: event.data._id,
      })
      .remove();
    return {
      success: true,
    };
  } catch (e) {
    return {
      success: false,
      errMsg: e,
    };
  }
};

// const getOpenId = require('./getOpenId/index');
// const getMiniProgramCode = require('./getMiniProgramCode/index');
// const createCollection = require('./createCollection/index');
// const selectRecord = require('./selectRecord/index');
// const updateRecord = require('./updateRecord/index');
// const fetchGoodsList = require('./fetchGoodsList/index');
// const genMpQrcode = require('./genMpQrcode/index');
// 云函数入口函数
exports.main = async (event, context) => {
  // 当前调用用户的 openid，用于"我的数据"接口的归属隔离
  const { OPENID } = cloud.getWXContext();
  switch (event.type) {
    case "getOpenId":
      return await getOpenId();
    case "getPhoneNumber":
      return await getPhoneNumber(event);
    case "getMiniProgramCode":
      return await getMiniProgramCode();
    case "createCollection":
      return await createCollection();
    case "selectRecord":
      return await selectRecord();
    case "updateRecord":
      return await updateRecord(event);
    case "insertRecord":
      return await insertRecord(event);
    case "deleteRecord":
      return await deleteRecord(event);
    // ===== 云回收业务 =====
    // 系统 / 品类
    case "initRecycleDB":
      return await recycleCategories.initRecycleDB();
    case "listCategories":
      return await recycleCategories.listCategories();
    // 地址
    case "getAddressList":
      return await recycleAddress.getAddressList(event, OPENID);
    case "saveAddress":
      return await recycleAddress.saveAddress(event, OPENID);
    case "deleteAddress":
      return await recycleAddress.deleteAddress(event, OPENID);
    // 订单
    case "createOrder":
      return await recycleOrders.createOrder(event, OPENID);
    case "getOrderList":
      return await recycleOrders.getOrderList(event, OPENID);
    case "getOrderDetail":
      return await recycleOrders.getOrderDetail(event, OPENID);
    case "cancelOrder":
      return await recycleOrders.cancelOrder(event, OPENID);
    case "getTempFileURL":
      return await recycleOrders.getTempFileURL(event);
  }
};
