import { ACTION } from '../common/Action';
import { ParamsStream } from './ParamsStream';
import VideoSettings from '../app/VideoSettings';

export interface ParamsStreamWebRTC extends ParamsStream {
    action: ACTION.STREAM_WEBRTC;
    ws: string;
    fitToScreen?: boolean;
    videoSettings?: VideoSettings;
}
