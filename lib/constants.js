/**
 * @fileoverview JTP (Janky Transfer Protocol) Constants
 * @author JTP Library
 * @version 1.0.0
 */

/**
 * JTP (Janky Transfer Protocol) Constants
 * 
 * Shared constants used across all JTP components defining protocol
 * specifications, packet structure, and operational limits.
 */

// Protocol constants

/**
 * Protocol version number (2 bits: 0-3)
 * @constant {number}
 * @default 0
 */
const VERSION = 0;

/**
 * Magic byte identifier for JTP packets ("J" in ASCII)
 * @constant {number}
 * @default 0x4A
 */
const MAGIC_BYTE = 0x4A;

/**
 * Maximum payload size per UDP packet in bytes
 * @constant {number}
 * @default 1200
 */
const MAX_PAYLOAD_SIZE = 1200;

// Header structure constants

/**
 * Total header size in bytes
 * @constant {number}
 * @default 12
 */
const HEADER_SIZE = 12;

/**
 * Maximum number of packet types (6-bit field: 0-63)
 * @constant {number}
 * @default 64
 */
const MAX_PACKET_TYPES = 64;

/**
 * Maximum message ID value (16-bit field)
 * @constant {number}
 * @default 0xFFFF
 */
const MAX_MESSAGE_ID = 0xFFFF;

/**
 * Maximum fragment count value (16-bit field)
 * @constant {number}
 * @default 0xFFFF
 */
const MAX_FRAGMENT_COUNT = 0xFFFF;

// Protocol limits

/**
 * Theoretical maximum message size in bytes
 * @constant {number}
 * @default 78,642,000
 */
const MAX_MESSAGE_SIZE = MAX_PAYLOAD_SIZE * MAX_FRAGMENT_COUNT;

module.exports = {
    VERSION,
    MAGIC_BYTE,
    MAX_PAYLOAD_SIZE,
    HEADER_SIZE,
    MAX_PACKET_TYPES,
    MAX_MESSAGE_ID,
    MAX_FRAGMENT_COUNT,
    MAX_MESSAGE_SIZE
};
