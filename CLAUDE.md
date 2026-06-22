# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

这是一个基于微信云开发（CloudBase）的微信小程序，由官方 quickstart 模板（`quickstart-wx-cloud`）演化而来。项目演示云开发三大能力：文档型数据库、文件存储、云函数。

## 开发与构建

本项目**没有命令行构建、lint 或测试流程**，所有开发在**微信开发者工具**中进行：

- **预览/编译**：在微信开发者工具中打开项目根目录，工具会根据 `project.config.json` 自动编译。
- **运行前置条件**：必须在 `miniprogram/app.js` 中填入云开发**环境 ID**（`globalData.env`），否则数据库/云函数调用会失败并弹出提示。
- **部署云函数（推荐）**：在 `cloudfunctions/quickstartFunctions` 目录上右键 →【上传并部署：云端安装依赖】。
- **部署云函数（命令行）**：`uploadCloudFunction.sh` 调用微信开发者工具 CLI（`cloud functions deploy`），需自行提供 `installPath`、`envId`、`projectPath` 变量。
- 云函数依赖：在 `cloudfunctions/quickstartFunctions/` 下 `npm install`（仅 `wx-server-sdk`），通常由“云端安装依赖”自动处理。

## 架构

代码分为两半，由 `project.config.json` 的 `miniprogramRoot` 与 `cloudfunctionRoot` 划定：

- **`miniprogram/`** — 小程序前端（页面 `pages/`、组件 `components/`、入口 `app.js`/`app.json`）。
- **`cloudfunctions/`** — 云端代码，每个子目录是一个独立部署的云函数。

### 单一云函数 + type 分发模式

整个后端目前只有一个云函数 `quickstartFunctions`。前端通过 `wx.cloud.callFunction` 调用时，用 `data.type` 字段指定要执行的业务动作，云函数内部用 `switch (event.type)` 分发（见 `cloudfunctions/quickstartFunctions/index.js`）。新增后端能力时，在该 `switch` 中加 case，而非新建云函数。

```js
// 前端调用示例
wx.cloud.callFunction({
  name: "quickstartFunctions",
  data: { type: "createCollection" },
});
```

### 前端页面流转

- `pages/index/index` 是入口页，用 `powerList` 数据驱动能力列表 UI；点击项后通过 `wx.navigateTo` 跳转到 `pages/example/index?type=xxx`，由 `type` 参数决定示例页展示哪种能力。
- 错误处理依赖对 `errMsg` 字符串的匹配（如 `Environment not found`、`FunctionName parameter could not be found`）来向用户提示“环境未配置”或“云函数未上传”。
- `components/cloudTipModal` 是通用提示弹窗组件，通过 `showTipProps`/`title`/`content` 属性受控。

### 数据库

默认集合为 `sales`（字段 `region`/`city`/`sales`）。`createCollection` 在集合已存在时会 catch 异常并仍返回 `success: true`，以避免开发者工具在前端抛错。

### 云函数权限

`cloudfunctions/quickstartFunctions/config.json` 声明云函数可调用的微信 openapi 权限（如 `wxacode.get` 用于生成小程序码）。新增需要鉴权的 openapi 调用时需在此登记。

## 注意事项

- `miniprogram/envList.js` 与 `project.private.config.json` 含本地/私有配置，`project.private.config.json` 会覆盖 `project.config.json` 的同名字段。
- 云函数中用 `cloud.DYNAMIC_CURRENT_ENV` 自动绑定当前环境，无需硬编码环境 ID。
