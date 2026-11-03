import { CONNECT_ADB_DEVICE } from '../../../common/AdbNetwork';
import WS from 'ws';
import { Mw, RequestParameters } from '../../mw/Mw';
import { ControlCenterCommand } from '../../../common/ControlCenterCommand';
import { ControlCenter } from '../services/ControlCenter';
import { ACTION } from '../../../common/Action';
import GoogDeviceDescriptor from '../../../types/GoogDeviceDescriptor';
import { DeviceTrackerEvent } from '../../../types/DeviceTrackerEvent';
import { DeviceTrackerEventList } from '../../../types/DeviceTrackerEventList';
import { Multiplexer } from '../../../packages/multiplexer/Multiplexer';
import { ChannelCode } from '../../../common/ChannelCode';

export class DeviceTracker extends Mw {
    public static readonly TAG = 'DeviceTracker';
    public static readonly type = 'android';
    private adt: ControlCenter = ControlCenter.getInstance();
    private readonly id: string;

    public static processChannel(ws: Multiplexer, code: string): Mw | undefined {
        if (code !== ChannelCode.GTRC) {
            return;
        }
        return new DeviceTracker(ws);
    }

    public static processRequest(ws: WS, params: RequestParameters): DeviceTracker | undefined {
        if (params.action !== ACTION.GOOG_DEVICE_LIST) {
            return;
        }
        return new DeviceTracker(ws);
    }

    constructor(ws: WS | Multiplexer) {
        super(ws);

        this.id = this.adt.getId();
        this.adt
            .init()
            .then(() => {
                this.adt.on('device', this.sendDeviceMessage);
                this.buildAndSendMessage(this.adt.getDevices());
            })
            .catch((error: Error) => {
                console.error(`[${DeviceTracker.TAG}] Error: ${error.message}`);
            });
    }

    private sendDeviceMessage = (device: GoogDeviceDescriptor): void => {
        const data: DeviceTrackerEvent<GoogDeviceDescriptor> = {
            device,
            id: this.id,
            name: this.adt.getName(),
        };
        this.sendMessage({
            id: -1,
            type: 'device',
            data,
        });
    };

    private buildAndSendMessage = (list: GoogDeviceDescriptor[]): void => {
        const data: DeviceTrackerEventList<GoogDeviceDescriptor> = {
            list,
            id: this.id,
            name: this.adt.getName(),
        };
        this.sendMessage({
            id: -1,
            type: 'devicelist',
            data,
        });
    };

    protected onSocketMessage(event: WS.MessageEvent): void {
        let command: ControlCenterCommand;
        let requestId = -1;
        let isConnect = false;
        try {
            const body = JSON.parse(event.data.toString());
            requestId = body.id;
            isConnect = body.type === CONNECT_ADB_DEVICE;
            command = ControlCenterCommand.fromJSON(event.data.toString());
        } catch (error: any) {
            if (isConnect) {
                this.sendMessage({
                    id: requestId,
                    type: CONNECT_ADB_DEVICE,
                    data: { success: false, message: error.message },
                });
                return;
            }
            console.error(`[${DeviceTracker.TAG}], Received message: ${event.data}. Error: ${error?.message}`);
            return;
        }
        if (isConnect) {
            const { host, port } = command.getData();
            this.adt.connectNetworkDevice(host, port).then(
                (serial) =>
                    this.sendMessage({
                        id: requestId,
                        type: CONNECT_ADB_DEVICE,
                        data: { success: true, message: `Устройство ${serial} подключено.` },
                    }),
                (error: Error) =>
                    this.sendMessage({
                        id: requestId,
                        type: CONNECT_ADB_DEVICE,
                        data: { success: false, message: error.message },
                    }),
            );
            return;
        }
        this.adt.runCommand(command).catch((e) => {
            console.error(`[${DeviceTracker.TAG}], Received message: ${event.data}. Error: ${e.message}`);
        });
    }

    public release(): void {
        super.release();
        this.adt.off('device', this.sendDeviceMessage);
    }
}
