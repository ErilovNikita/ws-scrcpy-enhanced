import '../../../style/morebox.css';
import { BasePlayer } from '../../player/BasePlayer';
import { TextControlMessage } from '../../controlMessage/TextControlMessage';
import { CommandControlMessage } from '../../controlMessage/CommandControlMessage';
import { ControlMessage } from '../../controlMessage/ControlMessage';
import Size from '../../Size';
import DeviceMessage from '../DeviceMessage';
import VideoSettings from '../../VideoSettings';
import { StreamClientScrcpy } from '../client/StreamClientScrcpy';
import { ScrcpyAudioController } from '../../audio/ScrcpyAudioController';

const TAG = '[GoogMoreBox]';

export class GoogMoreBox {
    private static defaultSize = new Size(480, 480);
    private static savedVideoSettingsKeyPrefix = 'ws-scrcpy:saved-video-settings:v1';
    private onStop?: () => void;
    private screenPowerModeIntervalId?: number;
    private readonly holder: HTMLElement;
    private readonly input: HTMLTextAreaElement;
    private readonly bitrateInput?: HTMLInputElement;
    private readonly maxFpsInput?: HTMLInputElement;
    private readonly iFrameIntervalInput?: HTMLInputElement;
    private readonly maxWidthInput?: HTMLInputElement;
    private readonly maxHeightInput?: HTMLInputElement;

