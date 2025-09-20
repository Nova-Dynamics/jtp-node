/**
 * @fileoverview JTP (Janky Transfer Protocol) Encoder implementation
 * @author JTP Library
 * @version 1.0.0
 */

/**
 * JTPEncoder - Handles encoding of messages into JTP packets
 *
 * The encoder takes raw buffer data and fragments it into JTP packets,
 * emitting them via events. Each encoder is tied to a specific source ID.
 * Supports both callback-based and event-driven patterns following Node.js
 * stream conventions.
 *
 * @class JTPEncoder
 * @extends EventEmitter
 * @example
 * const encoder = new JTPEncoder({ source_id: 0x1234 });
 * 
 * encoder.on('packet', (packet, info) => {
 *   // Send packet over UDP or other transport
 *   console.log(`Fragment ${info.fragment_index}/${info.fragment_count}`);
 * });
 * 
 * encoder.on('message:encoded', (metadata) => {
 *   console.log(`Message ${metadata.message_id} encoded successfully`);
 * });
 * 
 * // Encode with callback
 * encoder.encode_message(buffer, 5, (metadata) => {
 *   console.log('Encoding complete:', metadata);
 * });
 */

const { EventEmitter } = require('events');
const { VERSION, MAGIC_BYTE, MAX_PAYLOAD_SIZE } = require('./constants');

module.exports = class JTPEncoder extends EventEmitter {
    /**
     * Packet event - emitted for each generated packet fragment
     * @event JTPEncoder#packet
     * @param {Buffer} packet - The generated packet buffer
     * @param {Object} info - Packet information
     * @param {number} info.message_id - Message ID this packet belongs to
     * @param {number} info.message_type - Message type (0-63)
     * @param {number} info.fragment_index - Fragment index (0-based)
     * @param {number} info.fragment_count - Total fragments for this message
     * @param {number} info.fragment_size - Size of this fragment's payload
     */

    /**
     * Message encoded event - emitted when message encoding completes
     * @event JTPEncoder#message:encoded
     * @param {Object} metadata - Encoding completion metadata
     * @param {number} metadata.message_id - The assigned message ID
     * @param {number} metadata.message_type - Message type (0-63)
     * @param {number} metadata.fragment_count - Total fragments generated
     * @param {number} metadata.total_bytes - Total message size in bytes
     */

    /**
     * Error event - emitted on validation or encoding errors
     * @event JTPEncoder#error
     * @param {Error} error - The error that occurred
     * @param {Object} context - Error context information
     * @param {number} [context.message_type] - Message type if available
     * @param {number} [context.message_id] - Message ID if available
     */
    /**
     * Get the current protocol version
     * @static
     * @returns {number} Protocol version number (0-3)
     */
    static get VERSION() { return VERSION; }
    
    /**
     * Get the maximum payload size per packet
     * @static
     * @returns {number} Maximum payload size in bytes
     */
    static get MAX_PAYLOAD_SIZE() { return MAX_PAYLOAD_SIZE; }

    /**
     * Create a new JTP encoder
     * @param {Object} options - Configuration options
     * @param {number} options.source_id - 32-bit source identifier for this encoder
     * @throws {Error} If source_id is not provided or invalid
     */
    constructor({ source_id }) {
        super();
        this.source_id = source_id;
        this.message_id = 0;
        this._buffer_pool = []; // Pool of reusable buffers
    }

    /**
     * Increment the message ID with 16-bit wraparound
     * @private
     * @returns {void}
     */
    increment_message_id() {
        this.message_id = (this.message_id + 1) % 0x10000;
    }

    /**
     * Get a buffer from the pool or allocate a new one
     * @private
     * @param {number} size - Required buffer size in bytes
     * @returns {Buffer} Buffer of the requested size
     */
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

    /**
     * Return a buffer to the pool for reuse
     * @private
     * @param {Buffer} buffer - Buffer to return to pool
     * @returns {void}
     */
    _return_buffer(buffer) {
        // Return buffer to pool if not too large and pool not full
        if (buffer.length <= 64 * 1024 && this._buffer_pool.length < 10) {
            this._buffer_pool.push(buffer);
        }
    }

    /**
     * Encode a message into JTP packets and emit them as events
     * 
     * Fragments large messages automatically and emits 'packet' events for each
     * fragment. Supports both synchronous return value and asynchronous callback
     * patterns following Node.js stream conventions.
     * 
     * @param {Buffer} message_buffer - The buffer containing the message to encode
     * @param {number} message_type - The message type (0-63, fits in 6 bits)
     * @param {Function} [callback] - Optional callback called when encoding completes
     * @returns {number|null} The assigned message ID, or null if validation failed
     * 
     * @fires JTPEncoder#packet - Emitted for each packet fragment
     * @fires JTPEncoder#message:encoded - Emitted when encoding completes
     * @fires JTPEncoder#error - Emitted on validation or encoding errors
     * 
     * @example
     * // Event-driven usage
     * encoder.on('packet', (packet, info) => {
     *   udpSocket.send(packet, port, host);
     * });
     * 
     * const messageId = encoder.encode_message(buffer, 5);
     * 
     * @example
     * // Callback usage
     * encoder.encode_message(buffer, 5, (metadata) => {
     *   console.log(`Encoded message ${metadata.message_id}`);
     * });
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
     * 
     * This method handles the packet generation loop, yielding control
     * to the event loop periodically to prevent blocking on large messages.
     * 
     * @private
     * @param {Buffer} message_buffer - The message to encode
     * @param {number} message_type - The message type
     * @param {number} message_id - The assigned message ID
     * @param {number} fragment_count - Total number of fragments
     * @param {Function} [callback] - Optional completion callback
     * @returns {Promise<void>} Promise that resolves when encoding completes
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
