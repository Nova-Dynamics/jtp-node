/**
 * @fileoverview Test suite for JTPEncoder class
 * @author JTP Library
 * @version 1.0.0
 */

const { expect } = require('chai');
const JTPEncoder = require('../lib/Encoder');
const { VERSION, MAGIC_BYTE, MAX_PAYLOAD_SIZE } = require('../lib/constants');

describe('JTPEncoder', function() {
    let encoder;
    const SOURCE_ID = 0x12345678;

    beforeEach(function() {
        encoder = new JTPEncoder({ source_id: SOURCE_ID });
    });

    describe('Constructor', function() {
        it('should create encoder with source ID', function() {
            expect(encoder.source_id).to.equal(SOURCE_ID);
            expect(encoder.message_id).to.equal(0);
        });

        it('should expose static constants', function() {
            expect(JTPEncoder.VERSION).to.equal(VERSION);
            expect(JTPEncoder.MAX_PAYLOAD_SIZE).to.equal(MAX_PAYLOAD_SIZE);
        });
    });

    describe('Message ID Management', function() {
        it('should increment message ID', function() {
            expect(encoder.message_id).to.equal(0);
            encoder.increment_message_id();
            expect(encoder.message_id).to.equal(1);
        });

        it('should wrap message ID at 16-bit boundary', function() {
            encoder.message_id = 0xFFFF;
            encoder.increment_message_id();
            expect(encoder.message_id).to.equal(0);
        });
    });

    describe('Input Validation', function() {
        it('should reject invalid message types', function(done) {
            const invalid_types = [-1, 64, 100, 255];
            let error_count = 0;

            encoder.on('error', (error, metadata) => {
                expect(error.message).to.include('Message type must be 0-63');
                error_count++;
                if (error_count === invalid_types.length) {
                    done();
                }
            });

            invalid_types.forEach(type => {
                const result = encoder.encode_message(Buffer.from('test'), type);
                expect(result).to.be.null;
            });
        });

        it('should reject non-buffer messages', function(done) {
            encoder.on('error', (error) => {
                expect(error.message).to.include('message_buffer must be a Buffer');
                done();
            });

            const result = encoder.encode_message('not a buffer', 1);
            expect(result).to.be.null;
        });

        it('should reject messages too large to fragment', function(done) {
            // Create a message that would require more than 65535 fragments
            const huge_size = MAX_PAYLOAD_SIZE * 0x10000;
            const huge_buffer = Buffer.alloc(huge_size);

            encoder.on('error', (error) => {
                expect(error.message).to.include('Message too large to fragment');
                done();
            });

            const result = encoder.encode_message(huge_buffer, 1);
            expect(result).to.be.null;
        });
    });

    describe('Single Fragment Messages', function() {
        it('should encode small message as single packet', function(done) {
            const message = Buffer.from('Hello, World!');
            const message_type = 5;
            let packet_count = 0;

            encoder.on('packet', (packet, info) => {
                packet_count++;
                
                // Validate packet structure
                expect(packet).to.be.instanceOf(Buffer);
                expect(packet.length).to.equal(12 + message.length);
                
                // Validate header
                expect(packet.readUInt8(0)).to.equal(MAGIC_BYTE);
                expect(packet.readUInt8(1)).to.equal((VERSION << 6) | message_type);
                expect(packet.readUInt16LE(2)).to.equal(0); // message_id
                expect(packet.readUInt16LE(4)).to.equal(0); // fragment_index
                expect(packet.readUInt16LE(6)).to.equal(1); // fragment_count
                expect(packet.readUInt32LE(8)).to.equal(SOURCE_ID);
                
                // Validate payload
                const payload = packet.subarray(12);
                expect(payload).to.deep.equal(message);
                
                // Validate metadata
                expect(info.message_id).to.equal(0);
                expect(info.message_type).to.equal(message_type);
                expect(info.fragment_index).to.equal(0);
                expect(info.fragment_count).to.equal(1);
                expect(info.fragment_size).to.equal(message.length);
            });

            encoder.on('message:encoded', (metadata) => {
                expect(packet_count).to.equal(1);
                expect(metadata.message_id).to.equal(0);
                expect(metadata.message_type).to.equal(message_type);
                expect(metadata.fragment_count).to.equal(1);
                expect(metadata.total_bytes).to.equal(message.length);
                done();
            });

            const message_id = encoder.encode_message(message, message_type);
            expect(message_id).to.equal(0);
        });
    });

    describe('Multi-Fragment Messages', function() {
        it('should fragment large messages correctly', function(done) {
            // Create a message larger than MAX_PAYLOAD_SIZE
            const message_size = MAX_PAYLOAD_SIZE * 2.5; // 2.5 fragments
            const message = Buffer.alloc(Math.floor(message_size));
            message.fill(0xAB); // Fill with test pattern
            
            const message_type = 10;
            const expected_fragments = Math.ceil(message_size / MAX_PAYLOAD_SIZE);
            const packets = [];

            encoder.on('packet', (packet, info) => {
                packets.push({ packet, info });
                
                // Validate each packet header
                expect(packet.readUInt8(0)).to.equal(MAGIC_BYTE);
                expect(packet.readUInt8(1)).to.equal((VERSION << 6) | message_type);
                expect(packet.readUInt16LE(2)).to.equal(0); // message_id should be 0 (first message)
                expect(packet.readUInt16LE(4)).to.equal(info.fragment_index);
                expect(packet.readUInt16LE(6)).to.equal(expected_fragments);
                expect(packet.readUInt32LE(8)).to.equal(SOURCE_ID);
                
                // Validate fragment size
                const expected_size = (info.fragment_index === expected_fragments - 1) ?
                    message_size % MAX_PAYLOAD_SIZE || MAX_PAYLOAD_SIZE :
                    MAX_PAYLOAD_SIZE;
                expect(info.fragment_size).to.equal(expected_size);
            });

            encoder.on('message:encoded', (metadata) => {
                expect(packets.length).to.equal(expected_fragments);
                expect(metadata.fragment_count).to.equal(expected_fragments);
                expect(metadata.total_bytes).to.equal(message.length);
                
                // Verify packet order and content
                for (let i = 0; i < packets.length; i++) {
                    expect(packets[i].info.fragment_index).to.equal(i);
                    
                    const payload = packets[i].packet.subarray(12);
                    const start = i * MAX_PAYLOAD_SIZE;
                    const end = Math.min(start + MAX_PAYLOAD_SIZE, message.length);
                    const expected_payload = message.subarray(start, end);
                    
                    expect(payload).to.deep.equal(expected_payload);
                }
                
                done();
            });

            const message_id = encoder.encode_message(message, message_type);
            expect(message_id).to.equal(0);
        });
    });

    describe('Callback Support', function() {
        it('should call callback when encoding completes', function(done) {
            const message = Buffer.from('Callback test');
            const message_type = 15;

            encoder.encode_message(message, message_type, (metadata) => {
                expect(metadata.message_id).to.equal(0); // Fresh encoder starts at 0
                expect(metadata.message_type).to.equal(message_type);
                expect(metadata.fragment_count).to.equal(1);
                expect(metadata.total_bytes).to.equal(message.length);
                done();
            });
        });

        it('should handle callback with multi-fragment message', function(done) {
            const message = Buffer.alloc(MAX_PAYLOAD_SIZE * 3);
            const message_type = 20;

            encoder.encode_message(message, message_type, (metadata) => {
                expect(metadata.fragment_count).to.equal(3);
                expect(metadata.total_bytes).to.equal(message.length);
                done();
            });
        });
    });

    describe('Concurrent Encoding', function() {
        it('should handle multiple concurrent messages', function(done) {
            const messages = [
                { buffer: Buffer.from('Message 1'), type: 1 },
                { buffer: Buffer.from('Message 2'), type: 2 },
                { buffer: Buffer.from('Message 3'), type: 3 }
            ];
            
            const encoded_messages = new Set();
            
            encoder.on('message:encoded', (metadata) => {
                encoded_messages.add(metadata.message_id);
                
                if (encoded_messages.size === messages.length) {
                    expect(encoded_messages.size).to.equal(3);
                    expect(Array.from(encoded_messages).sort()).to.deep.equal([0, 1, 2]);
                    done();
                }
            });

            // Encode all messages rapidly
            messages.forEach(msg => {
                encoder.encode_message(msg.buffer, msg.type);
            });
        });
    });

    describe('Empty Messages', function() {
        it('should handle empty buffer', function(done) {
            const empty_buffer = Buffer.alloc(0);
            const message_type = 7;

            encoder.on('packet', (packet, info) => {
                expect(packet.length).to.equal(12); // Just header
                expect(info.fragment_size).to.equal(0);
                expect(info.fragment_count).to.equal(1);
            });

            encoder.on('message:encoded', (metadata) => {
                expect(metadata.total_bytes).to.equal(0);
                expect(metadata.fragment_count).to.equal(1);
                done();
            });

            encoder.encode_message(empty_buffer, message_type);
        });
    });

    describe('Error Handling', function() {
        it('should emit error for invalid input and continue working', function(done) {
            let error_received = false;

            encoder.on('error', (error) => {
                error_received = true;
                expect(error.message).to.include('Message type must be 0-63');
            });

            encoder.on('message:encoded', (metadata) => {
                expect(error_received).to.be.true;
                expect(metadata.message_type).to.equal(5);
                done();
            });

            // First encode with invalid type
            encoder.encode_message(Buffer.from('test'), 100);
            
            // Then encode with valid type
            setTimeout(() => {
                encoder.encode_message(Buffer.from('valid'), 5);
            }, 10);
        });
    });
});
