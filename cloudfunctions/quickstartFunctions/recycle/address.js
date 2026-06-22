// 云回收 · 地址模块
// 对应接口契约：3.1 getAddressList、3.2 saveAddress、3.3 deleteAddress
// 待办：R10 默认地址唯一性、R11 删除地址副作用
const cloud = require("wx-server-sdk");

const db = cloud.database();
const _ = db.command;

// getAddressList — 我的地址列表，默认地址排最前
const getAddressList = async (event, OPENID) => {
  try {
    const res = await db
      .collection("addresses")
      .where({ _openid: OPENID })
      .orderBy("isDefault", "desc")
      .orderBy("createTime", "desc")
      .get();
    return { success: true, data: res.data };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

// saveAddress — 新增/修改地址
// 入参 event.address: { _id?, contactName, phone, region, detail, isDefault? }
const saveAddress = async (event, OPENID) => {
  const a = event.address || {};
  // 1. 必填校验
  if (!a.contactName || !a.phone || !a.region || !a.detail) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }

  try {
    const coll = db.collection("addresses");

    // 2. R10：首个地址自动设为默认
    const { total } = await coll.where({ _openid: OPENID }).count();
    let wantDefault = !!a.isDefault;
    if (total === 0) {
      wantDefault = true;
    }

    // 3. R10：要设默认时，先把本人其它地址的 isDefault 全部置 false（先清后写，避免零默认）
    if (wantDefault) {
      await coll
        .where({ _openid: OPENID, isDefault: true })
        .update({ data: { isDefault: false } });
    }

    if (a._id) {
      // 4a. 更新：校验归属（where 带 _openid，非本人则 updated=0）
      const upRes = await coll
        .where({ _id: a._id, _openid: OPENID })
        .update({
          data: {
            contactName: a.contactName,
            phone: a.phone,
            region: a.region,
            detail: a.detail,
            isDefault: wantDefault,
          },
        });
      if (upRes.stats.updated === 0) {
        return { success: false, errMsg: "ADDRESS_NOT_FOUND" };
      }
      return { success: true, data: { _id: a._id } };
    } else {
      // 4b. 新增：手动写 _openid + createTime
      const addRes = await coll.add({
        data: {
          _openid: OPENID,
          contactName: a.contactName,
          phone: a.phone,
          region: a.region,
          detail: a.detail,
          isDefault: wantDefault,
          createTime: Date.now(),
        },
      });
      return { success: true, data: { _id: addRes._id } };
    }
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

// deleteAddress — 删除地址
// 入参 event.id
// R11：删的是默认地址时，把最近创建的另一个设为默认
const deleteAddress = async (event, OPENID) => {
  const id = event.id;
  if (!id) {
    return { success: false, errMsg: "PARAM_INVALID" };
  }

  try {
    const coll = db.collection("addresses");

    // 1. 取出待删地址，校验归属
    const target = await coll.where({ _id: id, _openid: OPENID }).get();
    if (target.data.length === 0) {
      return { success: false, errMsg: "ADDRESS_NOT_FOUND" };
    }
    const wasDefault = target.data[0].isDefault;

    // 2. 删除（历史订单存的是快照，不受影响，无需联动）
    await coll.where({ _id: id, _openid: OPENID }).remove();

    // 3. R11：若删的是默认地址且仍有其它地址，把最近创建的一个设为默认
    if (wasDefault) {
      const rest = await coll
        .where({ _openid: OPENID })
        .orderBy("createTime", "desc")
        .limit(1)
        .get();
      if (rest.data.length > 0) {
        await coll
          .where({ _id: rest.data[0]._id, _openid: OPENID })
          .update({ data: { isDefault: true } });
      }
    }

    return { success: true };
  } catch (e) {
    return { success: false, errMsg: "DB_ERROR" };
  }
};

module.exports = { getAddressList, saveAddress, deleteAddress };
