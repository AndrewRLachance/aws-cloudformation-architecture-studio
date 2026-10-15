import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { webcrypto } from 'node:crypto';

Object.defineProperty(globalThis, 'crypto', { value: webcrypto, configurable: true });
class ResizeObserverMock {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}
Object.defineProperty(globalThis, 'ResizeObserver', { value: ResizeObserverMock, configurable: true });
Object.defineProperty(globalThis, 'PointerEvent', { value: MouseEvent, configurable: true });
Object.defineProperty(window, 'matchMedia', { value: (query: string) => ({ matches: false, media: query, onchange: null, addListener: () => undefined, removeListener: () => undefined, addEventListener: () => undefined, removeEventListener: () => undefined, dispatchEvent: () => false }), configurable: true });
Object.defineProperty(HTMLElement.prototype, 'setPointerCapture', { value: () => undefined, configurable: true });
Object.defineProperty(HTMLElement.prototype, 'releasePointerCapture', { value: () => undefined, configurable: true });

afterEach(() => cleanup());
