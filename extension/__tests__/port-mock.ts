import { vi } from "vitest";
import type { Runtime } from "webextension-polyfill";

function event<Listener extends (...args: never[]) => unknown>() {
  const listeners = new Set<Listener>();
  return {
    addListener: vi.fn((listener: Listener) => {
      listeners.add(listener);
    }),
    removeListener: vi.fn((listener: Listener) => {
      listeners.delete(listener);
    }),
    emit: (...args: Parameters<Listener>) => {
      listeners.forEach((listener) => listener(...args));
    },
  };
}

/** A local disconnect only notifies the opposite endpoint, as a browser Port does. */
export function createPortPair(name = "prompttune-improve-owner") {
  let connected = true;
  const clientMessage = event<(message: unknown) => void>();
  const serverMessage = event<(message: unknown) => void>();
  const clientDisconnect = event<() => void>();
  const serverDisconnect = event<() => void>();
  function post(message: unknown, receive: typeof clientMessage) {
    if (!connected) throw new Error("Port disconnected");
    queueMicrotask(() => {
      if (connected) receive.emit(message);
    });
  }
  function disconnect(receive: typeof clientDisconnect) {
    if (!connected) return;
    connected = false;
    queueMicrotask(() => receive.emit());
  }
  const client = {
    name,
    onMessage: clientMessage,
    onDisconnect: clientDisconnect,
    postMessage: vi.fn((message: unknown) => post(message, serverMessage)),
    disconnect: vi.fn(() => disconnect(serverDisconnect)),
  } as unknown as Runtime.Port;
  const server = {
    name,
    onMessage: serverMessage,
    onDisconnect: serverDisconnect,
    postMessage: vi.fn((message: unknown) => post(message, clientMessage)),
    disconnect: vi.fn(() => disconnect(clientDisconnect)),
  } as unknown as Runtime.Port;
  return { client, server };
}
