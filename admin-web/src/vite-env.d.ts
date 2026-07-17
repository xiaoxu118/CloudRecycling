/// <reference types="vite/client" />

interface Window {
  ADMIN_CONFIG?: { env?: string; functionName?: string };
}

type CloudFunctionResult<T> =
  | { success: true; data: T }
  | { success: false; errMsg: string; data?: unknown };