    constructor(udid: string, private player: BasePlayer, private client: StreamClientScrcpy) {
        const playerName = player.getName();
        const videoSettings = player.getVideoSettings();
        const { displayId } = videoSettings;
        const preferredSettings = player.getPreferredVideoSetting();
        const overlay = document.createElement('div');
        overlay.className = 'more-box-overlay';
        overlay.hidden = true;
        const moreBox = document.createElement('div');
        moreBox.className = 'more-box scrcpy-settings-dialog';
        moreBox.setAttribute('role', 'dialog');
        moreBox.setAttribute('aria-modal', 'true');
        const header = document.createElement('div');
        header.className = 'more-box-header';
        const nameBox = document.createElement('p');
        nameBox.innerText = `${udid} (${playerName})`;
        nameBox.className = 'text-with-shadow';
        nameBox.id = `stream_settings_title_${udid}_${playerName}_${displayId}`;
        moreBox.setAttribute('aria-labelledby', nameBox.id);
        const closeButton = document.createElement('button');
        closeButton.className = 'more-box-close';
        closeButton.type = 'button';
        closeButton.innerText = '×';
        closeButton.setAttribute('aria-label', 'Close stream settings');
        const heading = document.createElement('div');
        heading.className = 'more-box-heading';
        const subtitle = document.createElement('small');
        subtitle.textContent = 'Send input, control device and configure quick settings';
        heading.append(nameBox, subtitle);
        header.append(heading, closeButton);
        moreBox.appendChild(header);
        const body = document.createElement('div');
        body.className = 'more-box-body';
        moreBox.appendChild(body);
        const input = (this.input = document.createElement('textarea'));
        input.classList.add('text-area');
        input.placeholder = 'Type text or key combination…';
        input.setAttribute('aria-label', 'Text to send to the device');
        input.id = `text_input_${udid}_${playerName}_${displayId}`;
        const sendButton = document.createElement('button');
        sendButton.innerText = 'Send as keys';

        const inputWrapper = GoogMoreBox.wrap('div', [input, sendButton], body, ['stream-input-section']);
        sendButton.onclick = () => {
            if (input.value) {
                client.sendMessage(new TextControlMessage(input.value));
            }
        };

        const commands: HTMLElement[] = [];
        const codes = CommandControlMessage.Commands;
        for (const [action, command] of codes.entries()) {
            const btn = document.createElement('button');
            let bitrateInput: HTMLInputElement;
            let maxFpsInput: HTMLInputElement;
            let iFrameIntervalInput: HTMLInputElement;
            let maxWidthInput: HTMLInputElement;
            let maxHeightInput: HTMLInputElement;
            if (action === ControlMessage.TYPE_CHANGE_STREAM_PARAMETERS) {
                const spoiler = document.createElement('details');
                const spoilerLabel = document.createElement('summary');

                const innerDiv = document.createElement('div');
                spoiler.className = 'spoiler';
                spoilerLabel.className = 'settings-disclosure-heading';
                spoilerLabel.innerText = command;
                innerDiv.className = 'box';
                spoiler.appendChild(spoilerLabel);
                spoiler.appendChild(innerDiv);

                const bitrateLabel = document.createElement('label');
                bitrateLabel.innerText = 'Bitrate:';
                bitrateInput = document.createElement('input');
                bitrateInput.placeholder = `${preferredSettings.bitrate} bps`;
                bitrateInput.value = videoSettings.bitrate.toString();
                bitrateInput.id = `video_bitrate_${udid}_${playerName}_${displayId}`;
                bitrateLabel.htmlFor = bitrateInput.id;
                GoogMoreBox.wrap('div', [bitrateLabel, bitrateInput], innerDiv);
                this.bitrateInput = bitrateInput;

                const maxFpsLabel = document.createElement('label');
                maxFpsLabel.innerText = 'Max fps:';
                maxFpsInput = document.createElement('input');
                maxFpsInput.placeholder = `${preferredSettings.maxFps} fps`;
                maxFpsInput.value = videoSettings.maxFps.toString();
                maxFpsInput.id = `video_max_fps_${udid}_${playerName}_${displayId}`;
                maxFpsLabel.htmlFor = maxFpsInput.id;
                GoogMoreBox.wrap('div', [maxFpsLabel, maxFpsInput], innerDiv);
                this.maxFpsInput = maxFpsInput;

                const iFrameIntervalLabel = document.createElement('label');
                iFrameIntervalLabel.innerText = 'I-Frame Interval:';
                iFrameIntervalInput = document.createElement('input');
                iFrameIntervalInput.placeholder = `${preferredSettings.iFrameInterval} seconds`;
                iFrameIntervalInput.value = videoSettings.iFrameInterval.toString();
                iFrameIntervalInput.id = `video_iframe_interval_${udid}_${playerName}_${displayId}`;
                iFrameIntervalLabel.htmlFor = iFrameIntervalInput.id;
                GoogMoreBox.wrap('div', [iFrameIntervalLabel, iFrameIntervalInput], innerDiv);
                this.iFrameIntervalInput = iFrameIntervalInput;

                const { width, height } = videoSettings.bounds || client.getMaxSize() || GoogMoreBox.defaultSize;
                const pWidth = preferredSettings.bounds?.width || width;
                const pHeight = preferredSettings.bounds?.height || height;

                const maxWidthLabel = document.createElement('label');
                maxWidthLabel.innerText = 'Max width:';
                maxWidthInput = document.createElement('input');
                maxWidthInput.placeholder = `${pWidth} px`;
                maxWidthInput.value = width.toString();
                maxWidthInput.id = `video_max_width_${udid}_${playerName}_${displayId}`;
                maxWidthLabel.htmlFor = maxWidthInput.id;
                GoogMoreBox.wrap('div', [maxWidthLabel, maxWidthInput], innerDiv);
                this.maxWidthInput = maxWidthInput;

                const maxHeightLabel = document.createElement('label');
                maxHeightLabel.innerText = 'Max height:';
                maxHeightInput = document.createElement('input');
                maxHeightInput.placeholder = `${pHeight} px`;
                maxHeightInput.value = height.toString();
                maxHeightInput.id = `video_max_height_${udid}_${playerName}_${displayId}`;
                maxHeightLabel.htmlFor = maxHeightInput.id;
                GoogMoreBox.wrap('div', [maxHeightLabel, maxHeightInput], innerDiv);
                this.maxHeightInput = maxHeightInput;

                innerDiv.appendChild(btn);
                const fitButton = document.createElement('button');
                fitButton.innerText = 'Fit';
                fitButton.onclick = this.fit;
                innerDiv.insertBefore(fitButton, innerDiv.firstChild);
                const resetButton = document.createElement('button');
                resetButton.innerText = 'Reset';
                resetButton.onclick = this.reset;
                innerDiv.insertBefore(resetButton, innerDiv.firstChild);
                const saveButton = document.createElement('button');
                saveButton.innerText = 'Save video settings';
                saveButton.onclick = () => {
                    this.saveVideoSettingsToLocalStorage(udid, playerName, displayId);
                };
                innerDiv.appendChild(saveButton);
                commands.push(spoiler);
            } else {
                if (
                    action === CommandControlMessage.TYPE_SET_CLIPBOARD ||
                    action === CommandControlMessage.TYPE_GET_CLIPBOARD
                ) {
                    inputWrapper.appendChild(btn);
                } else {
                    commands.push(btn);
                }
            }
            btn.innerText = command;
            if (action === ControlMessage.TYPE_CHANGE_STREAM_PARAMETERS) {
                btn.onclick = () => {
                    const bitrate = parseInt(bitrateInput.value, 10);
                    const maxFps = parseInt(maxFpsInput.value, 10);
                    const iFrameInterval = parseInt(iFrameIntervalInput.value, 10);
                    if (isNaN(bitrate) || isNaN(maxFps)) {
                        return;
                    }
                    const width = parseInt(maxWidthInput.value, 10) & ~15;
                    const height = parseInt(maxHeightInput.value, 10) & ~15;
                    const bounds = new Size(width, height);
                    const current = player.getVideoSettings();
                    const { lockedVideoOrientation, sendFrameMeta, displayId, codecOptions, encoderName } = current;
                    const videoSettings = new VideoSettings({
                        bounds,
                        bitrate,
                        maxFps,
                        iFrameInterval,
                        lockedVideoOrientation,
                        sendFrameMeta,
                        displayId,
                        codecOptions,
                        encoderName,
                    });
                    client.sendNewVideoSetting(videoSettings);
                };
            } else if (action === CommandControlMessage.TYPE_SET_CLIPBOARD) {
                btn.onclick = () => {
                    const text = input.value;
                    if (text) {
                        client.sendMessage(CommandControlMessage.createSetClipboardCommand(text));
                    }
                };
            } else {
                btn.onclick = () => {
                    client.sendMessage(new CommandControlMessage(action));
                };
            }
        }
        const inputActions = document.createElement('div');
        inputActions.className = 'stream-input-actions';
        Array.from(inputWrapper.querySelectorAll('button')).forEach((button) => inputActions.appendChild(button));
        inputWrapper.appendChild(inputActions);
        sendButton.classList.add('primary-action');
        const commandGrid = document.createElement('div');
        commandGrid.className = 'stream-command-grid';
        commands.filter((command) => command instanceof HTMLButtonElement).forEach((button) => {
            commandGrid.appendChild(button);
        });
        body.appendChild(commandGrid);
        commands.filter((command) => command.classList.contains('spoiler')).forEach((spoiler) => {
            const description = document.createElement('small');
            description.textContent = 'Quick display and stream options';
            const summary = spoiler.querySelector('summary');
            if (summary) {
                const caption = document.createElement('span');
                caption.className = 'settings-disclosure-caption';
                caption.textContent = summary.textContent;
                caption.appendChild(description);
                summary.textContent = '';
                summary.append(GoogMoreBox.createActionIcon('Video'), caption);
            }
            body.appendChild(spoiler);
        });

        const audioPanel = document.createElement('details');
        audioPanel.open = true;
        audioPanel.className = 'stream-audio-panel';
        const audioHeading = document.createElement('summary');
        audioHeading.className = 'stream-audio-heading settings-disclosure-heading';
        const audioTitle = document.createElement('h3');
        audioTitle.textContent = 'Audio settings';
        const audioSubtitle = document.createElement('small');
        audioSubtitle.textContent = 'Configure audio playback for this device';
        const audioCaption = document.createElement('span');
        audioCaption.className = 'settings-disclosure-caption';
        audioCaption.append(audioTitle, audioSubtitle);
        audioHeading.appendChild(audioCaption);
        const audioColumns = document.createElement('div');
        audioColumns.className = 'stream-audio-columns';
        const audioGeneral = document.createElement('div');
        audioGeneral.className = 'stream-audio-general';
        const audioOptions = document.createElement('div');
        audioOptions.className = 'stream-audio-options';
        audioColumns.append(audioGeneral, audioOptions);
        audioPanel.append(audioHeading, audioColumns);
        body.appendChild(audioPanel);

        const screenPowerModeId = `screen_power_mode_${udid}_${playerName}_${displayId}`;
        const screenPowerModeLabel = document.createElement('label');
        const labelTextPrefix = 'Screen power';
        const screenPowerModeCheck = document.createElement('input');
        screenPowerModeCheck.type = 'checkbox';
        screenPowerModeCheck.checked = false;
        screenPowerModeCheck.dataset.persistSkipRestore = 'true';
        let mode = 'OFF';
        screenPowerModeCheck.id = screenPowerModeLabel.htmlFor = screenPowerModeId;
        screenPowerModeLabel.innerText = `${labelTextPrefix} ${mode}`;
        const stopScreenPowerModeInterval = (): void => {
            if (typeof this.screenPowerModeIntervalId !== 'number') {
                return;
            }
            window.clearInterval(this.screenPowerModeIntervalId);
            delete this.screenPowerModeIntervalId;
        };
        const sendCurrentScreenPowerMode = (): void => {
            const message = CommandControlMessage.createSetScreenPowerModeCommand(screenPowerModeCheck.checked);
            client.sendMessage(message);
        };
        const startScreenPowerModeIntervalIfNeeded = (): void => {
            if (screenPowerModeCheck.checked) {
                stopScreenPowerModeInterval();
                return;
            }
            if (typeof this.screenPowerModeIntervalId === 'number') {
                return;
            }
            this.screenPowerModeIntervalId = window.setInterval(() => {
                if (!screenPowerModeCheck.checked) {
                    sendCurrentScreenPowerMode();
                }
            }, 1000);
        };
        screenPowerModeCheck.onchange = () => {
            mode = screenPowerModeCheck.checked ? 'ON' : 'OFF';
            screenPowerModeLabel.innerText = `${labelTextPrefix} ${mode}`;
            sendCurrentScreenPowerMode();
            startScreenPowerModeIntervalIfNeeded();
        };
        GoogMoreBox.wrap('p', [screenPowerModeCheck, screenPowerModeLabel], audioGeneral, ['flex-center']);

        const qualityId = `show_video_quality_${udid}_${playerName}_${displayId}`;
        const qualityLabel = document.createElement('label');
        const qualityCheck = document.createElement('input');
        qualityCheck.type = 'checkbox';
        qualityCheck.checked = BasePlayer.DEFAULT_SHOW_QUALITY_STATS;
        qualityCheck.id = qualityId;
        qualityLabel.htmlFor = qualityId;
        qualityLabel.innerText = 'Show quality stats';
        GoogMoreBox.wrap('p', [qualityCheck, qualityLabel], audioGeneral, ['flex-center']);
        qualityCheck.onchange = () => {
            player.setShowQualityStats(qualityCheck.checked);
        };

        const audioId = `enable_audio_${udid}_${playerName}_${displayId}`;
        const audioLabel = document.createElement('label');
        const audioCheck = document.createElement('input');
        audioCheck.type = 'checkbox';
        audioCheck.checked = client.isAudioEnabled();
        audioCheck.id = audioId;
        audioLabel.htmlFor = audioId;
        audioCheck.dataset.persistSkipRestore = 'true';

        GoogMoreBox.wrap('p', [audioCheck, audioLabel], audioGeneral, ['flex-center']);
        let removeAudioStatusListener: (() => void) | undefined;

        if (ScrcpyAudioController.isSupported()) {
            audioLabel.innerText = 'Audio';
            const audioHelp = document.createElement('small');
            audioHelp.innerText =
                'If you do not hear audio in the browser, tap or click the page once to allow playback.';
            GoogMoreBox.wrap('p', [audioHelp], audioGeneral, ['audio-help']);
            const audioStatus = document.createElement('small');
            audioStatus.innerText = `Audio: ${client.getAudioStatus()}`;
            GoogMoreBox.wrap('p', [audioStatus], audioGeneral, ['audio-status']);
            removeAudioStatusListener = client.addAudioStatusListener((status) => {
                audioStatus.innerText = `Audio: ${status}`;
            });
            audioCheck.onchange = () => {
                applyAudioOptions();
                client.setAudioEnabled(audioCheck.checked);
            };

            const currentAudio = client.getAudioOptions();

            const modeLabel = document.createElement('label');
            modeLabel.innerText = 'Mode:';
            const modeSelect = document.createElement('select');
            modeSelect.id = `audio_mode_${udid}_${playerName}_${displayId}`;
            modeLabel.htmlFor = modeSelect.id;
            const modeCombined = document.createElement('option');
            modeCombined.value = 'combined';
            modeCombined.innerText = 'combined';
            const modeSplit = document.createElement('option');
            modeSplit.value = 'split';
            modeSplit.innerText = 'split';
            modeSelect.appendChild(modeCombined);
            modeSelect.appendChild(modeSplit);
            modeSelect.value = currentAudio.frameMode;
            GoogMoreBox.wrap('div', [modeLabel, modeSelect], audioOptions);

            const channelsLabel = document.createElement('label');
            channelsLabel.innerText = 'Channels:';
            const channelsSelect = document.createElement('select');
            channelsSelect.id = `audio_channels_${udid}_${playerName}_${displayId}`;
            channelsLabel.htmlFor = channelsSelect.id;
            const ch1 = document.createElement('option');
            ch1.value = '1';
            ch1.innerText = '1';
            const ch2 = document.createElement('option');
            ch2.value = '2';
            ch2.innerText = '2';
            channelsSelect.appendChild(ch1);
            channelsSelect.appendChild(ch2);
            channelsSelect.value = String(currentAudio.channels || 1);
            GoogMoreBox.wrap('div', [channelsLabel, channelsSelect], audioOptions);

            const bitrateLabel = document.createElement('label');
            bitrateLabel.innerText = 'Bitrate:';
            const bitrateInput = document.createElement('input');
            bitrateInput.type = 'number';
            bitrateInput.min = '16000';
            bitrateInput.step = '1000';
            bitrateInput.value = String(currentAudio.bitrate || 64_000);
            bitrateInput.id = `audio_bitrate_${udid}_${playerName}_${displayId}`;
            bitrateLabel.htmlFor = bitrateInput.id;
            const bitrateRow = GoogMoreBox.wrap('div', [bitrateLabel, bitrateInput], audioOptions);
            const bitrateHelp = document.createElement('small');
            bitrateHelp.textContent = 'Audio bitrate in bits per second';
            bitrateRow.appendChild(bitrateHelp);

            const applyAudioBtn = document.createElement('button');
            applyAudioBtn.innerText = 'Apply audio settings';
            const applyAudioOptions = (): void => {
                const frameMode = (modeSelect.value === 'split' ? 'split' : 'combined') as 'split' | 'combined';
                const channelsRaw = parseInt(channelsSelect.value, 10);
                const channels = (channelsRaw === 2 ? 2 : 1) as 1 | 2;
                const bitrateRaw = parseInt(bitrateInput.value, 10);
                const bitrate = !isNaN(bitrateRaw) && bitrateRaw > 0 ? bitrateRaw : undefined;
                client.setAudioOptions({ frameMode, channels, bitrate });
            };
            applyAudioBtn.onclick = () => {
                applyAudioOptions();
                if (audioCheck.checked) {
                    client.setAudioEnabled(true);
                }
            };
            GoogMoreBox.wrap('p', [applyAudioBtn], audioOptions);
        } else {
            audioLabel.innerText = 'Audio (unsupported)';
            audioCheck.disabled = true;
        }

        const stop = (ev?: string | Event) => {
            if (ev && ev instanceof Event && ev.type === 'error') {
                console.error(TAG, ev);
            }
            stopScreenPowerModeInterval();
            removeAudioStatusListener?.();
            client.setAudioEnabled(false);
            const parent = overlay.parentElement;
            if (parent) {
                parent.removeChild(overlay);
            }
            if (this.onStop) {
                this.onStop();
                delete this.onStop;
            }
        };

        const stopBtn = document.createElement('button') as HTMLButtonElement;
        stopBtn.innerText = `Disconnect`;
        stopBtn.onclick = stop;

        const footer = document.createElement('div');
        footer.className = 'more-box-footer';
        footer.appendChild(stopBtn);
        moreBox.appendChild(footer);
        moreBox.querySelectorAll('button').forEach((button) => {
            if (button === closeButton) {
                return;
            }
            const label = button.textContent || '';
            const icon = GoogMoreBox.createActionIcon(label);
            const text = document.createElement('span');
            text.textContent = label;
            button.textContent = '';
            button.append(icon, text);
        });
        audioHeading.prepend(GoogMoreBox.createActionIcon('Audio'));
        overlay.appendChild(moreBox);

        const close = (): void => {
            const toggle = document.getElementById(`input_show_more_${udid}_${playerName}_${displayId}`);
            if (toggle instanceof HTMLInputElement && toggle.checked) {
                toggle.click();
            } else {
                overlay.hidden = true;
            }
        };
        closeButton.addEventListener('click', close);
        overlay.addEventListener('click', (event: MouseEvent) => {
            if (event.target === overlay) {
                close();
            }
        });
        overlay.addEventListener('keydown', (event: KeyboardEvent) => {
            if (event.key === 'Escape') {
                close();
            }
        });

        player.on('video-settings', this.onVideoSettings);
        this.holder = overlay;
    }

