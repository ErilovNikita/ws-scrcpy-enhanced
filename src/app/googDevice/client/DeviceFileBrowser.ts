import '../../../style/modal.css';
import '../../../style/device-file-browser.css';
import { ACTION } from '../../../common/Action';
import { ParamsDeviceTracker } from '../../../types/ParamsDeviceTracker';
import { AdbFileService, MAX_PREVIEW_BYTES } from './AdbFileService';
import { Entry } from '../Entry';
import SvgImage from '../../ui/SvgImage';
import * as path from 'path';

export function normalizeDevicePath(value: string, current = '/'): string {
    if (value.includes('\0')) throw new Error('Путь содержит недопустимый символ.');
    return path.resolve(current, value.trim() || '/');
}

export function formatFileSize(bytes: number): string {
    if (bytes < 1024) return `${bytes} Б`;
    const units = ['КБ', 'МБ', 'ГБ'];
    let value = bytes / 1024;
    let index = 0;
    while (value >= 1024 && index < units.length - 1) {
        value /= 1024;
        index++;
    }
    return `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

let browserId = 0;

export class DeviceFileBrowser {
    private static current?: DeviceFileBrowser;
    private readonly dialog = document.createElement('dialog');
    private readonly service: AdbFileService;
    private readonly pathInput: HTMLInputElement;
    private readonly search: HTMLInputElement;
    private readonly rows: HTMLElement;
    private readonly status: HTMLElement;
    private readonly summary: HTMLElement;
    private readonly preview: HTMLElement;
    private readonly up: HTMLButtonElement;
    private entries: Entry[] = [];
    private currentPath = '/sdcard';
    private generation = 0;
    private closed = false;
    private previewUrl?: string;

    public static open(udid: string, deviceName: string, params: ParamsDeviceTracker): void {
        this.current?.dialog.close();
        this.current = new DeviceFileBrowser(udid, deviceName, params);
    }

    private constructor(udid: string, deviceName: string, params: ParamsDeviceTracker) {
        const previousFocus = document.activeElement as HTMLElement | null;
        const id = `device_file_browser_${++browserId}`;
        const dialog = this.dialog;
        dialog.className = 'app-modal device-file-browser';
        dialog.setAttribute('aria-labelledby', `${id}_title`);
        dialog.setAttribute('aria-describedby', `${id}_device`);
        dialog.innerHTML = `
            <header class="file-browser-heading">
                <div class="app-modal-top-row">
                    <span class="app-modal-symbol file-browser-symbol" aria-hidden="true"></span>
                    <button class="file-browser-close" type="button" aria-label="Закрыть проводник">×</button>
                </div>
                <h2 id="${id}_title">Файлы устройства</h2>
                <p id="${id}_device" class="file-browser-device"></p>
            </header>
            <nav class="file-browser-shortcuts" aria-label="Быстрые переходы">
                <button type="button" data-path="/sdcard">Память Android</button>
                <button type="button" data-path="/">Корень</button>
                <button type="button" data-path="/data/local/tmp">Временная папка</button>
            </nav>
            <form class="file-browser-address">
                <button type="button" class="file-browser-up" title="На папку выше" aria-label="На папку выше">↑</button>
                <input class="file-browser-path" type="text" aria-label="Путь на устройстве" autocomplete="off" spellcheck="false" />
                <button type="submit">Перейти</button>
                <button type="button" class="file-browser-refresh" title="Обновить папку" aria-label="Обновить папку"></button>
            </form>
            <div class="file-browser-filter">
                <input type="search" placeholder="Поиск в папке" aria-label="Поиск в текущей папке" />
                <span class="file-browser-summary"></span>
            </div>
            <p class="file-browser-status" role="status" aria-live="polite" hidden></p>
            <div class="file-browser-table-wrapper">
                <table class="file-browser-table">
                    <thead><tr><th scope="col">Имя</th><th scope="col">Размер</th><th scope="col">Изменён</th></tr></thead>
                    <tbody></tbody>
                </table>
            </div>
            <section class="file-browser-preview" aria-label="Предпросмотр файла" hidden></section>
            <footer class="file-browser-footer">Доступ к файлам — с правами ADB на этом устройстве.</footer>`;
        this.pathInput = dialog.querySelector('.file-browser-path') as HTMLInputElement;
        this.search = dialog.querySelector('input[type="search"]') as HTMLInputElement;
        this.rows = dialog.querySelector('tbody') as HTMLElement;
        this.status = dialog.querySelector('.file-browser-status') as HTMLElement;
        this.summary = dialog.querySelector('.file-browser-summary') as HTMLElement;
        this.preview = dialog.querySelector('.file-browser-preview') as HTMLElement;
        this.up = dialog.querySelector('.file-browser-up') as HTMLButtonElement;
        (dialog.querySelector('.file-browser-device') as HTMLElement).textContent = `${
            deviceName || 'Android'
        } · ${udid}`;
        dialog.querySelector('.file-browser-symbol')?.appendChild(SvgImage.create(SvgImage.Icon.FOLDER));
        dialog.querySelector('.file-browser-refresh')?.appendChild(SvgImage.create(SvgImage.Icon.REFRESH));
        dialog.querySelector('.file-browser-close')?.addEventListener('click', () => dialog.close());
        dialog.querySelector('form')?.addEventListener('submit', (event) => {
            event.preventDefault();
            void this.navigate(this.pathInput.value);
        });
        this.up.onclick = () => void this.navigate(path.dirname(this.currentPath));
        dialog
            .querySelector('.file-browser-refresh')
            ?.addEventListener('click', () => void this.navigate(this.currentPath));
        dialog.querySelectorAll<HTMLButtonElement>('[data-path]').forEach((button) => {
            button.onclick = () => void this.navigate(button.dataset.path || '/');
        });
        this.search.oninput = () => this.renderEntries();
        dialog.addEventListener('click', (event) => {
            const bounds = dialog.getBoundingClientRect();
            if (
                event.target === dialog &&
                (event.clientX < bounds.left ||
                    event.clientX > bounds.right ||
                    event.clientY < bounds.top ||
                    event.clientY > bounds.bottom)
            )
                dialog.close();
        });
        document.body.appendChild(dialog);
        this.service = new AdbFileService({ ...params, action: ACTION.FILE_LISTING, udid, path: this.currentPath });
        dialog.addEventListener(
            'close',
            () => {
                this.closed = true;
                ++this.generation;
                this.service.destroy();
                this.clearPreview();
                this.pathInput.value = '';
                this.search.value = '';
                dialog.remove();
                if (DeviceFileBrowser.current === this) DeviceFileBrowser.current = undefined;
                if (previousFocus?.isConnected) previousFocus.focus();
            },
            { once: true },
        );
        dialog.showModal();
        this.pathInput.focus();
        void this.navigate(this.currentPath);
    }

    private showStatus(message: string, error = false): void {
        this.status.textContent = message;
        this.status.className = `file-browser-status${error ? ' is-error' : ''}`;
        this.status.hidden = !message;
    }

    private async navigate(value: string): Promise<void> {
        const generation = ++this.generation;
        this.service.cancelPending();
        try {
            this.currentPath = normalizeDevicePath(value, this.currentPath);
            this.clearPreview();
            this.pathInput.value = this.currentPath;
            this.up.disabled = this.currentPath === '/';
            this.search.value = '';
            this.search.disabled = true;
            this.entries = [];
            this.rows.textContent = '';
            this.summary.textContent = '';
            this.dialog.setAttribute('aria-busy', 'true');
            this.showStatus('Загружаем папку…');
            const entries = await this.service.list(this.currentPath);
            if (this.closed || generation !== this.generation) return;
            this.entries = entries;
            this.search.disabled = false;
            this.renderEntries();
        } catch (error) {
            if (!this.closed && generation === this.generation) {
                this.showStatus(error instanceof Error ? error.message : String(error), true);
            }
        } finally {
            if (generation === this.generation) this.dialog.removeAttribute('aria-busy');
        }
    }

    private renderEntries(): void {
        this.rows.textContent = '';
        const query = this.search.value.trim().toLocaleLowerCase();
        const filtered = this.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query));
        this.summary.textContent = query
            ? `${filtered.length} из ${this.entries.length}`
            : `Объектов: ${this.entries.length}`;
        this.showStatus(filtered.length ? '' : query ? 'Ничего не найдено.' : 'Папка пуста.');
        filtered.forEach((entry) => {
            const row = document.createElement('tr');
            const name = document.createElement('td');
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'file-browser-entry';
            const folder = entry.isDirectory() || entry.isSymbolicLink();
            const icon = SvgImage.create(folder ? SvgImage.Icon.FOLDER : SvgImage.Icon.FILE);
            icon.setAttribute('aria-hidden', 'true');
            const text = document.createElement('span');
            text.textContent = entry.name;
            button.append(icon, text);
            button.title = entry.name;
            button.onclick = () => {
                if (folder) void this.navigate(path.join(this.currentPath, entry.name));
                else void this.openFile(entry);
            };
            name.appendChild(button);
            const size = document.createElement('td');
            size.textContent = folder ? '—' : formatFileSize(entry.size);
            const modified = document.createElement('td');
            modified.textContent = entry.mtime.getTime() ? entry.mtime.toLocaleString() : '—';
            row.append(name, size, modified);
            this.rows.appendChild(row);
        });
    }

    private clearPreview(): void {
        if (this.previewUrl) URL.revokeObjectURL(this.previewUrl);
        this.previewUrl = undefined;
        this.preview.textContent = '';
        this.preview.hidden = true;
    }

    private async openFile(entry: Entry): Promise<void> {
        const generation = ++this.generation;
        this.service.cancelPending();
        this.clearPreview();
        this.preview.hidden = false;
        const heading = document.createElement('div');
        heading.className = 'file-browser-preview-heading';
        const title = document.createElement('strong');
        title.textContent = entry.name;
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        close.setAttribute('aria-label', 'Закрыть предпросмотр');
        close.onclick = () => {
            ++this.generation;
            this.service.cancelPending();
            this.clearPreview();
        };
        heading.append(title, close);
        const content = document.createElement('div');
        content.className = 'file-browser-preview-content';
        this.preview.append(heading, content);
        const extension = entry.name.split('.').pop()?.toLowerCase() || '';
        const imageTypes: Record<string, string> = {
            png: 'image/png',
            jpg: 'image/jpeg',
            jpeg: 'image/jpeg',
            gif: 'image/gif',
            webp: 'image/webp',
        };
        const textFile =
            /^(txt|log|json|xml|csv|tsv|md|ini|conf|config|yaml|yml|sh|prop|html|css|js|sql)$/.test(extension) ||
            entry.name === 'README';
        if ((!imageTypes[extension] && !textFile) || entry.size > MAX_PREVIEW_BYTES) {
            content.textContent = `${formatFileSize(entry.size)} · ${entry.mtime.toLocaleString()}\n${
                entry.size > MAX_PREVIEW_BYTES
                    ? 'Предпросмотр доступен для файлов до 5 МБ.'
                    : 'Для этого формата доступен просмотр свойств файла.'
            }`;
            return;
        }
        content.textContent = 'Читаем файл…';
        try {
            const bytes = await this.service.read(path.join(this.currentPath, entry.name));
            if (this.closed || generation !== this.generation) return;
            content.textContent = '';
            if (imageTypes[extension]) {
                const image = document.createElement('img');
                this.previewUrl = URL.createObjectURL(new Blob([bytes], { type: imageTypes[extension] }));
                image.src = this.previewUrl;
                image.alt = entry.name;
                content.appendChild(image);
            } else {
                const pre = document.createElement('pre');
                pre.textContent = new TextDecoder('utf-8').decode(bytes) || '(Пустой файл)';
                content.appendChild(pre);
            }
        } catch (error) {
            if (!this.closed && generation === this.generation) {
                content.textContent = error instanceof Error ? error.message : String(error);
                content.classList.add('is-error');
            }
        }
    }
}
