/**
 * JTPEncoder - Handles packetization of data into JTP packets
 *
 * The encoder takes raw buffer data and fragments it into JTP packets
 * that can be sent over UDP. Each encoder is tied to a specific SSRC.
 */

const { VERSION, MAGIC_BYTE, MAX_PAYLOAD_SIZE } = require('./constants');

module.exports = class JTPEncoder {
    static get VERSION() { return VERSION; }
    static get MAX_PAYLOAD_SIZE() { return MAX_PAYLOAD_SIZE; }

    constructor(ssrc) {
        this.ssrc = ssrc;
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
     * Asynchronous generator that yields UDP packets for a (possibly large) data buffer.
     * Uses setImmediate to yield control back to the event loop between packets.
     * @param {Buffer} payload_buffer - The buffer containing the data to send
     * @param {number} packet_type - The packet type (0-63)
     * @returns {AsyncGenerator<Buffer>}
     */
    async *packetize(payload_buffer, packet_type) {
        // Validate packet type fits in 6 bits (0-63)
        if (packet_type < 0 || packet_type > 63) {
            throw new Error(`Packet type must be 0-63, got ${packet_type}`);
        }

        if (!Buffer.isBuffer(payload_buffer)) {
            throw new Error("payload_buffer must be a Buffer");
        }

        const full_payload_length = payload_buffer.length;

        // Fragmentation
        const fragment_count = Math.ceil(full_payload_length / MAX_PAYLOAD_SIZE);

        if (fragment_count > 0xFFFF) {
            throw new Error("Data too large to fragment within 65535 fragments");
        }

        const message_id = this.message_id;
        this.increment_message_id();

        for (let fragment_index = 0; fragment_index < fragment_count; fragment_index++) {
            const frag_start = fragment_index * MAX_PAYLOAD_SIZE;
            const frag_end = Math.min(frag_start + MAX_PAYLOAD_SIZE, full_payload_length);
            const frag_payload_length = frag_end - frag_start;
            const header_length = 12;
            const buffer = this._get_buffer(header_length + frag_payload_length);

            // Header fields
            const version_and_type = (VERSION << 6) | (packet_type & 0x3F); // 2 bits version + 6 bits packet type
            buffer.writeUInt8(MAGIC_BYTE, 0); // Magic byte "J"
            buffer.writeUInt8(version_and_type, 1); // Version + Packet type
            buffer.writeUInt16LE(message_id, 2); // Message ID (2 bytes)
            buffer.writeUInt16LE(fragment_index, 4); // Fragment Index
            buffer.writeUInt16LE(fragment_count, 6); // Fragment Count
            buffer.writeUInt32LE(this.ssrc, 8); // SSRC (4 bytes)

            // Copy fragment payload
            payload_buffer.copy(buffer, header_length, frag_start, frag_end);

            yield buffer;

            // Yield control to event loop every 10 fragments or if this is a large fragment count
            if (fragment_index % 10 === 9 || fragment_count > 100) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
    }

    /**
     * Synchronous packetize that collects all packets into an array without blocking
     * Useful when you need all packets at once but don't want to block the event loop
     * @param {Buffer} payload_buffer - The buffer containing the data to send
     * @param {number} packet_type - The packet type (0-63)
     * @returns {Promise<Buffer[]>} Array of packet buffers
     */
    async packetize_all(payload_buffer, packet_type) {
        const packets = [];
        for await (const packet of this.packetize(payload_buffer, packet_type)) {
            packets.push(packet);
        }
        return packets;
    }
};
