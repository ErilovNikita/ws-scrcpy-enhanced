import '../../style/upload-notifications.css';
import FilePushHandler, { DragAndPushListener, PushUpdateParams } from './filePush/FilePushHandler';
import SvgImage from '../ui/SvgImage';

type UploadNotice = {
    element: HTMLElement;
    title: HTMLElement;
    message: HTMLElement;
    progress: HTMLProgressElement;
    close: HTMLButtonElement;
    timeout?: number;
};

export default class DragAndPushLogger implements DragAndPushListener {
    private readonly holder = document.createElement('div');
    private readonly notices = new Map<string, UploadNotice>();
    private dragNotice?: HTMLElement;

    constructor() {
        this.holder.className = 'upload-notifications';
        this.holder.setAttribute('aria-label', 'File uploads');
        document.body.appendChild(this.holder);
    }

    private createNotice(key: string, fileName: string): UploadNotice {
        const element = document.createElement('section');
        element.className = 'upload-notification';
        const icon = document.createElement('div');
        icon.className = 'upload-notification-icon';
        icon.appendChild(SvgImage.create(SvgImage.Icon.UPLOAD));
        icon.setAttribute('aria-hidden', 'true');
        const content = document.createElement('div');
        content.className = 'upload-notification-content';
        const title = document.createElement('strong');
        title.textContent = 'Uploading file';
        title.setAttribute('role', 'status');
        const name = document.createElement('div');
        name.className = 'upload-notification-name';
        name.textContent = name.title = fileName;
        const message = document.createElement('small');
        const progress = document.createElement('progress');
        progress.max = 100;
        progress.value = 0;
        progress.setAttribute('aria-label', `Upload progress for ${fileName}`);
        const close = document.createElement('button');
        close.type = 'button';
        close.textContent = '×';
        close.setAttribute('aria-label', `Dismiss notification for ${fileName}`);
        close.hidden = true;
        content.append(title, name, message, progress);
        element.append(icon, content, close);
        const notice = { element, title, message, progress, close };
        close.addEventListener('click', () => this.removeNotice(notice));
        this.notices.set(key, notice);
        this.holder.appendChild(element);
        return notice;
    }

    private removeNotice(notice: UploadNotice): void {
        window.clearTimeout(notice.timeout);
        notice.element.remove();
        this.notices.forEach((value, key) => {
            if (value === notice) {
                this.notices.delete(key);
            }
        });
    }

    public onDragEnter(): boolean {
        if (!this.dragNotice) {
            this.dragNotice = document.createElement('div');
            this.dragNotice.className = 'upload-drop-notice';
            this.dragNotice.textContent = 'Drop files to upload to this device';
            this.dragNotice.setAttribute('role', 'status');
            this.holder.prepend(this.dragNotice);
        }
        return true;
    }

    public onDragLeave(): boolean {
        this.dragNotice?.remove();
        this.dragNotice = undefined;
        return true;
    }

    public onDrop(): boolean {
        return this.onDragLeave();
    }

    public onError(error: Error | string): void {
        const notice = this.createNotice(`error_${Date.now()}`, 'File upload');
        notice.element.classList.add('error');
        notice.title.textContent = 'Upload failed';
        notice.message.textContent = typeof error === 'string' ? error : error.message;
        notice.message.setAttribute('role', 'alert');
        notice.progress.hidden = true;
        notice.close.hidden = false;
    }

    public onFilePushUpdate(data: PushUpdateParams): void {
        const { pushId, fileName, message, progress, error, finished } = data;
        const key = `${pushId}/${fileName}`;
        const pendingKey = `${FilePushHandler.REQUEST_NEW_PUSH_ID}/${fileName}`;
        let notice = this.notices.get(key);
        if (!notice && key !== pendingKey) {
            notice = this.notices.get(pendingKey);
            if (notice) {
                this.notices.delete(pendingKey);
                this.notices.set(key, notice);
            }
        }
        notice = notice || this.createNotice(key, fileName);
        window.clearTimeout(notice.timeout);
        notice.element.classList.toggle('error', error);
        notice.element.classList.toggle('success', finished && !error);
        notice.title.textContent = error ? 'Upload failed' : finished ? 'File uploaded' : 'Uploading file';
        const percent = Number.isFinite(progress) ? Math.max(0, Math.min(100, progress)) : 0;
        notice.progress.value = percent;
        notice.progress.hidden = error;
        notice.message.textContent = error ? message : finished ? 'Saved to your device' : `${Math.floor(percent)}%`;
        notice.message.setAttribute('role', error ? 'alert' : 'presentation');
        notice.close.hidden = !finished && !error;
        if (finished && !error) {
            const completed = notice;
            notice.timeout = window.setTimeout(() => this.removeNotice(completed), 5000);
        }
    }

    public dispose(): void {
        this.notices.forEach((notice) => window.clearTimeout(notice.timeout));
        this.notices.clear();
        this.holder.remove();
    }
}
