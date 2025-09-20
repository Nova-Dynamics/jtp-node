/**
 * JTPEncoder - Handles encoding of messages into JTP packets
 *
 * The encoder takes raw buffer data and emits packets via events.
 * Each encoder is tied to a specific source ID.
 */

const { EventEmitter } = require('events');
const { VERSION, MAGIC_BYTE, MAX_PAYLOAD_SIZE } = require('./constants');

module.exports = class JTPEncoder extends EventEmitter {
    static get VERSION() { return VERSION; }
    static get MAX_PAYLOAD_SIZE() { return MAX_PAYLOAD_SIZE; }

    constructor({ source_id }) {
        super();
        this.source_id = source_id;
        this.message_id = 0;
        this._buffer_pool = []; // Pool of reusable buffers
    }

    increment_message_id() {
        this.message_id = (this.message_id + 1) % 0x10000;
    }

    _get_buffer(size) {
        // Simple buffer pool to reduce allocations
        for (let i = 0; i < this._buffer_pool.length; i++) {
            if (this._buffer_pool[i].length >= size) {
                const buffer = this._buffer_pool.splice(i, 1)[0];
                return size === buffer.length ? buffer : buffer.subarray(0, size);
            }
        }
        return Buffer.allocUnsafe(size);
    }

    _return_buffer(buffer) {
        // Return buffer to pool if not too large and pool not full
        if (buffer.length <= 64 * 1024 && this._buffer_pool.length < 10) {
            this._buffer_pool.push(buffer);
        }
    }

    /**
     * Encodes a message into JTP packets and emits them as events
     * @param {Buffer} message_buffer - The buffer containing the message to encode
     * @param {number} message_type - The message type (0-63)
     * @param {Function} callback - Optional callback called when encoding is complete
     * @returns {number} message_id - The ID assigned to this message
     */
    encode_message(message_buffer, message_type, callback) {
        // Validate message type fits in 6 bits (0-63)
        if (message_type < 0 || message_type > 63) {
            const error = new Error(`Message type must be 0-63, got ${message_type}`);
            setImmediate(() => this.emit('error', error, { message_type }));
            return null;
        }

        if (!Buffer.isBuffer(message_buffer)) {
            const error = new Error("message_buffer must be a Buffer");
            setImmediate(() => this.emit('error', error, { message_type }));
            return null;
        }

        const message_length = message_buffer.length;
        const fragment_count = Math.max(1, Math.ceil(message_length / MAX_PAYLOAD_SIZE));

        if (fragment_count > 0xFFFF) {
            const error = new Error("Message too large to fragment within 65535 fragments");
            setImmediate(() => this.emit('error', error, { message_type, message_length }));
            return null;
        }

        const message_id = this.message_id;
        this.increment_message_id();

        // Start encoding asynchronously
        setImmediate(() => {
            this._encode_message_async(message_buffer, message_type, message_id, fragment_count, callback);
        });

        return message_id;
    }

    /**
     * Internal async method that performs the actual encoding
     * @private
     */
    async _encode_message_async(message_buffer, message_type, message_id, fragment_count, callback) {
        try {
            const message_length = message_buffer.length;
            
            for (let fragment_index = 0; fragment_index < fragment_count; fragment_index++) {
                const frag_start = fragment_index * MAX_PAYLOAD_SIZE;
                const frag_end = Math.min(frag_start + MAX_PAYLOAD_SIZE, message_length);
                const frag_payload_length = frag_end - frag_start;
                const header_length = 12;
                const packet_buffer = this._get_buffer(header_length + frag_payload_length);

                // Header fields
                const version_and_type = (VERSION << 6) | (message_type & 0x3F);
                packet_buffer.writeUInt8(MAGIC_BYTE, 0); // Magic byte "J"
                packet_buffer.writeUInt8(version_and_type, 1); // Version + Message type
                packet_buffer.writeUInt16LE(message_id, 2); // Message ID
                packet_buffer.writeUInt16LE(fragment_index, 4); // Fragment Index
                packet_buffer.writeUInt16LE(fragment_count, 6); // Fragment Count
                packet_buffer.writeUInt32LE(this.source_id, 8); // Source ID

                // Copy fragment payload
                message_buffer.copy(packet_buffer, header_length, frag_start, frag_end);

                // Emit packet event
                this.emit('packet', packet_buffer, {
                    message_id,
                    message_type,
                    fragment_index,
                    fragment_count,
                    fragment_size: frag_payload_length
                });

                // Yield control to event loop every 10 fragments or if large fragment count
                if (fragment_index % 10 === 9 || fragment_count > 100) {
                    await new Promise(resolve => setImmediate(resolve));
                }
            }

            // Emit completion event
            const completion_metadata = {
                message_id,
                message_type,
                fragment_count,
                total_bytes: message_length
            };

            this.emit('message:encoded', completion_metadata);
            
            if (callback) {
                callback(completion_metadata);
            }

        } catch (error) {
            this.emit('error', error, { message_id, message_type });
        }
    }
};
