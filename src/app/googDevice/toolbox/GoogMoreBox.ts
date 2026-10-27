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
        header.append(nameBox, closeButton);
        moreBox.appendChild(header);
        const input = (this.input = document.createElement('textarea'));
        input.classList.add('text-area');
        input.id = `text_input_${udid}_${playerName}_${displayId}`;
        const sendButton = document.createElement('button');
        sendButton.innerText = 'Send as keys';

        const inputWrapper = GoogMoreBox.wrap('p', [input, sendButton], moreBox);
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
                const spoiler = document.createElement('div');
                const spoilerLabel = document.createElement('label');
                const spoilerCheck = document.createElement('input');

                const innerDiv = document.createElement('div');
                const id = `spoiler_video_${udid}_${playerName}_${displayId}_${action}`;

                spoiler.className = 'spoiler';
                spoilerCheck.type = 'checkbox';
                spoilerCheck.id = id;
                spoilerLabel.htmlFor = id;
                spoilerLabel.innerText = command;
                innerDiv.className = 'box';
                spoiler.appendChild(spoilerCheck);
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
        GoogMoreBox.wrap('p', commands, moreBox);

        const screenPowerModeId = `screen_power_mode_${udid}_${playerName}_${displayId}`;
        const screenPowerModeLabel = document.createElement('label');
        const labelTextPrefix = 'Screen power';
        const screenPowerModeCheck = document.createElement('input');
        screenPowerModeCheck.type = 'checkbox';
        let mode = (screenPowerModeCheck.checked = true) ? 'ON' : 'OFF';
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
        GoogMoreBox.wrap('p', [screenPowerModeCheck, screenPowerModeLabel], moreBox, ['flex-center']);

        const qualityId = `show_video_quality_${udid}_${playerName}_${displayId}`;
        const qualityLabel = document.createElement('label');
        const qualityCheck = document.createElement('input');
        qualityCheck.type = 'checkbox';
        qualityCheck.checked = BasePlayer.DEFAULT_SHOW_QUALITY_STATS;
        qualityCheck.id = qualityId;
        qualityLabel.htmlFor = qualityId;
        qualityLabel.innerText = 'Show quality stats';
        GoogMoreBox.wrap('p', [qualityCheck, qualityLabel], moreBox, ['flex-center']);
        qualityCheck.onchange = () => {
            player.setShowQualityStats(qualityCheck.checked);
        };

        const audioId = `enable_audio_${udid}_${playerName}_${displayId}`;
        const audioLabel = document.createElement('label');
        const audioCheck = document.createElement('input');
        audioCheck.type = 'checkbox';
        audioCheck.checked = false;
        audioCheck.id = audioId;
        audioLabel.htmlFor = audioId;
        audioCheck.dataset.persistSkipRestore = 'true';

        GoogMoreBox.wrap('p', [audioCheck, audioLabel], moreBox, ['flex-center']);

        if (ScrcpyAudioController.isSupported()) {
            audioLabel.innerText = 'Audio';
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
            GoogMoreBox.wrap('div', [modeLabel, modeSelect], moreBox);

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
            GoogMoreBox.wrap('div', [channelsLabel, channelsSelect], moreBox);

            const bitrateLabel = document.createElement('label');
            bitrateLabel.innerText = 'Bitrate:';
            const bitrateInput = document.createElement('input');
            bitrateInput.type = 'number';
            bitrateInput.min = '16000';
            bitrateInput.step = '1000';
            bitrateInput.value = String(currentAudio.bitrate || 64_000);
            bitrateInput.id = `audio_bitrate_${udid}_${playerName}_${displayId}`;
            bitrateLabel.htmlFor = bitrateInput.id;
            GoogMoreBox.wrap('div', [bitrateLabel, bitrateInput], moreBox);

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
            GoogMoreBox.wrap('p', [applyAudioBtn], moreBox);
        } else {
            audioLabel.innerText = 'Audio (unsupported)';
            audioCheck.disabled = true;
        }

        const stop = (ev?: string | Event) => {
            if (ev && ev instanceof Event && ev.type === 'error') {
                console.error(TAG, ev);
            }
            stopScreenPowerModeInterval();
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
