/**
 * JTP (Janky Transfer Protocol) Constants
 * 
 * Shared constants used across all JTP components
 */

// Protocol constants
const VERSION = 0; // Protocol version (2 bits: 0-3)
const MAGIC_BYTE = 0x4A; // "J" in ASCII
const MAX_PAYLOAD_SIZE = 1200; // Max payload size per UDP packet

// Header structure constants
const HEADER_SIZE = 12; // Total header size in bytes
const MAX_PACKET_TYPES = 64; // 6-bit packet type field (0-63)
const MAX_MESSAGE_ID = 0xFFFF; // 16-bit message ID field
const MAX_FRAGMENT_COUNT = 0xFFFF; // 16-bit fragment count field

// Protocol limits
const MAX_MESSAGE_SIZE = MAX_PAYLOAD_SIZE * MAX_FRAGMENT_COUNT; // Theoretical max message size

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
