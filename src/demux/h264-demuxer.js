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
import SPSParser from './sps-parser';
import Log from '../utils/logger';
import DemuxErrors from './demux-errors';

/**
 * https://yumichan.net/video-processing/video-compression/introduction-to-h264-nal-unit/
 */
class H264Const {
    static init() {
        // nal unit type
        // 5bits, 7.3.1 NAL unit syntax,
        // H.264-AVC-ISO_IEC_14496-10.pdf, page 44.
        // 7: SPS, 8: PPS, 5: I Frame, 1: P Frame
        this.NAL_UNIT_TYPE_SPS = 7;
        this.NAL_UNIT_TYPE_PPS = 8;
        this.NAL_UNIT_TYPE_I_FRAME = 5;
        this.NAL_UNIT_TYPE_P_FRAME = 1;
    }

    static getNalUnitType(data, offset) {
        // lower 5bits
        if (offset < 0 || offset >= data.length) {
            return -1;
        }
        return (data[offset] & 0x1F);
    }

    /**
     * @param data
     * @param offset
     * @param length
     * @returns {number}
     */
    static nextNalUnit(data, offset, length) {
        // NAL delimiter
        // 00 00 00 01 [x]
        for (let i = offset + 4; i < length; i++) {
            if (data[i - 1] === 1 &&
                data[i - 2] === 0 &&
                data[i - 3] === 0 &&
                data[i - 4] === 0) {
                return i;
            }
        }
        return -1;
    }
}

H264Const.init();

