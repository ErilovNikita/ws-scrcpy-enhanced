export default class Util {
    private static SUFFIX: Record<number, string> = {
        0: 'B',
        1: 'KiB',
        2: 'MiB',
        3: 'GiB',
        4: 'TiB',
    };
    private static supportsPassiveValue: boolean | undefined;

    public static filterTrailingZeroes(bytes: Uint8Array): Uint8Array {
        let b = 0;
        return bytes
            .reverse()
            .filter((i) => b || (b = i))
            .reverse();
    }

    public static prettyBytes(value: number): string {
        let suffix = 0;
        while (value >= 512) {
            suffix++;
            value /= 1024;
        }
        return `${value.toFixed(suffix ? 1 : 0)}${Util.SUFFIX[suffix]}`;
    }

    public static escapeUdid(udid: string): string {
        return 'udid_' + udid.replace(/[. :]/g, '_');
    }

    public static parse(params: URLSearchParams, name: string, required?: boolean): string | null {
        const value = params.get(name);
        if (required && value === null) {
            throw TypeError(`Missing required parameter "${name}"`);
        }
        return value;
    }

    public static parseString(params: URLSearchParams, name: string, required?: boolean): string {
        const value = params.get(name);
        if (required && value === null) {
            throw TypeError(`Missing required parameter "${name}"`);
        }
        return value || '';
    }

    public static parseBoolean(params: URLSearchParams, name: string, required?: boolean): boolean {
        const value = this.parse(params, name, required);
        return value === '1' || (!!value && value.toString() === 'true');
    }

    public  static parseInt(params: URLSearchParams, name: string, required?: boolean): number {
        const value = this.parse(params, name, required);
        if (value === null) {
            return 0;
        }
        const int = parseInt(value, 10);
        if (isNaN(int)) {
            return 0;
        }
        return int;
    }

    public static parseBooleanEnv(input: string | string[] | boolean | undefined | null): boolean | undefined {
        if (typeof input === 'boolean') {
            return input;
        }
        if (typeof input === 'undefined' || input === null) {
            return undefined;
        }
        if (Array.isArray(input)) {
            input = input[input.length - 1];
        }
        return input === '1' || input.toLowerCase() === 'true';
    }

    public static parseStringEnv(input: string | string[] | undefined | null): string | undefined {
        if (typeof input === 'undefined' || input === null) {
            return undefined;
        }
        if (Array.isArray(input)) {
            input = input[input.length - 1];
        }
        return input;
    }
    public static parseIntEnv(input: string | string[] | number | undefined | null): number | undefined {
        if (typeof input === 'number') {
            return input;
        }
        if (typeof input === 'undefined' || input === null) {
            return undefined;
        }
        if (Array.isArray(input)) {
            input = input[input.length - 1];
        }
        const int = parseInt(input, 10);
        if (isNaN(int)) {
            return undefined;
        }
        return int;
    }


    // https://github.com/google/closure-library/blob/51e5a5ac373aefa354a991816ec418d730e29a7e/closure/goog/crypt/crypt.js#L117
/*
    Copyright 2008 The Closure Library Authors. All Rights Reserved.
    Licensed under the Apache License, Version 2.0 (the "License");
    you may not use this file except in compliance with the License.
    You may obtain a copy of the License at

         http://www.apache.org/licenses/LICENSE-2.0

    Unless required by applicable law or agreed to in writing, software
    distributed under the License is distributed on an "AS-IS" BASIS,
    WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
    See the License for the specific language governing permissions and
    limitations under the License.
 */
    /* tslint:disable */
    /**
     * Converts a JS string to a UTF-8 "byte" array.
     * @param {string} str 16-bit unicode string.
     * @return {!Array<number>} UTF-8 byte array.
     */
    static stringToUtf8ByteArray = function(str: string) {
        // TODO(user): Use native implementations if/when available
        var out = [], p = 0;
        for (var i = 0; i < str.length; i++) {
            var c = str.charCodeAt(i);
            if (c < 128) {
                out[p++] = c;
            } else if (c < 2048) {
                out[p++] = (c >> 6) | 192;
                out[p++] = (c & 63) | 128;
            } else if (
                ((c & 0xFC00) == 0xD800) && (i + 1) < str.length &&
                ((str.charCodeAt(i + 1) & 0xFC00) == 0xDC00)) {
                // Surrogate Pair
                c = 0x10000 + ((c & 0x03FF) << 10) + (str.charCodeAt(++i) & 0x03FF);
                out[p++] = (c >> 18) | 240;
                out[p++] = ((c >> 12) & 63) | 128;
                out[p++] = ((c >> 6) & 63) | 128;
                out[p++] = (c & 63) | 128;
            } else {
                out[p++] = (c >> 12) | 224;
                out[p++] = ((c >> 6) & 63) | 128;
                out[p++] = (c & 63) | 128;
            }
        }
        return Uint8Array.from(out);
    };

    /**
     * Converts a UTF-8 byte array to JavaScript's 16-bit Unicode.
     * @param {Uint8Array|Array<number>} bytes UTF-8 byte array.
     * @return {string} 16-bit Unicode string.
     */
    static utf8ByteArrayToString(bytes: Uint8Array): string {
        // TODO(user): Use native implementations if/when available
        var out = [], pos = 0, c = 0;
        while (pos < bytes.length) {
            var c1 = bytes[pos++];
            if (c1 < 128) {
                out[c++] = String.fromCharCode(c1);
            } else if (c1 > 191 && c1 < 224) {
                var c2 = bytes[pos++];
                out[c++] = String.fromCharCode((c1 & 31) << 6 | c2 & 63);
            } else if (c1 > 239 && c1 < 365) {
                // Surrogate Pair
                var c2 = bytes[pos++];
                var c3 = bytes[pos++];
                var c4 = bytes[pos++];
                var u = ((c1 & 7) << 18 | (c2 & 63) << 12 | (c3 & 63) << 6 | c4 & 63) -
                    0x10000;
                out[c++] = String.fromCharCode(0xD800 + (u >> 10));
                out[c++] = String.fromCharCode(0xDC00 + (u & 1023));
            } else {
                var c2 = bytes[pos++];
                var c3 = bytes[pos++];
                out[c++] =
                    String.fromCharCode((c1 & 15) << 12 | (c2 & 63) << 6 | c3 & 63);
            }
        }
        return out.join('');
    };
    /* tslint:enable */

    // https://github.com/WICG/EventListenerOptions/blob/gh-pages/explainer.md
    static supportsPassive(): boolean {
        if (typeof Util.supportsPassiveValue === 'boolean') {
            return Util.supportsPassiveValue;
        }

        // Test via a getter in the options object to see if the passive property is accessed
        let supportsPassive = false;
        try {
            const opts = Object.defineProperty({}, 'passive', {
                get: function() {
                    supportsPassive = true;
                }
            });

            // @ts-ignore
            window.addEventListener('testPassive', null, opts);
            // @ts-ignore
            window.removeEventListener('testPassive', null, opts);
        } catch (error: any) {}

        return Util.supportsPassiveValue = supportsPassive;

        // Use our detect's results. passive applied if supported, capture will be false either way.
        // elem.addEventListener('touchstart', fn, supportsPassive ? { passive: true } : false);
    }

    static setImmediate(fn: () => any): void {
        Promise.resolve().then(fn);
    }

    public static bindFormStateToLocalStorage(
        root: ParentNode,
        prefix: string,
        options?: {
            dispatchOnRestore?: boolean;
            debounceMs?: number;
            restoreMode?: 'direct' | 'simulate';
            deferRestore?: boolean;
        },
    ): { restore: () => void; dispose: () => void } {
        if (!window.localStorage) {
            return { restore: () => {}, dispose: () => {} };
        }
        const dispatchOnRestore = options?.dispatchOnRestore ?? true;
        const debounceMs = options?.debounceMs ?? 150;
        const restoreMode = options?.restoreMode ?? 'simulate';
        const deferRestore = options?.deferRestore ?? false;
        const bound = new WeakSet<Element>();
        const handlers = new WeakMap<
            Element,
            { onInput?: (event: Event) => void; onChange?: (event: Event) => void }
        >();
        const timeouts = new WeakMap<Element, number>();
        const pendingRestore = new WeakMap<Element, string>();
        let restored = false;

        const getStorageKey = (element: Element): string | null => {
            const el = element as HTMLElement;
            const dataKey = el.dataset ? el.dataset.persistKey : undefined;
            const id = el.id;
            const name = (element as HTMLInputElement).name;
            const key = dataKey || id || name;
            if (!key) {
                return null;
            }
            return `${prefix}::${key}`;
        };

        const shouldSkipRestore = (element: Element): boolean => {
            const el = element as HTMLElement;
            const raw = el.dataset ? el.dataset.persistSkipRestore : undefined;
            if (!raw) {
                return false;
            }
            return raw === '1' || raw.toLowerCase() === 'true';
        };

        const writeValue = (element: Element): void => {
            const key = getStorageKey(element);
            if (!key) {
                return;
            }
            try {
                if (element instanceof HTMLInputElement) {
                    if (element.type === 'checkbox') {
                        window.localStorage.setItem(key, element.checked ? 'true' : 'false');
                        return;
                    }
                    if (element.type === 'radio') {
                        if (element.checked) {
                            window.localStorage.setItem(key, element.value);
                        }
                        return;
                    }
                    window.localStorage.setItem(key, element.value);
                    return;
                }
                if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
                    window.localStorage.setItem(key, element.value);
                }
            } catch (error: any) {}
        };

        const readSavedRaw = (element: Element): string | null => {
            const key = getStorageKey(element);
            if (!key) {
                return null;
            }
            let raw: string | null = null;
            try {
                raw = window.localStorage.getItem(key);
            } catch (error: any) {
                raw = null;
            }
            return raw;
        };

        const applyRestore = (element: Element, raw: string): void => {
            if (restoreMode === 'simulate') {
                if (element instanceof HTMLInputElement) {
                    if (element.type === 'checkbox') {
                        const desired = raw === 'true' || raw === '1';
                        if (element.checked !== desired) {
                            element.click();
                        }
                        return;
                    }
                    if (element.type === 'radio') {
                        const desired = raw === element.value;
                        if (element.checked !== desired) {
                            element.click();
                        }
                        return;
                    }
                    if (element.value !== raw) {
                        element.value = raw;
                    }
                } else if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
                    if (element.value !== raw) {
                        element.value = raw;
                    }
                } else {
                    return;
                }
                if (!dispatchOnRestore) {
                    return;
                }
                const shouldChange =
                    element instanceof HTMLSelectElement ||
                    (element instanceof HTMLInputElement &&
                        (element.type === 'checkbox' || element.type === 'radio'));
                const eventType: 'input' | 'change' = shouldChange ? 'change' : 'input';
                Util.setImmediate(() => {
                    element.dispatchEvent(new Event(eventType, { bubbles: true }));
                    if (eventType === 'input') {
                        element.dispatchEvent(new Event('change', { bubbles: true }));
                    }
                });
                return;
            }

            if (element instanceof HTMLInputElement) {
                if (element.type === 'checkbox') {
                    element.checked = raw === 'true' || raw === '1';
                } else if (element.type === 'radio') {
                    element.checked = raw === element.value;
                } else {
                    element.value = raw;
                }
            } else if (element instanceof HTMLSelectElement || element instanceof HTMLTextAreaElement) {
                element.value = raw;
            }
            if (!dispatchOnRestore) {
                return;
            }
            let eventType: 'input' | 'change' = 'input';
            if (element instanceof HTMLSelectElement) {
                eventType = 'change';
            } else if (element instanceof HTMLInputElement && (element.type === 'checkbox' || element.type === 'radio')) {
                eventType = 'change';
            }
            Util.setImmediate(() => {
                element.dispatchEvent(new Event(eventType, { bubbles: true }));
            });
        };

        const restoreValue = (element: Element): void => {
            if (shouldSkipRestore(element)) {
                return;
            }
            const raw = readSavedRaw(element);
            if (raw === null) {
                return;
            }
            applyRestore(element, raw);
        };

        const bindElement = (element: Element): void => {
            if (bound.has(element)) {
                return;
            }
            bound.add(element);
            if (deferRestore && !restored) {
                if (!shouldSkipRestore(element)) {
                    const raw = readSavedRaw(element);
                    if (raw !== null) {
                        pendingRestore.set(element, raw);
                    }
                }
            } else {
                restoreValue(element);
            }
            const onInput = (event: Event): void => {
                const target = event.currentTarget as Element;
                const prior = timeouts.get(target);
                if (typeof prior === 'number') {
                    clearTimeout(prior);
                }
                const timeoutId = window.setTimeout(() => {
                    writeValue(target);
                }, debounceMs);
                timeouts.set(target, timeoutId);
            };
            const onChange = (event: Event): void => {
                const target = event.currentTarget as Element;
                writeValue(target);
            };
            const entry: { onInput?: (event: Event) => void; onChange?: (event: Event) => void } = {};
            if (element instanceof HTMLSelectElement) {
                element.addEventListener('change', onChange);
                entry.onChange = onChange;
            } else if (element instanceof HTMLInputElement) {
                if (element.type === 'checkbox' || element.type === 'radio') {
                    element.addEventListener('change', onChange);
                    entry.onChange = onChange;
                } else {
                    element.addEventListener('input', onInput);
                    element.addEventListener('change', onChange);
                    entry.onInput = onInput;
                    entry.onChange = onChange;
                }
            } else if (element instanceof HTMLTextAreaElement) {
                element.addEventListener('input', onInput);
                element.addEventListener('change', onChange);
                entry.onInput = onInput;
                entry.onChange = onChange;
            }
            handlers.set(element, entry);
        };

        const scan = (parent: ParentNode): void => {
            const nodes = parent.querySelectorAll ? parent.querySelectorAll('input, select, textarea') : [];
            nodes.forEach((node) => {
                bindElement(node);
            });
        };

        scan(root);
        let observer: MutationObserver | undefined;
        if (typeof MutationObserver !== 'undefined' && root instanceof HTMLElement) {
            observer = new MutationObserver((mutations) => {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (!(node instanceof HTMLElement)) {
                            return;
                        }
                        scan(node);
                    });
                });
            });
            observer.observe(root, { childList: true, subtree: true });
        }

        const restore = (): void => {
            if (restored) {
                return;
            }
            restored = true;
            if (!root.querySelectorAll) {
                return;
            }
            root.querySelectorAll('input, select, textarea').forEach((element) => {
                if (shouldSkipRestore(element)) {
                    return;
                }
                const raw = pendingRestore.get(element);
                if (typeof raw === 'string') {
                    pendingRestore.delete(element);
                    applyRestore(element, raw);
                } else {
                    restoreValue(element);
                }
            });
        };

        const dispose = (): void => {
            if (observer) {
                observer.disconnect();
                observer = undefined;
            }
            if (!root.querySelectorAll) {
                return;
            }
            root.querySelectorAll('input, select, textarea').forEach((element) => {
                const entry = handlers.get(element);
                if (!entry) {
                    return;
                }
                if (entry.onInput) {
                    element.removeEventListener('input', entry.onInput);
                }
                if (entry.onChange) {
                    element.removeEventListener('change', entry.onChange);
                }
                handlers.delete(element);
            });
        };

        return { restore, dispose };
    }
}
