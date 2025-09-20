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
    static get VERSION() { return VERSION; }
    static get MAX_PAYLOAD_SIZE() { return MAX_PAYLOAD_SIZE; }

    constructor({ source_id, message_types = null }) {
        super();
        this.source_id = source_id;
        this.message_types = message_types ? new Set(message_types) : null;
        this._accumulators = new Map(); // Map of message_type -> accumulator
    }

    reset_message_state(message_type = null) {
        if (message_type === null) {
            this._accumulators.clear();
        } else {
            this._accumulators.delete(message_type);
        }
    }

    /**
     * Asynchronously decode a single packet without blocking the event loop
     * @param {Buffer} packet - The packet to decode
     */
    async decode_packet_async(packet) {
        return new Promise((resolve) => {
            setImmediate(() => {
                try {
                    this.decode_packet(packet);
                    resolve();
                } catch (error) {
                    this.emit('error', error);
                    resolve();
                }
            });
        });
    }

    /**
     * Asynchronously decode multiple packets in batches without blocking the event loop
     * @param {Buffer[]} packets - Array of packets to decode
     * @param {number} batch_size - Number of packets to process per batch (default: 50)
     */
    async decode_packets_batch(packets, batch_size = 50) {
        for (let i = 0; i < packets.length; i += batch_size) {
            const batch = packets.slice(i, i + batch_size);
            
            // Process batch synchronously for efficiency
            for (const packet of batch) {
                try {
                    this.decode_packet(packet);
                } catch (error) {
                    this.emit('error', error);
                }
            }
            
            // Yield control to event loop after each batch
            if (i + batch_size < packets.length) {
                await new Promise(resolve => setImmediate(resolve));
            }
        }
    }

    /**
     * Process a JTP packet and extract message data
     * @param {Buffer} packet - JTP packet buffer to decode
     */
    decode_packet(packet) {
        // Check magic number first for fastest rejection of non-JTP packets
        if (packet.length < 1 || packet.readUInt8(0) !== MAGIC_BYTE) {
            return; // Not a JTP packet, silently ignore
        }

        if (packet.length < 12) {
            this.emit('error', new Error('Packet too short'));
            return;
        }

        // Extract version and message type from second byte
        const version_and_type = packet.readUInt8(1);
        const version = (version_and_type >> 6) & 0x03; // Top 2 bits
        const message_type = version_and_type & 0x3F; // Bottom 6 bits

        if (version !== VERSION) {
            this.emit('error', new Error(`Unsupported version: ${version}`));
            return;
        }

        const message_id = packet.readUInt16LE(2);
        const fragment_index = packet.readUInt16LE(4);
        const fragment_count = packet.readUInt16LE(6);
        const source_id = packet.readUInt32LE(8);
        const payload = packet.subarray(12); // Use subarray instead of slice
        const payload_length = payload.length;

        // Check source_id matches - early filter
        if (source_id !== this.source_id) {
            return; // Wrong source_id, silently ignore
        }

        // Check message type filter - early filter
        if (this.message_types && !this.message_types.has(message_type)) {
            return; // Filtered message type, silently ignore
        }

        // Basic validation
        if (fragment_index >= fragment_count || fragment_count === 0 || payload_length > MAX_PAYLOAD_SIZE) {
            this.emit('error', new Error(`Invalid fragment: idx=${fragment_index}, cnt=${fragment_count}, size=${payload_length}`));
            return;
        }

        // Get or create accumulator for this message type
        let accumulator = this._accumulators.get(message_type);

        // Ignore older messages - fixed boundary logic
        if (accumulator && this._is_newer_message(accumulator.message_id, message_id)) {
            return; // Older message, ignore
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
            return;
        }

        // Check for duplicate fragments
        if (accumulator.fragments.has(fragment_index)) {
            this.emit('error', new Error(`Duplicate fragment ${fragment_index} for message ${message_id}`));
            return;
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
            return;
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
    }

    /**
     * Reassemble a complete message from fragments
     * @param {number} message_type - The message type
     * @param {number} expected_message_id - Expected message ID for validation
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

    _is_newer_message(new_id, old_id) {
        // Handle 16-bit wraparound properly
        // Assumes messages within 32768 of each other are in sequence
        const diff = (new_id - old_id) & 0xFFFF;
        return diff > 0 && diff < 0x8000;
    }
};
