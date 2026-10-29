import { ManagerClient } from './ManagerClient';
import { Message } from '../../types/Message';
import { BaseDeviceDescriptor } from '../../types/BaseDeviceDescriptor';
import { DeviceTrackerEvent } from '../../types/DeviceTrackerEvent';
import { DeviceTrackerEventList } from '../../types/DeviceTrackerEventList';
import { html } from '../ui/HtmlTag';
import { ParamsDeviceTracker } from '../../types/ParamsDeviceTracker';
import { HostItem } from '../../types/Configuration';
import { Tool } from './Tool';
import Util from '../Util';
import { EventMap } from '../../common/TypedEmitter';
import SvgImage, { Icon } from '../ui/SvgImage';
import { ACTION } from '../../common/Action';

const TAG = '[BaseDeviceTracker]';

export abstract class BaseDeviceTracker<DD extends BaseDeviceDescriptor, TE extends EventMap> extends ManagerClient<
    ParamsDeviceTracker,
    TE
> {
    public static readonly ACTION_LIST = 'devicelist';
    public static readonly ACTION_DEVICE = 'device';
    public static readonly HOLDER_ELEMENT_ID = 'devices';
    public static readonly AttributePrefixInterfaceSelectFor = 'interface_select_for_';
    public static readonly AttributePlayerFullName = 'data-player-full-name';
    public static readonly AttributePlayerCodeName = 'data-player-code-name';
    public static readonly AttributePrefixPlayerFor = 'player_for_';
    protected static tools: Set<Tool> = new Set();
    protected static instanceId = 0;

    public static registerTool(tool: Tool): void {
        this.tools.add(tool);
    }

    public static buildUrl(item: HostItem): URL {
        const { secure, port, hostname } = item;
        const protocol = secure ? 'wss:' : 'ws:';
        const url = new URL(`${protocol}//${hostname}`);
        if (port) {
            url.port = port.toString();
        }
        return url;
    }

    public static buildUrlForTracker(params: HostItem): URL {
        const wsUrl = this.buildUrl(params);
        wsUrl.searchParams.set('action', this.ACTION);
        return wsUrl;
    }

    public static buildLink(q: any, text: string, params: ParamsDeviceTracker): HTMLAnchorElement {
        let { hostname } = params;
        let port: string | number | undefined = params.port;
        let protocol = params.secure ? 'https:' : 'http:';
        if (params.useProxy) {
            q.hostname = hostname;
            q.port = port;
            q.secure = params.secure;
            q.useProxy = true;
            protocol = location.protocol;
            hostname = location.hostname;
            port = location.port;
        }
        const hash = `#!${new URLSearchParams(q).toString()}`;
        const a = document.createElement('a');
        a.setAttribute('href', `${protocol}//${hostname}:${port}/${hash}`);
        a.setAttribute('rel', 'noopener noreferrer');
        a.setAttribute('target', '_blank');
        a.classList.add(`link-${q.action}`);
        const iconByAction: Record<string, Icon> = {
            [ACTION.SHELL]: Icon.KEYBOARD,
            [ACTION.DEVTOOLS]: Icon.SETTINGS,
            [ACTION.FILE_LISTING]: Icon.UPLOAD,
            [ACTION.STREAM_SCRCPY]: Icon.FULLSCREEN,
            [ACTION.STREAM_WEBRTC]: Icon.FULLSCREEN,
            [ACTION.STREAM_WS_QVH]: Icon.FULLSCREEN,
            [ACTION.STREAM_MJPEG]: Icon.FULLSCREEN,
        };
        const icon = iconByAction[q.action];
        if (icon !== undefined) {
            a.appendChild(SvgImage.create(icon));
        }
        const label = document.createElement('span');
        label.innerText = text;
        a.appendChild(label);
        return a;
    }

    protected title = 'Device list';
    protected tableId = 'base_device_list';
    protected descriptors: DD[] = [];
    protected elementId: string;
    protected trackerName = '';
    protected id = '';
    private created = false;
    private messageId = 0;

    protected constructor(params: ParamsDeviceTracker, protected readonly directUrl: string) {
        super(params);
        this.elementId = `tracker_instance${++BaseDeviceTracker.instanceId}`;
        this.trackerName = `Unavailable. Host: ${params.hostname}, type: ${params.type}`;
        this.setBodyClass('list');
        this.setTitle();
    }

    public static parseParameters(params: URLSearchParams): ParamsDeviceTracker {
        const typedParams = super.parseParameters(params);
        const type = Util.parseString(params, 'type', true);
        if (type !== 'android' && type !== 'ios') {
            throw Error('Incorrect type');
        }
        return { ...typedParams, type };
    }

    protected getNextId(): number {
        return ++this.messageId;
    }

    protected buildDeviceTable(): void {
        const data = this.descriptors;
        const devices = this.getOrCreateTableHolder();
        const tbody = this.getOrBuildTableBody(devices);

        const block = this.getOrCreateTrackerBlock(tbody, this.trackerName);
        data.forEach((item) => {
            this.buildDeviceRow(block, item);
        });
    }

    private setNameValue(parent: Element | null, name: string): void {
        if (!parent) {
            return;
        }
        const nameBlockId = `${this.elementId}_name`;
        let nameEl = document.getElementById(nameBlockId);
        if (!nameEl) {
            nameEl = document.createElement('div');
            nameEl.id = nameBlockId;
            nameEl.className = 'tracker-name';
        }
        nameEl.innerText = name;
        parent.insertBefore(nameEl, parent.firstChild);
    }

    private getOrCreateTrackerBlock(parent: Element, controlCenterName: string): Element {
        let el = document.getElementById(this.elementId);
        if (!el) {
            el = document.createElement('div');
            el.id = this.elementId;
            parent.appendChild(el);
            this.created = true;
        } else {
            while (el.children.length) {
                el.removeChild(el.children[0]);
            }
        }
        this.setNameValue(el, controlCenterName);
        return el;
    }

    protected abstract buildDeviceRow(tbody: Element, device: DD): void;

    protected addDeviceSettings(row: DocumentFragment, services: HTMLElement, deviceName: string, id: string): void {
        const settingsRow = row.querySelector('.device-settings-row') || row.querySelector('.device-header');
        if (!settingsRow) {
            return;
        }

        const trigger = document.createElement('button');
        trigger.className = 'device-settings-trigger';
        trigger.type = 'button';
        trigger.appendChild(SvgImage.create(Icon.SETTINGS));
        trigger.setAttribute('aria-label', `Device settings for ${deviceName}`);
        trigger.title = `Device settings for ${deviceName}`;
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');

        const overlay = document.createElement('div');
        overlay.className = 'device-settings-overlay';
        overlay.hidden = true;

        const dialog = document.createElement('section');
        dialog.className = 'device-settings-dialog';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', `${id}_settings_title`);

        const dialogHeader = document.createElement('div');
        dialogHeader.className = 'device-settings-header';

        const title = document.createElement('div');
        title.className = 'device-settings-title';
        title.id = `${id}_settings_title`;
        title.innerText = deviceName;

        const closeButton = document.createElement('button');
        closeButton.className = 'device-settings-close';
        closeButton.type = 'button';
        closeButton.innerText = '×';
        closeButton.setAttribute('aria-label', `Close settings for ${deviceName}`);

        const content = document.createElement('div');
        content.className = 'device-settings-content';
        const heading = document.createElement('div');
        heading.className = 'device-settings-heading';
        const metadata = document.createElement('div');
        metadata.className = 'device-settings-metadata';
        const status = document.createElement('span');
        const online = !!row.querySelector('.device.active');
        status.className = `device-settings-status ${online ? 'online' : 'offline'}`;
        status.innerText = online ? 'Online' : 'Offline';
        metadata.appendChild(status);
        const version = row.querySelector('.release-version')?.textContent;
        if (version) {
            const detail = document.createElement('span');
            detail.textContent = version.trim();
            metadata.appendChild(detail);
        }
        heading.append(title, metadata);

        const actions = document.createElement('div');
        actions.className = 'device-settings-actions';
        Array.from(services.children).forEach((entry) => {
            if (entry.querySelector('a') && !entry.hasAttribute(BaseDeviceTracker.AttributePlayerCodeName)) {
                const labels: Record<string, string> = {
                    'link-shell': 'Shell',
                    'link-devtools': 'DevTools',
                    'link-list-files': 'List files',
                };
                const link = entry.querySelector('a');
                const label = link?.querySelector('span');
                if (link && label) {
                    const name = Object.keys(labels).find((key) => link.classList.contains(key));
                    if (name) {
                        label.textContent = labels[name];
                    }
                }
                actions.appendChild(entry);
            } else if (entry.classList.contains('stream')) {
                actions.appendChild(entry);
            }
        });
        content.append(actions, services);

        const close = (): void => {
            overlay.hidden = true;
            trigger.setAttribute('aria-expanded', 'false');
            trigger.focus();
        };

        trigger.addEventListener('click', () => {
            overlay.hidden = false;
            trigger.setAttribute('aria-expanded', 'true');
            closeButton.focus();
        });
        closeButton.addEventListener('click', close);
        overlay.addEventListener('click', (event: MouseEvent) => {
            if (event.target === overlay) {
                close();
            } else if (event.target instanceof Element && event.target.closest('button, a')) {
                close();
            }
        });
        overlay.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                close();
                return;
            }
            if (event.key === 'Tab') {
                const focusable = Array.from(
                    dialog.querySelectorAll<HTMLElement>(
                        'button:not([disabled]), a[href], select:not([disabled]), input:not([disabled])',
                    ),
                );
                const first = focusable[0];
                const last = focusable[focusable.length - 1];
                if (event.shiftKey && document.activeElement === first) {
                    event.preventDefault();
                    last?.focus();
                } else if (!event.shiftKey && document.activeElement === last) {
                    event.preventDefault();
                    first?.focus();
                }
            }
        });

        dialogHeader.append(heading, closeButton);
        dialog.append(dialogHeader, content);
        overlay.appendChild(dialog);
        settingsRow.appendChild(trigger);
        row.appendChild(overlay);
    }

    protected onSocketClose(event: CloseEvent): void {
        if (this.destroyed) {
            return;
        }
        console.log(TAG, `Connection closed: ${event.reason}`);
        setTimeout(() => {
            this.openNewConnection();
        }, 2000);
    }

    protected onSocketMessage(event: MessageEvent): void {
        let message: Message;
        try {
            message = JSON.parse(event.data);
        } catch (error: any) {
            console.error(TAG, error.message);
            console.log(TAG, error.data);
            return;
        }
        switch (message.type) {
            case BaseDeviceTracker.ACTION_LIST: {
                const event = message.data as DeviceTrackerEventList<DD>;
                this.descriptors = event.list;
                this.setIdAndHostName(event.id, event.name);
                this.buildDeviceTable();
                break;
            }
            case BaseDeviceTracker.ACTION_DEVICE: {
                const event = message.data as DeviceTrackerEvent<DD>;
                this.setIdAndHostName(event.id, event.name);
                this.updateDescriptor(event.device);
                this.buildDeviceTable();
                break;
            }
            default:
                console.log(TAG, `Unknown message type: ${message.type}`);
        }
    }

    protected setIdAndHostName(id: string, trackerName: string): void {
        if (this.id === id && this.trackerName === trackerName) {
            return;
        }
        this.id = id;
        this.trackerName = trackerName;
        this.setNameValue(document.getElementById(this.elementId), trackerName);
    }

    protected getOrCreateTableHolder(): HTMLElement {
        const id = BaseDeviceTracker.HOLDER_ELEMENT_ID;
        let devices = document.getElementById(id);
        if (!devices) {
            devices = document.createElement('div');
            devices.id = id;
            devices.className = 'table-wrapper';
            document.body.appendChild(devices);
        }
        return devices;
    }

    protected updateDescriptor(descriptor: DD): void {
        const idx = this.descriptors.findIndex((item: DD) => {
            return item.udid === descriptor.udid;
        });
        if (idx !== -1) {
            this.descriptors[idx] = descriptor;
        } else {
            this.descriptors.push(descriptor);
        }
    }

    protected getOrBuildTableBody(parent: HTMLElement): Element {
        const className = 'device-list';
        let tbody = document.querySelector(
            `#${BaseDeviceTracker.HOLDER_ELEMENT_ID} #${this.tableId}.${className}`,
        ) as Element;
        if (!tbody) {
            const fragment = html`<div id="${this.tableId}" class="${className}"></div>`.content;
            parent.appendChild(fragment);
            const last = parent.children.item(parent.children.length - 1);
            if (last) {
                tbody = last;
            }
        }
        return tbody;
    }

    public getDescriptorByUdid(udid: string): DD | undefined {
        if (!this.descriptors.length) {
            return;
        }
        return this.descriptors.find((descriptor: DD) => {
            return descriptor.udid === udid;
        });
    }

    public destroy(): void {
        super.destroy();
        if (this.created) {
            const el = document.getElementById(this.elementId);
            if (el) {
                const { parentElement } = el;
                el.remove();
                if (parentElement && !parentElement.children.length) {
                    parentElement.remove();
                }
            }
        }
        const holder = document.getElementById(BaseDeviceTracker.HOLDER_ELEMENT_ID);
        if (holder && !holder.children.length) {
            holder.remove();
        }
    }

    protected supportMultiplexing(): boolean {
        return true;
    }

    protected getChannelCode(): string {
        throw Error('Not implemented. Must override');
    }

    protected getChannelInitData(): Buffer {
        const code = this.getChannelCode();
        const buffer = Buffer.alloc(code.length);
        buffer.write(code, 'ascii');
        return buffer;
    }
}