    private onVideoSettings = (videoSettings: VideoSettings): void => {
        if (this.bitrateInput) {
            this.bitrateInput.value = videoSettings.bitrate.toString();
        }
        if (this.maxFpsInput) {
            this.maxFpsInput.value = videoSettings.maxFps.toString();
        }
        if (this.iFrameIntervalInput) {
            this.iFrameIntervalInput.value = videoSettings.iFrameInterval.toString();
        }
        if (videoSettings.bounds) {
            const { width, height } = videoSettings.bounds;
            if (this.maxWidthInput) {
                this.maxWidthInput.value = width.toString();
            }
            if (this.maxHeightInput) {
                this.maxHeightInput.value = height.toString();
            }
        }
    };

    private fit = (): void => {
        const { width, height } = this.client.getMaxSize() || GoogMoreBox.defaultSize;
        if (this.maxWidthInput) {
            this.maxWidthInput.value = width.toString();
        }
        if (this.maxHeightInput) {
            this.maxHeightInput.value = height.toString();
        }
    };

    private reset = (): void => {
        const preferredSettings = this.player.getPreferredVideoSetting();
        this.onVideoSettings(preferredSettings);
    };

    private saveVideoSettingsToLocalStorage(udid: string, playerName: string, displayId: number): void {
        if (!window.localStorage) {
            return;
        }
        if (
            !this.bitrateInput ||
            !this.maxFpsInput ||
            !this.iFrameIntervalInput ||
            !this.maxWidthInput ||
            !this.maxHeightInput
        ) {
            return;
        }
        const bitrate = parseInt(this.bitrateInput.value, 10);
        const maxFps = parseInt(this.maxFpsInput.value, 10);
        const iFrameInterval = parseInt(this.iFrameIntervalInput.value, 10);
        if (isNaN(bitrate) || isNaN(maxFps) || isNaN(iFrameInterval)) {
            return;
        }
        const width = parseInt(this.maxWidthInput.value, 10) & ~15;
        const height = parseInt(this.maxHeightInput.value, 10) & ~15;
        if (isNaN(width) || isNaN(height) || width <= 0 || height <= 0) {
            return;
        }
        const key = `${GoogMoreBox.savedVideoSettingsKeyPrefix}:${playerName}:${udid}:${displayId}`;
        const payload = {
            bitrate,
            maxFps,
            iFrameInterval,
            bounds: { width, height },
        };
        window.localStorage.setItem(key, JSON.stringify(payload));
    }

