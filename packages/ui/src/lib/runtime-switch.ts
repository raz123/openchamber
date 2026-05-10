import { setRuntimeBearerToken } from '@/lib/runtime-auth';
import { configureRuntimeUrlResolver } from '@/lib/runtime-url';

export type RuntimeEndpointChangedDetail = {
  apiBaseUrl: string;
};

const RUNTIME_ENDPOINT_CHANGED_EVENT = 'openchamber:runtime-endpoint-changed';

let activeApiBaseUrl = '';

const readInjectedApiBaseUrl = (): string => {
  if (typeof window === 'undefined') return '';
  const injected = (window as typeof window & { __OPENCHAMBER_API_BASE_URL__?: string }).__OPENCHAMBER_API_BASE_URL__;
  return typeof injected === 'string' ? injected.trim() : '';
};

export const getRuntimeApiBaseUrl = (): string => activeApiBaseUrl || readInjectedApiBaseUrl();

export const switchRuntimeEndpoint = (options: { apiBaseUrl: string; clientToken?: string | null }): void => {
  const apiBaseUrl = options.apiBaseUrl.trim();
  activeApiBaseUrl = apiBaseUrl;
  if (typeof window !== 'undefined') {
    const runtimeWindow = window as typeof window & {
      __OPENCHAMBER_API_BASE_URL__?: string;
      __OPENCHAMBER_CLIENT_TOKEN__?: string;
    };
    runtimeWindow.__OPENCHAMBER_API_BASE_URL__ = apiBaseUrl;
    runtimeWindow.__OPENCHAMBER_CLIENT_TOKEN__ = options.clientToken || undefined;
  }
  configureRuntimeUrlResolver({ apiBaseUrl, realtimeBaseUrl: apiBaseUrl });
  setRuntimeBearerToken(options.clientToken || null);
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent<RuntimeEndpointChangedDetail>(RUNTIME_ENDPOINT_CHANGED_EVENT, {
      detail: { apiBaseUrl },
    }));
  }
};

export const subscribeRuntimeEndpointChanged = (callback: (detail: RuntimeEndpointChangedDetail) => void): (() => void) => {
  if (typeof window === 'undefined') return () => {};
  const listener = (event: Event) => {
    callback((event as CustomEvent<RuntimeEndpointChangedDetail>).detail);
  };
  window.addEventListener(RUNTIME_ENDPOINT_CHANGED_EVENT, listener);
  return () => window.removeEventListener(RUNTIME_ENDPOINT_CHANGED_EVENT, listener);
};
