/**
 * @fileoverview JTP (Janky Transfer Protocol) main entry point
 * @author JTP Library
 * @version 1.0.0
 */

/**
 * JTP (Janky Transfer Protocol) Library
 * 
 * A Node.js library implementing JTP, a UDP-based protocol for streaming
 * variable-length data with automatic fragmentation and reassembly.
 * Features a clean, stream-style API built on EventEmitter for reactive
 * programming.
 * 
 * @module jtp
 * @example
 * const { JTPEncoder, JTPDecoder, VERSION } = require('jtp');
 * 
 * // Create encoder and decoder
 * const encoder = new JTPEncoder({ source_id: 0x1234 });
 * const decoder = new JTPDecoder({ source_id: 0x1234 });
 * 
 * // Set up message handling
 * decoder.on('message', (buffer, messageType, metadata) => {
 *   console.log(`Received message: ${buffer.toString()}`);
 * });
 * 
 * // Set up packet forwarding
 * encoder.on('packet', (packet) => {
 *   decoder.decode_packet(packet); // Or send over UDP
 * });
 * 
 * // Encode a message
 * encoder.encode_message(Buffer.from('Hello, World!'), 5);
 */

const JTPEncoder = require('./lib/Encoder');
const JTPDecoder = require('./lib/Decoder');

const { VERSION } = require('./lib/constants');

module.exports = {
    /**
     * Current protocol version
     * @type {number}
     */
    VERSION,
    
    /**
     * JTP Encoder class for fragmenting messages into packets
     * @type {JTPEncoder}
     */
    JTPEncoder,
    
    /**
     * JTP Decoder class for reassembling packets into messages
     * @type {JTPDecoder}
     */
    JTPDecoder
};