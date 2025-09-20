/**
 * @fileoverview JTP (Janky Transfer Protocol) Decoder implementation
 * @author JTP Library
 * @version 1.0.0
 */

/**
 * JTPDecoder - Handles decoding of JTP packets into messages
 *
 * The decoder listens for packets from a specific source and optionally
 * filters for specific message types. It handles fragmentation reassembly
 * and emits complete messages when received. Supports event-driven architecture
 * for reactive programming patterns.
 *
 * @class JTPDecoder
 * @extends EventEmitter
 * @example
 * const decoder = new JTPDecoder({ 
 *   source_id: 0x1234,
 *   message_types: [1, 5, 10] // Optional filter
 * });
 * 
 * decoder.on('message', (buffer, messageType, metadata) => {
 *   console.log(`Received message type ${messageType}:`, buffer);
 * });
 * 
 * decoder.on('fragment:received', (info) => {
 *   console.log(`Fragment ${info.fragment_index}/${info.fragment_count}`);
 * });
 * 
 * // Process incoming packets
 * udpSocket.on('message', (packet) => {
 *   decoder.decode_packet(packet);
 * });
 */

const { EventEmitter } = require("events");

/**
 * JTPDecoder - Handles decoding of JTP packets into messages
 *
 * The decoder listens for packets from a specific source and optionally
 * filters for specific message types. It handles fragmentation reassembly
 * and emits complete messages when received.
 */

const { VERSION, MAGIC_BYTE, MAX_PAYLOAD_SIZE } = require('./constants');

