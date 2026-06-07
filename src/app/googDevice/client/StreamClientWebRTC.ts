import { ACTION } from '../../../common/Action';
import Util from '../../Util';
import { StreamClientScrcpy } from './StreamClientScrcpy';
import { ParamsStreamWebRTC } from '../../../types/ParamsStreamWebRTC';
import { ParamsStreamScrcpy } from '../../../types/ParamsStreamScrcpy';
import { StreamReceiverScrcpyWebRTC } from './StreamReceiverScrcpyWebRTC';

export class StreamClientWebRTC {
    public static ACTION = ACTION.STREAM_WEBRTC;

    public static parseParameters(params: URLSearchParams): ParamsStreamWebRTC {
        return {
            action: ACTION.STREAM_WEBRTC,
            player: Util.parseString(params, 'player', true),
            udid: Util.parseString(params, 'udid', true),
            ws: Util.parseString(params, 'ws', true),
            useProxy: Util.parseBooleanEnv(params.get('useProxy')),
            secure: Util.parseBooleanEnv(params.get('secure')),
            hostname: Util.parseStringEnv(params.get('hostname')),
            port: Util.parseIntEnv(params.get('port')),
        };
    }

    public static start(query: URLSearchParams | ParamsStreamWebRTC): StreamClientScrcpy {
        const params = query instanceof URLSearchParams ? this.parseParameters(query) : query;
        const receiverParams: ParamsStreamScrcpy = {
            ...params,
            action: ACTION.STREAM_SCRCPY,
        };
        const receiver = new StreamReceiverScrcpyWebRTC(receiverParams);
        return StreamClientScrcpy.start(receiverParams, receiver);
    }
}
