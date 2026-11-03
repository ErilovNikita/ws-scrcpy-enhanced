import '../../style/modal.css';
import SvgImage, { Icon } from './SvgImage';

let nextId = 0;
const notices = new Map<string, HTMLDialogElement>();

type ModalOptions = {
    title: string;
    message: string;
    icon: Icon;
    error?: boolean;
};

function createModal(options: ModalOptions): { dialog: HTMLDialogElement; form: HTMLFormElement; footer: HTMLElement } {
    const previousFocus = document.activeElement as HTMLElement | null;
    const dialog = document.createElement('dialog');
    dialog.className = 'app-modal app-message-dialog';
    const id = `app_modal_${++nextId}`;
    dialog.setAttribute('aria-labelledby', `${id}_title`);
    dialog.setAttribute('aria-describedby', `${id}_message`);
    const form = document.createElement('form');
    const top = document.createElement('div');
    top.className = 'app-modal-top-row';
    const symbol = document.createElement('span');
    symbol.className = `app-modal-symbol${options.error ? ' is-error' : ''}`;
    symbol.setAttribute('aria-hidden', 'true');
    symbol.appendChild(SvgImage.create(options.icon));
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'app-modal-close';
    close.setAttribute('aria-label', 'Закрыть');
    close.textContent = '×';
    close.onclick = () => dialog.close();
    top.append(symbol, close);
    const title = document.createElement('h2');
    title.id = `${id}_title`;
    title.textContent = options.title;
    const message = document.createElement('p');
    message.id = `${id}_message`;
    message.textContent = options.message;
    const footer = document.createElement('div');
    footer.className = 'app-modal-footer';
    form.append(top, title, message, footer);
    dialog.appendChild(form);
    dialog.addEventListener('click', (event) => {
        const rect = dialog.getBoundingClientRect();
        if (
            event.target === dialog &&
            (event.clientX < rect.left ||
                event.clientX > rect.right ||
                event.clientY < rect.top ||
                event.clientY > rect.bottom)
        ) {
            dialog.close();
        }
    });
    dialog.addEventListener('close', () => {
        form.reset();
        dialog.remove();
        if (previousFocus?.isConnected) {
            previousFocus.focus();
        }
    });
    document.body.appendChild(dialog);
    return { dialog, form, footer };
}

export function showNotice(title: string, message: string): void {
    const key = `${title}::${message}`;
    const existing = notices.get(key);
    if (existing?.isConnected) {
        return;
    }
    const { dialog, form, footer } = createModal({ title, message, icon: Icon.OFFLINE, error: true });
    notices.set(key, dialog);
    const ok = document.createElement('button');
    ok.type = 'submit';
    ok.className = 'app-modal-primary';
    ok.textContent = 'Понятно';
    footer.appendChild(ok);
    form.onsubmit = (event) => {
        event.preventDefault();
        dialog.close();
    };
    dialog.addEventListener('close', () => notices.delete(key), { once: true });
    dialog.showModal();
    ok.focus();
}

export function promptUploadDirectory(value: string): Promise<string | null> {
    const { dialog, form, footer } = createModal({
        title: 'Загрузка файлов',
        message: 'Укажите папку на Android. Оставьте поле пустым, чтобы использовать /data/local/tmp.',
        icon: Icon.UPLOAD,
    });
    const label = document.createElement('label');
    label.textContent = 'Папка назначения';
    const input = document.createElement('input');
    input.type = 'text';
    input.value = value;
    input.placeholder = '/sdcard/Download';
    input.autocomplete = 'off';
    input.spellcheck = false;
    label.appendChild(input);
    const error = document.createElement('p');
    error.className = 'app-modal-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;
    form.insertBefore(label, footer);
    form.insertBefore(error, footer);
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.textContent = 'Отмена';
    cancel.onclick = () => dialog.close();
    const upload = document.createElement('button');
    upload.type = 'submit';
    upload.className = 'app-modal-primary';
    upload.textContent = 'Загрузить';
    footer.append(cancel, upload);
    return new Promise((resolve) => {
        let result: string | null = null;
        form.onsubmit = (event) => {
            event.preventDefault();
            const path = input.value.trim().replace(/\\/g, '/');
            if (
                path &&
                (!path.startsWith('/') ||
                    path.includes('\0') ||
                    path.split('/').some((part) => part === '.' || part === '..'))
            ) {
                error.textContent = 'Укажите абсолютный путь без сегментов «.» и «..», например /sdcard/Download.';
                error.hidden = false;
                input.focus();
                return;
            }
            result = path.length > 1 ? path.replace(/\/+$/, '') : path;
            dialog.close();
        };
        dialog.addEventListener('close', () => resolve(result), { once: true });
        dialog.showModal();
        input.focus();
        input.select();
    });
}
