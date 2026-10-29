import { ToolBox } from '../../toolbox/ToolBox';
import KeyEvent from '../android/KeyEvent';
import SvgImage from '../../ui/SvgImage';
import { KeyCodeControlMessage } from '../../controlMessage/KeyCodeControlMessage';
import { ToolBoxButton } from '../../toolbox/ToolBoxButton';
import { ToolBoxElement } from '../../toolbox/ToolBoxElement';
import { ToolBoxCheckbox } from '../../toolbox/ToolBoxCheckbox';
import { StreamClientScrcpy } from '../client/StreamClientScrcpy';
import { BasePlayer } from '../../player/BasePlayer';

const BUTTONS = [
    {
        title: 'Power',
        code: KeyEvent.KEYCODE_POWER,
        icon: SvgImage.Icon.POWER,
    },
    // {
    //     title: 'Volume up',
    //     code: KeyEvent.KEYCODE_VOLUME_UP,
    //     icon: SvgImage.Icon.VOLUME_UP,
    // },
    // {
    //     title: 'Volume down',
    //     code: KeyEvent.KEYCODE_VOLUME_DOWN,
    //     icon: SvgImage.Icon.VOLUME_DOWN,
    // },
    // {
    //     title: 'Back',
    //     code: KeyEvent.KEYCODE_BACK,
    //     icon: SvgImage.Icon.BACK,
    // },
    // {
    //     title: 'Home',
    //     code: KeyEvent.KEYCODE_HOME,
    //     icon: SvgImage.Icon.HOME,
    // },
    // {
    //     title: 'Overview',
    //     code: KeyEvent.KEYCODE_APP_SWITCH,
    //     icon: SvgImage.Icon.OVERVIEW,
    // },
];

export class GoogToolBox extends ToolBox {
    protected constructor(list: ToolBoxElement<any>[]) {
        super(list);
    }

    public static createToolBox(
        udid: string,
        player: BasePlayer,
        client: StreamClientScrcpy,
        moreBox?: HTMLElement,
    ): GoogToolBox {
        const playerName = player.getName();
        const list = BUTTONS.slice();
        const handler = <K extends keyof HTMLElementEventMap, T extends HTMLElement>(
            type: K,
            element: ToolBoxElement<T>,
        ) => {
            if (!element.optional?.code) {
                return;
            }
            const { code } = element.optional;
            const action = type === 'mousedown' ? KeyEvent.ACTION_DOWN : KeyEvent.ACTION_UP;
            const event = new KeyCodeControlMessage(action, code, 0, 0);
            client.sendMessage(event);
        };
        const elements: ToolBoxElement<any>[] = list.map((item) => {
            const button = new ToolBoxButton(item.title, item.icon, {
                code: item.code,
            });
            button.addEventListener('mousedown', handler);
            button.addEventListener('mouseup', handler);
            return button;
        });

        if (player.supportsScreenshot) {
            const screenshot = new ToolBoxButton('Take screenshot', SvgImage.Icon.CAMERA);
            screenshot.addEventListener('click', () => {
                player.createScreenshot(client.getDeviceName());
            });
            // useless function
            // elements.push(screenshot);
        }

        const uploadFile = new ToolBoxButton('Upload files', SvgImage.Icon.UPLOAD);
        uploadFile.addEventListener('click', () => {
            client.selectAndUploadFile('/sdcard/Download');
        });
        elements.push(uploadFile);

        const fullscreen = new ToolBoxButton('Fullscreen', SvgImage.Icon.FULLSCREEN);
        fullscreen.addEventListener('click', () => {
            if (document.fullscreenElement) {
                document.exitFullscreen().catch((e) => {
                    console.error('Failed to exit fullscreen:', e);
                });
            } else {
                document.documentElement.requestFullscreen().catch((e) => {
                    console.error('Failed to enter fullscreen:', e);
                });
            }
        });
        elements.push(fullscreen);

        const keyboard = new ToolBoxCheckbox(
            'Capture keyboard',
            SvgImage.Icon.KEYBOARD,
            `capture_keyboard_${udid}_${playerName}`,
        );
        keyboard.addEventListener('change', (_, el) => {
            const element = el.getElement();
            client.setHandleKeyboardEvents(element.checked);
        });
        elements.push(keyboard);

        if (moreBox) {
            const displayId = player.getVideoSettings().displayId;
            const id = `show_more_${udid}_${playerName}_${displayId}`;
            const more = new ToolBoxCheckbox('Settings', SvgImage.Icon.SETTINGS, id);
            more.addEventListener('change', (_, el) => {
                const element = el.getElement();
                moreBox.hidden = !element.checked;
                if (element.checked) {
                    moreBox.querySelector<HTMLButtonElement>('.more-box-close')?.focus();
                }
            });
            elements.unshift(more);
        }

        const deviceList = new ToolBoxButton('All devices', SvgImage.Icon.DEVICE_LIST);
        deviceList.getElement().type = 'button';
        deviceList.getElement().setAttribute('aria-label', 'Back to all devices');
        deviceList.addEventListener('click', () => {
            // Routing is initialized on load, so clearing the stream hash needs a reload.
            window.location.hash = '';
            window.location.reload();
        });
        elements.unshift(deviceList);

        const toggleSidebar = new ToolBoxCheckbox(
            'Toggle Sidebar',
            SvgImage.Icon.MENU,
            `toggle_sidebar_${udid}_${playerName}`,
        );
        toggleSidebar.addEventListener('change', (_, el) => {
            const element = el.getElement();
            const holder = client.getControlButtonsElement();
            const isChecked = element.checked;

            elements.forEach((item) => {
                if (item !== toggleSidebar) {
                    item.getAllElements().forEach((htmlEl) => {
                        htmlEl.style.display = isChecked ? 'none' : '';
                    });
                }
            });

            if (holder) {
                holder.style.height = isChecked ? '0' : '';
                holder.style.minHeight = isChecked ? '0' : '';
                holder.style.padding = isChecked ? '0' : '';
            }

            const label = toggleSidebar.getAllElements()[1];
            if (label) {
                if (isChecked) {
                        label.style.position = 'absolute';
                        label.style.right = '0';
                        label.style.top = '0';
                        label.style.zIndex = '100';
                        label.style.margin = '0';
                        label.style.padding = '10px';
                        label.style.borderRadius = '50%';
                        label.style.height = '40px';
                        label.style.width = '40px';
                        label.style.backgroundColor = 'var(--control-buttons-bg-color)';
                        label.style.opacity = '0.75';
                    } else {
                        label.style.position = '';
                        label.style.right = '';
                        label.style.top = '';
                        label.style.zIndex = '';
                        label.style.margin = '';
                        label.style.backgroundColor = '';
                        label.style.opacity = '';
                    }
                }
                // Trigger screen fit to adjust video size immediately
                client.triggerScreenFit();
            });
        elements.unshift(toggleSidebar);

        return new GoogToolBox(elements);
    }
}
