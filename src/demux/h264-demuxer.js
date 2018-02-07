/*
 * Copyright (C) 2018 landerlyoung@gmail.com. All Rights Reserved.
 *
 * @author landerlyoung@gmail.com
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

class H264Demuxer {

    constructor(probeData, config) {
        this.TAG = 'H264Demuxer';
    }

    static probe(buffer) {
        // let data = new Uint8Array(buffer);
        // let mismatch = {match: false};
        //
        // if (data[0] !== 0x46 || data[1] !== 0x4C || data[2] !== 0x56 || data[3] !== 0x01) {
        //     return mismatch;
        // }
        //
        // let hasAudio = ((data[4] & 4) >>> 2) !== 0;
        // let hasVideo = (data[4] & 1) !== 0;
        //
        // let offset = ReadBig32(data, 5);
        //
        // if (offset < 9) {
        //     return mismatch;
        // }
        //
        // return {
        //     match: true,
        //     consumed: offset,
        //     dataOffset: offset,
        //     hasAudioTrack: hasAudio,
        //     hasVideoTrack: hasVideo
        // };
    }

}

export default H264Demuxer;