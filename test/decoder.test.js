/**
 * @fileoverview Test suite for JTPDecoder class
 * @author JTP Library
 * @version 1.0.0
 */

const { expect } = require('chai');
const JTPDecoder = require('../lib/Decoder');
const JTPEncoder = require('../lib/Encoder');
const { VERSION, MAGIC_BYTE, MAX_PAYLOAD_SIZE } = require('../lib/constants');

describe('JTPDecoder', function() {
    let decoder;
    const SOURCE_ID = 0x12345678;
    const OTHER_SOURCE_ID = 0x87654321;

    beforeEach(function() {
        decoder = new JTPDecoder({ source_id: SOURCE_ID });
    });

    describe('Constructor', function() {
        it('should create decoder with source ID', function() {
            expect(decoder.source_id).to.equal(SOURCE_ID);
            expect(decoder.message_types).to.be.null;
        });

        it('should create decoder with message type filter', function() {
            const filtered_decoder = new JTPDecoder({ 
                source_id: SOURCE_ID, 
                message_types: [1, 5, 10] 
            });
            expect(filtered_decoder.message_types).to.be.instanceOf(Set);
            expect(filtered_decoder.message_types.has(1)).to.be.true;
            expect(filtered_decoder.message_types.has(5)).to.be.true;
            expect(filtered_decoder.message_types.has(10)).to.be.true;
            expect(filtered_decoder.message_types.has(2)).to.be.false;
        });

        it('should expose static constants', function() {
            expect(JTPDecoder.VERSION).to.equal(VERSION);
            expect(JTPDecoder.MAX_PAYLOAD_SIZE).to.equal(MAX_PAYLOAD_SIZE);
        });
    });

    describe('Message State Management', function() {
        it('should reset all message state', function() {
            // Add some mock accumulators
            decoder._accumulators.set(1, { mock: 'data1' });
            decoder._accumulators.set(2, { mock: 'data2' });
            
            decoder.reset_message_state();
            expect(decoder._accumulators.size).to.equal(0);
        });

        it('should reset specific message type state', function() {
            decoder._accumulators.set(1, { mock: 'data1' });
            decoder._accumulators.set(2, { mock: 'data2' });
            
            decoder.reset_message_state(1);
            expect(decoder._accumulators.has(1)).to.be.false;
            expect(decoder._accumulators.has(2)).to.be.true;
        });
    });

    describe('Packet Validation', function() {
        it('should ignore non-JTP packets (wrong magic byte)', function() {
            const bad_packet = Buffer.alloc(20);
            bad_packet.writeUInt8(0x00, 0); // Wrong magic byte
            
            const result = decoder.decode_packet(bad_packet);
            expect(result).to.be.false;
        });

        it('should reject packets that are too short', function(done) {
            const short_packet = Buffer.alloc(10); // Less than 12 bytes
            short_packet.writeUInt8(MAGIC_BYTE, 0);
            
            decoder.on('error', (error) => {
                expect(error.message).to.include('Packet too short');
                done();
            });
            
            const result = decoder.decode_packet(short_packet);
            expect(result).to.be.false;
        });

        it('should reject packets with unsupported version', function(done) {
            const bad_version_packet = Buffer.alloc(15);
            bad_version_packet.writeUInt8(MAGIC_BYTE, 0);
            bad_version_packet.writeUInt8((3 << 6) | 5, 1); // Version 3 (unsupported)
            
            decoder.on('error', (error) => {
                expect(error.message).to.include('Unsupported version: 3');
                done();
            });
            
            const result = decoder.decode_packet(bad_version_packet);
            expect(result).to.be.false;
        });

        it('should ignore packets from wrong source', function() {
            const packet = createValidPacket({
                source_id: OTHER_SOURCE_ID,
                message_type: 1,
                message_id: 0,
                fragment_index: 0,
                fragment_count: 1,
                payload: Buffer.from('test')
            });
            
            const result = decoder.decode_packet(packet);
            expect(result).to.be.false;
        });

        it('should ignore filtered message types', function() {
            const filtered_decoder = new JTPDecoder({ 
                source_id: SOURCE_ID, 
                message_types: [1, 2] 
            });
            
            const packet = createValidPacket({
                source_id: SOURCE_ID,
                message_type: 5, // Not in filter
                message_id: 0,
                fragment_index: 0,
                fragment_count: 1,
                payload: Buffer.from('test')
            });
            
            const result = filtered_decoder.decode_packet(packet);
            expect(result).to.be.false;
        });

        it('should reject invalid fragment parameters', function(done) {
            let error_count = 0;
            const expected_errors = 3;
            
            decoder.on('error', (error) => {
                expect(error.message).to.include('Invalid fragment');
                error_count++;
                if (error_count === expected_errors) {
                    done();
                }
            });
            
            // Fragment index >= fragment count
            let packet = createValidPacket({
                source_id: SOURCE_ID,
                message_type: 1,
                message_id: 0,
                fragment_index: 5,
                fragment_count: 5,
                payload: Buffer.from('test')
            });
            decoder.decode_packet(packet);
            
            // Fragment count is 0
            packet = createValidPacket({
                source_id: SOURCE_ID,
                message_type: 1,
                message_id: 1,
                fragment_index: 0,
                fragment_count: 0,
                payload: Buffer.from('test')
            });
            decoder.decode_packet(packet);
            
            // Payload too large
            packet = createValidPacket({
                source_id: SOURCE_ID,
                message_type: 1,
                message_id: 2,
                fragment_index: 0,
                fragment_count: 1,
                payload: Buffer.alloc(MAX_PAYLOAD_SIZE + 1)
            });
            decoder.decode_packet(packet);
        });
    });

    describe('Single Fragment Messages', function() {
        it('should decode complete single-fragment message', function(done) {
            const original_message = Buffer.from('Hello, World!');
            const message_type = 5;
            
            decoder.on('message:start', (info) => {
                expect(info.message_type).to.equal(message_type);
                expect(info.message_id).to.equal(100);
                expect(info.fragment_count).to.equal(1);
            });
            
            decoder.on('fragment:received', (info) => {
                expect(info.message_type).to.equal(message_type);
                expect(info.message_id).to.equal(100);
                expect(info.fragment_index).to.equal(0);
                expect(info.fragment_count).to.equal(1);
                expect(info.fragments_received).to.equal(1);
            });
            
            decoder.on('message', (buffer, type, metadata) => {
                expect(buffer).to.deep.equal(original_message);
                expect(type).to.equal(message_type);
                expect(metadata.message_id).to.equal(100);
                expect(metadata.fragment_count).to.equal(1);
                expect(metadata.total_bytes).to.equal(original_message.length);
            });
            
            decoder.on('message:complete', (info) => {
                expect(info.message_type).to.equal(message_type);
                expect(info.message_id).to.equal(100);
                expect(info.fragment_count).to.equal(1);
                expect(info.total_bytes).to.equal(original_message.length);
                done();
            });
            
            const packet = createValidPacket({
                source_id: SOURCE_ID,
                message_type: message_type,
                message_id: 100,
                fragment_index: 0,
                fragment_count: 1,
                payload: original_message
            });
            
            const result = decoder.decode_packet(packet);
            expect(result).to.be.true;
        });
    });

    describe('Multi-Fragment Messages', function() {
        it('should reassemble multi-fragment message in order', function(done) {
            const fragment1 = Buffer.from('Hello, ');
            const fragment2 = Buffer.from('World!');
            const expected_message = Buffer.concat([fragment1, fragment2]);
            const message_type = 10;
            const message_id = 200;
            
            let fragments_received = 0;
            
            decoder.on('fragment:received', (info) => {
                fragments_received++;
                expect(info.message_type).to.equal(message_type);
                expect(info.message_id).to.equal(message_id);
                expect(info.fragment_count).to.equal(2);
            });
            
            decoder.on('message', (buffer, type, metadata) => {
                expect(buffer).to.deep.equal(expected_message);
                expect(type).to.equal(message_type);
                expect(metadata.message_id).to.equal(message_id);
                expect(metadata.fragment_count).to.equal(2);
                expect(fragments_received).to.equal(2);
                done();
            });
            
            // Send fragments in order
            const packet1 = createValidPacket({
                source_id: SOURCE_ID,
                message_type: message_type,
                message_id: message_id,
                fragment_index: 0,
                fragment_count: 2,
                payload: fragment1
            });
            
            const packet2 = createValidPacket({
                source_id: SOURCE_ID,
                message_type: message_type,
                message_id: message_id,
                fragment_index: 1,
                fragment_count: 2,
                payload: fragment2
            });
            
            expect(decoder.decode_packet(packet1)).to.be.true;
            expect(decoder.decode_packet(packet2)).to.be.true;
        });

        it('should reassemble multi-fragment message out of order', function(done) {
            const fragment1 = Buffer.from('Hello, ');
            const fragment2 = Buffer.from('beautiful ');
            const fragment3 = Buffer.from('World!');
            const expected_message = Buffer.concat([fragment1, fragment2, fragment3]);
            const message_type = 15;
            const message_id = 300;
            
            decoder.on('message', (buffer, type, metadata) => {
                expect(buffer).to.deep.equal(expected_message);
                expect(type).to.equal(message_type);
                expect(metadata.fragment_count).to.equal(3);
                done();
            });
            
            // Send fragments out of order: 2, 0, 1
            const packets = [
                createValidPacket({
                    source_id: SOURCE_ID,
                    message_type: message_type,
                    message_id: message_id,
                    fragment_index: 1,
                    fragment_count: 3,
                    payload: fragment2
                }),
                createValidPacket({
                    source_id: SOURCE_ID,
                    message_type: message_type,
                    message_id: message_id,
                    fragment_index: 0,
                    fragment_count: 3,
                    payload: fragment1
                }),
                createValidPacket({
                    source_id: SOURCE_ID,
                    message_type: message_type,
                    message_id: message_id,
                    fragment_index: 2,
                    fragment_count: 3,
                    payload: fragment3
                })
            ];
            
            packets.forEach(packet => {
                expect(decoder.decode_packet(packet)).to.be.true;
            });
        });

        it('should handle missing fragments by not completing message', function(done) {
            const message_type = 20;
            const message_id = 400;
            let fragments_received = 0;
            
            decoder.on('fragment:received', (info) => {
                fragments_received++;
                if (fragments_received === 2) {
                    // We've received 2 out of 3 fragments, message should not complete
                    setTimeout(() => {
                        // Verify message is still incomplete
                        const accumulator = decoder._accumulators.get(message_type);
                        expect(accumulator).to.exist;
                        expect(accumulator.fragments_received).to.equal(2);
                        expect(accumulator.fragment_count).to.equal(3);
                        done();
                    }, 100);
                }
            });
            
            decoder.on('message', () => {
                throw new Error('Should not receive complete message with missing fragments');
            });
            
            // Send only fragments 0 and 2, missing fragment 1
            const packet1 = createValidPacket({
                source_id: SOURCE_ID,
                message_type: message_type,
                message_id: message_id,
                fragment_index: 0,
                fragment_count: 3,
                payload: Buffer.from('part1')
            });
            
            const packet3 = createValidPacket({
                source_id: SOURCE_ID,
                message_type: message_type,
                message_id: message_id,
                fragment_index: 2,
                fragment_count: 3,
                payload: Buffer.from('part3')
            });
            
            decoder.decode_packet(packet1);
            decoder.decode_packet(packet3);
        });

        it('should reject duplicate fragments', function(done) {
            const message_type = 25;
            const message_id = 500;
            
            decoder.on('error', (error) => {
                expect(error.message).to.include('Duplicate fragment 0');
                done();
            });
            
            const packet = createValidPacket({
                source_id: SOURCE_ID,
                message_type: message_type,
                message_id: message_id,
                fragment_index: 0,
                fragment_count: 2,
                payload: Buffer.from('test')
            });
            
            // Send same fragment twice
            decoder.decode_packet(packet);
            decoder.decode_packet(packet);
        });
    });

    describe('Message ID Wraparound', function() {
        it('should handle message ID wraparound correctly', function(done) {
            const message_type = 30;
            
            // Simulate newer message (wraparound case)
            decoder.on('message:incomplete', (info) => {
                expect(info.message_type).to.equal(message_type);
                expect(info.message_id).to.equal(0xFFFE);
                expect(info.fragments_received).to.equal(1);
            });
            
            decoder.on('message', (buffer, type, metadata) => {
                expect(metadata.message_id).to.equal(0x0001); // Newer message
                done();
            });
            
            // Start old message
            const old_packet = createValidPacket({
                source_id: SOURCE_ID,
                message_type: message_type,
                message_id: 0xFFFE,
                fragment_index: 0,
                fragment_count: 2,
                payload: Buffer.from('old')
            });
            decoder.decode_packet(old_packet);
            
            // Start newer message (should replace old one)
            const new_packet = createValidPacket({
                source_id: SOURCE_ID,
                message_type: message_type,
                message_id: 0x0001,
                fragment_index: 0,
                fragment_count: 1,
                payload: Buffer.from('new')
            });
            decoder.decode_packet(new_packet);
        });
    });

    describe('Multiple Message Types', function() {
        it('should handle concurrent messages of different types', function(done) {
            const type1_message = Buffer.from('Type 1 message');
            const type2_message = Buffer.from('Type 2 message');
            let completed_messages = 0;
            
            decoder.on('message', (buffer, type, metadata) => {
                if (type === 1) {
                    expect(buffer).to.deep.equal(type1_message);
                } else if (type === 2) {
                    expect(buffer).to.deep.equal(type2_message);
                } else {
                    throw new Error(`Unexpected message type: ${type}`);
                }
                
                completed_messages++;
                if (completed_messages === 2) {
                    done();
                }
            });
            
            // Send packets for both message types interleaved
            const packets = [
                createValidPacket({
                    source_id: SOURCE_ID,
                    message_type: 1,
                    message_id: 100,
                    fragment_index: 0,
                    fragment_count: 1,
                    payload: type1_message
                }),
                createValidPacket({
                    source_id: SOURCE_ID,
                    message_type: 2,
                    message_id: 200,
                    fragment_index: 0,
                    fragment_count: 1,
                    payload: type2_message
                })
            ];
            
            packets.forEach(packet => decoder.decode_packet(packet));
        });
    });

    describe('Integration with Encoder', function() {
        it('should correctly decode encoder output', function(done) {
            const encoder = new JTPEncoder({ source_id: SOURCE_ID });
            const original_message = Buffer.from('Integration test message that should be fragmented across multiple packets to test the complete encode/decode cycle.');
            const message_type = 42;
            const packets = [];
            
            // Collect packets from encoder
            encoder.on('packet', (packet) => {
                packets.push(packet);
            });
            
            // Decode collected packets when encoding completes
            encoder.on('message:encoded', (metadata) => {
                expect(packets.length).to.equal(metadata.fragment_count);
                
                // Decode packets in random order to test reassembly
                const shuffled_packets = [...packets].sort(() => Math.random() - 0.5);
                shuffled_packets.forEach(packet => decoder.decode_packet(packet));
            });
            
            // Verify decoded message matches original
            decoder.on('message', (buffer, type, metadata) => {
                expect(buffer).to.deep.equal(original_message);
                expect(type).to.equal(message_type);
                done();
            });
            
            // Start the test
            encoder.encode_message(original_message, message_type);
        });
    });

    describe('Empty Messages', function() {
        it('should handle empty message payload', function(done) {
            const empty_payload = Buffer.alloc(0);
            const message_type = 0;
            
            decoder.on('message', (buffer, type, metadata) => {
                expect(buffer).to.deep.equal(empty_payload);
                expect(buffer.length).to.equal(0);
                expect(type).to.equal(message_type);
                expect(metadata.total_bytes).to.equal(0);
                done();
            });
            
            const packet = createValidPacket({
                source_id: SOURCE_ID,
                message_type: message_type,
                message_id: 0,
                fragment_index: 0,
                fragment_count: 1,
                payload: empty_payload
            });
            
            decoder.decode_packet(packet);
        });
    });
});

/**
 * Helper function to create valid JTP packets for testing
 * @param {Object} options - Packet creation options
 * @param {number} options.source_id - Source ID for the packet
 * @param {number} options.message_type - Message type (0-63)
 * @param {number} options.message_id - Message ID
 * @param {number} options.fragment_index - Fragment index
 * @param {number} options.fragment_count - Total fragment count
 * @param {Buffer} options.payload - Payload data
 * @returns {Buffer} Valid JTP packet buffer
 */
function createValidPacket({ source_id, message_type, message_id, fragment_index, fragment_count, payload }) {
    const header_size = 12;
    const packet = Buffer.allocUnsafe(header_size + payload.length);
    
    const version_and_type = (VERSION << 6) | (message_type & 0x3F);
    packet.writeUInt8(MAGIC_BYTE, 0);
    packet.writeUInt8(version_and_type, 1);
    packet.writeUInt16LE(message_id, 2);
    packet.writeUInt16LE(fragment_index, 4);
    packet.writeUInt16LE(fragment_count, 6);
    packet.writeUInt32LE(source_id, 8);
    
    payload.copy(packet, header_size);
    
    return packet;
}