module.exports = class JTPDecoder extends EventEmitter {
    /**
     * Message event - emitted when a complete message is reassembled
     * @event JTPDecoder#message
     * @param {Buffer} message_buffer - The complete reassembled message
     * @param {number} message_type - Message type (0-63)
     * @param {Object} metadata - Message metadata
     * @param {number} metadata.message_id - Message ID
     * @param {number} metadata.fragment_count - Number of fragments
     * @param {number} metadata.total_bytes - Total message size
     */

    /**
     * Message start event - emitted when first fragment of new message arrives
     * @event JTPDecoder#message:start
     * @param {Object} info - Message start information
     * @param {number} info.message_type - Message type
     * @param {number} info.message_id - Message ID
     * @param {number} info.fragment_count - Expected fragment count
     */

    /**
     * Fragment received event - emitted for each accepted fragment
     * @event JTPDecoder#fragment:received
     * @param {Object} info - Fragment information
     * @param {number} info.message_type - Message type
     * @param {number} info.message_id - Message ID
     * @param {number} info.fragment_index - Fragment index
     * @param {number} info.fragment_count - Total fragment count
     * @param {number} info.fragments_received - Fragments received so far
     */

    /**
     * Message complete event - emitted after successful message reassembly
     * @event JTPDecoder#message:complete
     * @param {Object} info - Completion information
     * @param {number} info.message_type - Message type
     * @param {number} info.message_id - Message ID
     * @param {number} info.fragment_count - Number of fragments
     * @param {number} info.total_bytes - Total message size
     */

    /**
     * Message incomplete event - emitted when incomplete message is replaced
     * @event JTPDecoder#message:incomplete
     * @param {Object} info - Incomplete message information
     * @param {number} info.message_type - Message type
     * @param {number} info.message_id - Message ID of incomplete message
     * @param {number} info.fragments_received - Fragments received before replacement
     * @param {number} info.fragment_count - Expected fragment count
     */

    /**
     * Error event - emitted on packet validation or reassembly errors
     * @event JTPDecoder#error
     * @param {Error} error - The error that occurred
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
     * Create a new JTP decoder
     * @param {Object} options - Configuration options
     * @param {number} options.source_id - 32-bit source identifier to listen for
     * @param {number[]} [options.message_types] - Optional array of message types to accept (0-63)
     * @throws {Error} If source_id is not provided or invalid
     */
    constructor({ source_id, message_types = null }) {
        super();
        this.source_id = source_id;
        this.message_types = message_types ? new Set(message_types) : null;
        this._accumulators = new Map(); // Map of message_type -> accumulator
    }

    /**
     * Reset message state for incomplete messages
     * @param {number} [message_type] - Specific message type to reset, or null for all
     * @returns {void}
     */
    reset_message_state(message_type = null) {
        if (message_type === null) {
            this._accumulators.clear();
        } else {
            this._accumulators.delete(message_type);
        }
    }

    /**
     * Process a JTP packet and extract message data
     * 
     * Validates the packet format, filters by source ID and message type,
     * and accumulates fragments until complete messages can be reassembled.
     * Returns immediately for invalid or filtered packets.
     * 
     * @param {Buffer} packet - JTP packet buffer to decode
     * @returns {boolean} true if packet was processed, false if ignored
     * 
     * @fires JTPDecoder#message:start - Emitted when first fragment of new message arrives
     * @fires JTPDecoder#fragment:received - Emitted for each accepted fragment
     * @fires JTPDecoder#message - Emitted when complete message is reassembled
     * @fires JTPDecoder#message:complete - Emitted after message event with metadata
     * @fires JTPDecoder#message:incomplete - Emitted when incomplete message is replaced
     * @fires JTPDecoder#error - Emitted on packet validation or reassembly errors
     * 
     * @example
     * udpSocket.on('message', (packet) => {
     *   const processed = decoder.decode_packet(packet);
     *   if (!processed) {
     *     console.log('Packet ignored (wrong source or filtered)');
     *   }
     * });
     */
    decode_packet(packet) {
        // Check magic number first for fastest rejection of non-JTP packets
        if (packet.length < 1 || packet.readUInt8(0) !== MAGIC_BYTE) {
            return false; // Not a JTP packet, silently ignore
        }

        if (packet.length < 12) {
            this.emit('error', new Error('Packet too short'));
            return false;
        }

        // Extract version and message type from second byte
        const version_and_type = packet.readUInt8(1);
        const version = (version_and_type >> 6) & 0x03; // Top 2 bits
        const message_type = version_and_type & 0x3F; // Bottom 6 bits

        if (version !== VERSION) {
            this.emit('error', new Error(`Unsupported version: ${version}`));
            return false;
        }

        const message_id = packet.readUInt16LE(2);
        const fragment_index = packet.readUInt16LE(4);
        const fragment_count = packet.readUInt16LE(6);
        const source_id = packet.readUInt32LE(8);
        const payload = packet.subarray(12); // Use subarray instead of slice
        const payload_length = payload.length;

        // Check source_id matches - early filter
        if (source_id !== this.source_id) {
            return false; // Wrong source_id, silently ignore
        }

        // Check message type filter - early filter
        if (this.message_types && !this.message_types.has(message_type)) {
            return false; // Filtered message type, silently ignore
        }

        // Basic validation
        if (fragment_index >= fragment_count || fragment_count === 0 || payload_length > MAX_PAYLOAD_SIZE) {
            this.emit('error', new Error(`Invalid fragment: idx=${fragment_index}, cnt=${fragment_count}, size=${payload_length}`));
            return false;
        }

        // Get or create accumulator for this message type
        let accumulator = this._accumulators.get(message_type);

        // Ignore older messages - fixed boundary logic
        if (accumulator && this._is_newer_message(accumulator.message_id, message_id)) {
            return false; // Older message, ignore
        }

        // Reset if the accumulator is empty, or we are starting a newer message without finishing the last
        if (!accumulator || this._is_newer_message(message_id, accumulator.message_id)) {
            if (accumulator) {
                this.emit('message:incomplete', { 
                    message_type,
                    message_id: accumulator.message_id, 
                    fragments_received: accumulator.fragments_received,
                    fragment_count: accumulator.fragment_count 
                });
            }
            accumulator = {
                message_id: message_id,
                fragment_count: fragment_count,
                fragments_received: 0,
                fragments: new Map(), // Use Map for sparse fragment storage
                message_len: 0,
                valid: true
            };
            this._accumulators.set(message_type, accumulator);
            this.emit('message:start', { message_type, message_id, fragment_count });
        }

        // At this point, message_id's MUST match
        if (message_id !== accumulator.message_id) {
            this.emit('error', new Error(`Message ID mismatch: expected ${accumulator.message_id}, got ${message_id}`));
            return false;
        }

        // Check for duplicate fragments
        if (accumulator.fragments.has(fragment_index)) {
            this.emit('error', new Error(`Duplicate fragment ${fragment_index} for message ${message_id}`));
            return false;
        }

        // Store fragment - copy payload to avoid holding reference to original packet
        const fragment_copy = Buffer.from(payload);
        accumulator.fragments.set(fragment_index, fragment_copy);
        accumulator.fragments_received++;
        accumulator.message_len += payload_length;

        // Validate fragments_received doesn't exceed fragment_count
        if (accumulator.fragments_received > accumulator.fragment_count) {
            this.emit('error', new Error(`Fragment count exceeded: ${accumulator.fragments_received} > ${accumulator.fragment_count}`));
            this.reset_message_state(message_type);
            return false;
        }

        this.emit('fragment:received', { 
            message_type,
            message_id, 
            fragment_index, 
            fragment_count, 
            fragments_received: accumulator.fragments_received 
        });

        // If all fragments received, reassemble and emit
        if (accumulator.fragments_received === accumulator.fragment_count) {
            // For large messages, defer reassembly to avoid blocking
            if (accumulator.fragment_count > 100 || accumulator.message_len > 64 * 1024) {
                setImmediate(() => this._reassemble_message(message_type, message_id));
            } else {
                this._reassemble_message(message_type, message_id);
            }
        }

        return true; // Packet was successfully processed
    }

    /**
     * Reassemble a complete message from fragments
     * 
     * Called when all fragments for a message have been received.
     * Validates fragment completeness and emits the reconstructed message.
     * 
     * @private
     * @param {number} message_type - The message type
     * @param {number} expected_message_id - Expected message ID for validation
     * @returns {void}
     */
    _reassemble_message(message_type, expected_message_id) {
        const accumulator = this._accumulators.get(message_type);
        if (!accumulator || accumulator.message_id !== expected_message_id) {
            return; // Accumulator changed while waiting
        }

        try {
            // Reassemble message from fragments
            const message_buffer = Buffer.allocUnsafe(accumulator.message_len);
            let offset = 0;
            for (let i = 0; i < accumulator.fragment_count; i++) {
                const fragment = accumulator.fragments.get(i);
                if (!fragment) {
                    throw new Error(`Missing fragment ${i}`);
                }
                fragment.copy(message_buffer, offset);
                offset += fragment.length;
            }

            this.emit("message", message_buffer, message_type, { 
                message_id: expected_message_id, 
                fragment_count: accumulator.fragment_count, 
                total_bytes: accumulator.message_len 
            });
            this.emit('message:complete', { 
                message_type,
                message_id: expected_message_id, 
                fragment_count: accumulator.fragment_count, 
                total_bytes: accumulator.message_len 
            });
        } catch (e) {
            this.emit('error', new Error(`Reassembly failed for message ${expected_message_id}: ${e.message}`));
        }
        this.reset_message_state(message_type);
    }

    /**
     * Determine if a message ID is newer than another, handling 16-bit wraparound
     * 
     * @private
     * @param {number} new_id - The potentially newer message ID
     * @param {number} old_id - The existing message ID
     * @returns {boolean} true if new_id is newer than old_id
     */
    _is_newer_message(new_id, old_id) {
        // Handle 16-bit wraparound properly
        // Assumes messages within 32768 of each other are in sequence
        const diff = (new_id - old_id) & 0xFFFF;
        return diff > 0 && diff < 0x8000;
    }
};