    public OnDeviceMessage(ev: DeviceMessage): void {
        if (ev.type !== DeviceMessage.TYPE_CLIPBOARD) {
            return;
        }
        this.input.value = ev.getText();
        this.input.select();
        document.execCommand('copy');
    }

    private static createActionIcon(label: string): SVGSVGElement {
        const paths: Record<string, string> = {
            'Send as keys': 'm8 5 11 7-11 7V5Z',
            'Get clipboard': 'M9 5H5v15h12v-4M9 2h12v14H9z',
            'Set clipboard': 'M12 16V3m-5 5 5-5 5 5M4 14v7h16v-7',
            'Expand notifications': 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4',
            'Expand settings': 'M4 6h16M4 12h16M4 18h16M8 3v6m8 0v6m-6 0v6',
            'Collapse panels': 'M4 9V4h5m6 0h5v5M4 15v5h5m6 0h5v-5M8 8l4 4 4-4m-8 8 4-4 4 4',
            'Rotate device': 'M4 9V3m0 0h6M4 3l4 4m12 8v6m0 0h-6m6 0-4-4M9 4h8v16H7V9',
            'Apply audio settings': 'm4 12 5 5L20 6',
            'Disconnect': 'M6 10h12v11H6zM8 10V6a4 4 0 0 1 8 0v4',
            Video: 'M3 6h12v12H3zM15 10l6-4v12l-6-4',
            Audio: 'M4 9h4l5-5v16l-5-5H4zM16 8a6 6 0 0 1 0 8m3-11a10 10 0 0 1 0 14',
        };
        const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
        svg.setAttribute('viewBox', '0 0 24 24');
        svg.setAttribute('fill', 'none');
        svg.setAttribute('stroke', 'currentColor');
        svg.setAttribute('stroke-width', '1.8');
        svg.setAttribute('stroke-linecap', 'round');
        svg.setAttribute('stroke-linejoin', 'round');
        svg.setAttribute('aria-hidden', 'true');
        const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
        path.setAttribute('d', paths[label] || 'M4 6h16M4 12h16M4 18h16');
        svg.appendChild(path);
        return svg;
    }

    private static wrap(
        tagName: string,
        elements: HTMLElement[],
        parent: HTMLElement,
        opt_classes?: string[],
    ): HTMLElement {
        const wrap = document.createElement(tagName);
        if (opt_classes) {
            wrap.classList.add(...opt_classes);
        }
        elements.forEach((e) => {
            wrap.appendChild(e);
        });
        parent.appendChild(wrap);
        return wrap;
    }

    public getHolderElement(): HTMLElement {
        return this.holder;
    }

    public setOnStop(listener: () => void): void {
        this.onStop = listener;
    }
}
