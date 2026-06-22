const cloud = require("wx-server-sdk");
cloud.init({
  env: cloud.DYNAMIC_CURRENT_ENV,
});

const db = cloud.database();
// 获取openid
const getOpenId = async () => {
  // 获取基础信息
  const wxContext = cloud.getWXContext();
  return {
    openid: wxContext.OPENID,
    appid: wxContext.APPID,
    unionid: wxContext.UNIONID,
  };
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

// 示例品类数据（来自数据字典，平台可后续在控制台增删改）
const SAMPLE_CATEGORIES = [
  { name: "纸箱/废纸", unit: "kg", priceRef: "0.8元/kg", icon: "", sortOrder: 1, enabled: true },
  { name: "塑料瓶/塑料", unit: "kg", priceRef: "0.5元/kg", icon: "", sortOrder: 2, enabled: true },
  { name: "易拉罐/金属", unit: "kg", priceRef: "2.0元/kg", icon: "", sortOrder: 3, enabled: true },
  { name: "旧衣物", unit: "kg", priceRef: "0.2元/kg", icon: "", sortOrder: 4, enabled: true },
  { name: "旧家电", unit: "件", priceRef: "面议", icon: "", sortOrder: 5, enabled: true },
];

// 初始化数据库：创建 categories/addresses/orders 集合，写入示例品类
// 仅开发期手动调用一次；可重复调用（集合已存在会被 catch，品类非空时跳过写入）
const initRecycleDB = async () => {
  // 1. 创建三个集合，已存在则忽略异常
  for (const name of ["categories", "addresses", "orders"]) {
    try {
      await db.createCollection(name);
    } catch (e) {
      // 集合已存在会抛错，属正常情况，忽略
    }
  }

  // 2. 仅当 categories 为空时写入示例品类，避免重复调用产生重复数据
  try {
    const { total } = await db.collection("categories").count();
    if (total === 0) {
      for (const cat of SAMPLE_CATEGORIES) {
        await db.collection("categories").add({ data: cat });
      }
    }
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }

  return { success: true };
};

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
  switch (event.type) {
    case "getOpenId":
      return await getOpenId();
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
    case "initRecycleDB":
      return await initRecycleDB();
  }
};
