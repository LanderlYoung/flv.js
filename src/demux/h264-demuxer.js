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

import Demuxer from './demuxer';

class H264Demuxer extends Demuxer {

    constructor(probeData, config) {
        super();

        this.TAG = 'H264Demuxer';

        this._config = config;

        this._dataOffset = probeData.dataOffset;
        this._firstParse = true;
        this._dispatch = false;

        this._hasAudio = probeData.hasAudioTrack;
        this._hasVideo = probeData.hasVideoTrack;
    }

    static probe(buffer) {
        let data = new Uint8Array(buffer);
        let mismatch = {match: false};

        if (data[0] !== 0x46 || data[1] !== 0x4C || data[2] !== 0x56 || data[3] !== 0x01) {
            return mismatch;
        }

        let hasVideo = (data[4] & 1) !== 0;

        let offset = Demuxer.ReadBig32(data, 5);

        if (offset < 9) {
            return mismatch;
        }

        return {
            match: true,
            consumed: offset,
            dataOffset: offset,
            hasAudioTrack: false,
            hasVideoTrack: true
        };
    }

    // function parseChunks(chunk: ArrayBuffer, byteStart: number): number;
    // override
    parseChunks(chunk, byteStart) {

    }

}

export default H264Demuxer;