// debug info
function buf2hex(buffer) { // buffer is an ArrayBuffer
    return Array.prototype.map.call(new Uint8Array(buffer), x => ('00' + x.toString(16)).slice(-2)).join(' ');
}

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

        this._referenceFrameRate = {
            fixed: true,
            fps: 23.976,
            fps_num: 23976,
            fps_den: 1000
        };
        this._accolumatedFrames = 0;

        this._initMetaWithSpsPps(probeData.sps, probeData.pps);
    }

    _initMetaWithSpsPps(sps, pps) {
        let config = this._combineSpsPps2AVCDecoderConfigurationRecord(sps, pps);

        this._parseAVCDecoderConfigurationRecord(config, 0, config.byteLength);
    }

    /**
     * 第一个视频Tag，需要写入AVC视频流的configuretion信息，这个信息根据pps、sps生成
     * 8 bit configuration version ------ 版本号
     * 8 bit AVC Profile Indication ------- sps[1]
     * 8 bit Profile Compatibility ------- sps[2]
     * 8 bit AVC Level Compatibility ------- sps[3]
     * 6 bit Reserved ------- 111111
     * 2 bit Length Size Minus One ------- NAL Unit Length长度为－1，一般为3
     * 3 bit Reserved ------- 111
     * 5 bit Num of Sequence Parameter Sets ------- sps个数，一般为1
     * ? bit Sequence Parameter Set NAL Units ------- （sps_size + sps）的数组
     * 8 bit Num of Picture Parameter Sets ------- pps个数，一般为1
     * ? bit Picture Parameter Set NAL Units ------- （pps_size + pps）的数组
     * @param sps
     * @param pps
     * @returns {ArrayBuffer}
     */
    _combineSpsPps2AVCDecoderConfigurationRecord(sps, pps) {
        let length = (8 + sps.length) + (3 + pps.length);
        let data = new ArrayBuffer(length);
        let v = new DataView(data);
        let off = 0;

        v.setUint8(off++, 0x01);
        v.setUint8(off++, sps[1]);
        v.setUint8(off++, sps[2]);
        v.setUint8(off++, sps[3]);
        v.setUint8(off++, 0xff);

        v.setUint8(off++, 0xe1);
        v.setUint16(off, sps.length, !this._littleEndian);
        off += 2;
        for (let i = 0; i < sps.length; i++) {
            v.setUint8(off++, sps[i]);
        }

        v.setUint8(off++, 0x01);
        v.setUint16(off, pps.length, !this._littleEndian);
        off += 2;
        for (let i = 0; i < pps.length; i++) {
            v.setUint8(off++, pps[i]);
        }

        return data;
    }

    static probe(buffer) {
        // initial SPS PPS frame
        let data = new Uint8Array(buffer);
        let mismatch = {match: false};

        let spsStart = H264Const.nextNalUnit(data, 0, data.length);
        let spsType = H264Const.getNalUnitType(data, spsStart);

        if (spsType !== H264Const.NAL_UNIT_TYPE_SPS) {
            return mismatch;
        }

        let ppsStart = H264Const.nextNalUnit(data, spsStart, data.length);
        let ppsType = H264Const.getNalUnitType(data, ppsStart);

        if (ppsType !== H264Const.NAL_UNIT_TYPE_PPS) {
            return mismatch;
        }

        let spsEnd = ppsStart - 4;
        let sps = new Uint8Array(buffer, spsStart, spsEnd - spsStart);

        let nextOne = H264Const.nextNalUnit(data, ppsStart, data.length);
        let ppsEnd = nextOne !== -1 ? nextOne - 4 : data.length;

        let pps = new Uint8Array(buffer, ppsStart, ppsEnd - ppsStart);

        return {
            match: true,
            offset: ppsEnd,
            sps: sps,
            pps: pps,
        };
    }

    // function parseChunks(chunk: ArrayBuffer, byteStart: number): number;
    // override
    parseChunks(chunk, byteStart) {
        this._callbackVideoMetaIfNeed();

        let offset = this._parseH264Frames(chunk, byteStart);

        // dispatch parsed frames to consumer (typically, the remuxer)
        if (this._isInitialMetadataDispatched()) {
            if (this._dispatch && (this._audioTrack.length || this._videoTrack.length)) {
                console.log('_onDataAvailable videos:' + this._videoTrack.length + ' callback:' + this._onDataAvailable);
                this._onDataAvailable(this._audioTrack, this._videoTrack);
            }
        }

        console.log('parseChunks len:' + chunk.byteLength + ' start:' + byteStart + ' offset: ' + offset);

        return offset;  // consumed bytes, just equals latest offset index
    }

    _parseH264Frames(chunk, byteStart) {
        const data = new Uint8Array(chunk);

        let isKeyFrame = false;
        let offset = 0;
        let units = [];
        let length = 0;
        while (offset < data.length) {
            let naluStart = H264Const.nextNalUnit(data, offset, data.length);
            if (naluStart === -1) {
                offset = data.length;
                break;
            }
            let type = H264Const.getNalUnitType(data, naluStart);

            if (type === H264Const.NAL_UNIT_TYPE_I_FRAME) {
                isKeyFrame = true;
            }

            offset = naluStart;
            let nextOne = H264Const.nextNalUnit(data, offset, data.length);

            let naluEnd = nextOne !== -1 ? nextOne - 4 : data.length;

            let frameData = new Uint8Array(chunk, offset, naluEnd - naluStart);
            let unit = {
                type: type,
                data: frameData
            };
            units.push(unit);
            length += frameData.byteLength;

            // optimize speed!
            if (nextOne !== -1) {
                offset = nextOne - 4;
            } else {
                offset = data.length;
            }
        }

        if (units.length) {
            this._accolumatedFrames++;
            let frameInterval = 1000 / this._videoMetadata.frameRate.fps;

            let dts = this._accolumatedFrames * frameInterval;
            let cts = dts;

            let track = this._videoTrack;
            let avcSample = {
                units: units,
                length: length,
                isKeyframe: isKeyFrame,
                dts: dts,
                cts: cts,
                pts: (dts + cts)
            };

            if (isKeyFrame) {
                avcSample.fileposition = byteStart + offset;
            }

            track.samples.push(avcSample);
            track.length += length;
        }

        this._dispatch = byteStart !== offset;
        return offset;
    }

    // same as flv-demuxer
    _parseAVCDecoderConfigurationRecord(arrayBuffer, dataOffset, dataSize) {
        if (dataSize < 7) {
            Log.w(this.TAG, this.TAG + ': Invalid AVCDecoderConfigurationRecord, lack of data!');
            return;
        }

        let meta = this._videoMetadata;
        let track = this._videoTrack;
        let le = this._littleEndian;
        let v = new DataView(arrayBuffer, dataOffset, dataSize);

        if (!meta) {
            this._hasVideo = true;
            this._mediaInfo.hasVideo = true;

            meta = this._videoMetadata = {};
            meta.type = 'video';
            meta.id = track.id;
            meta.timescale = this._timescale;
            meta.duration = this._duration;
        } else {
            if (typeof meta.avcc !== 'undefined') {
                Log.w(this.TAG, 'Found another AVCDecoderConfigurationRecord!');
            }
        }

        let version = v.getUint8(0);  // configurationVersion
        let avcProfile = v.getUint8(1);  // avcProfileIndication
        let profileCompatibility = v.getUint8(2);  // profile_compatibility
        let avcLevel = v.getUint8(3);  // AVCLevelIndication

        if (version !== 1 || avcProfile === 0) {
            this._onError(DemuxErrors.FORMAT_ERROR, this.TAG + ': Invalid AVCDecoderConfigurationRecord');
            return;
        }

        this._naluLengthSize = (v.getUint8(4) & 3) + 1;  // lengthSizeMinusOne
        if (this._naluLengthSize !== 3 && this._naluLengthSize !== 4) {  // holy shit!!!
            this._onError(DemuxErrors.FORMAT_ERROR, this.TAG + `: Strange NaluLengthSizeMinusOne: ${this._naluLengthSize - 1}`);
            return;
        }

        let spsCount = v.getUint8(5) & 0x1F;  // numOfSequenceParameterSets
        if (spsCount === 0) {
            this._onError(DemuxErrors.FORMAT_ERROR, this.TAG + ': Invalid AVCDecoderConfigurationRecord: No SPS');
            return;
        } else if (spsCount > 1) {
            Log.w(this.TAG, this.TAG + `: Strange AVCDecoderConfigurationRecord: SPS Count = ${spsCount}`);
        }

        let offset = 6;

        for (let i = 0; i < spsCount; i++) {
            let len = v.getUint16(offset, !le);  // sequenceParameterSetLength
            offset += 2;

            if (len === 0) {
                continue;
            }

            // Notice: Nalu without startcode header (00 00 00 01)
            let sps = new Uint8Array(arrayBuffer, dataOffset + offset, len);
            offset += len;

            let config = SPSParser.parseSPS(sps);
            if (i !== 0) {
                // ignore other sps's config
                continue;
            }

            meta.codecWidth = config.codec_size.width;
            meta.codecHeight = config.codec_size.height;
            meta.presentWidth = config.present_size.width;
            meta.presentHeight = config.present_size.height;

            meta.profile = config.profile_string;
            meta.level = config.level_string;
            meta.bitDepth = config.bit_depth;
            meta.chromaFormat = config.chroma_format;
            meta.sarRatio = config.sar_ratio;
            meta.frameRate = config.frame_rate;

            if (config.frame_rate.fixed === false ||
                config.frame_rate.fps_num === 0 ||
                config.frame_rate.fps_den === 0) {
                meta.frameRate = this._referenceFrameRate;
            }

            let fps_den = meta.frameRate.fps_den;
            let fps_num = meta.frameRate.fps_num;
            meta.refSampleDuration = meta.timescale * (fps_den / fps_num);

            let codecArray = sps.subarray(1, 4);
            let codecString = 'avc1.';
            for (let j = 0; j < 3; j++) {
                let h = codecArray[j].toString(16);
                if (h.length < 2) {
                    h = '0' + h;
                }
                codecString += h;
            }
            meta.codec = codecString;

            let mi = this._mediaInfo;

            mi.width = meta.codecWidth;
            mi.height = meta.codecHeight;
            mi.fps = meta.frameRate.fps;
            mi.profile = meta.profile;
            mi.level = meta.level;
            mi.refFrames = config.ref_frames;
            mi.chromaFormat = config.chroma_format_string;
            mi.sarNum = meta.sarRatio.width;
            mi.sarDen = meta.sarRatio.height;
            mi.videoCodec = codecString;
            mi.mimeType = 'video/x-flv; codecs="' + mi.videoCodec + '"';
        }

        let ppsCount = v.getUint8(offset);  // numOfPictureParameterSets
        if (ppsCount === 0) {
            this._onError(DemuxErrors.FORMAT_ERROR, this.TAG + ': Invalid AVCDecoderConfigurationRecord: No PPS');
            return;
        } else if (ppsCount > 1) {
            Log.w(this.TAG, this.TAG + `: Strange AVCDecoderConfigurationRecord: PPS Count = ${ppsCount}`);
        }

        offset++;

        for (let i = 0; i < ppsCount; i++) {
            let len = v.getUint16(offset, !le);  // pictureParameterSetLength
            offset += 2;

            if (len === 0) {
                continue;
            }

            // pps is useless for extracting video information
            offset += len;
        }

        meta.avcc = new Uint8Array(dataSize);
        meta.avcc.set(new Uint8Array(arrayBuffer, dataOffset, dataSize), 0);
        Log.v(this.TAG, 'Parsed AVCDecoderConfigurationRecord');

        this._needCallbackMetaData = true;
    }

    _callbackVideoMetaIfNeed() {
        if (!this._needCallbackMetaData) {
            return;
        }

        this._needCallbackMetaData = false;

        let mi = this._mediaInfo;
        let meta = this._videoMetadata;

        if (mi.isComplete()) {
            this._onMediaInfo(mi);
        }

        if (this._isInitialMetadataDispatched()) {
            // flush parsed frames
            if (this._dispatch && (this._audioTrack.length || this._videoTrack.length)) {
                this._onDataAvailable(this._audioTrack, this._videoTrack);
            }
        } else {
            this._videoInitialMetadataDispatched = true;
        }

        // notify new metadata
        this._dispatch = false;
        this._onTrackMetadata('video', meta);
    }
}

export default H264Demuxer;