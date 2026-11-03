import SvgImage from './SvgImage';
import { validateAdbAddress } from '../../common/AdbNetwork';

export function openAddDeviceDialog(connect: (host: string, port: number) => Promise<string>): void {
    if (document.querySelector('.add-device-dialog')) {
        return;
    }
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog');
    dialog.className = 'add-device-dialog';
    dialog.setAttribute('aria-labelledby', 'add-device-title');
    dialog.setAttribute('aria-describedby', 'add-device-description');
    dialog.innerHTML = `
        <form class="add-device-form">
            <div class="add-device-heading">
                <span class="add-device-symbol" aria-hidden="true"></span>
                <button class="add-device-close" type="button" aria-label="Закрыть">×</button>
            </div>
            <h2 id="add-device-title">Добавить устройство</h2>
            <p id="add-device-description">Подключите Android по сети через ADB. Устройство должно быть доступно с сервера, а отладка по сети — включена.</p>
            <div class="add-device-fields">
                <label>IP-адрес<input name="host" type="text" placeholder="192.168.1.10" autocomplete="off" spellcheck="false" required /></label>
                <label class="add-device-port">Порт<input name="port" type="number" placeholder="5555" min="1" max="65535" step="1" required /></label>
            </div>
            <p class="add-device-help">Для беспроводной отладки Android 11+ сначала выполните сопряжение с сервером. Здесь укажите порт подключения, а не сопряжения.</p>
            <div class="add-device-result" role="status" aria-live="polite" hidden></div>
            <div class="add-device-footer">
                <button class="add-device-cancel" type="button">Отмена</button>
                <button class="add-device-submit" type="submit">Подключить</button>
            </div>
        </form>`;
    const form = dialog.querySelector('form') as HTMLFormElement;
    const host = form.elements.namedItem('host') as HTMLInputElement;
    const port = form.elements.namedItem('port') as HTMLInputElement;
    const submit = dialog.querySelector('.add-device-submit') as HTMLButtonElement;
    const result = dialog.querySelector('.add-device-result') as HTMLElement;
    dialog.querySelector('.add-device-symbol')?.appendChild(SvgImage.create(SvgImage.Icon.ADD_DEVICE));
    const close = (): void => dialog.close();
    dialog.querySelector('.add-device-close')?.addEventListener('click', close);
    dialog.querySelector('.add-device-cancel')?.addEventListener('click', close);
    dialog.addEventListener('click', (event) => {
        const bounds = dialog.getBoundingClientRect();
        if (
            event.target === dialog &&
            (event.clientX < bounds.left ||
                event.clientX > bounds.right ||
                event.clientY < bounds.top ||
                event.clientY > bounds.bottom)
        ) {
            close();
        }
    });
    dialog.addEventListener('close', () => {
        form.reset();
        result.textContent = '';
        dialog.remove();
        if (previousFocus?.isConnected) {
            previousFocus.focus();
        }
    });
    const showResult = (text: string, success: boolean): void => {
        result.textContent = text;
        result.className = `add-device-result ${success ? 'success' : 'error'}`;
        result.hidden = false;
    };
    form.addEventListener('submit', async (event) => {
        event.preventDefault();
        if (submit.disabled) {
            return;
        }
        try {
            const address = validateAdbAddress(host.value, Number(port.value));
            submit.disabled = true;
            host.disabled = true;
            port.disabled = true;
            form.setAttribute('aria-busy', 'true');
            submit.textContent = 'Подключение…';
            result.hidden = false;
            result.className = 'add-device-result';
            result.textContent = `Подключаемся к ${address.host}:${address.port}…`;
            const message = await connect(address.host, address.port);
            if (dialog.isConnected) {
                showResult(message, true);
            }
        } catch (error) {
            if (dialog.isConnected) {
                showResult(error instanceof Error ? error.message : String(error), false);
            }
        } finally {
            submit.disabled = false;
            host.disabled = false;
            port.disabled = false;
            form.removeAttribute('aria-busy');
            submit.textContent = 'Подключить';
        }
    });
    document.body.appendChild(dialog);
    dialog.showModal();
    host.focus();
}
